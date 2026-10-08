/**
 * Finish gate, review round 4 (core). Strict by design, fail closed, no fuzzy
 * credit. Fictional fixtures.
 *
 * B1: a credential is "said" only on a full-key match. B2: a credentials
 * line with several credentials is checked part by part. S1: the writer's
 * status is cleared only by an answer of the same status. S3: the
 * year-or-status box takes exactly one status. S4: one scope list.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus, pickDefendLines, type DefendAnswer } from "../resumeStatus";
import { canonicalCredentialKey, credentialMentionsOf } from "../credentialMentions";
import { isStrictCredentialWhen } from "../credentialStatus";
import { scopeHits, answerTalksScope } from "../scopeWords";

const BASE = `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.
The owner asked me to show new cooks the grill.`;
const page = (extra: string) => `MORGAN SAMPLE
Toledo, OH | morgan@example.com

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.${extra}`;
const GOOD = "I did that at the diner most shifts, the owner can say so.";
const TYPED = "It is a card from the county job center, I keep it in my wallet.";
function walk(r: string, src: string, ans = (q: string) => (/license, a certification/.test(q) ? TYPED : GOOD)) {
  let a: DefendAnswer[] = [];
  for (let k = 0; k < 3; k++) {
    const s = getResumeStatus({ resumeText: r, sourceText: src, defendAnswers: a });
    for (const i of s.openItems) if (i.severity === "BLOCK" && !a.some((x) => x.line === i.line)) a.push({ line: i.line, answer: ans(i.question), verdict: "stands" });
  }
  return getResumeStatus({ resumeText: r, sourceText: src, defendAnswers: a });
}

// ---- B1 ------------------------------------------------------------------------------

const FAMILY: Array<[string, string]> = [
  ["I have my OSHA 10 card from 2019.", "OSHA 30, 2019"],
  ["I got my ServSafe Food Handler card in 2020.", "ServSafe Manager, 2020"],
  ["I have had my CDL Class B license since 2015.", "CDL Class A, 2015"],
  ["I have my CPR card from 2021.", "Certified CPR Instructor, 2021"],
  ["I passed the AWS D1.1 certification in 2018.", "AWS D1.1 Certified Welding Inspector, 2018"],
  ["I have my OSHA 30 card from 2017.", "OSHA 30 Authorized Trainer, 2017"],
  ["I got my ServSafe Food Handler card in 2020.", "ServSafe Instructor and Proctor, 2020"],
  ["I earned my Six Sigma Yellow Belt certification in 2020.", "Six Sigma Black Belt, 2020"],
];
for (const [said, line] of FAMILY) {
  test(`B1: "${said}" never says "${line}": a memory prompt, and draft`, () => {
    const r = page(`\n\nCERTIFICATIONS\n- ${line}`);
    const s = walk(r, `${BASE}\n${said}`);
    assert.equal(s.state, "draft");
    assert.ok(s.openItems.some((i) => i.kind === "credential_unsaid" && i.line === `- ${line}`), JSON.stringify(s.openItems));
  });
}

for (const [said, line] of [
  ["I was always the first one in.", "First Aid Certified"],
  ["The manager asked me to close.", "ServSafe Manager"],
  ["I served 30 tables a night.", "OSHA 30"],
  ["I drove a forklift at the warehouse for a summer.", "Forklift card"],
] as const) {
  test(`B1: an ordinary word never says a named credential ("${line}")`, () => {
    const s = getResumeStatus({ resumeText: page(`\n\nCERTIFICATIONS\n- ${line}`), sourceText: `${BASE}\n${said}` });
    assert.ok(s.openItems.some((i) => i.kind === "credential_unsaid"), JSON.stringify(s.openItems));
  });
}

test("B1: spelling variants meet on one key; family members never do", () => {
  for (const v of ["OSHA-10", "OSHA10", "OSHA 10-Hour", "10-hour OSHA", "OSHA 10"]) assert.equal(canonicalCredentialKey(v), canonicalCredentialKey("OSHA 10"), v);
  assert.equal(canonicalCredentialKey("Forklift Certified"), canonicalCredentialKey("Certified Forklift Operator"));
  for (const [a, b] of [["OSHA 10", "OSHA 30"], ["CDL Class A", "CDL Class B"], ["CPR", "Certified CPR Instructor"], ["ServSafe Manager", "ServSafe Food Handler"], ["Six Sigma Black Belt", "Six Sigma Yellow Belt"]]) {
    assert.notEqual(canonicalCredentialKey(a), canonicalCredentialKey(b), `${a} / ${b}`);
  }
});

test("B1 (control): the same credential the person named, with their year, still finishes", () => {
  const s = walk(page("\n\nCERTIFICATIONS\n- OSHA 30, 2019"), `${BASE}\nI have my OSHA 30 card from 2019.`);
  assert.equal(s.state, "finished", JSON.stringify(s.openItems));
  const aws = page("\n\nCERTIFICATIONS\n- AWS D1.1 certification, renewed yearly");
  assert.ok(!pickDefendLines(aws, `${BASE}\nPassed AWS D1.1 certification renewal every year.`).some((d) => d.reasons.includes("credential")));
});

// ---- B2 ------------------------------------------------------------------------------

for (const line of ["OSHA 10 (2019), CPR, Forklift card", "OSHA 10, 2019 | ServSafe Manager | CDL Class A", "OSHA 10, Forklift Certified", "OSHA 10 and Forklift Certified, 2019", "OSHA 10 - CPR - First Aid"]) {
  test(`B2: "${line}" is read part by part; parts the person never named are asked`, () => {
    const r = page(`\n\nCERTIFICATIONS\n- ${line}`);
    const parts = credentialMentionsOf(r).filter((m) => m.where === "credentials").map((m) => m.name);
    assert.ok(parts.length >= 2, JSON.stringify(parts));
    const s = walk(r, `${BASE}\nI have my OSHA 10 card from 2019.`);
    assert.equal(s.state, "draft");
    assert.ok(s.openItems.some((i) => i.kind === "credential_unsaid" && !/OSHA 10/.test(i.subject ?? "")), JSON.stringify(s.openItems));
  });
}

test("B2 (control): 'OSHA 10, 2019' alone still finishes for the person who named it", () => {
  assert.equal(walk(page("\n\nCERTIFICATIONS\n- OSHA 10, 2019"), `${BASE}\nI have my OSHA 10 card from 2019.`).state, "finished");
});

// ---- S1 ------------------------------------------------------------------------------

test("S1: the writer's 'current' clears only with an answer that says current", () => {
  const src = `${BASE}\nI have my forklift card from the county job center.`;
  const r = page("\n\nCERTIFICATIONS\n- Forklift card, current");
  for (const ans of ["It is a card, I passed the test at the county job center.", "It is a card I got through the county job center.", "It is a card, finished the class at the job center.", "It is a card, I was enrolled at the job center."]) {
    assert.equal(walk(r, src, () => ans).state, "draft", ans);
  }
  assert.equal(walk(r, src, () => "It is a card from the county job center and it is current.").state, "finished");
});

// ---- S3 ------------------------------------------------------------------------------

test("S3: the year-or-status box takes exactly one status, and no future year", () => {
  for (const w of ["2021", "current", "expired", "in progress", "completed", "expired in 2019", "completed 2018", "current, expires 2027", "valid until 2027"]) assert.equal(isStrictCredentialWhen(w), true, w);
  for (const w of ["current expired", "expired, current", "currently expired", "active and expired", "completed in progress", "valid until 2019, current", "2049", "since 2045", "still current as of 2030", "through", "good for", "passed", "current 2019 2020 2021"]) {
    assert.equal(isStrictCredentialWhen(w), false, w);
  }
});

// ---- S4 ------------------------------------------------------------------------------

for (const line of ["Headed the night crew", "Ran the night crew", "Was in charge of the night crew", "Bossed the dish crew", "Trained the night crew", "Spearheaded the night crew", "Took charge of the night crew", "Owned the night crew schedule", "Supervised the night crew", "Managed the night crew"]) {
  test(`S4: "${line}" is a scope claim a generic answer never settles`, () => {
    const r = page(`\n- ${line} on the breakfast line.`);
    for (const ans of [GOOD, "I managed to do that most shifts at the diner, the owner can say so.", "I never supervised anyone there, I just did my own station."]) {
      const a = pickDefendLines(r, BASE).map((d) => ({ line: d.line, answer: ans, verdict: "stands" as const }));
      assert.equal(getResumeStatus({ resumeText: r, sourceText: BASE, defendAnswers: a }).state, "draft", `${line} / ${ans}`);
    }
  });
}

test("S4: 'ran the grill' is ordinary work; 'I managed to' and denials are not about scope", () => {
  assert.equal(scopeHits("Ran the grill on the breakfast line.").length, 0);
  assert.ok(scopeHits("Ran the night crew.").length > 0);
  assert.equal(answerTalksScope("I managed to get it done on Sundays."), false);
  assert.equal(answerTalksScope("I never supervised anyone."), false);
  assert.equal(answerTalksScope("I supervised the two dishwashers on Sundays."), true);
  // A count and a describing word before the people noun still count.
  assert.ok(scopeHits("Trained four new aides on the floor.").length > 0);
  assert.equal(answerTalksScope("Trained four new aides on the floor."), true);
});

// ---- notes ---------------------------------------------------------------------------

test("NOTE: 'certified since' and 'certified hand' are not credential names", () => {
  const names = credentialMentionsOf(page("\n- Loaded trucks on weekends as an OSHA 10 certified hand, certified since 2015")).map((m) => m.name);
  assert.ok(!names.some((n) => /since|hand/i.test(n)), JSON.stringify(names));
});
