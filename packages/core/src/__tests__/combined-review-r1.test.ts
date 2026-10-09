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
import type { PracticeEntry } from "../practiceRecordShared";
import { applyPhraseAnswer, applyTitleMode, type CreativeKindSettings } from "../creativeLaneShared";
import { buildCvModel, cvPlainText } from "../cvShared";
import { getCvStatus } from "../cvChecks";
import { exportOpenItemLines } from "../creativeChecks";
import { buildPerformerModel, performerPlainText, performerShownIds } from "../performerShared";
import { getPerformerStatus } from "../performerChecks";

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
    ["Soledad State Prison", "Released from Soledad in 2019."],
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
