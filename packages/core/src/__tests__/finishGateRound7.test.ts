/**
 * Finish gate, review round 7 (core). Fictional fixtures.
 *
 * B1: the licenses answer is structured rows; the free-text answer gives no
 * exception, and the person's lines never join. B2: a hyphen inside a word
 * is a space when finding credentials, and the prompt names the credential.
 * B3: a scope claim with no people named is theirs only when they used the
 * verb themselves, about the same thing; nouns never count. S1/S2: titles.
 * S3: work acronyms are not credentials. The rest: soft skills, people-word
 * classes, someone else's credential.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus, type DefendAnswer } from "../resumeStatus";
import { credentialMentionsOf, credentialsToAsk, credentialLineText, mentionMatchesRow } from "../credentialMentions";
import { scopeNotTheirs, scopeHits } from "../scopeWords";
import { isWorkAcronym } from "../workAcronyms";

const BASE = `Jordan Smith
Toledo, OH | jordan@example.com
Warehouse Associate | Midwest Distribution | 2019 - 2023
I picked orders with a scanner and wrapped pallets.`;
const page = (extra: string, title = "WAREHOUSE ASSOCIATE") => `JORDAN SMITH
Toledo, OH | jordan@example.com

PROFESSIONAL EXPERIENCE
${title} | Midwest Distribution | 2019 - 2023
- Picked orders with a scanner and wrapped pallets.${extra}`;
const GOOD = "I did that at Midwest most shifts, my lead can say so.";
const walk = (r: string, src: string, extra: Record<string, unknown> = {}) => {
  let a: DefendAnswer[] = [];
  for (let k = 0; k < 3; k++) {
    const s = getResumeStatus({ resumeText: r, sourceText: src, defendAnswers: a, ...extra });
    for (const i of s.openItems) if (i.severity === "BLOCK" && !a.some((x) => x.line === i.line)) a.push({ line: i.line, answer: GOOD, verdict: "stands" });
  }
  return getResumeStatus({ resumeText: r, sourceText: src, defendAnswers: a, ...extra });
};

// ---- B1 ----------------------------------------------------------------------------------

for (const [typed, line] of [
  ["CNA\nLet it lapse in 2019 when I went in, need to retake the state test", "CNA"],
  ["CNA\nI let it lapse while I was locked up", "CNA"],
  ["Forklift certified\nIt expired in 2020 while I was locked up", "Forklift certified"],
  ["Forklift certified\nBut that was back in 2016, never renewed it", "Forklift certified"],
  ["CDL Class A\nSuspended right now, working on getting it back", "CDL Class A"],
  ["OSHA 10\n\nThat card expired a long time ago", "OSHA 10"],
  ["Forklift certified 2020", "Forklift certified 2020"],
] as const) {
  test(`B1: the free-text answer ${JSON.stringify(typed)} never covers "${line}"`, () => {
    const s = walk(page(`\n\nCERTIFICATIONS\n- ${line}`), `${BASE}\n\n${typed}`, { credentialsAnswer: typed });
    assert.equal(s.state, "draft");
    assert.ok(s.openItems.some((i) => i.kind === "credential_unsaid"));
  });
}

test("B1: a structured row covers the page line that shows exactly that name, kind and year or status", () => {
  const rows = [{ name: "Forklift", kind: "certification" as const, when: "2020" }];
  const text = credentialLineText("Forklift", "certification", "2020");
  assert.equal(text, "Forklift certification, 2020");
  const src = `${BASE}\n\n${text}`;
  // The rows' rendering is the licenses answer in the person's words (ownWordsFor); it is never a whole-line exception.
  const extra = { credentialRows: rows, credentialsAnswer: text };
  assert.equal(walk(page(`\n\nCERTIFICATIONS\n- ${text}`), src, extra).state, "finished");
  for (const shown of ["Forklift certification, current", "Forklift card, 2020", "Forklift certification", "Forklift Certified, 2020"]) {
    assert.equal(walk(page(`\n\nCERTIFICATIONS\n- ${shown}`), src, extra).state, "draft", shown);
  }
  // An incomplete row is no exception.
  const m = credentialMentionsOf(page(`\n\nCERTIFICATIONS\n- ${text}`)).find((x) => x.where === "credentials")!;
  assert.equal(mentionMatchesRow(m, [{ name: "Forklift", kind: "certification", when: "a while back" }]), false);
});

test("B1: their uploaded resume lines never join; a status they wrote must be on the page", () => {
  const r = page("\n\nCERTIFICATIONS\n- CNA");
  assert.ok(credentialsToAsk(r, "CNA\nLet it lapse in 2019").length === 0, "the bare line of their resume still covers a bare page line");
  assert.ok(credentialsToAsk(page("\n\nCERTIFICATIONS\n- CNA, current"), "CNA").length > 0, "a status they never wrote is asked");
});

// ---- B2 ----------------------------------------------------------------------------------

for (const [line, name] of [
  ["Forklift-certified with a clean safety record", "Forklift certified"],
  ["Moved freight as a forklift-certified operator on second shift", "forklift certified"],
  ["Stayed forklift-certified throughout my time at Midwest", "forklift certified"],
  ["Reach-truck-certified for high-bay putaway", "Reach truck certified"],
  ["State-licensed for residential electrical repairs on weekends", "State licensed"],
] as const) {
  test(`B2: "${line}" is a memory prompt named "${name}"`, () => {
    const s = walk(page(`\n- ${line}`), BASE);
    const item = s.openItems.find((i) => i.kind === "credential_unsaid");
    assert.ok(item, JSON.stringify(s.openItems));
    assert.equal(item!.subject, name);
  });
}

// ---- B3 ----------------------------------------------------------------------------------

for (const [said, line] of [
  ["I finished my supervision in 2022 and have been working steady since.", "Supervised daily shipping operations"],
  ["I'm still on supervision until 2025.", "Supervised dock operations on second shift"],
  ["Management liked my work and asked me to stay on.", "Managed inventory counts and cycle audits"],
  ["I always told management when something was broken.", "Managed daily dock operations"],
  ["I have good hand-eye coordination from driving the forklift.", "Coordinated inbound and outbound shipments"],
  ["My mentor at the reentry program helped me get this job.", "Mentored on safe lifting and dock procedures"],
  ["I followed my lead's directions every shift.", "Led daily safety walkthroughs"],
  ["I supervised the dish pit on Sundays.", "Supervised daily operations"],
  ["I managed the register when the cashier was out.", "Managed inventory, ordering and vendor relationships"],
  ["I coordinated pickups with the drivers.", "Coordinated all inbound and outbound logistics for the facility"],
] as const) {
  test(`B3: "${said}" never makes "${line}" theirs`, () => {
    assert.ok(scopeNotTheirs(line, said), line);
    assert.equal(walk(page(`\n- ${line}.`), `${BASE}\n${said}`).state, "draft");
  });
}

test("B3 (control): the same verb, theirs, about the same thing, still finishes", () => {
  assert.equal(scopeNotTheirs("Supervised the dish pit on Sundays.", "I supervised the dish pit on Sundays."), undefined);
  assert.equal(scopeNotTheirs("Managed the stockroom.", "I managed the stockroom."), undefined);
  assert.equal(scopeNotTheirs("Supervised the dish crew on Sundays.", "I supervised the two dishwashers on Sundays."), undefined);
  assert.equal(scopeNotTheirs("Trained new hires on the pallet jack.", "I trained the new guys on the pallet jack."), undefined);
});

test("B3: 'care coordination team' and other nouns about someone else are not claims on the page", () => {
  assert.equal(scopeHits("Kept detailed visit notes for the care coordination team").length, 0);
});

// ---- S1 / S2: titles ---------------------------------------------------------------------

test("S1: an honest CNA who confirms CNA keeps 'CNA | Meadowbrook'", () => {
  const r = page("", "CNA");
  const own = "CNA, Ohio registry, 2016\nI helped residents with meals.";
  const key = credentialMentionsOf(r).find((m) => m.title)!.key;
  const s = getResumeStatus({ resumeText: r, sourceText: own, confirmedKeys: [key] });
  assert.ok(!s.openItems.some((i) => /^CNA \|/.test(i.line) && (i.kind === "title_unsaid" || i.kind === "credential_unsaid")), JSON.stringify(s.openItems));
});

test("S1: confirming a credential never makes a plain title theirs ('SHIFT SUPERVISOR')", () => {
  const r = page("\n\nCERTIFICATIONS\n- Certified Shift Supervisor", "SHIFT SUPERVISOR");
  const s = getResumeStatus({ resumeText: r, sourceText: BASE, confirmedKeys: ["shift supervisor"] });
  assert.ok(s.openItems.some((i) => i.kind === "title_unsaid"));
});

test("S2: the title card is cleared by the person's own rewrite of the header", () => {
  const r = page("", "MATERIAL HANDLER");
  const src = "I worked at Midwest Distribution from 2019 to 2023. I picked orders with a scanner and wrapped pallets.";
  assert.ok(getResumeStatus({ resumeText: r, sourceText: src }).openItems.some((i) => i.kind === "title_unsaid"));
  const header = "Warehouse Associate | Midwest Distribution | 2019 - 2023";
  const r2 = r.replace("MATERIAL HANDLER | Midwest Distribution | 2019 - 2023", header);
  const a: DefendAnswer[] = [{ line: header, answer: header, verdict: "stands", kind: "rewrite", replaced: "MATERIAL HANDLER | Midwest Distribution | 2019 - 2023" }];
  assert.ok(!getResumeStatus({ resumeText: r2, sourceText: src, defendAnswers: a }).openItems.some((i) => i.kind === "title_unsaid"));
});

test("S2: titles told in a sentence count ('hired on as a picker', 'my job ... was warehouse associate')", () => {
  assert.ok(!getResumeStatus({ resumeText: page("", "PICKER"), sourceText: "I was hired on at Midwest Distribution in 2019 as a picker." }).openItems.some((i) => i.kind === "title_unsaid"));
  assert.ok(!getResumeStatus({ resumeText: page(""), sourceText: "My job at Midwest Distribution was warehouse associate." }).openItems.some((i) => i.kind === "title_unsaid"));
});

test("S6: a credential title skips the prompt only when the title is in their own job header, never from a sentence", () => {
  const r = page("", "CNA");
  assert.ok(credentialsToAsk(r, "I was a CNA at Meadowbrook from 2019 to 2023. I never got certified though.").some((m) => m.title));
  assert.ok(!credentialsToAsk(r, "CNA | Meadowbrook | 2019 - 2023").some((m) => m.title));
});

// ---- S3: work acronyms; someone else's credential ------------------------------------------

for (const line of [
  "Picked orders with an RF scanner",
  "Wore PPE and followed safety rules",
  "Rotated stock using FIFO",
  "Rang up orders on the POS",
  "Supported BOH and FOH teams",
  "Charted care in the EHR",
  "Ran CNC lathes on second shift",
  "Worked in Dallas, TX and Tulsa, OK",
  "Reported changes in residents to the RN on duty",
  "Loaded trailers for CDL drivers",
  "Delivered meal trays and supported CNA staff on the floor",
]) {
  test(`S3: "${line}" asks no "Do you hold ...?"`, () => {
    assert.deepEqual(credentialsToAsk(page(`\n- ${line}`), BASE).map((m) => m.name), []);
  });
}

test("S3: the skip list is work vocabulary only; an unknown capital is still asked", () => {
  for (const t of ["RF", "PPE", "FIFO", "POS", "QA", "HVAC", "OH", "NYC"]) assert.ok(isWorkAcronym(t), t);
  // Round 8: OSHA, HACCP, GED, HSE, MA and PA are claims more often than not.
  for (const t of ["CNA", "CDL", "RN", "QMA", "TABC", "OSHA", "HACCP", "GED", "HSE", "MA", "PA"]) assert.equal(isWorkAcronym(t), false, t);
  assert.ok(credentialsToAsk(page("\n- QMA on the weekend shift at the care home"), BASE).some((m) => m.name === "QMA"));
});

// ---- the rest ----------------------------------------------------------------------------

test("Soft skills: 'Time management' and 'Inventory management' are not scope; 'Team management' is", () => {
  assert.equal(scopeHits("Time management").length, 0);
  assert.equal(scopeHits("Inventory management").length, 0);
  assert.ok(scopeHits("Team management").length > 0);
});

test("An employer after a credential is a detail of it, never 'Do you hold Midwest Distribution?'", () => {
  const asked = credentialsToAsk(page("\n\nCERTIFICATIONS\n- Forklift Certified, Midwest Distribution, 2020"), BASE).map((m) => m.name);
  assert.deepEqual(asked, ["Forklift Certified"]);
});
