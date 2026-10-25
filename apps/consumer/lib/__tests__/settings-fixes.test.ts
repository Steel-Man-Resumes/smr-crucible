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
import { PROGRESSION_AI } from '../progression-policy';
import { handleTourWrite, type TourWriteStore } from '../tour/tour-write';
import { TOURS, readTourSlot, isTourId, slotSql } from '../tour/registry';
import { grantTourRewardWith } from '../tour/tour-sql';
import { ALL_TICKED, EXPORT_BOXES, FULL_COPY_ONLY, exportCategories, exportLeavesOut, exportFileName, documentsFileName, exportConfirmBody, noPasswordExportConfirmed, vaultZipPlan, VAULT_ZIP_MAX_BYTES, VAULT_ZIP_TOO_LARGE, DOCUMENTS_DOWNLOAD_FAILED, skippedFilesNote, SKIPPED_FILE_NAME } from '../export-plan';
import { saveErrorWords, SAVE_ERROR_FALLBACK } from '../save-error';
import { buildUsageView, usageWords, nextUtcMidnight, toolRemaining, legacyToolLeft, oneActionCostLine, draftFailureWords, type UsageView } from '../usage-view';

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

test('S10 (SF-5): ui-prefs treats the avatar as private: no impersonation sets or clears the photo choice, and GET hides the photo id', () => {
  const src = read('app/api/user/ui-prefs/route.ts');
  assert.match(src, /if \("avatar" in body\) \{\s*(?:\/\/[^\n]*\n\s*)*const refused = settingsRefusal\(session, "private", "write"\); if \(refused\) return refused;\s*patch\.avatar = body\.avatar;/,
    'the avatar field is guarded as private before it reaches setUiPrefs');
  assert.match(src, /session\?\.impersonation && prefs\.avatar\?\.photoAssetId/, 'GET strips the photo id while impersonating');
  assert.equal(settingsVerdict({ mode: 'assist' }, 'private', 'write'), SETTINGS_REFUSAL.private, 'assist mode is refused too');
});

test('S10 (SF-6): a refused save shows the route\'s words beside the control and never shows an unsaved change', () => {
  assert.equal(saveErrorWords({ error: SETTINGS_REFUSAL.consent }), SETTINGS_REFUSAL.consent);
  assert.equal(saveErrorWords({ error: '' }), SAVE_ERROR_FALLBACK);
  assert.equal(saveErrorWords(null), SAVE_ERROR_FALLBACK);
  assert.equal(saveErrorWords({ error: 'x'.repeat(400) }), SAVE_ERROR_FALLBACK, 'a long body is not shown');
  assert.equal(saveErrorWords({ error: 7 }, 'fallback'), 'fallback');
  for (const c of ['components/ConsentPanel.tsx', 'components/SharingConsentSection.tsx', 'components/AccessibilitySettingsSection.tsx']) {
    const src = read(c);
    assert.match(src, /readSaveError\(res\)/, `${c} reads the route's words`);
    assert.match(src, /<SaveError message=/, `${c} shows them`);
    // Every write is awaited into res (reads may still fall back quietly).
    assert.doesNotMatch(src, /method: "(?:POST|PATCH)",[^}]*\}\)\.catch\(\(\) => \{\}\);/, `${c} no longer swallows a failed save`);
    assert.ok((src.match(/const res = await fetch\(/g) ?? []).length >= 1, `${c} awaits its save`);
  }
  assert.doesNotMatch(read('components/ConsentPanel.tsx'), /return res\.ok;/, 'ConsentPanel no longer reduces the answer to ok or not');
  const a11y = read('components/AccessibilitySettingsSection.tsx');
  assert.match(a11y, /if \(!res\.ok\) \{ showPrefs\(before\);/, 'a refused display change is rolled back on screen');
  assert.match(a11y, /if \(!res\.ok\) \{ setCoach\(before\);/, 'a refused reading-help change is rolled back');
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

/* S5: Usage shows the allowance the tools spend from */

const NOW = new Date('2026-10-24T18:30:00Z');
const fmt = (d: Date) => d.toISOString();
const base = { bonusExpiresAt: null, legacyLimit: 30, toolUsage: {}, toolPolicies: [] };

test('S5: a new account sees base + bonus - used, the number tailor-batch spends from, not the access-code limit', () => {
  // The Valjean walk: tailor remaining went 34 to 31 while Settings showed the access-code count.
  const v = buildUsageView({ ...base, allowance: { existing: false, base: 5, bonus: 2, used: 3 }, bonusExpiresAt: '2026-10-25T09:00:00Z', toolUsage: { 'resume-full': 3 } }, NOW);
  assert.equal(v.kind, 'allowance');
  assert.equal(v.remaining, 4);
  assert.equal(v.base, 5); assert.equal(v.bonus, 2);
  assert.equal(v.bonusExpiresAt, '2026-10-25T09:00:00.000Z');
  assert.equal(v.resetsAt, '2026-10-25T00:00:00.000Z');
  assert.deepEqual(v.ceilings, [], 'the access-code count (30 + 2 - 3) is not lower than 4, so it does not bind and is not shown');
  const w = usageWords(v, fmt);
  assert.equal(w.headline, '4 AI actions left today');
  assert.match(w.line, /allowance is 5 plus 2 bonus/);
  assert.match(w.line, /starts over at 2026-10-25T00:00:00\.000Z/);
  assert.match(w.bonusLine!, /2 bonus actions, good until 2026-10-25T09:00:00\.000Z/);
  assert.doesNotMatch(JSON.stringify(w), /midnight\./, 'no bare "resets at midnight"');
});

test('S5: per-tool ceilings show only where they bind', () => {
  const v = buildUsageView({ ...base, allowance: { existing: false, base: 10, bonus: 0, used: 2 }, toolPolicies: [
    { workflow: 'resume-full', disabled: false, daily_calls: 3, ran: 2 },
    { workflow: 'interview', disabled: false, daily_calls: 50, ran: 0 },
    { workflow: 'fit-check', disabled: true, daily_calls: null, ran: 0 },
  ] }, NOW);
  assert.equal(v.remaining, 8);
  assert.deepEqual(v.ceilings.map(c => [c.tool, c.left, !!c.paused]), [['fit-check', 0, true], ['resume-full', 1, false]]);
});

test('S5: an older account keeps its count per tool; an unlimited one says so; the line never promises more than is checked', () => {
  const old = buildUsageView({ ...base, allowance: { existing: true, base: 100, bonus: 0, used: 0 }, legacyLimit: 100, toolUsage: { coach: 7, headshot_upload: 2 } }, NOW);
  assert.equal(old.kind, 'per-tool');
  assert.equal(old.remaining, null);
  assert.equal(old.perTool, 100);
  assert.deepEqual(old.ceilings.map(c => [c.label, c.left]), [['t.ROY chat', 93]], 'non-AI counters are ignored');
  const open = buildUsageView({ ...base, allowance: { existing: true, base: 0, bonus: 0, used: 0 }, legacyLimit: 0 }, NOW);
  assert.equal(open.kind, 'unlimited');
  assert.equal(usageWords(open).headline, 'No daily AI limit on this account');
  assert.equal(nextUtcMidnight(new Date('2026-12-31T23:59:59Z')), '2027-01-01T00:00:00.000Z');
  // Every tool the line names spends from the allowance.
  for (const t of ['assistant', 'resume-full', 'interview', 'follow-up', 'fit-check']) assert.ok((PROGRESSION_AI as readonly string[]).includes(t), t);
});

test('S5 (SF-2): on an older account the bonus is one shared pool for progression tools, spent account-wide, never a count added to every tool', () => {
  // The admission rule (lib/withRateLimit.ts, lib/ai-operation-server.ts) as numbers.
  assert.equal(legacyToolLeft({ limit: 30, count: 0, bonus: 2, bonusUsed: 0, progression: true }), 32);
  assert.equal(legacyToolLeft({ limit: 30, count: 30, bonus: 2, bonusUsed: 0, progression: true }), 2, 'over the count, the bonus admits');
  assert.equal(legacyToolLeft({ limit: 30, count: 30, bonus: 2, bonusUsed: 2, progression: true }), 0, 'the bonus spent elsewhere is gone here too');
  assert.equal(legacyToolLeft({ limit: 30, count: 10, bonus: 2, bonusUsed: 2, progression: true }), 20);
  assert.equal(legacyToolLeft({ limit: 30, count: 0, bonus: 2, bonusUsed: 0, progression: false }), 30, 'a non-progression tool never sees the bonus');
  assert.equal(legacyToolLeft({ limit: 30, count: 31, bonus: 2, bonusUsed: 0, progression: true }), 1, 'capped at limit + bonus - count');
  assert.equal(legacyToolLeft({ limit: 30, count: 40, bonus: 2, bonusUsed: 0, progression: true }), 0);
  // Both bonus calls spent in t.ROY chat after its 30; analyze is not a progression tool.
  const v = buildUsageView({ ...base, allowance: { existing: true, base: 30, bonus: 2, used: 0, bonusUsed: 2 }, bonusExpiresAt: '2026-10-25T09:00:00Z', toolUsage: { coach: 32, analyze: 5, 'resume-full': 1 } }, NOW);
  assert.equal(v.kind, 'per-tool');
  assert.equal(v.perTool, 30, 'the headline count is the per-tool count, not 32');
  assert.equal(v.bonus, 2); assert.equal(v.bonusLeft, 0);
  assert.deepEqual(v.ceilings.map(c => [c.tool, c.left]), [['coach', 0], ['analyze', 25], ['resume-full', 29]]);
  const w = usageWords(v, fmt);
  assert.equal(w.headline, '30 AI actions a day in each tool');
  assert.match(w.bonusLine!, /^Plus 2 bonus actions shared across .* 0 of them left today, good until 2026-10-25T09:00:00\.000Z\.$/);
  assert.equal(toolRemaining(v, 'follow-up').left, 30, 'an unused progression tool has its count and no bonus left');
  assert.equal(toolRemaining(v, 'coach').left, 0);
  const fresh = buildUsageView({ ...base, allowance: { existing: true, base: 30, bonus: 2, used: 0, bonusUsed: 0 }, toolUsage: {} }, NOW);
  assert.equal(toolRemaining(fresh, 'follow-up').left, 32);
  assert.equal(toolRemaining(fresh, 'analyze').left, 30);
  assert.match(read('app/api/usage/route.ts'), /bonusUsed: allow\.bonusUsed/);
  const tailor = read('app/api/tailor-batch/route.ts');
  assert.match(tailor, /legacyToolLeft\(\{ limit, count: used\?\.call_count \?\? 0, bonus, bonusUsed: allow\.bonusUsed, progression: true \}\)/, 'the tailor follows the same rule');
  assert.doesNotMatch(tailor, /limit \+ bonus - \(used/);
});

test('S5: the route and the page read the allowance, not getUserDailyLimit and the summed counter', () => {
  const route = read('app/api/usage/route.ts');
  assert.match(route, /progressionAllowance\(userId\)/);
  assert.match(route, /buildUsageView\(/);
  assert.doesNotMatch(route, /getUserDailyUsage/);
  const page = read('app/(dashboard)/dashboard/settings/page.tsx');
  assert.match(page, /<UsageCard usage=\{usage\} \/>/);
  assert.doesNotMatch(page, /Resets at midnight\./);
});

/* S6, S7, A3: small truths */

test('S6: the program code copy joins a seat and promises no AI calls', () => {
  const page = read('app/(dashboard)/dashboard/settings/page.tsx');
  assert.match(page, /Join a program with a code/);
  assert.match(page, /joins you to a program&apos;s seat/);
  // SF-4: a code can change tier and AI limit, so it does not "open nothing"; it shares nothing.
  assert.match(page, /joining shares\s+nothing by itself/);
  assert.doesNotMatch(page, /opens\s+nothing by itself/);
  const gate = read('lib/withRateLimit.ts');
  assert.doesNotMatch(gate, /partner code in Settings to upgrade/, 'the tier gate no longer promises an upgrade');
  assert.match(gate, /If a program gave you a code, enter it in Settings\./);
  // Phrases split so the banned-claims scan does not trip on this test.
  for (const gone of ['unlock more ' + 'AI calls', 'daily limit has ' + 'been increased', 'PARTNER' + '123', 'calls' + '/day']) assert.ok(!page.includes(gone), gone);
});

test('S7: the progress-sharing switch shows only to a program member; otherwise one plain line', () => {
  const page = read('app/(dashboard)/dashboard/settings/page.tsx');
  assert.match(page, /codesLoaded && \(redeemedCodes\.length > 0\s*\? <SharingConsentSection \/>\s*: <p id="settings-share-progress"[^>]*>No program is linked to your account/);
  assert.doesNotMatch(page, /\{!isOrgStaff && <SharingConsentSection \/>\}/);
});

test('A3: follow-up drafts show a cost line first and say why a draft failed', () => {
  const allowance: UsageView = { kind: 'allowance', remaining: 3, base: 5, bonus: 0, used: 2, bonusLeft: 0, perTool: null, bonusExpiresAt: null, resetsAt: '', blockedReason: null, ceilings: [] };
  assert.deepEqual(oneActionCostLine(toolRemaining({ ...allowance, ceilings: [] }, 'follow-up')), { line: 'Drafting uses 1 AI action. You have 3 left today.', canRun: true });
  const capped = toolRemaining({ ...allowance, ceilings: [{ tool: 'follow-up', label: 'Follow-up draft', left: 1 }] }, 'follow-up');
  assert.equal(capped.left, 1, 'the lower of the allowance and the tool ceiling');
  const none = oneActionCostLine(toolRemaining({ ...allowance, remaining: 0 }, 'follow-up'));
  assert.equal(none.canRun, false);
  assert.match(none.line, /^Drafting uses 1 AI action\. You have none left today\./);
  assert.equal(oneActionCostLine(toolRemaining({ ...allowance, ceilings: [{ tool: 'follow-up', label: 'x', left: 0, paused: true }] }, 'follow-up')).canRun, false);
  assert.equal(oneActionCostLine(null).line, 'Drafting uses 1 AI action.');
  assert.match(draftFailureWords(429, 'Your current AI allowance or spending limit is reached.'), /allowance/);
  assert.match(draftFailureWords(500), /could not be drafted/);
  const page = read('app/(dashboard)/dashboard/applications/page.tsx');
  assert.match(page, /data-testid="follow-up-cost-line">\{followUpCost\.line\}/);
  assert.match(page, /failure = draftFailureWords\(/);
  assert.doesNotMatch(page, /\}\s*\} catch \{\}\s*setFollowUpFor\(null\);/, 'failures are no longer swallowed');
});

/* S8: export */

test('S8: every export-data category is either a box or named as full-copy-only', () => {
  const route = read('app/api/user/export-data/route.ts');
  const cats = new Set([...route.matchAll(/want\("([a-z_]+)"\)/g)].map(m => m[1]));
  const known = new Set<string>([...EXPORT_BOXES.map(b => b.key), ...FULL_COPY_ONLY.map(c => c.key)]);
  assert.deepEqual([...cats].filter(c => !known.has(c)), [], 'a new category must be listed so unticking says it is left out');
});

test('S8: unticking a box says what the copy leaves out, including the full-copy-only parts', () => {
  assert.equal(exportCategories(ALL_TICKED), undefined, 'all ticked asks for everything');
  assert.deepEqual(exportLeavesOut(ALL_TICKED), []);
  const ticks = { ...ALL_TICKED, chat: false };
  assert.ok(!exportCategories(ticks)!.includes('chat'));
  const out = exportLeavesOut(ticks);
  assert.ok(out.includes('chat history with t.ROY'));
  for (const c of FULL_COPY_ONLY) assert.ok(out.includes(c.label), c.key);
  const page = read('app/(dashboard)/dashboard/settings/page.tsx');
  assert.match(page, /This copy leaves out \{leftOut\.join\(", "\)\}/);
});

test('S8: the files carry Steel Man names on the person\'s own date', () => {
  const d = new Date(2026, 9, 24, 23, 30);
  assert.equal(exportFileName(d), 'steel-man-data-2026-10-24.json');
  assert.equal(documentsFileName(d), 'steel-man-documents-2026-10-24.zip');
  assert.doesNotMatch(read('app/(dashboard)/dashboard/settings/page.tsx'), /second-mile-data/);
});

test('S8: a no-password account exports with a plain confirm, never by typing DELETE', () => {
  assert.equal(noPasswordExportConfirmed({ confirm: true, typedConfirmation: 'DELETE' }), false);
  assert.equal(noPasswordExportConfirmed({ confirm: true, ownDevice: true }), true);
  assert.deepEqual(exportConfirmBody({ password: '', ownDevice: true }), { confirm: true, ownDevice: true });
  for (const r of ['app/api/user/export-data/route.ts', 'app/api/user/export-vault/route.ts']) {
    const src = read(r);
    assert.match(src, /if \(!noPasswordExportConfirmed\(body\)\)/, r);
    assert.doesNotMatch(src, /typedConfirmation !== "DELETE"/, r);
  }
  assert.match(read('app/api/user/delete-data/route.ts'), /"DELETE"/, 'delete keeps its word');
});

test('S8: the documents ZIP is wired, and the shared-computer warning gates both downloads', () => {
  const page = read('app/(dashboard)/dashboard/settings/page.tsx');
  assert.match(page, /fetch\("\/api\/user\/export-vault"/);
  assert.match(page, /\{SHARED_COMPUTER_WARNING\}/);
  assert.match(page, /disabled=\{exportStatus !== "idle" \|\| !anyChecked \|\| !ownDevice\}/);
  assert.match(page, /disabled=\{docsStatus !== "idle" \|\| !ownDevice\}/);
  assert.match(read('app/(dashboard)/dashboard/documents/page.tsx'), /href="\/dashboard\/settings#settings-export"/);
});

test('S8 (SF-3): the documents ZIP refuses over about 4 MB with plain words, names skipped files, and the page stops saying "Try again"', () => {
  assert.equal(VAULT_ZIP_MAX_BYTES, 4 * 1024 * 1024);
  assert.deepEqual(vaultZipPlan([2_000_000, 1_500_000]), { total: 3_500_000, over: false });
  assert.deepEqual(vaultZipPlan([2_000_000, 2_000_000, 2_000_000]), { total: 6_000_000, over: true }, 'three phone photos');
  assert.deepEqual(vaultZipPlan([NaN, -5, 10]), { total: 10, over: false }, 'bad sizes never make it over');
  assert.match(VAULT_ZIP_TOO_LARGE, /^Too many files for one download\. Download fewer documents at a time/);
  const note = skippedFilesNote(2, ['id-card.jpg', 'letter.pdf']);
  assert.match(note, /^2 files were not included/);
  assert.match(note, /- id-card\.jpg\n- letter\.pdf/);
  assert.match(skippedFilesNote(1, ['x.pdf']), /^1 file was not included/);
  const route = read('app/api/user/export-vault/route.ts');
  assert.match(route, /if \(vaultZipPlan\(docs\.map\(\(d\) => Number\(d\.byte_size\)\)\)\.over\) \{\s*return NextResponse\.json\(\{ error: VAULT_ZIP_TOO_LARGE \}, \{ status: 413/, 'sizes are summed before any decrypt');
  assert.match(route, /if \(zip\.length > VAULT_ZIP_MAX_BYTES\) \{\s*return NextResponse\.json\(\{ error: VAULT_ZIP_TOO_LARGE \}, \{ status: 413/);
  assert.match(route, /if \(!decrypted\) \{ skipped\.push\(name\); continue; \}/, 'a skipped file is counted, not dropped');
  assert.match(route, /entries\.push\(\{ name: SKIPPED_FILE_NAME, data: new TextEncoder\(\)\.encode\(skippedFilesNote\(skipped\.length, skipped\)\) \}\)/);
  assert.equal(SKIPPED_FILE_NAME, 'SKIPPED.txt');
  assert.doesNotMatch(route, /NON-impersonatable|non-impersonatable auth\(\) \(/, 'the header says what the route does now');
  const page = read('app/(dashboard)/dashboard/settings/page.tsx');
  assert.doesNotMatch(page, /could not be downloaded\. Try again\./);
  assert.match(page, /setDocsMessage\(data\.error \|\| DOCUMENTS_DOWNLOAD_FAILED\)/);
  assert.match(DOCUMENTS_DOWNLOAD_FAILED, /fewer documents at a time/);
  assert.match(page, /up to about\s+4 MB at a time/);
});

/* T1: the tour store keyed by tour id (the SQL runs for real in tour-store-map-pglite.test.ts) */

test('T1: the old single slot is read as the entrance tour; tours.<id> wins once written; settings never reads it', () => {
  const old = { version: 5, runId: 'a', stop: 3 };
  assert.deepEqual(readTourSlot({ guidedTour: old }, 'entrance'), old);
  assert.equal(readTourSlot({ guidedTour: old }, 'settings'), null);
  const moved = { version: 5, runId: 'b', stop: 4 };
  assert.deepEqual(readTourSlot({ guidedTour: old, tours: { entrance: moved } }, 'entrance'), moved);
  assert.deepEqual(readTourSlot({ tours: { settings: { version: 1, stop: 2 } } }, 'settings'), { version: 1, stop: 2 });
  assert.equal(readTourSlot(null, 'entrance'), null);
  assert.match(slotSql('$6'), /COALESCE\(preferences->'tours'->\$6::text, CASE WHEN \$6::text = 'entrance' THEN preferences->'guidedTour' END\)/);
  assert.equal(isTourId('entrance') && isTourId('settings') && !isTourId('__proto__'), true);
});

test('T1: reward keys stay per tour; settings is reserved and never granted', async () => {
  assert.equal(TOURS.entrance.rewardKey, 'tour:complete');
  assert.equal(TOURS.settings.rewardKey, 'tour:settings');
  assert.equal(TOURS.settings.grants, false);
  const calls: string[] = [];
  const store: TourWriteStore = {
    async start(_u, _r, _p, _s, tourId) { calls.push(`start:${tourId}`); return 'started'; },
    async advance(_u, _r, _q, _s, _c, tourId) { calls.push(`advance:${tourId}`); return 'saved'; },
    async watchedMs() { calls.push('watched'); return 10 * 60_000; },
    async grant(_u, _r, tourId) { calls.push(`grant:${tourId}`); return { status: 'granted', calls: 1 }; },
    async invalidate() {},
  };
  const run = '77777777-7777-4777-8777-777777777777';
  const done = await handleTourWrite(store, 'u', { tourId: 'settings', version: TOURS.settings.version, runId: run, sequence: 1, stop: 3, action: 'complete' });
  assert.equal(done.status, 200);
  assert.equal(done.json.reward, null);
  assert.deepEqual(calls, ['advance:settings'], 'no watch check and no grant for a reserved reward');
  // The entrance write path grants under the entrance tour, never a hard-coded one.
  await handleTourWrite(store, 'u', { version: TOURS.entrance.version, runId: run, sequence: 1, stop: TOURS.entrance.stopCount - 1, action: 'complete' });
  assert.equal(calls.at(-1), 'grant:entrance');
  // If the settings reward is ever switched on, its grant is its own (SF-1): the
  // write path hands the store the tour, not the entrance key.
  const grants = TOURS.settings.grants;
  try {
    TOURS.settings.grants = true;
    await handleTourWrite(store, 'u', { tourId: 'settings', version: TOURS.settings.version, runId: run, sequence: 2, stop: 3, action: 'complete' });
  } finally { TOURS.settings.grants = grants; }
  assert.equal(calls.at(-1), 'grant:settings');
  // A body without tourId is the entrance tour, so the entrance client is unchanged.
  await handleTourWrite(store, 'u', { version: TOURS.entrance.version, runId: run, sequence: 0, stop: 0, action: 'start', previousRunId: null });
  assert.equal(calls.at(-1), 'start:entrance');
  for (const bad of [{ tourId: 'x' }, { tourId: 7 }, { tourId: 'settings', version: TOURS.entrance.version }]) {
    assert.equal((await handleTourWrite(store, 'u', { version: TOURS.settings.version, runId: run, sequence: 1, stop: 0, action: 'progress', ...bad })).status, 400, JSON.stringify(bad));
  }
});

test('T1: the grant SQL binds the tour\'s own reward key and label; the entrance tour still writes exactly tour:complete', async () => {
  const bound: unknown[][] = [];
  const db = { async batchAsUser(_u: string, build: (sql: (s: TemplateStringsArray, ...v: unknown[]) => unknown) => unknown[]) {
    build((_s, ...v) => { bound.push(v); return null; });
    return [[], [], []];
  } };
  const run = '88888888-8888-4888-8888-888888888888';
  await grantTourRewardWith(db, 'u', run);
  let keys = bound.flat().filter(v => typeof v === 'string' && /^tour:/.test(v as string));
  assert.deepEqual([...new Set(keys)], ['tour:complete'], 'default is the entrance key');
  assert.ok(bound.flat().includes('Tour finished: extra AI actions'), 'the entrance label production rows carry');
  bound.length = 0;
  await grantTourRewardWith(db, 'u', run, { key: TOURS.settings.rewardKey, label: TOURS.settings.rewardLabel });
  keys = bound.flat().filter(v => typeof v === 'string' && /^tour:/.test(v as string));
  assert.deepEqual([...new Set(keys)], ['tour:settings'], 'the settings grant reads and writes only its own key');
  assert.equal(keys.length, 3, 'the read, the insert and the not-exists check all use it');
  assert.ok(!bound.flat().includes('tour:complete'));
  assert.notEqual(TOURS.settings.rewardKey, TOURS.entrance.rewardKey);
});
