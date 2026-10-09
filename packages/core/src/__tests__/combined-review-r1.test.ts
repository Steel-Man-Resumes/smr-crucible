/**
 * Lane 3e combined review, round 1 (review-3e-combined-r1.md, with the boss's
 * rulings): the facility check every lane shares.
 *
 *   Tier 1, held: a whole or earlier name, a typed nickname, a run of 2+
 *     naming words with a distinctive one, or a kept-off word within four
 *     words of a facility or incarceration word.
 *   Tier 2: any other single kept-off word, in any field: it prints and the
 *     page is a DRAFT until the person answers one card.
 *   C-H1: a word printed elsewhere only turns a hold into a card; never for
 *     names, nicknames or facility/incarceration neighbors; a line never
 *     clears itself; an unflagged line is judged like any other.
 *   C-M2: a run, nickname or whole name in the person's own name, email,
 *     website or home place is held until answered (generic file name and
 *     title meanwhile); a single word there prints with a card.
 *
 * Every person is invented. Real prison names are used on purpose.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanDetails, cleanEntryText, cleanLine, type PracticeEntry } from "../practiceRecordShared";
import { applyPhraseAnswer, applyTitleMode, cleanKindSettings, type CreativeKindSettings } from "../creativeLaneShared";
import { buildCvModel, cvPlainText } from "../cvShared";
import { getCvStatus } from "../cvChecks";
import { exportOpenItemLines } from "../creativeChecks";
import { buildPerformerModel, performerPlainText, performerShownIds } from "../performerShared";
import { getPerformerStatus } from "../performerChecks";
import { withCommonWords } from "../facilityDictionary";

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(70000 + ++n).padStart(12, "0")}`;
function entry(p: Partial<PracticeEntry> & Pick<PracticeEntry, "section" | "title" | "year">): PracticeEntry {
  return { id: id(), user_id: "u", venue: null, city: null, state: null, end_year: null, details: {}, proof: "checked", names_facility: false, created_at: "", updated_at: "", ...p };
}
const BASE: CreativeKindSettings = { displayName: "Dana Sample", email: "dana@sample.test" };
const DEG = entry({ section: "education", title: "Bachelor of Science in Biology", venue: "Sample State University", year: 2015, details: { degree: true, status: "conferred" } });
const cv = (entries: PracticeEntry[], s: CreativeKindSettings) => {
  const model = buildCvModel(entries, s, "academic");
  const status = getCvStatus({ entries, settings: s, cvType: "academic", model });
  return { model, status, text: cvPlainText(model) };
};
function hide(venue: string, section: PracticeEntry["section"] = "teaching") {
  const e = entry({ section, title: section === "credit" ? "Twelfth Night" : "Literacy Tutor", venue, year: 2019, names_facility: true, details: section === "credit" ? { medium: "theater", role: "Viola" } : {} });
  return { e, s: applyTitleMode(BASE, e.id, "leave_out")! };
}
const noAll = (entries: PracticeEntry[], s: CreativeKindSettings) => {
  let cur = s;
  for (let i = 0; i < 6; i++) for (const a of buildCvModel(entries, cur, "academic").asks) if (!a.held) cur = applyPhraseAnswer(cur, a.phrase, "no")!;
  return cur;
};

describe("C-H2: a prison-town word with an incarceration or facility word is held; alone it keeps the page a draft", () => {
  const held: [string, string][] = [
    ["Folsom State Prison", "I served time at Folsom."],
    ["Attica Correctional Facility", "Poetry workshop with inmates at Attica."],
    ["Corcoran State Prison", "Incarcerated at Corcoran."],
    ["Soledad State Prison", "Locked up in Soledad for years."],
    ["Folsom State Prison", "Teaching inside Folsom prison"],
    ["USP Leavenworth", "Did time in Leavenworth, then college."],
    ["Folsom State Prison", "Stories from the yard at Folsom"],
  ];
  for (const [venue, text] of held) {
    it(`${venue}: "${text}" is held (BLOCK, never printed, no card)`, () => {
      const { e, s } = hide(venue);
      const set = { ...s, interests: text };
      const r = cv([DEG, e], set);
      assert.ok(r.model.heldFields.some((h) => h.field === "interests" && h.reason === "names_hidden"), JSON.stringify(r.model));
      assert.ok(!r.model.asks.some((a) => a.field === "interests"));
      assert.equal(r.status.state, "draft");
      // "No" never clears it.
      assert.ok(cv([DEG, e], applyPhraseAnswer(set, text, "no")!).model.heldFields.some((h) => h.field === "interests"));
    });
  }
  const asked: [string, string][] = [
    ["Folsom State Prison", "Theater at Folsom."],
    ["USP Leavenworth", "Ten years inside Leavenworth."],
  ];
  for (const [venue, text] of asked) {
    it(`${venue}: "${text}" prints with one card and the CV is a DRAFT until answered; "No" finishes it`, () => {
      const { e, s } = hide(venue);
      const set = { ...s, interests: text };
      const r = cv([DEG, e], set);
      assert.ok(r.text.includes(text));
      assert.ok(r.model.asks.some((a) => a.field === "interests" && !a.held));
      assert.equal(r.status.state, "draft");
      assert.ok(r.status.openItems.some((x) => x.answer === "facility_word" && x.severity === "BLOCK" && x.line === "Interests"));
      const n2 = cv([DEG, e], noAll([DEG, e], set));
      assert.equal(n2.status.state, "finished");
      assert.ok(n2.text.includes(text));
    });
  }
});

describe("C-H1: a printed word never cancels a hold; a line never clears itself", () => {
  it("an unflagged job 'Line cook, hired after Rikers' gets a card, and Interests 'Writing group on Rikers' is never on a finished CV", () => {
    const { e, s } = hide("Rikers Island Correctional Center");
    const job = entry({ section: "appointment", title: "Line cook, hired after Rikers", venue: "Example Diner", year: 2021 });
    const set = { ...s, interests: "Writing group on Rikers" };
    const r = cv([DEG, e, job], set);
    assert.equal(r.status.state, "draft");
    assert.ok(r.model.asks.some((a) => a.entryId === job.id));
    assert.ok(r.model.asks.some((a) => a.field === "interests"));
    // ... and on Rikers Island it is held outright.
    const r2 = cv([DEG, e, job], { ...s, interests: "Writing group on Rikers Island" });
    assert.ok(r2.model.heldFields.some((h) => h.field === "interests"));
  });
  it("a printed job at a town theater never lets 'Teaching inside Folsom prison' print", () => {
    const { e, s } = hide("Folsom State Prison");
    const job = entry({ section: "appointment", title: "Stage manager", venue: "Folsom Lake Community Theater", city: "Folsom", state: "CA", year: 2022 });
    const r = cv([DEG, e, job], { ...s, interests: "Teaching inside Folsom prison" });
    assert.doesNotMatch(r.text, /inside Folsom prison/);
    assert.equal(r.status.state, "draft");
    // The job itself prints with one card ("Macomb Community College" class: at most one tap).
    assert.match(r.text, /Stage manager, Folsom Lake Community Theater/);
    assert.ok(r.model.asks.some((a) => a.entryId === job.id && !a.held));
  });
  it("'Macomb Community College' with Macomb Correctional Facility left off prints with at most one tap", () => {
    const { e, s } = hide("Macomb Correctional Facility");
    const col = entry({ section: "education", title: "Associate of Science", venue: "Macomb Community College", year: 2020, details: { degree: true, status: "conferred" } });
    const r = cv([DEG, e, col], s);
    assert.match(r.text, /Macomb Community College/);
    assert.equal(cv([DEG, e, col], noAll([DEG, e, col], s)).status.state, "finished");
  });
  it("performer: with a 'Folsom State Players' credit printed, 'trained at Folsom prison' (discipline, agent, skill) never prints", () => {
    const tw = hide("Folsom State Prison", "credit");
    const pl = entry({ section: "credit", title: "Hamlet", venue: "Folsom State Players", year: 2020, names_facility: true, details: { medium: "theater", role: "Horatio" } });
    const ot = entry({ section: "credit", title: "Our Town", venue: "Example Street Theatre", year: 2024, details: { medium: "theater", role: "Emily Webb" } });
    const s = { ...applyTitleMode(tw.s, pl.id, "true_title")!, displayName: "Ray Example", discipline: "Actor, trained at Folsom prison", agent: "Folsom prison arts office", skills: [{ text: "Folsom prison yard drumming", confirmed: true }] };
    const entries = [tw.e, pl, ot];
    const m = buildPerformerModel(entries, s);
    const txt = performerPlainText(m);
    assert.doesNotMatch(txt, /Folsom prison|Twelfth Night|Viola/);
    assert.match(txt, /Hamlet \| Horatio \| Folsom State Players/);
    const st = getPerformerStatus({ entries, settings: s, model: m, pages: 1 });
    assert.equal(st.state, "draft");
    for (const l of exportOpenItemLines(st, entries, s, "performer", performerShownIds(m))) assert.doesNotMatch(l, /Folsom/);
  });
});

describe("C-M1: true facts that share one word cost one tap, never a dead hold", () => {
  for (const [venue, text] of [
    ["San Quentin State Prison", "Films of Quentin Tarantino"],
    ["Dane County Jail", "Dane County farmers market"],
    ["Macomb Correctional Facility", "Community college in Macomb County"],
  ] as const) {
    it(`${venue}: "${text}" is a card; "No" prints it on a finished CV`, () => {
      const { e, s } = hide(venue);
      const set = { ...s, interests: text };
      const r = cv([DEG, e], set);
      assert.deepEqual(r.model.heldFields, []);
      assert.ok(r.model.asks.some((a) => a.field === "interests"));
      const n2 = cv([DEG, e], noAll([DEG, e], set));
      assert.equal(n2.status.state, "finished");
      assert.ok(n2.text.includes(text));
    });
  }
});

describe("C-M2: the person's own name, email, website and home place", () => {
  it("a run of a kept-off name in the name is held until answered: the header is empty (so the file name and title are generic) and the page is a DRAFT", () => {
    const { e, s } = hide("San Quentin State Prison", "credit");
    const set = { ...s, displayName: "Ray Example of San Quentin", discipline: "Actor", email: "ray@example.com" };
    const m = buildPerformerModel([e], set);
    assert.equal(m.header.name, "");
    const st = getPerformerStatus({ entries: [e], settings: set, model: m, pages: 1 });
    assert.equal(st.state, "draft");
    const card = st.openItems.find((x) => x.answer === "facility_word" && x.line === "(top of the page)")!;
    assert.equal(card.severity, "BLOCK");
    assert.equal(buildPerformerModel([e], applyPhraseAnswer(set, card.phrase, "yes")!).header.name, "");
    assert.equal(buildPerformerModel([e], applyPhraseAnswer(set, card.phrase, "no")!).header.name, "Ray Example of San Quentin");
  });
  it("a single word in the name prints, with a card", () => {
    const { e, s } = hide("Lee Correctional Institution");
    const r = cv([DEG, e], { ...s, displayName: "Jordan Lee" });
    assert.equal(r.model.header.name, "Jordan Lee");
    assert.ok(r.model.asks.some((a) => a.field === "displayName" && !a.held));
    assert.equal(r.status.state, "draft");
  });
  it("the home place follows the same rule, and never masks the same words in other text", () => {
    const { e, s } = hide("San Quentin State Prison", "credit");
    const set = { ...s, displayName: "Ray Example", basedIn: "San Quentin, CA", discipline: "Actor, taught at San Quentin, CA" };
    const m = buildPerformerModel([e], set);
    assert.ok(m.heldFields.some((h) => h.field === "basedIn"));
    assert.ok(m.asks.some((a) => a.field === "basedIn" && a.held));
    assert.equal(m.header.discipline, "");
    assert.doesNotMatch(performerPlainText(m), /Quentin/);
  });
});

describe("combined review LOWs on the performer page", () => {
  const ot = entry({ section: "credit", title: "Our Town", venue: "Example Street Theatre", year: 2024, details: { medium: "theater", role: "Emily Webb" } });
  const S: CreativeKindSettings = { displayName: "Ray Example", email: "ray@example.com" };
  it("C-L1: the status prints once, after the name; a name that says a status is asked, never printed", () => {
    const u = entry({ section: "union", title: "SAG-AFTRA", year: 2024, details: { status: "eligible" } });
    assert.deepEqual(buildPerformerModel([ot, u], S).header.unions, ["SAG-AFTRA, eligible"]);
    for (const title of ["SAG-AFTRA Member", "AEA (full member)", "EMC"]) {
      const bad = { ...u, title };
      const m = buildPerformerModel([ot, bad], S);
      assert.deepEqual(m.header.unions, [], title);
      const st = getPerformerStatus({ entries: [ot, bad], settings: S, model: m, pages: 1 });
      assert.ok(st.openItems.some((x) => x.entryId === bad.id && x.rule === "CR-08" && x.severity === "BLOCK"), title);
    }
  });
  it("C-L2: an age range is 16 to 90, three to fifteen years wide", () => {
    for (const [r, ok] of [["25-35", true], ["16-19", true], ["75-90", true], ["44-45", false], ["44-46", false], ["1-99", false], ["20-40", false], ["12-16", false], ["85-95", false]] as const) {
      const m = buildPerformerModel([ot], { ...S, ageRange: r });
      assert.equal(m.header.stats.some((x) => x.startsWith("Age range")), ok, r);
      if (!ok) assert.ok(getPerformerStatus({ entries: [ot], settings: { ...S, ageRange: r }, model: m, pages: 1 }).openItems.some((x) => x.rule === "CR-08" && x.severity === "BLOCK" && /16 to 90/.test(x.question)), r);
    }
  });
  it("C-L4: a credit added after the person trimmed shows a to-do line, never silence", () => {
    const old = { ...ot, created_at: "2026-01-01T00:00:00.000Z" };
    const later = entry({ section: "credit", title: "Night Bus", venue: "Example Pictures", year: 2025, details: { medium: "film" }, created_at: "2026-09-01T00:00:00.000Z" });
    const s = cleanKindSettings({ selection: [old.id] }, S);
    assert.ok(s.selectionAt, "the server stamps when the selection was made");
    const stamped = { ...s, selectionAt: "2026-06-01T00:00:00.000Z" };
    const st = getPerformerStatus({ entries: [old, later], settings: stamped, pages: 1 });
    const item = st.openItems.find((x) => x.entryId === later.id)!;
    assert.equal(item.severity, "FIX");
    assert.match(item.question, /^New credit not on the page yet/);
    // An entry the person left off when they picked is not asked about again.
    const before = { ...later, created_at: "2026-05-01T00:00:00.000Z" };
    assert.ok(!getPerformerStatus({ entries: [old, before], settings: stamped, pages: 1 }).openItems.some((x) => x.entryId === before.id));
    // The stamp is the server's: a request can't set it, and a later save keeps it.
    assert.equal(cleanKindSettings({ selectionAt: "2020-01-01T00:00:00.000Z" }, S).selectionAt, undefined);
    assert.equal(cleanKindSettings({ phone: "555-0100" }, stamped).selectionAt, "2026-06-01T00:00:00.000Z");
    assert.equal(cleanKindSettings({ selection: null }, stamped).selectionAt, undefined);
  });
  it("C-L5: a role played as oneself is scanned for personal details; a character never is", () => {
    for (const role of ["Himself, age 45, father of two", "Herself (born 1980)", "Self, married with 2 kids", "Interview subject, as himself, 45 years old"]) {
      const c = entry({ section: "credit", title: "Example Documentary", venue: "Example Pictures", year: 2023, details: { medium: "film", role } });
      const m = buildPerformerModel([ot, c], S);
      assert.ok(m.omitted.some((o) => o.entryId === c.id && o.reason === "personal"), role);
      assert.doesNotMatch(performerPlainText(m), /45|1980|married/);
    }
    const ch = entry({ section: "credit", title: "Example Play", venue: "Example Rep", year: 2023, details: { medium: "theater", role: "Single mother, 45 years old" } });
    assert.match(performerPlainText(buildPerformerModel([ot, ch], S)), /Single mother, 45 years old/);
  });
  it("C-L7: a tampered description or skill list is a BLOCK", () => {
    const s = { ...S, ageRange: "25-35", skills: [{ text: "Stage combat", confirmed: true }, { text: "Fire breathing", confirmed: false }] };
    const m = buildPerformerModel([ot], s);
    assert.equal(getPerformerStatus({ entries: [ot], settings: s, model: m, pages: 1 }).state, "finished");
    const t1 = structuredClone(m);
    t1.header.stats.push("Age 45");
    assert.ok(getPerformerStatus({ entries: [ot], settings: s, model: t1, pages: 1 }).openItems.some((x) => x.rule === "CR-08" && x.line === "(your description)" && x.severity === "BLOCK"));
    const t2 = structuredClone(m);
    t2.sections.find((x) => x.key === "skills")!.text = "Stage combat, Fire breathing";
    assert.ok(getPerformerStatus({ entries: [ot], settings: s, model: t2, pages: 1 }).openItems.some((x) => x.rule === "CR-08" && x.line === "Special skills" && x.severity === "BLOCK"));
  });
});

describe("CC rulings after round 1 (burden and the last three calls)", () => {
  // The server marks facility-named entries with the common English words of their names (SCOWL).
  const mark = (es: PracticeEntry[]) => withCommonWords(es);
  it("ruling 2: a whole hidden name in the person's own name is a fixed hold with no card; 'No' never releases it", () => {
    const { e, s } = hide("San Quentin State Prison", "credit");
    const set = { ...s, displayName: "Ray Example, San Quentin State Prison" };
    const m = buildPerformerModel([e], set);
    assert.equal(m.header.name, "");
    assert.ok(!m.asks.some((a) => a.field === "displayName"));
    const st = getPerformerStatus({ entries: [e], settings: set, model: m, pages: 1 });
    assert.ok(st.openItems.some((x) => x.rule === "STD-R03" && x.severity === "BLOCK" && x.line === "(top of the page)" && !x.answer));
    assert.equal(buildPerformerModel([e], applyPhraseAnswer(set, set.displayName, "no")!).header.name, "");
  });
  it("ruling 3: a run of the name in a record line is held until answered, with one card; 'No' puts it back", () => {
    const { e, s } = hide("Example Valley State Prison");
    const college = entry({ section: "education", title: "Certificate in Welding", venue: "Example Valley College", year: 2021, details: { degree: false } });
    const es = mark([DEG, college, e]);
    const r = cv(es, s);
    assert.doesNotMatch(r.text, /Example Valley College/);
    const ask = r.model.asks.find((a) => a.entryId === college.id)!;
    assert.ok(ask && ask.held);
    assert.ok(r.status.openItems.some((x) => x.entryId === college.id && x.answer === "facility_word" && x.severity === "BLOCK"));
    assert.ok(!r.status.openItems.some((x) => x.entryId === college.id && !x.answer), "the card replaces the generic hold");
    const n2 = cv(es, applyPhraseAnswer(s, ask.phrase, "no")!);
    assert.match(n2.text, /Certificate in Welding, Example Valley College/);
    assert.equal(n2.status.state, "finished");
  });
  it("ruling 3: next to a facility or incarceration word, a whole name or a nickname, a record line stays a fixed hold", () => {
    const { e, s } = hide("Example Valley State Prison");
    const nick = { ...e, details: { otherNames: ["the Valley Pen"] } };
    for (const [title, venue] of [
      ["Welding instructor", "Example Valley prison shop"],
      ["Kitchen trainer", "Example Valley State Prison"],
      ["Inmate tutor", "Example Valley Annex"],
      ["Choir", "the Valley Pen"],
    ]) {
      const row = entry({ section: "appointment", title, venue, year: 2020 });
      const es = mark([DEG, nick, row]);
      const r = cv(es, applyTitleMode(s, nick.id, "leave_out")!);
      assert.ok(r.model.omitted.some((o) => o.entryId === row.id && o.reason === "names_hidden"), venue);
      assert.ok(!r.model.asks.some((a) => a.entryId === row.id), `${venue}: no card`);
    }
  });
  it("ruling 4: a common English word never asks on its own; a town or proper name still does", () => {
    // Round 2 (C2-H1): the cut applies only where the name has a non-dictionary word to carry it.
    const quiet: [string, string][] = [
      ["Folsom Valley State Prison", "Central Valley farmworker history"],
      ["Soledad Mountain View Correctional Facility", "Point of view in documentary film"],
      ["Attica Green Correctional Facility", "Green building; urban gardens"],
      ["Corcoran Coffee Creek Annex", "Spanish; coffee roasting"],
      ["Folsom Great Meadow Unit", "The Great Migration"],
      ["Soledad River Correctional Center", "River restoration"],
    ];
    for (const [venue, text] of quiet) {
      const { e, s } = hide(venue);
      const r = cv(mark([DEG, e]), { ...s, interests: text });
      assert.ok(!r.model.asks.length, `${venue}: ${text} ${JSON.stringify(r.model.asks)}`);
      assert.equal(r.status.state, "finished", `${venue}: ${text}`);
      assert.ok(r.text.includes(text.split(";")[0]));
    }
    const asks: [string, string][] = [
      ["Folsom State Prison", "Theater at Folsom"],
      ["San Quentin State Prison", "Films of Quentin Tarantino"],
      ["Attica Correctional Facility", "Attica, New York history"],
      ["Rikers Island Correctional Center", "Poetry on Rikers"],
      ["Dane County Jail", "Dane County farmers market"],
    ];
    for (const [venue, text] of asks) {
      const { e, s } = hide(venue);
      const r = cv(mark([DEG, e]), { ...s, interests: text });
      assert.ok(r.model.asks.some((a) => a.field === "interests"), `${venue}: ${text}`);
      assert.equal(r.status.state, "draft");
    }
  });
  it("ruling 4: common words still count inside a held run and next to a facility or incarceration word", () => {
    for (const [venue, text] of [
      ["Green Haven Correctional Facility", "Gardening at Green Haven"],
      ["Valley State Prison", "Welding in the Valley yard"],
      ["Mountain View Correctional Facility", "I did time at Mountain View"],
      ["Coffee Creek Correctional Facility", "Coffee Creek prison choir"],
    ] as const) {
      const { e, s } = hide(venue);
      const r = cv(mark([DEG, e]), { ...s, interests: text });
      assert.ok(r.model.heldFields.some((h) => h.field === "interests"), `${venue}: ${text}`);
    }
  });
  it("ruling 4: without the server's mark (an entry the server did not hand out) every shared word still asks", () => {
    const { e, s } = hide("Valley State Prison");
    assert.ok(cv([DEG, e], { ...s, interests: "Central Valley farmworker history" }).model.asks.some((a) => a.field === "interests"));
    const cw = mark([e])[0].details.commonWords!;
    assert.ok(cw.includes("valley") && cw.includes("prison"), JSON.stringify(cw));
    assert.ok(!mark([hide("Folsom State Prison").e])[0].details.commonWords!.includes("folsom"));
    // The mark is never stored: the record's cleaner drops it.
    assert.equal(cleanDetails("teaching", { commonWords: ["folsom"] }).commonWords, undefined);
  });
});

describe("a hidden name split over a line break", () => {
  it("is read joined and held: 'Shakespeare at San' / 'Quentin'", () => {
    const { e, s } = hide("San Quentin State Prison");
    for (const text of ["Shakespeare at San\nQuentin", "Debate team\nSan\r\nQuentin"]) {
      const r = cv([DEG, e], { ...s, interests: text });
      assert.ok(r.model.heldFields.some((h) => h.field === "interests"), JSON.stringify(text));
      assert.doesNotMatch(r.text, /Quentin/);
    }
  });
});

describe("combined review r2 (C2-H1 and the LOWs)", () => {
  const mark = (es: PracticeEntry[]) => withCommonWords(es);
  it("C2-H1: a place whose naming words are all dictionary words still asks about each one alone", () => {
    for (const [venue, text] of [
      ["Lee Correctional Institution", "Spike Lee films"],
      ["Valley State Prison", "Central Valley farmworker history"],
      ["Pelican Bay State Prison", "Bay Area art collective"],
      ["Green Haven Correctional Facility", "Green building"],
    ] as const) {
      const { e, s } = hide(venue);
      const r = cv(mark([DEG, e]), { ...s, interests: text });
      assert.ok(r.model.asks.some((a) => a.field === "interests" && !a.held), `${venue}: ${text}`);
      assert.equal(r.status.state, "draft");
      assert.equal(cv(mark([DEG, e]), noAll(mark([DEG, e]), { ...s, interests: text })).status.state, "finished");
    }
  });
  it("C2-H1: release and custody wording near the short name is held until answered; 'No' puts it back", () => {
    for (const [venue, text] of [
      ["Cook County Jail", "Released from Cook County in 2019."],
      ["Lee Correctional Institution", "Paroled from Lee in 2020."],
      ["Lee Correctional Institution", "Sentenced to Lee in 2015."],
      ["Pelican Bay State Prison", "Paroled from the Bay in 2019."],
      ["Valley State Prison", "Released from Valley in 2019."],
      ["Orange County Jail", "Paroled out of Orange County."],
      ["Lee Correctional Institution", "Transferred to Lee in 2016."],
      ["Cook County Jail", "Booked into Cook County twice."],
      ["Soledad State Prison", "Released from Soledad in 2019."],
    ] as const) {
      const { e, s } = hide(venue);
      const set = { ...s, interests: text };
      const r = cv(mark([DEG, e]), set);
      assert.ok(r.model.heldFields.some((h) => h.field === "interests"), `${venue}: ${text}`);
      assert.ok(r.model.asks.some((a) => a.field === "interests" && a.held), `${venue}: ${text} has its card`);
      assert.ok(!r.text.includes(text));
      const n2 = cv(mark([DEG, e]), applyPhraseAnswer(set, text, "no")!);
      assert.ok(n2.text.includes(text), `${venue}: 'No' puts it back`);
    }
    // A true fact costs one tap, never a dead hold.
    const { e, s } = hide("Cook County Jail");
    const hosp = { ...s, interests: "Released from Cook County Hospital after surgery" };
    assert.ok(cv(mark([DEG, e]), hosp).model.asks.some((a) => a.held));
    const n3 = cv(mark([DEG, e]), applyPhraseAnswer(hosp, hosp.interests, "no")!);
    assert.match(n3.text, /Cook County Hospital/);
  });
  it("C2-H1: a '<word> County' run always asks, even when the word is common", () => {
    const { e, s } = hide("Cook County Jail");
    const r = cv(mark([DEG, e]), { ...s, interests: "Cook County farmers market" });
    assert.ok(r.model.asks.some((a) => a.field === "interests"));
    assert.equal(cv(mark([DEG, e]), noAll(mark([DEG, e]), { ...s, interests: "Cook County farmers market" })).status.state, "finished");
    // A carried name's common word still stays quiet alone.
    const f = hide("Folsom Lake Correctional Center");
    assert.equal(cv(mark([DEG, f.e]), { ...f.s, interests: "Lake restoration" }).status.state, "finished");
  });
  it("C2-L1: a name split by ; | / or , is read joined", () => {
    const { e, s } = hide("Green Haven Correctional Facility");
    for (const text of ["Ten years at Green | Haven", "Ten years at Green; Haven", "Ten years at Green/Haven", "Ten years at Green, Haven"]) {
      const r = cv(mark([DEG, e]), { ...s, interests: text });
      assert.ok(r.model.heldFields.some((h) => h.field === "interests"), text);
    }
    const sq = hide("San Quentin State Prison");
    assert.ok(cv([DEG, sq.e], { ...sq.s, interests: "Theater at San | Quentin" }).model.heldFields.some((h) => h.field === "interests"));
  });
  it("C2-L2: an invisible format character between words reads and prints as a space", () => {
    const sq = hide("San Quentin State Prison");
    const r = cv([DEG, sq.e], { ...sq.s, interests: "Theater at San\u200bQuentin" });
    assert.ok(r.model.heldFields.some((h) => h.field === "interests"));
    assert.equal(cleanLine("Ray\u200bExample\u00ad\u2060", 50), "Ray Example");
    assert.equal(cleanEntryText({ ...DEG, title: "Bachelor\u200bof Science" }).title, "Bachelor of Science");
  });
  it("C2-L3: a nickname counts only as whole words: 'the Q-tip' is a different word", () => {
    const { e, s } = hide("San Quentin State Prison");
    const nick = { ...e, details: { otherNames: ["the Q"] } };
    assert.deepEqual(cv([DEG, nick], { ...s, interests: "The Q-tip collection" }).model.heldFields, []);
    assert.ok(cv([DEG, nick], { ...s, interests: "Shakespeare in the Q" }).model.heldFields.some((h) => h.field === "interests"));
    assert.ok(cv([DEG, nick], { ...s, interests: "Shakespeare in the Q, 2015" }).model.heldFields.some((h) => h.field === "interests"));
  });
  it("C2-L4: one card per word across the person's name, email and website", () => {
    const { e, s } = hide("San Quentin State Prison");
    const set = { ...s, displayName: "Quentin Jones", email: "quentin.jones@sample.test", website: "quentinjones.art" };
    const r = cv([DEG, e], set);
    assert.deepEqual(r.model.asks.map((a) => a.field), ["displayName"]);
    assert.match(r.text, /quentin\.jones@sample\.test/);
    const no = cv([DEG, e], applyPhraseAnswer(set, "Quentin Jones", "no")!);
    assert.deepEqual(no.model.asks, []);
    assert.equal(no.status.state, "finished");
    const yes = cv([DEG, e], applyPhraseAnswer(set, "Quentin Jones", "yes")!);
    assert.deepEqual(yes.model.heldFields.map((h) => h.field).sort(), ["displayName", "email"]);
  });
});
