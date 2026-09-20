/**
 * Measures the org-output verifier (layer 1 + the layer 2 model judge) against
 * answers whose truth we know. Run from apps/consumer:
 *
 *   cd apps/consumer && npx tsx ../../scripts/verify-org-output-judge.mts
 *
 * WHY THIS EXISTS. The first judge prompt caught every fabrication and ALSO
 * flagged every true answer -- questions and offers included -- so every staff
 * reply shipped with a "could not support" warning. Nothing told us, because a
 * verifier that always objects looks exactly like a verifier that works. Change
 * the judge prompt OR THE JUDGE MODEL, run this (ORG_VERIFY_MODEL=<id> to try a
 * candidate). Calls OpenAI, a few cents.
 */
import fs from "node:fs";

// Parsed, never sourced: an unescaped & in a .env file can print secrets in bash.
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^OPENAI_API_KEY=(.*)$/);
  if (m) process.env.OPENAI_API_KEY = m[1].replace(/^["']|["']$/g, "").trim();
}
const { verifyOrgOutput } = await import(process.cwd() + "/lib/org-output-verify.ts");

const small = { caseload: 3, stalled: 1, activeRecently: 2, neverStarted: 1, hired: 0, unassigned: 0, visibleNames: ["Colton", "Nadia", "Wes"], staffNames: ["Russ", "Dana"], needsAttention: ["Colton"] };
const big = { caseload: 5, stalled: 2, activeRecently: 3, neverStarted: 1, hired: 1, unassigned: 1, visibleNames: ["Colton", "Nadia", "Wes", "Ivan", "Marisol"], staffNames: ["Russ", "Dana"], needsAttention: ["Colton", "Nadia"], orgName: "Big Sky Reentry Services (Demo)" };

// [name, facts, text, shouldPass]
const cases: Array<[string, typeof small, string, boolean, string?]> = [
  ["true: named + question + offer", small, "**Colton.** He's been inactive for two weeks -- that's the flag that needs your eyes first.\n\nWho are the other two and what's their status? I can help you triage from there, or draft an outreach message to Colton.", true],
  ["true: count + named", small, "You have 3 clients assigned to you. Colton needs attention now. He hasn't been active in two weeks.", true],
  ["true: two named, paraphrased", big, "Quick version: caseload triage, case notes, emails, and numbers.\n\nRight now, **Colton and Nadia** need attention -- both have gone quiet. Want me to start there, or is something else on your plate?", true],
  ["true: every number", big, "Of your 5 clients, 2 have gone quiet, 1 never started, and 1 has started work. One person is not assigned to anyone yet.", true],
  // Found in production AFTER the first nine passed: layer 1 read a heading and
  // the org's own name as people. The cases below are formats, not claims.
  ["true: bulleted snapshot with org name heading", big, "**Big Sky Reentry Services -- Caseload Snapshot**\n\n5 participants total across the organization.\n\n- **1** started work\n- **2** inactive 2+ weeks -- need outreach\n- **1** never started\n- **1** unassigned\n\n**Right now:** Colton and Nadia need attention. Want me to pull up what's going on with either of them?", true],
  ["true: email draft", big, "Here's a draft you can send:\n\nHi Colton,\n\nJust checking in. It has been a couple of weeks since we connected and I wanted to see how things are going. No pressure at all. Let me know a good time to talk.\n\nBest,\nDana", true],
  ["false: person outside reach", big, "You should also check on Marcus, he has gone quiet too.", false],
  ["false: outsider inside an email draft", big, "Here's a draft:\n\nHi Colton,\n\nI spoke with Deshawn and he said you two might carpool to the job fair.\n\nBest,\nDana", false],
  // Never-started is INSIDE not-active. Production drafted a director email that
  // counted them as separate people; the numbers were each "ours" and the sum was wrong.
  ["true: overlap stated correctly", big, "You have 5 people. 3 have been active in the last two weeks and 2 have not. Of those 2, 1 has never started at all.", true],
  ["true: assistant describing its own limits", big, "Colton and Nadia are both flagged, but I don't have their exact last-contact dates or phone numbers. Which one do you want to start with?", true],
  ["false: never-started presented as extra people", big, "Two participants have been inactive for two weeks. In addition to those two, one other participant was assigned but never engaged with the program.", false],
  // Second production batch. Three false alarms and one real catch worth keeping.
  ["true: question echoing what the user said", big, "This comes up a lot. Lower the ask, change the channel, and lead with something useful rather than a check-in.\n\nWhat do you know about why they went quiet? That might shape which approach fits.", true, "Someone on my caseload stopped responding. What are good ways to re-engage without pressuring them?"],
  ["true: template with placeholders", small, "**Phone Check-In -- [Date]**\n\n**Participant:** [Name]\n**Duration:** approx. [X] min\n**Contacted by:** [Your Name]\n\n**Summary:** Spoke with [Name] by phone. [He/She/They] reported [current situation -- employment status, housing, any barriers].\n\n**Next contact:** [Date or TBD]", true, "Write a case note template I can use after a phone check-in"],
  ["true: durations are not headcounts", small, "Here's your Monday opener: spend the first 15 minutes on Colton. He needs attention right now. Call first, text if no answer. A 2-minute check-in is enough.", true, "Give me a plan for Monday morning"],
  ["false: one person counted twice", small, "First, Colton. He needs attention right now. Next, your quiet one: you've got one other person who hasn't been active in two weeks, so after Colton that's your second call.", false, "Give me a plan for Monday morning"],
  // Third batch: both of these are TRUE and gpt-4o-mini flagged them. The fix was
  // the judge model, not more prompt.
  ["true: director email with overlap stated correctly", big, "Here's a draft ready to send:\n\nHi [Name],\n\nQuick update on our current caseload of five participants. Three have been active in the last two weeks and are progressing. One has started employment. Two participants, Colton and Nadia, have not engaged recently and are my priority focus this week. Of those two, one has never begun the program at all.\n\n[Your name]", true, "Draft an email to my director summarizing where our participants stand"],
  ["true: bulleted list of the assistant's own limits", big, "Here's what I can't tell you:\n\n- Dates of last activity (I know who needs attention, not when they last logged in)\n- Which specific person has never started, or who found work\n- Anything about the 1 unassigned participant -- I don't know who they are\n- Any detail I wasn't given: notes, goals, contact info", true, "What can you not tell me about my participants?"],
  ["false: invented hire + count", small, "You have 3 clients. Nadia got hired last week at Costco, and Colton has completed 4 applications.", false],
  ["false: invented trend + event", small, "Your placement rate is up this month and Wes has an interview Thursday.", false],
  ["false: fact smuggled inside an offer", big, "Want me to draft a note congratulating Nadia on her new job at the mill?", false],
  ["false: right status, wrong person", big, "Wes has gone quiet and needs a check-in this week.", false],
  ["false: vague wrong proportion", big, "Most of your caseload has started work already, which is a strong month.", false],
];

let failed = 0;
for (const [name, facts, text, shouldPass, userSaid] of cases) {
  const v = await verifyOrgOutput(text, facts, userSaid);
  if (!v.modelChecked) { console.log(`SKIP  ${name} -- layer 2 did not run (no key / outage)`); failed++; continue; }
  const good = v.ok === shouldPass;
  if (!good) failed++;
  console.log(`${good ? "ok  " : "FAIL"}  ${name}${good ? "" : " -> " + JSON.stringify(v.problems)}`);
}
console.log(failed ? `\n${failed} of ${cases.length} wrong` : `\nall ${cases.length} correct`);
process.exit(failed ? 1 : 0);
