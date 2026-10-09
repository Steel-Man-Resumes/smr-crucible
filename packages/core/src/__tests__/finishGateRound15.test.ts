/**
 * Finish gate, re-check round 15 (core). Fictional fixtures.
 *
 * R15-B1: strict titles, word for word (short forms aside): no added, dropped
 * or swapped word clears a title. R15-B2: only the direct object of a target
 * verb is the job they want. R15-B3: a job header's title comes only from
 * their own title for that same job (employer and years). R15-B4: "eager to
 * bring my experience as a shift supervisor" is a title they claim.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus } from "../resumeStatus";
import { scopeHits, scopeHitsNotTheirs, titleInOwnHeaders } from "../scopeWords";

const up = (header: string) => `Jordan Smith\nToledo, OH | jordan@example.com\n${header} | Burger Barn | 2019 - 2023\nran the register, counted drawers, opened the store`;
const roleOpen = (line: string, src: string) => scopeHitsNotTheirs(line, src).some((h) => h.role && h.title);

test("R15-B1: a swapped, added or dropped title word never clears", () => {
  for (const [header, line] of [
    ["Shift Manager", "Store manager who ran the register."],
    ["Shift Manager", "Restaurant manager who ran the register."],
    ["Shift Supervisor", "Store supervisor who ran the register."],
    ["Crew Lead", "Store lead who ran the register."],
    ["Line Lead", "Production lead who ran the register."],
    ["Team Lead", "Project lead who ran the register."],
    ["Shift Lead", "Retail shift lead who ran the register."],
    ["Night Shift Lead Custodian", "Lead custodian who ran the floor scrubber."],
    ["Assistant Manager", "Manager who ran the register."],
  ]) {
    assert.ok(roleOpen(line, up(header)), `${header} -> ${line}`);
  }
  assert.ok(!roleOpen("Shift manager who ran the register.", up("Shift Manager")));
  assert.ok(!roleOpen("Assistant manager who ran the register.", up("Asst. Mgr")));
  assert.ok(titleInOwnHeaders("Customer service representative", up("Customer Service Rep")));
  assert.ok(!titleInOwnHeaders("Store manager", up("Shift Manager")));
});

test("R15-B2: only the direct object of a target verb is the job they want", () => {
  for (const s of ["I am applying for the shift lead position.", "Seeking a shift supervisor role.", "I am interested in the team lead opening.", "Hard worker looking to grow into a team lead.", "I am applying for the position of shift supervisor."]) {
    assert.ok(!scopeHits(s).some((h) => h.role), s);
  }
  for (const s of [
    "I am applying for this job because as a shift lead at Burger Barn I ran the register.",
    "I am applying for the store manager job because as store manager at Burger Barn I ran the register.",
    "I am interested in this role because I was the shift supervisor at Burger Barn.",
    "Seeking a warehouse role as an experienced shift supervisor.",
    "My experience as a shift lead taught me to count drawers.",
  ]) {
    assert.ok(scopeHits(s).some((h) => h.role && h.title), s);
  }
});

test("R15-B4: a frame governs the verb, not the title after 'as a'", () => {
  for (const s of [
    "I am eager to bring my experience as a shift supervisor at Burger Barn to your store.",
    "I would like to bring my experience as a shift lead at Burger Barn to your team.",
    "I hope to bring my experience as a shift lead to your team.",
    "I want to put my experience as a team lead to work for you.",
    "I am ready to use what I learned as a shift supervisor at Burger Barn.",
  ]) {
    assert.ok(scopeHits(s).some((h) => h.role && h.title), s);
  }
});

const PAGE = (header: string) => `JORDAN SMITH\nToledo, OH | jordan@example.com\n\nPROFESSIONAL EXPERIENCE\n${header}\n- Ran the register`;
const titled = (header: string, src: string) => getResumeStatus({ resumeText: PAGE(header), sourceText: src }).openItems.some((i) => i.kind === "title_unsaid");
const PROMO = "Jordan Smith\nToledo, OH | jordan@example.com\nShift Lead | Kroger | 2019 - 2023\nCashier | Kroger | 2016 - 2019";
test("R15-B3: a job header's title comes only from their own title for that same job", () => {
  assert.ok(titled("SHIFT LEAD | Kroger | Toledo, OH | 2016 - 2019", PROMO), "promotion moved onto earlier years");
  assert.ok(titled("SHIFT LEAD | Kroger | Toledo, OH | 2016 - 2023", PROMO), "merged span");
  assert.ok(!titled("SHIFT LEAD | Kroger | Toledo, OH | 2019 - 2023", PROMO), "their own job");
  assert.ok(!titled("CASHIER | Kroger | Toledo, OH | 2016 - 2019", PROMO), "their own job");
  assert.ok(titled("SHIFT LEAD | Dollar General | Toledo, OH | 2016 - 2019", "Jordan Smith\nShift Lead | Kroger | 2019 - 2023\nCashier at Dollar General 2016 to 2019"), "another job's title");
  assert.ok(titled("SHIFT LEAD | Dollar General | Toledo, OH | 2016 - 2019", "Jordan Smith\nShift Lead | Kroger | 2019 - 2023"), "no own job there");
  assert.ok(!titled("SHIFT LEAD | Kroger | Toledo, OH | 2019 - Present", "Jordan Smith\nShift Lead | Kroger | 2019 - present"));
  assert.ok(!titled("WAREHOUSE ASSOCIATE | Midwest Distribution | 2019 - 2023", "I was hired on at Midwest Distribution in 2019 as a warehouse associate."));
});
