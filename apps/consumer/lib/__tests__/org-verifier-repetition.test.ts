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
it('keeps dates, shortened flags and compound sentences for model review', () => {
  assert.deepEqual(check(reason, ['Robin is interviewing']), ['Robin is interviewing']);
  const dated: OrgFacts = {...facts, staffToolEvidence: [projectStaffToolEvidence('read_today_queue', {
    status: 'ok', items: [{section: 'interviews', firstName: 'Robin', reason: reason.slice(0, -1) + ', next date Nov 5.'}]
  })!]};
  assert.deepEqual(check(reason, [reason], dated), [reason]);
  assert.deepEqual(check(reason + ' The job pays $45 an hour.', [reason]), [reason]);
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
