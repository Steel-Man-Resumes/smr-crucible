import { it } from 'node:test';
import assert from 'node:assert/strict';
import { filterRecordRepetitionFlags, buildOrgVerificationPrompt, type OrgFacts } from '../org-output-verify';
import { projectStaffToolEvidence } from '../staff-tool-evidence';
const reason = 'Robin is interviewing for Shift Supervisor at Example Manufacturing.';
const facts: OrgFacts = { caseload: 2, stalled: 0, neverStarted: 0, hired: 0, unassigned: 0,
  visibleNames: ['Robin', 'Alex'], staffNames: [], staffToolEvidence: [projectStaffToolEvidence('read_today_queue', {
    status: 'ok', items: [{section: 'interviews', firstName: 'Robin', reason, when: null}]
  })!] };
const check = (text: string, flags = [text], data = facts) => filterRecordRepetitionFlags(flags, text, data);
it('accepts a complete standalone interview reason, including bullet formatting', () => {
  assert.deepEqual(check(reason), []);
  assert.deepEqual(check(`- ${reason}`, [reason.slice(0, -1)]), []);
});
it('keeps person, status, employer and negation changes flagged', () => {
  for (const text of [reason.replace('Robin', 'Alex'), reason.replace('interviewing', 'hired'),
    reason.replace('Example Manufacturing', 'Other Company'), reason.replace('is interviewing', 'is not interviewing')])
    assert.deepEqual(check(text), [text]);
});
it('does not accept a matching prefix of an unsupported longer assertion', () => {
  const text = reason.slice(0, -1) + ' and has already been hired.';
  assert.deepEqual(check(text, [reason]), [reason]);
});
it('keeps dates and shortened flags for model review', () => {
  assert.deepEqual(check(reason, ['Robin is interviewing']), ['Robin is interviewing']);
  const dated: OrgFacts = {...facts, staffToolEvidence: [projectStaffToolEvidence('read_today_queue', {
    status: 'ok', items: [{section: 'interviews', firstName: 'Robin', reason: reason.slice(0, -1) + ', next date Nov 5.'}]
  })!]};
  assert.deepEqual(check(reason, [reason], dated), [reason]);
  const wage = 'The job pays $45 an hour.';
  assert.deepEqual(check(reason + ' ' + wage, [reason, wage]), [wage]);
});
it('never upgrades a task, a note, user text or an unavailable read to interview evidence', () => {
  for (const evidence of [
    projectStaffToolEvidence('read_staff_tasks', {status:'ok', tasks:[{title:reason, participant:'Robin'}]})!,
    projectStaffToolEvidence('read_today_queue', {status:'ok', items:[{section:'tasks', firstName:'Robin', reason}]})!,
    {...facts.staffToolEvidence![0], facts:{status:'unavailable', items:[{section:'interviews',firstName:'Robin',reason}]}}
  ]) assert.deepEqual(check(reason, [reason], {...facts, staffToolEvidence:[evidence]}), [reason]);
  assert.deepEqual(check(reason, [reason], {...facts, staffToolEvidence:[]}), [reason]);
});
it('does not turn a checker outage into a successful check', () => {
  assert.equal(filterRecordRepetitionFlags(null, reason, facts), null);
});
it('distinguishes priority judgments from their factual reasons in the prompt', () => {
  const prompt = buildOrgVerificationPrompt('I would start with Robin.', facts);
  assert.match(prompt, /Still check every factual reason separately/);
  assert.match(prompt, /missing interview date does not invalidate/);
});

it('accepts the preview I shape with an unknown-time sentence on the same line', () => {
  assert.deepEqual(check(`- ${reason} The date and time are unknown.`, [reason.slice(0, -1)]), []);
});
it('accepts the preview H shape with a short presentation label', () => {
  for (const label of ['Interview', 'Reason'])
    assert.deepEqual(check(`- ${label}: ${reason} The queue gives no date or time, so the timing is unknown.`, [reason]), []);
});
it('keeps a following negation and unsupported claim flagged independently', () => {
  const denial = 'Robin is not interviewing there.';
  assert.deepEqual(check(`${reason} ${denial}`, [reason, denial]), [denial]);
  const hired = 'Robin has already been hired.';
  assert.deepEqual(check(`- Interview: ${reason} ${hired}`, [reason, hired]), [hired]);
});
it('does not strip arbitrary or nested labels that could change meaning', () => {
  for (const prefix of ['Not true:', 'Interview: Not true:', 'Rumor:', 'Alex said:'])
    assert.deepEqual(check(`- ${prefix} ${reason}`, [reason]), [reason]);
});
it('does not clear ambiguous repeated sentences, even on the same line', () => {
  assert.deepEqual(check(`${reason} ${reason}`, [reason]), [reason]);
  assert.deepEqual(check(`- ${reason}\n- Interview: ${reason}`, [reason]), [reason]);
});
it('keeps a compound assertion under the interview label flagged', () => {
  const compound = reason.slice(0, -1) + ' and has already been hired.';
  assert.deepEqual(check(`- Interview: ${compound}`, [reason]), [reason]);
});

it('preview K: drops only a pure priority judgment about a caseload name, and flags inside an offered draft', async () => {
  const { filterJudgmentAndDraftFlags } = await import('../org-output-verify');
  const f: OrgFacts = { ...facts, visibleNames: ['Jean', 'Marqus'], offeredDraftBodies: ["Hi Jean, it's Lupe. Congratulations on getting that far. How is the ID going?"] };
  const dropped = ['Jean is the one who needs attention (from your Today queue, read Nov 1)', '- Who: Jean', 'Jean is the one who needs you today.', 'Congratulations on getting that far'];
  assert.deepEqual(filterJudgmentAndDraftFlags(dropped, f), []);
  const kept = ['Jean is the one who needs you because he was hired yesterday', 'Robin is the one who needs attention', 'Jean needs attention because his interview is Monday', 'Jean was hired', 'Congratulations on the new job', 'Jean'.repeat(1) + ' is overdue'];
  assert.deepEqual(filterJudgmentAndDraftFlags(kept, f), kept);
  assert.equal(filterJudgmentAndDraftFlags(null, f), null);
  // No offered draft: draft words are checked like any answer words.
  assert.deepEqual(filterJudgmentAndDraftFlags(['Congratulations on getting that far'], { ...f, offeredDraftBodies: [] }), ['Congratulations on getting that far']);
});
