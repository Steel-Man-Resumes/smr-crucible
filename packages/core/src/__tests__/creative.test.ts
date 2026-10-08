/**
 * Creative lanes (075): the practice record, the artist resume, the bio, the
 * statement coach and its authorship guard, the work-sample list, the
 * realistic/dream plan, and the truth checks. Pure modules only; the policies
 * and the exact SQL are proven against a scratch Postgres separately.
 *
 * Every person and place here is invented.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLaneSettings, laneKindOf } from "../careerLaneShared";
import { LANE_PAIR_SQL, LANE_UNPAIR_SQL, LANE_SET_PLAN_SQL, LANE_INSERT_SQL } from "../careerLane";
import {
  resolvePracticeEntry,
  looksLikeFacilityName,
  cleanDetails,
  yearsOf,
  type PracticeEntry,
} from "../practiceRecordShared";
import {
  buildArtistResumeModel,
  artistResumePlainText,
  buildWorkSampleList,
  workSampleListCsv,
  cleanKindSettings,
  applyTitleMode,
  settingsRev,
  stillNeedsProof,
  artistResumePageCap,
  countChars,
  countWords,
  rowText,
  type CreativeKindSettings,
} from "../creativeLaneShared";
import {
  checkStatementSave,
  modelFingerprints,
  readBackQuestions,
  auditStatementHistory,
  applySpellingMark,
  MAX_STATEMENT_VERSIONS,
  COACH_QUESTIONS,
  type StatementContent,
} from "../creativeStatement";
import {
  draftBioFromFacts,
  bioTemplates,
  classifyBio,
  bioTextForLane,
  bioText,
  bioCounts,
  emptyBio,
} from "../creativeBio";
import { spellingMarksFor, spellingCheck, boundedDistance, isValidSpellingMark, suggestionFor, isDictionaryWord } from "../creativeSpelling";
import { checkBio, exportOpenItemLines, creativeOpenItemLines, HIDDEN_ENTRY_LINE, HIDDEN_SENTENCE_LINE } from "../creativeChecks";
import { getCreativeStatus, checkArtistResume } from "../creativeChecks";
import { hurdlesFor, cleanPlan, HELP_SOURCES, HURDLES_NOT_A_VERDICT } from "../twoPathPlan";
import { RLS_PROTECTED_TABLES } from "../rlsHealth";
import { ARTIFACT_CONTENT_UPDATE_SQL, CREATIVE_ARTIFACT_TYPES } from "../refineryArtifact";

const MIGRATIONS = join(__dirname, "..", "..", "migrations");
const U = "00000000-0000-4000-8000-00000000c0de";
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function entry(p: Partial<PracticeEntry> & Pick<PracticeEntry, "section" | "title" | "year">): PracticeEntry {
  return {
    id: id(), user_id: U, venue: null, city: null, state: null, end_year: null, details: {}, proof: "remembered",
    names_facility: false, created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z", ...p,
  };
}

// An invented muralist and printmaker.
const SOLO = entry({ section: "exhibition", title: "Shift Change", venue: "Riverside Arts Center", city: "Toledo", state: "OH", year: 2024, details: { kind: "solo" }, proof: "checked" });
const GROUP = entry({ section: "exhibition", title: "New Prints", venue: "Harbor Gallery", city: "Toledo", state: "OH", year: 2022, details: { kind: "group" } });
const INSIDE_SHOW = entry({ section: "exhibition", title: "Art From Example County Correctional", venue: "Main Street Library", city: "Akron", state: "OH", year: 2020, details: { kind: "group" }, names_facility: true });
const PROGRAM = entry({ section: "arts_program", title: "Inside Print Workshop", venue: "Example County Correctional Facility", year: 2018, end_year: 2020, details: { role: "printmaker" }, names_facility: true });
const AWARD = entry({ section: "award", title: "Emerging Artist Grant", venue: "Toledo Arts Fund", year: 2023, details: { kind: "grant" } });
const WORK = entry({ section: "work", title: "Night Bus", year: 2023, details: { medium: "Acrylic on panel", dimensions: "24 x 36 in", description: "The last bus home after a double." } });
const WORK2 = entry({ section: "work", title: "Loading Dock", year: 2021, details: { medium: "Linocut", dimensions: "11 x 14 in" } });
const ALL = [SOLO, GROUP, INSIDE_SHOW, PROGRAM, AWARD, WORK, WORK2];
const SETTINGS: CreativeKindSettings = {
  displayName: "Ray Example", discipline: "painter and printmaker", basedIn: "Toledo, OH", email: "ray@example.com",
  titleModes: { [INSIDE_SHOW.id]: "venue_only", [PROGRAM.id]: "true_title" },
};

// ------------------------------------------------------------------ lanes --
describe("lane kind and path (075)", () => {
  it("a new lane is a resume lane unless it says creative; path is optional", () => {
    const r = resolveLaneSettings({ name: "Warehouse" }, null);
    assert.ok(r.ok);
    assert.equal(r.value.kind, "resume");
    assert.equal(r.value.path, null);
    const c = resolveLaneSettings({ name: "Painting", kind: "creative", path: "dream" }, null);
    assert.ok(c.ok);
    assert.equal(c.value.kind, "creative");
    assert.equal(c.value.path, "dream");
  });
  it("kind is fixed after create; bad kind and path are refused, never guessed", () => {
    const cur = { name: "Painting", target_role: null, format: "chronological" as const, hybrid_uneven_history: false, hybrid_field_change: false, length_pref: "auto" as const, kind: "creative" as const, path: null };
    assert.deepEqual(resolveLaneSettings({ kind: "resume" }, cur), { ok: false, error: "kind_is_fixed" });
    assert.deepEqual(resolveLaneSettings({ name: "x", kind: "portfolio" }, null), { ok: false, error: "bad_kind" });
    assert.deepEqual(resolveLaneSettings({ name: "x", path: "someday" }, null), { ok: false, error: "bad_path" });
    assert.deepEqual(resolveLaneSettings({ name: "x", kind: "creative", format: "hybrid", hybridUnevenHistory: true, hybridFieldChange: true }, null), { ok: false, error: "bad_format" });
  });
  it("rows read before 075 count as resume lanes", () => {
    assert.equal(laneKindOf({}), "resume");
    assert.equal(laneKindOf({ kind: "creative" }), "creative");
    assert.equal(laneKindOf({ kind: "nonsense" }), "resume");
  });
  it("pairing and unpairing are single statements over both rows", () => {
    assert.match(LANE_PAIR_SQL, /l\.id IN \(\$1::uuid, \$2::uuid\)/);
    assert.match(LANE_PAIR_SQL, /pair_lane_id IS NULL\) = 2/);
    assert.match(LANE_UNPAIR_SQL, /id = \$1 OR pair_lane_id = \$1/);
    assert.match(LANE_SET_PLAN_SQL, /path = 'dream' AND pair_lane_id IS NOT NULL/);
    assert.match(LANE_INSERT_SQL, /kind, path/);
  });
});

// ----------------------------------------------------------- practice record --
describe("practice record", () => {
  it("every entry needs a title and a four-digit year; ranges keep order", () => {
    assert.deepEqual(resolvePracticeEntry({ section: "work", title: " ", year: 2020 }), { ok: false, error: "title_required" });
    assert.deepEqual(resolvePracticeEntry({ section: "work", title: "x", year: "20" }), { ok: false, error: "year_required" });
    assert.deepEqual(resolvePracticeEntry({ section: "work", title: "x", year: 2020, endYear: 2019 }), { ok: false, error: "bad_end_year" });
    assert.deepEqual(resolvePracticeEntry({ section: "rumor", title: "x", year: 2020 }), { ok: false, error: "bad_section" });
  });
  it("a show says solo, two-person or group; a publication says its status, and submitted says when", () => {
    assert.deepEqual(resolvePracticeEntry({ section: "exhibition", title: "x", year: 2020 }), { ok: false, error: "kind_required" });
    assert.deepEqual(resolvePracticeEntry({ section: "publication", title: "x", year: 2020 }), { ok: false, error: "status_required" });
    assert.deepEqual(resolvePracticeEntry({ section: "publication", title: "x", year: 2020, details: { status: "submitted" } }), { ok: false, error: "submitted_needs_when" });
    assert.equal(resolvePracticeEntry({ section: "publication", title: "x", year: 2020, details: { status: "rejected" } }).ok, false);
  });
  it("details keep only the fields that belong to the section", () => {
    const d = cleanDetails("exhibition", { kind: "group", medium: "oil", juried: "yes", curator: "  A. Person " });
    assert.deepEqual(d, { kind: "group", curator: "A. Person" });
  });
  it("a press quote keeps its exact characters", () => {
    const d = cleanDetails("press", { quote: "  Bold,  quiet   work.  " });
    assert.equal(d.quote, "Bold,  quiet   work.");
  });
  it("facility words are a hint only", () => {
    assert.equal(looksLikeFacilityName("Art From Example County Correctional"), true);
    assert.equal(looksLikeFacilityName("Riverside Arts Center", null), false);
  });
  it("years print as a plain hyphenated range", () => {
    assert.equal(yearsOf(PROGRAM), "2018-2020");
    assert.equal(yearsOf(SOLO), "2024");
  });
});

// ------------------------------------------------------------ artist resume --
describe("artist resume (CAA order)", () => {
  const m = buildArtistResumeModel(ALL, SETTINGS);
  it("sections follow the CAA order and solo and group shows stay separate", () => {
    assert.deepEqual(m.sections.map((s) => s.key), ["education", "solo", "group", "award"]);
  });
  it("titles of shows are italic; venue and place follow; years sit apart", () => {
    const row = m.sections.find((s) => s.key === "solo")!.rows[0];
    assert.equal(row.years, "2024");
    assert.equal(row.parts[0].italic, true);
    assert.equal(rowText(row.parts), "Shift Change, Riverside Arts Center, Toledo, OH");
  });
  it("R03: venue-only shows the kind and venue, never the title; true title shows it exactly", () => {
    const group = m.sections.find((s) => s.key === "group")!;
    const inside = group.rows.find((r) => r.entryId === INSIDE_SHOW.id)!;
    assert.equal(rowText(inside.parts), "Group exhibition, Main Street Library, Akron, OH");
    assert.ok(!rowText(inside.parts).includes("Example County"));
    const prog = m.sections.find((s) => s.key === "education")!.rows[0];
    assert.equal(rowText(prog.parts), "Inside Print Workshop, Example County Correctional Facility, printmaker");
  });
  it("R03: with no choice made, the entry stays off and is asked about", () => {
    const m2 = buildArtistResumeModel(ALL, { ...SETTINGS, titleModes: {} });
    assert.deepEqual(m2.needsChoice.sort(), [INSIDE_SHOW.id, PROGRAM.id].sort());
    assert.ok(!artistResumePlainText(m2).includes("Example County"));
  });
  it("leave out keeps it off this lane only", () => {
    const m3 = buildArtistResumeModel(ALL, { ...SETTINGS, titleModes: { [INSIDE_SHOW.id]: "leave_out", [PROGRAM.id]: "leave_out" } });
    assert.ok(!m3.sections.some((s) => s.rows.some((r) => r.entryId === INSIDE_SHOW.id)));
    assert.equal(m3.needsChoice.length, 0);
  });
  it("a selection trims and says Selected; the record keeps everything", () => {
    const m4 = buildArtistResumeModel(ALL, { ...SETTINGS, selection: [SOLO.id, AWARD.id] });
    assert.deepEqual(m4.sections.map((s) => s.heading), ["Solo Exhibitions", "Awards, Grants and Fellowships"]);
    const m5 = buildArtistResumeModel(ALL, { ...SETTINGS, selection: [SOLO.id] });
    assert.ok(m5.trimmed);
  });
  it("a private collector is named only with their OK; public collections lead", () => {
    const pub = entry({ section: "collection", title: "Night Bus", venue: "City Hall", city: "Toledo", state: "OH", year: 2024, details: { holder: "public" } });
    const priv = entry({ section: "collection", title: "Loading Dock", venue: "J. Doe", year: 2025, details: { holder: "private" } });
    const s = buildArtistResumeModel([pub, priv], {}).sections[0];
    assert.equal(rowText(s.rows[0].parts), "City Hall, Toledo, OH");
    assert.equal(rowText(s.rows[1].parts), "Private collection");
  });
  it("page cap is 2, or 4 only when the person says a call allows it (C1)", () => {
    assert.equal(artistResumePageCap({}), 2);
    assert.equal(artistResumePageCap({ callAllowsMore: true }), 4);
  });
  it("review L3: the largest settings the app allows stay under the database's 16,000-byte check", () => {
    const id = (i: number) => `00000000-0000-4000-8000-${String(900000 + i).padStart(12, "0")}`;
    let big: CreativeKindSettings | null = cleanKindSettings({
      displayName: "x".repeat(200), discipline: "x".repeat(200), basedIn: "x".repeat(200), email: "x".repeat(200), phone: "x".repeat(200), website: "x".repeat(200),
      callAllowsMore: true, bioPronoun: "they",
      selection: Array.from({ length: 300 }, (_, i) => id(i)),
    }, { rev: 123456 });
    for (let i = 0; i < 300; i++) big = applyTitleMode(big, id(i), "venue_only") ?? big;
    big = { ...big!, rev: 123457 };
    assert.ok(Buffer.byteLength(JSON.stringify(big)) < 16000, String(Buffer.byteLength(JSON.stringify(big))));
  });
  it("kind settings drop unknown keys and bad values; facility choices never arrive as a map", () => {
    const s = cleanKindSettings({ displayName: "  Ray  ", callAllowsMore: "yes", titleModes: { [GROUP.id]: "leave_out" }, rev: 99, junk: 1 });
    assert.deepEqual(s, { displayName: "Ray" });
    assert.equal(applyTitleMode(s, GROUP.id, "soften"), null);
    assert.deepEqual(applyTitleMode(s, GROUP.id, "leave_out")?.titleModes, { [GROUP.id]: "leave_out" });
  });
  it("review N-M2 / S1: a stale tab's whole map can't undo a newer 'leave it off'", () => {
    const stored = { ...applyTitleMode({ displayName: "Ray", rev: 4 }, INSIDE_SHOW.id, "leave_out")!, rev: 4 };
    const staleTab = { titleModes: { [INSIDE_SHOW.id]: "true_title", [PROGRAM.id]: "leave_out" } };
    const next = cleanKindSettings(staleTab, stored);
    assert.equal(next.titleModes?.[INSIDE_SHOW.id], "leave_out");
    assert.equal(next.titleModes?.[PROGRAM.id], undefined, "only applyTitleMode sets a choice");
    assert.equal(settingsRev(next), 4, "the stored revision is kept; the route checks it");
    const one = applyTitleMode(stored, PROGRAM.id, "leave_out")!;
    assert.deepEqual(one.titleModes, { [INSIDE_SHOW.id]: "leave_out", [PROGRAM.id]: "leave_out" });
  });
});

// ----------------------------------------------------------- work samples --
describe("work-sample list", () => {
  it("keeps the person's order, then newest; copies every field as typed", () => {
    const rows = buildWorkSampleList(ALL, [WORK2.id]);
    assert.deepEqual(rows.map((r) => r.title), ["Loading Dock", "Night Bus"]);
    assert.equal(rows[1].description, "The last bus home after a double.");
    assert.equal(rows[0].description, "");
  });
  it("CSV keeps formulas inert", () => {
    const evil = entry({ section: "work", title: "=HYPERLINK(1)", year: 2020, details: { medium: "x", dimensions: "y" } });
    assert.match(workSampleListCsv(buildWorkSampleList([evil], [])), /'=HYPERLINK/);
    // Review L6: a leading tab or carriage return is guarded too.
    const row = { entryId: "x", number: 1, title: "\t=HYPERLINK(1)", year: "2020", medium: "", size: "", description: "", fileName: "" };
    assert.match(workSampleListCsv([row]).split("\r\n")[1], /^1,'\t=HYPERLINK/);
  });
});

// ----------------------------------------------------------- counts --
describe("plain text counts", () => {
  it("characters count spaces and line breaks, like portals do", () => {
    assert.equal(countChars("ab c"), 4);
    assert.equal(countChars("a\nb"), 3);
    assert.equal(countChars("é"), 1);
    assert.equal(countWords("  two   words "), 2);
  });
});

// --------------------------------------------------- statement (CR-03) --
describe("statement coach, strict v1: no model at all; spelling from a word list (CR-03)", () => {
  const person = "I paint the night shift at the plant. I am not ashamed of where I learned to draw. I keep it seperate.";

  it("the coach is fixed code: the question bank plus a read-back of the person's own sentences", () => {
    for (const q of COACH_QUESTIONS) assert.ok(q.endsWith("?"));
    const rb = readBackQuestions(`${"word ".repeat(40).trim()}. I like stuff.`);
    assert.ok(rb.length >= 2);
    for (const q of rb) assert.ok(q.endsWith("?"));
    // Review P1: a "question" carrying model wording has no way in; there is no model reply to parse.
    const statement = require("../creativeStatement");
    assert.equal(statement.parseCoachOutput, undefined);
  });

  it("review P4: a real word is never marked, so not/now, paint/print, draw/drew can't be offered", () => {
    const marks = spellingMarksFor(person);
    assert.deepEqual(marks.map((m) => [m.word, m.suggestion]), [["seperate", "separate"]]);
    assert.match(marks[0].sentence ?? "", /I keep it seperate\./);
    for (const [w, sug] of [["not", "now"], ["paint", "print"], ["draw", "drew"], ["plant", "plane"], ["am", "was"], ["can", "can't"], ["hate", "have"], ["lie", "live"], ["form", "from"]]) {
      assert.equal(isValidSpellingMark({ word: w, suggestion: sug }), false, `${w} -> ${sug}`);
    }
  });

  it("a mark replaces only a non-word, only with the one closest dictionary word", () => {
    assert.equal(isDictionaryWord("separate"), true);
    assert.equal(suggestionFor("seperate"), "separate");
    assert.equal(suggestionFor("recieve"), "receive");
    assert.equal(suggestionFor("Toledo"), null, "names and capitals are never marked");
    assert.equal(suggestionFor("printmaking"), null, "a real art word is a word");
    assert.equal(suggestionFor("zzqx"), null, "nothing close: no mark");
    assert.equal(isValidSpellingMark({ word: "seperate", suggestion: "separate" }), true);
    assert.equal(isValidSpellingMark({ word: "seperate", suggestion: "desperate" }), false, "only the one fix the list offers");
  });

  it("review N-M1: bare contractions are never marked, and a tie between two words means no mark", () => {
    for (const t of ["hasnt", "hadnt", "couldnt", "shouldnt", "wouldnt", "aint", "havent", "doesnt", "mustnt", "neednt"]) assert.equal(suggestionFor(t), null, t);
    // Equally close words: no guess at which one was meant.
    for (const t of ["addicion", "fram", "pround", "stol", "stoped", "noone", "evr", "nto"]) assert.equal(suggestionFor(t), null, t);
    // Real one-answer slips still get their fix.
    for (const [t, fix] of [["recieve", "receive"], ["thier", "their"], ["beleive", "believe"], ["relaspe", "relapse"], ["sobreity", "sobriety"], ["galery", "gallery"]]) {
      assert.equal(suggestionFor(t), fix, t);
    }
  });

  it("review N-M3: a 12,000-character statement of non-words is checked in under a second, and says when it stopped", () => {
    const letters = "abcdefghijklmnoprstuw";
    const words: string[] = [];
    for (let i = 0; words.join(" ").length < 11900; i++) {
      let w = "s";
      let k = i;
      for (let j = 0; j < 9; j++) { w += letters[k % letters.length]; k = Math.floor(k / letters.length) + j * 7 + 3; }
      words.push(w);
    }
    const text = words.join(" ");
    const t0 = Date.now();
    const r = spellingCheck(text);
    const ms = Date.now() - t0;
    assert.ok(ms < 1000, `${ms} ms`);
    assert.equal(r.capped, true);
    assert.ok(boundedDistance("abcdefghij", "zyxwvutsrq", 2) === 3, "the distance gives up past its limit");
  });

  it("the save checks every mark on the server, and only one word may change", () => {
    const mk = { word: "seperate", suggestion: "separate" };
    const fixed = applySpellingMark(person, mk);
    assert.ok(fixed.endsWith("I keep it separate."));
    assert.deepEqual(checkStatementSave({ previousText: person, nextText: fixed, acceptedMark: mk, validMark: isValidSpellingMark, modelPrints: [] }), { ok: true });
    assert.deepEqual(
      checkStatementSave({ previousText: person, nextText: `${fixed} Truly a visionary.`, acceptedMark: mk, validMark: isValidSpellingMark, modelPrints: [] }),
      { ok: false, reason: "mark_changed_more" }
    );
    // Review P4b: not -> now, even if the browser sends it, is refused.
    const flip = { word: "not", suggestion: "now" };
    assert.deepEqual(
      checkStatementSave({ previousText: person, nextText: applySpellingMark(person, flip), acceptedMark: flip, validMark: isValidSpellingMark, modelPrints: [] }),
      { ok: false, reason: "mark_not_valid" }
    );
    // No server check supplied: no mark can be accepted at all.
    assert.deepEqual(checkStatementSave({ previousText: person, nextText: fixed, acceptedMark: mk, modelPrints: [] }), { ok: false, reason: "mark_not_valid" });
  });

  it("backstop: a stored model reply's words still can't be saved (the design doesn't rely on it)", () => {
    const prints = modelFingerprints("Every canvas carries the weight of a double shift.");
    assert.deepEqual(
      checkStatementSave({ previousText: person, nextText: `${person} Every canvas carries the weight of a double shift.`, modelPrints: prints }),
      { ok: false, reason: "model_text" }
    );
    assert.deepEqual(checkStatementSave({ previousText: person, nextText: `${person} The drivers know every face.`, modelPrints: prints }), { ok: true });
  });

  it("review M6: more than 25 versions with an early spelling fix never raises a false CR-03 BLOCK", () => {
    const mk = { word: "thier", suggestion: "their" };
    const t = "I paint thier faces on the night shift.";
    const versions: StatementContent["versions"] = [
      { text: t, savedAt: "2026-10-07T10:00:00.000Z", via: "typed" },
      { text: applySpellingMark(t, mk), savedAt: "2026-10-07T10:01:00.000Z", via: "spelling", mark: mk },
    ];
    for (let i = 0; i < 24; i++) versions.push({ text: `${applySpellingMark(t, mk)} Line ${i}.`, savedAt: `2026-10-07T11:${String(i).padStart(2, "0")}:00.000Z`, via: "typed" });
    const kept: StatementContent = { versions: versions.slice(-MAX_STATEMENT_VERSIONS), modelPrints: [] };
    assert.equal(kept.versions[0].via, "spelling");
    assert.equal(auditStatementHistory(kept), null);
    assert.equal(getCreativeStatus({ entries: [], settings: {}, statement: kept }).blockCount, 0);
  });

  it("no route outside the creative tools can write a statement", () => {
    for (const t of CREATIVE_ARTIFACT_TYPES) assert.ok(ARTIFACT_CONTENT_UPDATE_SQL("").includes(`'${t}'`));
    assert.match(ARTIFACT_CONTENT_UPDATE_SQL(""), /artifact_type NOT IN/);
  });
});

// ------------------------------------------------------------------- bio --
describe("bio (C3), strict v1: fixed templates, one entry per sentence; origin decided by the server", () => {
  it("every template sentence comes from exactly one entry and names only that entry", () => {
    const t = bioTemplates(ALL, SETTINGS);
    assert.ok(t.length >= 4);
    assert.equal(t[0].key, "intro");
    assert.equal(t[0].text, "Ray Example is a painter and printmaker based in Toledo, OH.");
    const byId = new Map(ALL.map((e) => [e.id, e]));
    for (const x of t.slice(1)) {
      const e = byId.get(x.sourceEntryId!)!;
      assert.ok(e, x.text);
      for (const other of ALL.filter((o) => o.id !== e.id && o.venue && o.venue !== e.venue)) assert.ok(!x.text.includes(other.venue!), `${x.text} pools ${other.venue}`);
      assert.ok(x.text.includes(String(e.year)) || ["education", "collection"].includes(e.section), x.text);
    }
  });

  it("the lane's choice per entry applies: venue only drops the title; leave out drops the entry", () => {
    const venue = bioTemplates(ALL, SETTINGS).map((x) => x.text).join(" ");
    assert.ok(!venue.includes("Art From Example County Correctional"));
    assert.match(venue, /group exhibition at Main Street Library in 2020/);
    assert.match(venue, /Inside Print Workshop/);
    const out = bioTemplates(ALL, { ...SETTINGS, titleModes: { [INSIDE_SHOW.id]: "leave_out", [PROGRAM.id]: "leave_out" } }).map((x) => x.text).join(" ");
    assert.ok(!/Example County|Inside Print|Main Street Library/.test(out));
    const unset = bioTemplates(ALL, { ...SETTINGS, titleModes: {} }).map((x) => x.text).join(" ");
    assert.ok(!/Example County|Inside Print|Main Street Library/.test(unset));
  });

  it("entries still marked need-to-find are not used", () => {
    const e = entry({ section: "award", title: "Harbor Prize", venue: "Harbor Fund", year: 2021, proof: "need_to_find" });
    assert.ok(!bioTemplates([e], SETTINGS).some((x) => x.text.includes("Harbor Prize")));
  });

  it("short stays inside 100 words and 600 characters", () => {
    const many = Array.from({ length: 30 }, (_, i) => entry({ section: "award", title: `Prize Number ${i}`, venue: "Toledo Arts Fund", year: 2000 + i }));
    const s = draftBioFromFacts(many, SETTINGS, "short").map((x) => x.text).join(" ");
    assert.ok(countWords(s) <= 100 && countChars(s) <= 600);
  });

  it("review B1: model-style sentences are never 'fact' sentences; each is the person's own and gets asked about", () => {
    const rec = [
      entry({ section: "exhibition", title: "Night Shift", venue: "Corner Gallery", city: "Lansing", state: "MI", year: 2023, details: { kind: "group" } }),
      entry({ section: "award", title: "Emerging Artist Grant", venue: "City Arts Council", year: 2021, details: { kind: "grant" } }),
    ];
    const st = { displayName: "Ray Example", discipline: "painter" };
    const tries = [
      "Ray Example had a solo exhibition at Corner Gallery in 2021.",
      "Ray Example has shown in over twenty exhibitions.",
      "Ray Example won first prize at Corner Gallery in 2023.",
      "Paris hosted Ray Example's work in 2023.",
      "Ray Example received a national fellowship from City Arts Council in 2021.",
      "Ray Example is a painter whose work toured nationally.",
    ];
    const bio = classifyBio({ lengths: { short: tries.map((text, i) => ({ id: `m${i}`, text, origin: "fact", approved: true })), medium: [], long: [] } }, rec, st);
    for (const x of bio.lengths.short) assert.equal(x.origin, "person_written", x.text);
    assert.ok(!bioTemplates(rec, st).some((t) => tries.includes(t.text)));
    const items = checkBio(bio, rec, st);
    // Not a fact sentence, so never drafted and never "finished" on the record's word; these three also carry a name, number or claim the record doesn't hold.
    for (const t of tries.filter((x) => /twenty|Paris|toured/.test(x))) {
      const id = bio.lengths.short.find((x) => x.text === t)!.id;
      assert.ok(items.some((i) => i.sentenceId === id), `asked about: ${t}`);
    }
  });

  it("a sentence equal to a template is a fact sentence with its one source; the browser's label is ignored", () => {
    const t = bioTemplates(ALL, SETTINGS);
    const bio = classifyBio({ lengths: { short: [{ id: "a", text: t[1].text, origin: "person_written", approved: true }, { id: "b", text: `${t[1].text} Truly.`, origin: "fact", approved: true }], medium: [], long: [] } }, ALL, SETTINGS);
    assert.equal(bio.lengths.short[0].origin, "fact");
    assert.equal(bio.lengths.short[0].sourceEntryId, t[1].sourceEntryId);
    assert.equal(bio.lengths.short[1].origin, "person_written");
  });

  it("review B3: a person's sentence naming a venue and year not in the record is flagged", () => {
    const bio = classifyBio({ lengths: { short: [{ id: "a", text: "Ray Example had a solo show at the Whitney in 2024.", approved: true }], medium: [], long: [] } }, ALL, SETTINGS);
    const items = checkBio(bio, ALL, SETTINGS);
    assert.ok(items.some((x) => x.rule === "CR-04" && /Whitney|2024/.test(x.question)));
  });

  it("review B2: the lane's CURRENT choice wins; a stored copy can't re-open a facility name", () => {
    const t = bioTemplates(ALL, SETTINGS).find((x) => x.sourceEntryId === PROGRAM.id)!;
    const bio = classifyBio({ disclosure: "include", lengths: { short: [{ id: "a", text: t.text, approved: true }], medium: [], long: [] } }, ALL, SETTINGS);
    const nowOff = { ...SETTINGS, titleModes: { ...SETTINGS.titleModes, [PROGRAM.id]: "leave_out" as const } };
    const items = checkBio(bio, ALL, nowOff);
    assert.equal(items.filter((x) => x.severity === "BLOCK").length, 1);
    assert.equal(bioTextForLane(bio.lengths.short, ALL, nowOff), "", "the export leaves the sentence out");
    // A person's own sentence naming it is held to the same choice.
    const mine = classifyBio({ lengths: { short: [{ id: "b", text: "Ray Example learned printing at Example County Correctional Facility.", approved: true }], medium: [], long: [] } }, ALL, nowOff);
    assert.equal(checkBio(mine, ALL, nowOff).filter((x) => x.severity === "BLOCK").length, 1);
  });

  it("a fact sentence whose entry changed is a BLOCK until the person rewrites or cuts it", () => {
    const t = bioTemplates(ALL, SETTINGS).find((x) => x.sourceEntryId === AWARD.id)!;
    const bio = classifyBio({ lengths: { short: [{ id: "a", text: t.text, approved: true }], medium: [], long: [] } }, ALL, SETTINGS);
    const changed = ALL.map((e) => (e.id === AWARD.id ? { ...e, year: 2019 } : e));
    assert.ok(checkBio(bio, changed, SETTINGS).some((x) => x.severity === "BLOCK" && /record changed/.test(x.question)));
  });

  it("only approved sentences are the bio; counts include spaces", () => {
    const t = bioText([
      { id: "1", text: "One two.", origin: "fact", approved: true },
      { id: "2", text: "Not yet.", origin: "fact", approved: false },
    ]);
    assert.equal(t, "One two.");
    assert.deepEqual(bioCounts(t, "short"), { words: 2, chars: 8, over: false });
  });
});

// ------------------------------------------------- facility choices (H3) --
describe("one source of truth for facility names: the lane's current choice, on every document", () => {
  const W = entry({ section: "work", title: "Made at Example State Correctional Facility", year: 2020, details: { medium: "ink", dimensions: "9 x 12 in" }, names_facility: true });
  for (const mode of ["true_title", "venue_only", "leave_out", "unset"] as const) {
    it(`choice ${mode}: artist resume, bio, work samples, CSV and plain text agree`, () => {
      const settings: CreativeKindSettings = { ...SETTINGS, titleModes: mode === "unset" ? {} : { [INSIDE_SHOW.id]: mode, [PROGRAM.id]: mode, [W.id]: mode } };
      const entries = [...ALL, W];
      const resume = artistResumePlainText(buildArtistResumeModel(entries, settings));
      const bio = bioTemplates(entries, settings).map((x) => x.text).join(" ");
      const rows = buildWorkSampleList(entries, [], settings);
      const csv = workSampleListCsv(rows);
      const text = [resume, bio, csv].join("\n");
      if (mode === "true_title") {
        assert.match(resume, /Art From Example County Correctional/);
        assert.match(bio, /Inside Print Workshop/);
        assert.match(csv, /Made at Example State Correctional Facility/);
      } else {
        assert.ok(!/Art From Example County Correctional|Inside Print Workshop|Made at Example State/.test(text), text);
      }
      if (mode === "leave_out" || mode === "unset") assert.ok(!/Example County Correctional Facility/.test(text));
      const st = getCreativeStatus({ entries, settings, workSamples: rows });
      const sampleBlock = st.openItems.some((x) => x.doc === "work_samples" && x.severity === "BLOCK");
      assert.equal(sampleBlock, mode === "unset", "an unset facility work blocks the sample list only until chosen");
    });
  }
  it("review W1: a sample row for a work the lane keeps off is a BLOCK", () => {
    const rows = buildWorkSampleList([W], [], { titleModes: { [W.id]: "true_title" } });
    const st = getCreativeStatus({ entries: [W], settings: { titleModes: { [W.id]: "leave_out" } }, workSamples: rows });
    assert.ok(st.openItems.some((x) => x.doc === "work_samples" && x.rule === "STD-R03" && x.severity === "BLOCK"));
  });
});

describe("creative truth checks", () => {
  const model = buildArtistResumeModel(ALL, SETTINGS);
  it("a clean lane is finished, in the getResumeStatus shape", () => {
    const st = getCreativeStatus({ entries: [SOLO, GROUP, AWARD], settings: SETTINGS, artistResume: { model: buildArtistResumeModel([SOLO, GROUP, AWARD], SETTINGS), pages: 1 } });
    assert.equal(st.state, "finished", JSON.stringify(st.openItems));
    assert.equal(st.blockCount, 0);
    assert.ok(typeof st.rulesVersion === "string");
  });
  it("CR-01: a row that differs from the record is a BLOCK", () => {
    const bad = structuredClone(model);
    bad.sections[1].rows[0].parts[1] = { text: "Toledo Museum of Art", after: "," };
    const items = checkArtistResume(bad, ALL, SETTINGS, 1);
    assert.ok(items.some((x) => x.rule === "CR-01" && x.severity === "BLOCK"));
  });
  it("CR-02: a group show under Solo is a BLOCK; juried without the person saying so is a BLOCK", () => {
    const bad = structuredClone(model);
    const g = bad.sections.find((s) => s.key === "group")!;
    bad.sections.find((s) => s.key === "solo")!.rows.push(g.rows[0]);
    assert.ok(checkArtistResume(bad, ALL, SETTINGS, 1).some((x) => x.rule === "CR-02"));
    const bad2 = structuredClone(model);
    bad2.sections.find((s) => s.key === "group")!.rows[0].parts.push({ text: "(juried)" });
    assert.ok(checkArtistResume(bad2, ALL, SETTINGS, 1).some((x) => x.rule === "CR-02" && /juried/.test(x.question)));
  });
  it("STD-T05: a moved year is a BLOCK", () => {
    const bad = structuredClone(model);
    bad.sections.find((s) => s.key === "solo")!.rows[0].years = "2021";
    assert.ok(checkArtistResume(bad, ALL, SETTINGS, 1).some((x) => x.rule === "STD-T05"));
  });
  it("STD-R03: no choice yet is a BLOCK; a softened title is a BLOCK", () => {
    const st = getCreativeStatus({ entries: ALL, settings: { ...SETTINGS, titleModes: {} } });
    assert.equal(st.state, "draft");
    assert.equal(st.openItems.filter((x) => x.rule === "STD-R03" && x.severity === "BLOCK").length, 2);
    const soft = structuredClone(model);
    const row = soft.sections.find((s) => s.key === "education")!.rows[0];
    row.parts[0] = { text: "Community Print Workshop", after: "," };
    assert.ok(checkArtistResume(soft, ALL, SETTINGS, 1).some((x) => x.severity === "BLOCK" && x.entryId === PROGRAM.id));
  });
  it("a facility word with the box unticked is asked about", () => {
    const e = entry({ section: "teaching", title: "Workshop Leader", venue: "County Jail Arts Program", year: 2022 });
    assert.ok(getCreativeStatus({ entries: [e], settings: {} }).openItems.some((x) => x.rule === "STD-R03" && x.severity === "FIX"));
  });
  it("STD-F07: past the cap is a BLOCK; past 2 is fine when a call allows 4", () => {
    assert.ok(checkArtistResume(model, ALL, SETTINGS, 3).some((x) => x.rule === "STD-F07"));
    assert.ok(!checkArtistResume(model, ALL, { ...SETTINGS, callAllowsMore: true }, 3).some((x) => x.rule === "STD-F07"));
  });
  it("STD-T03, CR-05, CR-06, CR-07 ask about degrees, commissions, quotes and teaching titles", () => {
    const cert = entry({ section: "education", title: "BFA coursework", venue: "State College", year: 2015, details: { degree: false } });
    const comm = entry({ section: "commission", title: "Mural", venue: "Corner Store", year: 2022, details: { consent: true } });
    const quote = entry({ section: "press", title: "Local Artist Opens Studio", venue: "The Daily", year: 2023, details: { quote: "Bold work." } });
    const prof = entry({ section: "teaching", title: "Adjunct Professor", venue: "State College", year: 2023 });
    const rules = getCreativeStatus({ entries: [cert, comm, quote, prof], settings: {} }).openItems.map((x) => x.rule);
    for (const r of ["STD-T03", "CR-05", "CR-06", "CR-07"]) assert.ok(rules.includes(r), r);
  });
  it("CR-10: a sample line that differs from the record is a BLOCK", () => {
    const rows = buildWorkSampleList(ALL, []);
    rows[0].description = "A haunting meditation on labor.";
    assert.ok(getCreativeStatus({ entries: ALL, settings: SETTINGS, workSamples: rows }).openItems.some((x) => x.rule === "CR-10" && x.severity === "BLOCK"));
  });
  it("CR-04: first person and statement words in the person's own sentence are a FIX", () => {
    const bio = classifyBio({ lengths: { short: [], long: [], medium: [{ id: "2", text: "I make work that explores memory.", approved: true }] } }, ALL, SETTINGS);
    const items = getCreativeStatus({ entries: ALL, settings: SETTINGS, bio }).openItems;
    assert.ok(items.some((x) => x.rule === "CR-04" && x.severity === "FIX" && /written about you/.test(x.question)));
    assert.ok(items.some((x) => x.rule === "CR-04" && x.severity === "FIX" && /explores/.test(x.question)));
    assert.equal(items.filter((x) => x.severity === "BLOCK").length, 0);
  });
  it("open-item questions never carry a dash the house never prints", () => {
    const st = getCreativeStatus({ entries: ALL, settings: { titleModes: {} }, artistResume: { model: buildArtistResumeModel([], {}), pages: 5 } });
    for (const x of st.openItems) assert.ok(!/[\u2013\u2014]/.test(x.question + x.why), x.question);
  });
});

// ----------------------------------------------------------- two paths --
describe("realistic and dream: the plan card", () => {
  it("hurdles are general, by the kind of work named", () => {
    assert.deepEqual(hurdlesFor("Teaching artist in schools").map((h) => h.id), ["schools"]);
    assert.ok(hurdlesFor("Tattoo artist").some((h) => h.id === "license"));
    assert.deepEqual(hurdlesFor("Muralist").map((h) => h.id), ["general"]);
    assert.match(HURDLES_NOT_A_VERDICT, /separate, private question/);
  });
  it("help sources are public links", () => {
    for (const h of HELP_SOURCES) assert.match(h.url, /^https:\/\//);
  });
  it("the plan keeps the person's words, trimmed and capped", () => {
    const p = cleanPlan({ goal: "  Paint murals  ", steps: ["Apply at the sign shop", "", 4, "x".repeat(400)], helpNotes: "Ask my cousin", other: 1 });
    assert.equal(p.goal, "Paint murals");
    assert.equal(p.steps.length, 2);
    assert.equal(p.steps[1].length, 200);
    assert.equal(p.helpNotes, "Ask my cousin");
  });
});

// --------------------------------------------- round 2: the to-do page and more --
describe("review r2: nothing the lane hides reaches an exported to-do page (N-H1)", () => {
  const W = entry({ section: "work", title: "Made at Example County Correctional Facility", year: 2020, details: { medium: "ink", dimensions: "9 x 12 in" }, names_facility: true, proof: "need_to_find" });
  const MURAL = entry({ section: "commission", title: "Mural for Example County Correctional Facility", venue: "Example County", year: 2018, names_facility: true });
  const QUOTE = entry({ section: "press", title: "Local Artist Opens Studio", venue: "", year: 2023, details: { quote: "Bold work." } });
  const PROG_NTF = { ...PROGRAM, proof: "need_to_find" as const };
  const entries = [...ALL.filter((e) => e.id !== PROGRAM.id), PROG_NTF, W, MURAL, QUOTE];
  const hiddenWords = /Example County|Inside Print|Art From|Made at|Mural for/;
  for (const mode of ["venue_only", "leave_out", "unset"] as const) {
    it(`choice ${mode}: no hidden title, venue or sentence in any document's to-do lines`, () => {
      const settings: CreativeKindSettings = { ...SETTINGS, titleModes: mode === "unset" ? {} : { [INSIDE_SHOW.id]: mode, [PROGRAM.id]: mode, [W.id]: mode, [MURAL.id]: mode } };
      // A bio kept while the program showed its true title, then the lane switched.
      const t = bioTemplates([PROGRAM], { ...SETTINGS, titleModes: { [PROGRAM.id]: "true_title" } }).find((x) => x.sourceEntryId === PROGRAM.id)!;
      const bio = classifyBio({ lengths: { short: [{ id: "a", text: t.text, approved: true }], medium: [], long: [] } }, entries, { ...SETTINGS, titleModes: { [PROGRAM.id]: "true_title" } });
      const model = buildArtistResumeModel(entries, settings);
      const rows = buildWorkSampleList(entries, [], settings);
      const st = getCreativeStatus({ entries, settings, artistResume: { model, pages: 1 }, bio, workSamples: rows });
      for (const doc of ["artist_resume", "bio", "work_samples", "statement"] as const) {
        for (const l of creativeOpenItemLines(st, doc)) {
          // venue only: the venue is the person's chosen line; the TITLE never shows.
          const bad = mode === "venue_only" ? /Inside Print|Art From|Made at|Mural for/ : hiddenWords;
          assert.ok(!bad.test(l), `${doc}: ${l}`);
        }
        for (const l of exportOpenItemLines(st, entries, settings, doc)) assert.ok(!(mode === "venue_only" ? /Inside Print|Art From|Made at|Mural for/ : hiddenWords).test(l), `export ${doc}: ${l}`);
      }
      assert.ok(st.openItems.some((x) => x.line.includes(HIDDEN_ENTRY_LINE) || x.line === HIDDEN_SENTENCE_LINE || mode === "venue_only"));
    });
  }
  it("the export backstop replaces any line that still names a hidden term", () => {
    const settings: CreativeKindSettings = { titleModes: { [PROGRAM.id]: "leave_out" } };
    const fake = { state: "draft" as const, blockCount: 1, fixCount: 0, rulesVersion: "x", openItems: [{ rule: "X", severity: "BLOCK" as const, line: "Inside Print Workshop", question: "?", why: "", doc: "bio" as const }] };
    assert.deepEqual(exportOpenItemLines(fake, [PROGRAM], settings, "bio").length, 1);
    assert.ok(!/Inside Print/.test(exportOpenItemLines(fake, [PROGRAM], settings, "bio")[0]));
  });
});

describe("review r2 LOWs", () => {
  it("LOW 3: a person's edit that turns a group show into a solo show is asked about", () => {
    const t = bioTemplates(ALL, SETTINGS).find((x) => x.sourceEntryId === GROUP.id)!;
    const edited = t.text.replace("a group exhibition", "a solo exhibition");
    const bio = classifyBio({ lengths: { short: [{ id: "a", text: edited, approved: true }], medium: [], long: [] } }, ALL, SETTINGS);
    assert.equal(bio.lengths.short[0].origin, "person_written");
    assert.ok(checkBio(bio, ALL, SETTINGS).some((x) => x.rule === "CR-02" && /solo/.test(x.question)));
    const prize = classifyBio({ lengths: { short: [{ id: "b", text: "Ray Example won first prize at Harbor Gallery.", approved: true }], medium: [], long: [] } }, ALL, SETTINGS);
    assert.ok(checkBio(prize, ALL, SETTINGS).some((x) => x.rule === "CR-02"));
  });
  it("LOW 6: a record sentence whose entry changed never prints (and stays a BLOCK)", () => {
    const t = bioTemplates(ALL, SETTINGS).find((x) => x.sourceEntryId === AWARD.id)!;
    const bio = classifyBio({ lengths: { short: [{ id: "a", text: t.text, approved: true }], medium: [], long: [] } }, ALL, SETTINGS);
    const changed = ALL.map((e) => (e.id === AWARD.id ? { ...e, year: 2019 } : e));
    assert.equal(bioTextForLane(bio.lengths.short, changed, SETTINGS), "");
    assert.ok(checkBio(bio, changed, SETTINGS).some((x) => x.severity === "BLOCK"));
  });
  it("LOW 7: the shared-venue exemption counts only entries the lane shows", () => {
    const teach = entry({ section: "teaching", title: "Workshop Leader", venue: "Example County Correctional Facility", year: 2021, proof: "need_to_find" });
    const settings: CreativeKindSettings = { titleModes: { [PROGRAM.id]: "leave_out" } };
    const bio = classifyBio({ lengths: { short: [{ id: "a", text: "Ray Example taught at Example County Correctional Facility.", approved: true }], medium: [], long: [] } }, [PROGRAM, teach], settings);
    assert.ok(checkBio(bio, [PROGRAM, teach], settings).some((x) => x.severity === "BLOCK" && x.rule === "STD-R03"));
  });
  it("L7 note: shown entries still needing proof are counted (a note, never a BLOCK)", () => {
    const e = { ...GROUP, proof: "need_to_find" as const };
    const m = buildArtistResumeModel([e, SOLO], SETTINGS);
    assert.equal(stillNeedsProof([e, SOLO], m.sections.flatMap((x) => x.rows.map((r) => r.entryId))), 1);
    assert.equal(getCreativeStatus({ entries: [e, SOLO], settings: SETTINGS, artistResume: { model: m, pages: 1 } }).blockCount, 0);
  });
});


// ------------------------------------------------------------- round 3 --
describe("review r3: no open item ever quotes a sentence; old names stay hidden (R3-H1, LOW 2)", () => {
  const settingsTrue: CreativeKindSettings = { ...SETTINGS, titleModes: { [PROGRAM.id]: "true_title" } };
  const kept = bioTemplates([PROGRAM], settingsTrue).find((x) => x.sourceEntryId === PROGRAM.id)!;
  const keptBio = () => classifyBio({ lengths: { short: [{ id: "k1", text: kept.text, approved: true }], medium: [], long: [] } }, [PROGRAM], settingsTrue);
  const facilityWords = /Inside Print|Example County/;
  const allLines = (st: ReturnType<typeof getCreativeStatus>, entries: PracticeEntry[], settings: CreativeKindSettings) =>
    [...st.openItems.map((x) => `${x.line} ${x.question}`), ...exportOpenItemLines(st, entries, settings, "bio")];

  it("R3-D: the facility entry is deleted after its sentence was kept: no line names it, and the body drops it", () => {
    const bio = keptBio();
    const settings: CreativeKindSettings = { ...SETTINGS, titleModes: { [PROGRAM.id]: "leave_out" } };
    const st = getCreativeStatus({ entries: ALL.filter((e) => e.id !== PROGRAM.id), settings, bio });
    assert.ok(st.openItems.some((x) => x.doc === "bio" && x.severity === "BLOCK" && x.sentenceId === "k1"));
    for (const l of allLines(st, ALL, settings)) assert.ok(!facilityWords.test(l), l);
    assert.equal(bioTextForLane(bio.lengths.short, ALL.filter((e) => e.id !== PROGRAM.id), settings), "");
  });

  it("R3-X: the entry is renamed (title and venue) while 'leave it off' stands: no line names the old or new name", () => {
    const bio = keptBio();
    const r = resolvePracticeEntry({ title: "Print Program", venue: "ECCF" }, PROGRAM);
    assert.ok(r.ok);
    const renamed: PracticeEntry = { ...PROGRAM, ...r.value };
    assert.deepEqual(renamed.details.formerNames, ["Inside Print Workshop", "Example County Correctional Facility"]);
    const settings: CreativeKindSettings = { ...SETTINGS, titleModes: { [PROGRAM.id]: "leave_out" } };
    const entries = [...ALL.filter((e) => e.id !== PROGRAM.id), renamed];
    const st = getCreativeStatus({ entries, settings, bio });
    for (const l of allLines(st, entries, settings)) assert.ok(!/Inside Print|Example County|Print Program|ECCF/.test(l), l);
    assert.equal(bioTextForLane(bio.lengths.short, entries, settings), "");
  });

  it("LOW 2: a person's own sentence using the OLD name after a rename is a BLOCK and never prints", () => {
    const r = resolvePracticeEntry({ title: "Print Program", venue: "ECCF" }, PROGRAM);
    const renamed: PracticeEntry = { ...PROGRAM, ...(r.ok ? r.value : {}) };
    const settings: CreativeKindSettings = { ...SETTINGS, titleModes: { [PROGRAM.id]: "leave_out" } };
    const mine = classifyBio({ lengths: { short: [{ id: "p1", text: "Ray Example learned printing in Inside Print Workshop.", approved: true }], medium: [], long: [] } }, [renamed], settings);
    const items = checkBio(mine, [renamed], settings);
    assert.ok(items.some((x) => x.severity === "BLOCK" && x.rule === "STD-R03" && x.sentenceId === "p1"));
    assert.equal(bioTextForLane(mine.lengths.short, [renamed], settings), "");
  });

  it("a request can't set formerNames; the server keeps them", () => {
    const r = resolvePracticeEntry({ section: "arts_program", title: "X", year: 2020, namesFacility: true, details: { formerNames: ["Planted"] } });
    assert.ok(r.ok && r.value.details.formerNames === undefined);
  });

  it("no bio or statement item line quotes its sentence, whatever the finding", () => {
    const texts = ["I make work that explores memory.", "Ray Example won first prize at Harbor Gallery.", "Ray Example had a solo show at the Whitney in 2024.", "Ray Example has shown in over twenty exhibitions."];
    const bio = classifyBio({ lengths: { short: texts.map((text, i) => ({ id: `s${i}`, text, approved: true })), medium: [], long: [] } }, ALL, SETTINGS);
    const items = checkBio(bio, ALL, SETTINGS);
    assert.ok(items.length >= 4);
    for (const it of items) for (const t of texts) assert.ok(!it.line.includes(t.slice(0, 20)), it.line);
    for (const it of items) assert.match(it.line, /^Short bio, sentence \d+/);
  });

  it("artist resume items show an entry only through its current rendering", () => {
    const model = buildArtistResumeModel(ALL, SETTINGS);
    const bad = structuredClone(model);
    bad.sections.find((x) => x.key === "group")!.rows.find((r) => r.entryId === INSIDE_SHOW.id)!.parts = [{ text: "Art From Example County Correctional" }];
    const items = checkArtistResume(bad, ALL, SETTINGS, 1);
    assert.ok(items.some((x) => x.entryId === INSIDE_SHOW.id && x.severity === "BLOCK"));
    for (const it of items) assert.ok(!/Art From/.test(it.line), it.line);
  });
});

describe("review r3: spelling keeps the shape of contractions and 'nev' words (R3-M1)", () => {
  it("misspelled contractions and nev- words get no mark", () => {
    for (const t of ["havnt", "dosent", "dosnt", "couldent", "wernt", "cannt", "didn", "hadn", "shouldn", "wouldn", "nevr", "nevar", "neva", "wount"]) assert.equal(suggestionFor(t), null, t);
    for (const [t, fix] of [["recieve", "receive"], ["agreemnt", "agreement"], ["statment", "statement"], ["adiction", "addiction"]]) assert.equal(suggestionFor(t), fix, t);
  });
});

describe("review r3: claim words toned down (LOW)", () => {
  it("'first' and 'won' count only near a prize, award or place word", () => {
    const g = classifyBio({ lengths: { short: [{ id: "a", text: "Her first show was at Harbor Gallery.", approved: true }, { id: "b", text: "Ray Example won over the room at Harbor Gallery.", approved: true }, { id: "c", text: "Ray Example won first place at Harbor Gallery.", approved: true }], medium: [], long: [] } }, ALL, SETTINGS);
    const items = checkBio(g, ALL, SETTINGS).filter((x) => x.rule === "CR-02");
    assert.deepEqual(items.map((x) => x.sentenceId), ["c"]);
  });
});

// -------------------------------------------------------------- migration --
describe("migration 075", () => {
  const sql = readFileSync(join(MIGRATIONS, "075_creative_lanes.sql"), "utf8");
  it("sets lock_timeout, forces RLS on the practice record, carries a rollback note", () => {
    assert.match(sql, /^SET LOCAL lock_timeout = '5s';/m);
    assert.match(sql, /FORCE ROW LEVEL SECURITY/);
    assert.match(sql, /ROLLBACK, in this order/);
  });
  it("kind is resume | creative with resume the default; new artifact types are allowed", () => {
    assert.match(sql, /kind TEXT NOT NULL DEFAULT 'resume'/);
    assert.match(sql, /CHECK \(kind IN \('resume', 'creative'\)\)/);
    for (const t of CREATIVE_ARTIFACT_TYPES.filter((x) => x !== "cv")) assert.ok(sql.includes(`'${t}'`), t);
  });
  it("practice_entry is in the one list of protected tables", () => {
    assert.ok((RLS_PROTECTED_TABLES as readonly string[]).includes("practice_entry"));
  });
});

describe("review r2: reading stored settings keeps the facility choices and revision", () => {
  it("readKindSettings is what every reader uses", () => {
    const { readKindSettings } = require("../creativeLaneShared");
    const stored = { displayName: "Ray", titleModes: { [PROGRAM.id]: "leave_out" }, rev: 3 };
    assert.deepEqual(readKindSettings(stored), stored);
  });
});
