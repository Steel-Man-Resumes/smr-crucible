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
 * the judge prompt, run this. Calls OpenAI (gpt-4o-mini), a few cents.
 */
import fs from "node:fs";

// Parsed, never sourced: an unescaped & in a .env file can print secrets in bash.
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^OPENAI_API_KEY=(.*)$/);
  if (m) process.env.OPENAI_API_KEY = m[1].replace(/^["']|["']$/g, "").trim();
}
const { verifyOrgOutput } = await import(process.cwd() + "/lib/org-output-verify.ts");

const small = { caseload: 3, stalled: 1, neverStarted: 1, hired: 0, unassigned: 0, visibleNames: ["Colton", "Nadia", "Wes"], staffNames: ["Russ", "Dana"], needsAttention: ["Colton"] };
const big = { caseload: 5, stalled: 2, neverStarted: 1, hired: 1, unassigned: 1, visibleNames: ["Colton", "Nadia", "Wes", "Ivan", "Marisol"], staffNames: ["Russ", "Dana"], needsAttention: ["Colton", "Nadia"] };

// [name, facts, text, shouldPass]
const cases: Array<[string, typeof small, string, boolean]> = [
  ["true: named + question + offer", small, "**Colton.** He's been inactive for two weeks -- that's the flag that needs your eyes first.\n\nWho are the other two and what's their status? I can help you triage from there, or draft an outreach message to Colton.", true],
  ["true: count + named", small, "You have 3 clients assigned to you. Colton needs attention now. He hasn't been active in two weeks.", true],
  ["true: two named, paraphrased", big, "Quick version: caseload triage, case notes, emails, and numbers.\n\nRight now, **Colton and Nadia** need attention -- both have gone quiet. Want me to start there, or is something else on your plate?", true],
  ["true: every number", big, "Of your 5 clients, 2 have gone quiet, 1 never started, and 1 has started work. One person is not assigned to anyone yet.", true],
  ["false: invented hire + count", small, "You have 3 clients. Nadia got hired last week at Costco, and Colton has completed 4 applications.", false],
  ["false: invented trend + event", small, "Your placement rate is up this month and Wes has an interview Thursday.", false],
  ["false: fact smuggled inside an offer", big, "Want me to draft a note congratulating Nadia on her new job at the mill?", false],
  ["false: right status, wrong person", big, "Wes has gone quiet and needs a check-in this week.", false],
  ["false: vague wrong proportion", big, "Most of your caseload has started work already, which is a strong month.", false],
];

let failed = 0;
for (const [name, facts, text, shouldPass] of cases) {
  const v = await verifyOrgOutput(text, facts);
  if (!v.modelChecked) { console.log(`SKIP  ${name} -- layer 2 did not run (no key / outage)`); failed++; continue; }
  const good = v.ok === shouldPass;
  if (!good) failed++;
  console.log(`${good ? "ok  " : "FAIL"}  ${name}${good ? "" : " -> " + JSON.stringify(v.problems)}`);
}
console.log(failed ? `\n${failed} of ${cases.length} wrong` : `\nall ${cases.length} correct`);
process.exit(failed ? 1 : 0);
