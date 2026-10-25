/**
 * Settings and You fixes (fix-settings lane, 2026-10-24, TOOL-REVISIONS S1, S2,
 * S5, S6, S7, S8, S10, T2). Each test here failed on 964090c.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coachSaveBody, coachSettingsPatch, COACH_SAVE_FIELDS } from '../coach-settings';
import { SETTINGS_LESSONS } from '../orientation-lessons';
import { settingsVerdict, SETTINGS_REFUSAL } from '../settings-guard';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/* S1: Coach Save must not undo reading help */
const GET_PAYLOAD = {
  coachName: 'Guide', coachStyle: 'balanced', coachLength: 'full', coachFocus: 'guide', coachCreativity: 50,
  coachVoice: false, coachPlainLanguage: false, coachLanguage: 'en',
};

test('S1: the Your Coach save body carries only the five coach fields', () => {
  const body = coachSaveBody(GET_PAYLOAD);
  assert.deepEqual(Object.keys(body).sort(), [...COACH_SAVE_FIELDS].sort());
  for (const k of ['coachVoice', 'coachPlainLanguage', 'coachLanguage']) assert.ok(!(k in body), k);
});

test('S1: a coach save after a plain-language tap leaves plain language, read aloud and Spanish alone', () => {
  const columns = coachSettingsPatch(coachSaveBody({ ...GET_PAYLOAD, coachStyle: 'direct' })).map(([c]) => c);
  assert.ok(columns.includes('coach_style'));
  for (const c of ['coach_voice', 'coach_plain_language', 'coach_language']) assert.ok(!columns.includes(c), c);
});

test('S1: the component posts the picked body, never the whole GET payload', () => {
  const src = read('components/CoachSettingsSection.tsx');
  assert.doesNotMatch(src, /body:\s*JSON\.stringify\(s\)/);
  assert.match(src, /JSON\.stringify\(coachSaveBody\(/);
  assert.match(read('app/api/coach/settings/route.ts'), /coachSettingsPatch\(body\)/);
});

test('S1: the route applies only keys that are present and valid; an absent or bad key gets no default', () => {
  assert.deepEqual(coachSettingsPatch({}), []);
  assert.deepEqual(coachSettingsPatch(null), []);
  assert.deepEqual(coachSettingsPatch({ coachPlainLanguage: true }), [['coach_plain_language', true]]);
  assert.deepEqual(coachSettingsPatch({ coachCreativity: 'loud' }), [], 'a bad creativity is not reset to 50');
  assert.deepEqual(coachSettingsPatch({ coachCreativity: 140 }), [['coach_creativity', 100]]);
  assert.deepEqual(coachSettingsPatch({ coachStyle: 'mean', coachName: '   ' }), []);
  assert.deepEqual(coachSettingsPatch({ coachVoice: 'yes' }), [], 'only real booleans');
});

/* S2: the creativity slider is read; the lesson must say what it really does */
test('S2: creativity reaches the Refinery coach prompt, and the lesson says what it does', () => {
  assert.match(read('app/api/coach/route.ts'), /coachCreativityNote\(profile\.coachCreativity\)/);
  const coach = SETTINGS_LESSONS.find(l => l.id === 'coach');
  assert.ok(coach, 'coach lesson exists');
  const text = JSON.stringify(coach);
  assert.doesNotMatch(text, /framed/, 'the old line promised framing, not behavior');
  assert.match(text, /usual path/);
  assert.match(text, /middle of the slider changes nothing/);
});

/* S10 and T2: Settings and the tours under impersonation */

test('S10: settings verdicts by kind: preference writes need assist, consent writes and anything private need no impersonation', () => {
  const view = { mode: 'view' }, assist = { mode: 'assist' }, odd = { mode: 'something' };
  for (const k of ['preference', 'consent', 'private'] as const) for (const a of ['read', 'write'] as const) assert.equal(settingsVerdict(null, k, a), null, `${k} ${a} as yourself`);
  assert.equal(settingsVerdict(view, 'preference', 'read'), null);
  assert.equal(settingsVerdict(view, 'preference', 'write'), SETTINGS_REFUSAL.viewOnly);
  assert.equal(settingsVerdict(assist, 'preference', 'write'), null);
  assert.equal(settingsVerdict(odd, 'preference', 'write'), SETTINGS_REFUSAL.viewOnly, 'an unknown mode fails toward read only');
  assert.equal(settingsVerdict(assist, 'consent', 'read'), null);
  assert.equal(settingsVerdict(assist, 'consent', 'write'), SETTINGS_REFUSAL.consent);
  assert.equal(settingsVerdict(view, 'consent', 'write'), SETTINGS_REFUSAL.consent);
  for (const imp of [view, assist]) for (const a of ['read', 'write'] as const) assert.equal(settingsVerdict(imp, 'private', a), SETTINGS_REFUSAL.private);
});

const SETTINGS_ROUTES: Record<string, 'preference' | 'consent' | 'private'> = {
  'coach/settings': 'preference', 'user/ui-prefs': 'preference', 'user/package-email': 'preference', usage: 'preference',
  'access-code/mine': 'preference', 'access-code/policy': 'preference', 'user/profile': 'preference', 'user/decisions': 'preference',
  'user/ai-costs': 'preference', 'user/hidden-employers': 'preference',
  consent: 'consent', sharing: 'consent', 'access-code/redeem': 'consent', 'access-code/leave': 'consent', 'user/premium': 'consent',
  'user/export-data': 'private', 'user/delete-data': 'private', 'user/export-vault': 'private', 'user/sessions': 'private',
  'user/security-status': 'private', 'user/login-events': 'private', 'user/2fa/setup': 'private', 'user/2fa/enable': 'private',
  'user/2fa/disable': 'private', 'auth/set-password': 'private', 'avatar/select': 'private', 'avatar/assets': 'private',
  'avatar/[id]': 'private', 'avatar/photo': 'private',
};

test('S10: every Settings route resolves the person with effectiveAuth and guards every handler', () => {
  for (const [route, kind] of Object.entries(SETTINGS_ROUTES)) {
    const src = read(`app/api/${route}/route.ts`);
    assert.doesNotMatch(src, /from "@\/auth"/, `${route} uses plain auth()`);
    assert.match(src, /effectiveAuth/, route);
    const handlers = (src.match(/export (?:async function|const) (?:GET|POST|PUT|PATCH|DELETE)\b|async function handlePost/g) ?? []).length;
    const guards = (src.match(new RegExp(`settingsRefusal\\(session, "${kind}", "(?:read|write)"\\)`, 'g')) ?? []).length
      + (route === 'user/hidden-employers' ? (src.match(/await userId\("(?:read|write)"\)/g) ?? []).length : 0);
    const exportedAlias = /export const POST = withRateLimit\(handlePost/.test(src) ? 1 : 0;
    assert.equal(guards, handlers - exportedAlias, `${route}: ${guards} guards for ${handlers - exportedAlias} handlers`);
  }
  assert.match(read('app/api/sharing/join-prompt/route.ts'), /if \(session\?\.impersonation\) return NextResponse\.json\(\{ show: false \}\)/);
});

test('T2: the tour route refuses every write under any impersonation, and the tour never opens', () => {
  const route = read('app/api/onboarding/tour/route.ts');
  assert.match(route, /if \(session\.impersonation\) return NextResponse\.json\(/);
  assert.doesNotMatch(route, /impersonation\?\.mode === "view"\) return/);
  assert.match(read('components/GuidedTour.tsx'), /held=\{!!props\.held \|\| impersonating\}/);
  const page = read('app/(dashboard)/dashboard/settings/page.tsx');
  assert.match(page, /impersonating \? <p[^>]*>Hidden while you view or assist as this person\.<\/p> : <SecuritySection \/>/);
  assert.match(page, /\{!impersonating && <AvatarSettingsSection \/>\}/);
});
