/**
 * Finish gate, review round 8 (consumer). Fictional fixtures.
 *
 * Rows refuse a status in the name and know a permit; an education line is
 * confirmed as earned or in progress, in place; "No" shows what it will
 * change and keeps duty lines; one family key per role (OSHA 10 is not OSHA
 * 10 Trainer); "No" on a credential-only title asks for their own title.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "../finish-gate";
import { credentialRowNeeds, credentialRowsAsText } from "../credential-rows";

const { buildFinishView, applyConfirmation, cutCredentialEverywhere, cutCredentialWithRemnant, EDUCATION_KINDS } = gate;
type Input = Parameters<typeof buildFinishView>[0];

const OWN = `Jordan Smith
Toledo, OH | jordan@example.com
Warehouse Associate | Midwest Distribution | 2019 - 2023
I picked orders with a scanner and wrapped pallets.`;
const HEAD = (extra = "", title = "WAREHOUSE ASSOCIATE") => `JORDAN SMITH
Toledo, OH | jordan@example.com

PROFESSIONAL EXPERIENCE
${title} | Midwest Distribution | 2019 - 2023
- Picked orders with a scanner and wrapped pallets.${extra}`;
const view = (resumeText: string, extra: Partial<Input> = {}) => buildFinishView({ resumeText, ownWords: OWN, defendAnswers: [], ...extra } as Input);

test("Rows: a status in the name, a permit named as a license, a kind the name contradicts", () => {
  assert.equal(credentialRowNeeds({ name: "CNA (lapsed)", kind: "certification", when: "2016" }), "name");
  assert.equal(credentialRowNeeds({ name: "CDL permit", kind: "license", when: "2024" }), "permit");
  assert.equal(credentialRowNeeds({ name: "CDL license", kind: "card", when: "2024" }), "kind-name");
  assert.equal(credentialRowNeeds({ name: "CDL", kind: "permit", when: "2024" }), "");
  assert.equal(credentialRowsAsText([{ name: "CDL", kind: "permit", when: "2024" }]), "CDL permit, 2024");
  assert.equal(credentialRowsAsText([{ name: "Forklift", kind: "card", when: "2021" }, { name: "CNA (lapsed)", kind: "certification", when: "2016" }]), "Forklift card, 2021\nCNA (lapsed), certification, 2016");
});

test("B5: an education line is asked as earned or in progress, and rewritten where it stands", () => {
  const r = `${HEAD()}\n\nEDUCATION\nGED | Toledo Adult Education | 2023`;
  const v = view(r, { ownWords: `${OWN}\nI am working on my GED.` });
  const g = v.groups.find((x) => x.credentialName)!;
  assert.ok(g && g.education, JSON.stringify(v.groups));
  assert.deepEqual([...EDUCATION_KINDS], ["earned", "in progress"]);
  const res = applyConfirmation({ resume: r, letter: "" }, g.credentialName!, "in progress", "in progress")!;
  // Round 9 (r9-N4): only the named part changes; the school stays and the writer's year comes off.
  assert.match(res.resume, /EDUCATION\nGED, in progress \| Toledo Adult Education$/);
  assert.doesNotMatch(res.resume, /CERTIFICATIONS/);
  const after = view(res.resume, { ownWords: `${OWN}\nI am working on my GED.`, confirmedCredentials: [res.confirm], written: { resume: r, letter: "" } });
  assert.ok(!after.groups.some((x) => x.credentialName), JSON.stringify(after.openItems));
});

test("S4: 'No' lists what it will change, keeps a duty line, and leaves someone else's sentence alone", () => {
  const r = HEAD("\n- Followed ServSafe food safety rules on every shift\n\nCERTIFICATIONS\n- ServSafe certified");
  const letter = "Dear Hiring Manager,\n\nAt Midwest Distribution I loaded trailers for the CDL drivers every night. I followed ServSafe food safety rules. I am ServSafe certified.\n\nJordan Smith";
  const out = cutCredentialEverywhere({ resume: r, letter }, "ServSafe");
  assert.match(out.resume, /- Followed food safety rules on every shift/, out.resume);
  assert.doesNotMatch(out.resume, /ServSafe/);
  assert.match(out.letter, /loaded trailers for the CDL drivers every night\./);
  assert.match(out.letter, /I followed food safety rules\./);
  assert.doesNotMatch(out.letter, /ServSafe/);
  assert.ok(out.changes.length >= 3, JSON.stringify(out.changes));
  assert.ok(out.changes.some((c) => c.target === "resume" && /Followed ServSafe/.test(c.before) && c.after && /Followed food safety rules/.test(c.after)));
  const cdl = cutCredentialEverywhere({ resume: HEAD(), letter }, "CDL");
  assert.equal(cdl.letter, letter, "someone else's CDL is never cut");
});

test("S5: OSHA 10 and OSHA 10 Trainer, CPR and CPR Instructor stand side by side; OSHA 10 and 10-hour OSHA are one", () => {
  for (const [a, b, conflict] of [["OSHA 10", "OSHA 10 Trainer", false], ["CPR", "CPR Instructor", false], ["OSHA 10", "10-hour OSHA card", true]] as const) {
    const r = HEAD(`\n\nCERTIFICATIONS\n- ${a}\n- ${b}`);
    const one = applyConfirmation({ resume: r, letter: "" }, a, "card", "2019")!;
    const name2 = view(one.resume, { confirmedCredentials: [one.confirm], written: { resume: r, letter: "" } }).groups.find((g) => g.credentialName)!.credentialName!;
    const two = applyConfirmation({ resume: one.resume, letter: "" }, name2, "certification", "current")!;
    const v = view(two.resume, { confirmedCredentials: [one.confirm, two.confirm], written: { resume: r, letter: "" } });
    assert.equal(v.openItems.some((i) => i.kind === "credential_confirmed_conflict"), conflict, `${a} / ${b}`);
  }
});

test("S7: 'No' on a title that is only a credential asks for their own title; 'CDL-A DRIVER' keeps DRIVER", () => {
  const r = HEAD("", "CNA");
  const out = cutCredentialWithRemnant(r, "CNA | Midwest Distribution | 2019 - 2023", false, "CNA");
  assert.match(out.text, /^\[Your job title\] \| Midwest Distribution \| 2019 - 2023$/m);
  assert.ok(view(out.text).openItems.some((i) => i.rule === "STD-F05"), "the placeholder holds the page until they type their title");
  const d = cutCredentialWithRemnant(HEAD("", "CDL-A DRIVER"), "CDL-A DRIVER | Midwest Distribution | 2019 - 2023", false, "CDL-A DRIVER");
  assert.match(d.text, /^DRIVER \| Midwest Distribution/m);
});
