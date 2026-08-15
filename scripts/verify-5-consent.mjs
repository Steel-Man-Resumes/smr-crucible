// Phase 5 consent-model verify: a one-time "save just this run" stores the
// transcript but leaves NO durable consent (the fix). QA account, reversible.
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../apps/consumer/.env.local', import.meta.url), 'utf8');
for (const k of ['DATABASE_URL', 'DOCUMENT_ENCRYPTION_KEY']) {
  const m = env.match(new RegExp('^' + k + '=["\']?([^"\'\n]+)', 'm'));
  if (m) process.env[k] = m[1];
}
const core = await import('../packages/core/dist/index.js');
const {
  createConversationSession, appendConversationChunk, getConversationTranscript,
  isConsentGranted, revokeConsent, query,
} = core;

const QA = 'c8515692-8ad3-422f-9b1b-b4d24ca84e56';
let fail = 0;
const check = (n, c, d) => { if (c) console.log('  ok  ' + n); else { fail++; console.error('FAIL ' + n + (d ? ' -- ' + d : '')); } };

// Start clean: ensure durable disclosure_transcript is NOT granted.
await revokeConsent(QA, 'disclosure_transcript');
check('precondition: durable consent OFF', (await isConsentGranted(QA, 'disclosure_transcript')) === false);

// Simulate the route's ONE-TIME path: create a session (the route authorizes it
// via sessionConsent), append turns, WITHOUT ever granting the durable layer.
const sid = await createConversationSession({
  ownerUserId: QA, purpose: 'disclosure_rehearsal',
  targetContext: { persona: 'mentor' }, consentLayer: 'disclosure_transcript:session:verify',
});
check('one-time session created', !!sid);
await appendConversationChunk({ ownerUserId: QA, purpose: 'disclosure_rehearsal', sessionId: sid, seq: 0, role: 'user', text: 'I have a felony from 2019.' });
await appendConversationChunk({ ownerUserId: QA, purpose: 'disclosure_rehearsal', sessionId: sid, seq: 1, role: 'assistant', text: 'Thank you for trusting me with that.' });
const t = await getConversationTranscript({ ownerUserId: QA, purpose: 'disclosure_rehearsal', sessionId: sid });
check('transcript stored + decrypts in order', t?.length === 2 && t[0].text.includes('felony') && t[1].role === 'assistant', JSON.stringify(t?.map(x => x.role)));

// THE FIX: a one-time save must NOT have granted durable consent.
check('one-time run left NO durable consent', (await isConsentGranted(QA, 'disclosure_transcript')) === false);

// Idempotent retry of the same seq is a no-op (no dupe).
await appendConversationChunk({ ownerUserId: QA, purpose: 'disclosure_rehearsal', sessionId: sid, seq: 0, role: 'user', text: 'DIFFERENT text same seq' });
const t2 = await getConversationTranscript({ ownerUserId: QA, purpose: 'disclosure_rehearsal', sessionId: sid });
check('idempotent: retry of seq 0 did not overwrite or dupe', t2?.length === 2 && t2[0].text.includes('felony'));

// Foreign owner cannot read.
const foreign = await getConversationTranscript({ ownerUserId: 'fac1ac74-6c26-40e1-a6d1-e80d3c79be9f', purpose: 'disclosure_rehearsal', sessionId: sid });
check('foreign owner cannot read the transcript', foreign === null || foreign?.length === 0, JSON.stringify(foreign));

// Ciphertext at rest is not plaintext.
const raw = await query(`SELECT ciphertext FROM disclosure_rehearsal_chunk WHERE session_id = $1 AND seq = 0`, [sid]);
check('stored ciphertext is NOT the plaintext', !String(raw[0]?.ciphertext || '').includes('felony'));

// cleanup
await query(`DELETE FROM disclosure_rehearsal_chunk WHERE session_id = $1`, [sid]);
await query(`DELETE FROM disclosure_rehearsal_session WHERE id = $1`, [sid]);
console.log(fail ? `\n${fail} FAILURES` : '\nall green');
process.exit(fail ? 1 : 0);
