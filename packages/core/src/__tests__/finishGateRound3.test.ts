/**
 * Finish gate, review round 3 (core). Fictional fixtures.
 *
 * B1 detection: one shared credential list, so a credential is never a skill
 * to keep. B5: an all-caps name is never a heading, so a pipe headline under
 * it is asked about. S2: a job word never counts as having said a
 * credential, and the writer's "current" is never the person's status. B3: a
 * long sentence that carries a credential is still read like any line, and a
 * scope word in it needs an answer about that scope.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus, pickDefendLines, type DefendAnswer } from "../resumeStatus";
import { runMintCheck, numbersIn } from "../resumeMintCheckShared";
import { credentialMentionsOf, credentialsToAsk } from "../credentialMentions";
import * as words from "../credentialWords";

const SOURCE = `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.
The owner asked me to show new cooks the grill.`;
const HEAD = `MORGAN SAMPLE
Toledo, OH | morgan@example.com

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.`;
const GOOD = "I did that at the diner most shifts, the owner can say so.";

const CREDENTIAL_TERMS = ["HAZMAT", "TWIC", "PMP", "NCCER", "Six Sigma Green Belt", "Food handler card", "Hazmat endorsement", "Forklift permit"];

test("B1: one shared credential list: these are credentials, found in a skills list, never skills to keep", () => {
  const isCredentialTerm = (words as Record<string, unknown>).isCredentialTerm as ((t: string) => boolean) | undefined;
  assert.equal(typeof isCredentialTerm, "function");
  for (const t of CREDENTIAL_TERMS) {
    assert.ok(isCredentialTerm!(t), t);
    const r = `${HEAD}\n\nSKILLS\nGrill, Breakfast line, ${t}`;
    assert.ok(!runMintCheck({ output: r, source: SOURCE, kind: "resume" }).findings.some((f) => f.line === t && /grid/.test(f.kind ?? "")), `${t} is not a skills term`);
    assert.ok(credentialMentionsOf(r).some((m) => m.term && m.line === t), `${t} is a credential mention`);
  }
  assert.ok(!isCredentialTerm!("Hazmat handling"), "handling hazmat is a skill");
  assert.equal(numbersIn("Six Sigma Green Belt").size, 0, "Six Sigma is a name, not a count");
});

for (const h of ["Kitchen Supervisor | Breakfast Line", "Kitchen Manager | Line Cook", "Executive Chef | Grill"]) {
  test(`B5: the pipe headline "${h}" under an all-caps name is asked about`, () => {
    const r = HEAD.replace("Toledo, OH | morgan@example.com", `Toledo, OH | morgan@example.com\n${h}`);
    assert.ok(pickDefendLines(r, SOURCE).some((d) => d.line === h), JSON.stringify(pickDefendLines(r, SOURCE)));
    const a: DefendAnswer[] = pickDefendLines(r, SOURCE).map((d) => ({ line: d.line, answer: GOOD, verdict: "stands" }));
    assert.equal(getResumeStatus({ resumeText: r, sourceText: SOURCE, defendAnswers: a }).state, "draft");
  });
}

for (const cred of ["Certified Kitchen Supervisor", "Certified Line Cook", "Breakfast Line Certified", "Certified Grill Master"]) {
  test(`S2: "${cred}" is never 'said' because the person used a job word`, () => {
    const r = `${HEAD}\n\nCERTIFICATIONS\n- ${cred}, current`;
    // Round 5: every credential is asked; nothing the person said is read as saying it.
    assert.ok(credentialsToAsk(r).length > 0, cred);
    assert.ok(getResumeStatus({ resumeText: r, sourceText: SOURCE }).openItems.some((i) => i.kind === "credential_unsaid"), cred);
  });
}

test("S2 (round 5): the writer's 'current' is never the person's status, and no answer settles it", () => {
  const src = `${SOURCE}\nI have my forklift card from the warehouse job.`;
  const r = `${HEAD}\n\nCERTIFICATIONS\n- Forklift card, current`;
  const s = getResumeStatus({ resumeText: r, sourceText: src });
  assert.ok(s.openItems.some((i) => i.kind === "credential_unsaid" && i.severity === "BLOCK"), JSON.stringify(s.openItems));
  for (const ans of ["It is a card from the county job center, I keep it in my wallet.", "It is a card from the county job center and it expired last spring.", "It is a card from the county job center and it is still current."]) {
    const a = [{ line: "- Forklift card, current", answer: ans, verdict: "stands" as const }];
    assert.equal(getResumeStatus({ resumeText: r, sourceText: src, defendAnswers: a }).state, "draft", ans);
  }
});

test("B3: a long sentence that carries a credential is still a line to ask about; a scope word needs an answer about it", () => {
  const line = "- Forklift Certified operator who supervised a crew of night loaders and trained every new hire";
  const r = `${HEAD}\n${line}`;
  assert.ok(pickDefendLines(r, SOURCE).some((d) => d.line === line && d.reasons.includes("far_from_your_words")));
  const generic = [{ line, answer: GOOD, verdict: "stands" as const }];
  assert.ok(getResumeStatus({ resumeText: r, sourceText: SOURCE, defendAnswers: generic }).openItems.some((i) => i.line === line && i.rule === "STD-C04"));
  // Round 5: even an answer about that scope never settles a scope claim; only a rewrite or a cut does.
  const scope = [{ line, answer: "I supervised the two night loaders when the dock lead was out on Fridays.", verdict: "stands" as const }];
  assert.ok(getResumeStatus({ resumeText: r, sourceText: SOURCE, defendAnswers: scope }).openItems.some((i) => i.line === line && i.kind === "scope_unsaid"));
});
