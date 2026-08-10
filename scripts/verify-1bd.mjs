// Phase 1B+1D live verify: voice reservation budget, consent events + defaults,
// journey snapshot + gate decision. QA account only; cleans up after itself.
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../apps/consumer/.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=["']?([^"'\n]+)/m)[1];

const core = await import('../packages/core/dist/index.js');
const {
  reserveVoiceSession, endVoiceSession, findExpiredActiveSessions, query,
  grantConsent, revokeConsent, isConsentGranted, consentDefaultFor,
  recordProgressEvent, buildJourneySnapshot, computeGateDecision, countApplicationsSent,
} = core;

const QA = 'c8515692-8ad3-422f-9b1b-b4d24ca84e56'; // qafable
let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log('  ok  ' + name);
  else { failures++; console.error('FAIL  ' + name + (detail ? ' -- ' + JSON.stringify(detail).slice(0, 200) : '')); }
};

// --- voice reservation ---
const r1 = await reserveVoiceSession(QA, 'verify-role');
check('first reservation succeeds', r1.status === 'reserved', r1.status);
const r2 = await reserveVoiceSession(QA, 'verify-role');
check('second concurrent reservation refused (one active per user)', r2.status === 'already_active', r2.status);
const ended = await endVoiceSession(QA, r1.session.id, 'user_ended');
check('end session returns elapsed seconds', typeof ended === 'object' ? ended !== null : ended >= 0, ended);
// exhaust budget: insert synthetic used-up sessions today
await query(`INSERT INTO voice_session (user_id, status, reserved_seconds, started_at, expires_at, ended_at, ended_reason)
  VALUES ($1,'ended',1200, now() - interval '2 hours', now() - interval '100 minutes', now() - interval '100 minutes', 'verify')`, [QA]);
const r3 = await reserveVoiceSession(QA);
check('budget exhausted after 1200s used today', r3.status === 'budget_exhausted', r3.status);

// --- consent ---
check('default: enhanced granted', consentDefaultFor('enhanced') === 'granted');
check('default: research declined', consentDefaultFor('research') === 'declined');
const beforeGrant = await isConsentGranted(QA, 'enhanced');
check('absent enhanced row reads granted', beforeGrant === true, beforeGrant);
await revokeConsent(QA, 'enhanced');
check('revoked enhanced reads declined', (await isConsentGranted(QA, 'enhanced')) === false);
await grantConsent(QA, 'enhanced', '2026-06-07-v1');
check('re-granted enhanced reads granted', (await isConsentGranted(QA, 'enhanced')) === true);
const events = await query(
  `SELECT action FROM consumer_consent_event WHERE user_id = $1 AND consent_layer = 'enhanced' ORDER BY created_at`, [QA]);
check('immutable history recorded revoke + grant', events.length >= 2 &&
  events.some(e => e.action === 'revoked') && events.some(e => e.action === 'granted'), events);

// --- journey ---
await recordProgressEvent(QA, 'job_search', { verify: true });
const snap = await buildJourneySnapshot(QA);
check('snapshot v1 with metrics', snap.version === 1 && typeof snap.metrics.jobSearches === 'number', snap.version);
check('job_search event counted', snap.metrics.jobSearches >= 1, snap.metrics.jobSearches);
const gate = computeGateDecision(snap, 'client');
check('gate decision has state + reason', ['needs_profile','needs_resume','full_access'].includes(gate.state) && !!gate.reason, gate);
const gateAdmin = computeGateDecision(snap, 'admin');
check('admin always full_access', gateAdmin.state === 'full_access');
let badType = false;
try { await recordProgressEvent(QA, 'evil_type', {}); } catch { badType = true; }
check('unknown event type rejected', badType);

// --- cleanup ---
await query(`DELETE FROM voice_session WHERE user_id = $1`, [QA]);
await query(`DELETE FROM user_progress_event WHERE user_id = $1 AND context->>'verify' = 'true'`, [QA]);
// consent rows: leave enhanced granted (matches default; the event history is the point and is append-only by design)

console.log(failures ? `\n${failures} FAILURES` : '\nall green');
process.exit(failures ? 1 : 0);
