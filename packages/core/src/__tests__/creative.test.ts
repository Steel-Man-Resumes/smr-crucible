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
  artistResumePageCap,
  countChars,
  countWords,
  rowText,
  type CreativeKindSettings,
} from "../creativeLaneShared";
import {
  parseCoachOutput,
  checkStatementSave,
  modelFingerprints,
  isSpellingFix,
  dictionaryMarks,
  readBackQuestions,
  auditStatementHistory,
  applySpellingMark,
  COACH_QUESTIONS,
  type StatementContent,
} from "../creativeStatement";
import {
  draftBioFromFacts,
  parseBioDraft,
  bioVocabulary,
  bioFactEntries,
  traceSentence,
  draftSentenceOk,
  checkBioSave,
  bioText,
  bioCounts,
  emptyBio,
} from "../creativeBio";
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
  titleModes: { [INSIDE_SHOW.id]: "venue_only", [PROGRAM.id]: "true_title" }, bioDisclosure: "include",
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
    assert.deepEqual(resolveLaneSettings({ name: "x", kind: "cv" }, null), { ok: false, error: "bad_kind" });
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
  it("kind settings drop unknown keys and bad values", () => {
    const s = cleanKindSettings({ displayName: "  Ray  ", callAllowsMore: "yes", titleModes: { [SOLO.id]: "soften", [GROUP.id]: "leave_out" }, junk: 1 });
    assert.deepEqual(s, { displayName: "Ray", titleModes: { [GROUP.id]: "leave_out" } });
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
describe("statement coach: no model text can be saved (CR-03)", () => {
  const person = "I paint the people who ride the night bus. I started drawing in a workshop and never stoped.";
  // What a model might send back: a rewrite, praise, a question, a real spelling fix, a fake one.
  const modelReply = JSON.stringify({
    questions: [
      "What do you see on the night bus that others miss?",
      "Here is a stronger version. Your work powerfully explores themes of resilience and redemption?",
      "Try this: My practice interrogates labor and visibility through the lens of public transit.",
    ],
    spelling: [
      { word: "stoped", suggestion: "stopped" },
      { word: "paint", suggestion: "illuminate the lives of" },
      { word: "workshop", suggestion: "prestigious residency" },
      { word: "missing", suggestion: "messing" },
    ],
    rewrite: "My practice interrogates labor and visibility through the lens of public transit, honoring the quiet resilience of night riders.",
  });

  it("the coach keeps only one-sentence questions and single-word spelling fixes", () => {
    const out = parseCoachOutput(modelReply, person);
    assert.deepEqual(out.questions, ["What do you see on the night bus that others miss?"]);
    assert.deepEqual(out.marks, [{ word: "stoped", suggestion: "stopped" }]);
  });

  it("a save that carries the model's rewrite is refused, even if it reached the page", () => {
    const prints = modelFingerprints(modelReply, person);
    const smuggled = `${person} My practice interrogates labor and visibility through the lens of public transit.`;
    assert.deepEqual(
      checkStatementSave({ previousText: person, nextText: smuggled, offeredMarks: [], modelPrints: prints }),
      { ok: false, reason: "model_text" }
    );
    // The questions a model asked cannot be pasted in as statement text either.
    const pastedQuestion = `${person} What do you see on the night bus that others miss`;
    assert.deepEqual(checkStatementSave({ previousText: person, nextText: pastedQuestion, offeredMarks: [], modelPrints: prints }), { ok: false, reason: "model_text" });
  });

  it("the person's own new sentence saves; the model quoting them back does not taint it", () => {
    const draft = `${person} The drivers know every face on the route.`;
    const echo = JSON.stringify({ questions: ["When you say the drivers know every face on the route, who do you mean?"] });
    const prints = modelFingerprints(echo, draft);
    assert.deepEqual(checkStatementSave({ previousText: person, nextText: draft, offeredMarks: [], modelPrints: prints }), { ok: true });
  });

  it("a spelling mark changes exactly one word, only as offered", () => {
    const offered = [{ word: "stoped", suggestion: "stopped" }];
    const fixed = applySpellingMark(person, offered[0]);
    assert.ok(fixed.endsWith("never stopped."));
    assert.deepEqual(checkStatementSave({ previousText: person, nextText: fixed, acceptedMark: offered[0], offeredMarks: offered, modelPrints: [] }), { ok: true });
    // Same mark, but the text also gained other words: refused.
    assert.deepEqual(
      checkStatementSave({ previousText: person, nextText: `${fixed} Truly a visionary.`, acceptedMark: offered[0], offeredMarks: offered, modelPrints: [] }),
      { ok: false, reason: "mark_changed_more" }
    );
    // A mark nobody offered: refused.
    const other = { word: "paint", suggestion: "pant" };
    assert.deepEqual(
      checkStatementSave({ previousText: person, nextText: applySpellingMark(person, other), acceptedMark: other, offeredMarks: offered, modelPrints: [] }),
      { ok: false, reason: "mark_not_offered" }
    );
    // A "mark" that is really a rewrite: refused even if it was somehow stored as offered.
    const phrase = { word: "paint", suggestion: "illuminate the lives of" };
    assert.deepEqual(
      checkStatementSave({ previousText: person, nextText: applySpellingMark(person, phrase), acceptedMark: phrase, offeredMarks: [phrase], modelPrints: [] }),
      { ok: false, reason: "mark_not_spelling" }
    );
  });

  it("spelling fixes are close spellings of one word, never a new word", () => {
    assert.equal(isSpellingFix("recieve", "receive"), true);
    assert.equal(isSpellingFix("workshop", "residency"), false);
    assert.equal(isSpellingFix("bus", "bus"), false);
    assert.equal(isSpellingFix("night", "night bus"), false);
    assert.deepEqual(dictionaryMarks("I seperate the colors."), [{ word: "seperate", suggestion: "separate" }]);
  });

  it("the history audit catches a model sentence stored by any path", () => {
    const at = "2026-10-07T10:00:00.000Z";
    const c: StatementContent = {
      versions: [
        { text: person, savedAt: "2026-10-07T09:00:00.000Z", via: "typed" },
        { text: `${person} My practice interrogates labor and visibility through the lens of public transit.`, savedAt: "2026-10-07T11:00:00.000Z", via: "typed" },
      ],
      offeredMarks: [],
      modelPrints: [{ at, prints: modelFingerprints(modelReply, person) }],
    };
    assert.deepEqual(auditStatementHistory(c), { index: 1, reason: "model_text" });
    assert.equal(getCreativeStatus({ entries: [], settings: {}, statement: c }).openItems[0].rule, "CR-03");
    // The same text saved BEFORE the coach ever replied is the person's own.
    const early: StatementContent = { ...c, modelPrints: [{ at: "2026-10-07T12:00:00.000Z", prints: c.modelPrints[0].prints }] };
    assert.equal(auditStatementHistory(early), null);
  });

  it("coach questions and read-back are questions, never text to paste", () => {
    for (const q of COACH_QUESTIONS) assert.ok(q.endsWith("?"));
    const long = `${"word ".repeat(40).trim()}. I like stuff.`;
    const rb = readBackQuestions(long);
    assert.ok(rb.length >= 2);
    for (const q of rb) assert.ok(q.endsWith("?"));
  });

  it("no route outside the creative tools can write a statement", () => {
    for (const t of CREATIVE_ARTIFACT_TYPES) assert.ok(ARTIFACT_CONTENT_UPDATE_SQL("").includes(`'${t}'`));
    assert.match(ARTIFACT_CONTENT_UPDATE_SQL(""), /artifact_type NOT IN/);
  });
});

// ------------------------------------------------------------------- bio --
describe("bio (C3): drafted only from confirmed facts, each sentence approved", () => {
  it("the plain draft traces every name, place and year to the record", () => {
    const facts = bioFactEntries(ALL, SETTINGS.bioDisclosure);
    const vocab = bioVocabulary(facts, SETTINGS);
    const s = draftBioFromFacts(ALL, SETTINGS, "long");
    assert.ok(s.length >= 3);
    for (const x of s) assert.ok(draftSentenceOk(traceSentence(x, vocab)), x);
    assert.match(s[0], /^Ray Example is a painter and printmaker based in Toledo, OH\.$/);
  });
  it("disclosure: leave out and in context keep facility entries out of the draft", () => {
    const out = draftBioFromFacts(ALL, { ...SETTINGS, bioDisclosure: "leave_out" }, "long").join(" ");
    assert.ok(!/Example County|Inside Print/.test(out));
    const ctx = draftBioFromFacts(ALL, { ...SETTINGS, bioDisclosure: "context" }, "long").join(" ");
    assert.ok(!/Example County|Inside Print/.test(ctx));
    const inc = draftBioFromFacts(ALL, SETTINGS, "long").join(" ");
    assert.match(inc, /Inside Print Workshop/);
  });
  it("entries still marked need-to-find are not drafted from", () => {
    const e = entry({ section: "award", title: "Harbor Prize", venue: "Harbor Fund", year: 2021, proof: "need_to_find" });
    assert.ok(!draftBioFromFacts([e], SETTINGS, "long").join(" ").includes("Harbor Prize"));
  });
  it("short stays inside 100 words and 600 characters", () => {
    const many = Array.from({ length: 30 }, (_, i) => entry({ section: "award", title: `Prize Number ${i}`, venue: "Toledo Arts Fund", year: 2000 + i }));
    const s = draftBioFromFacts(many, SETTINGS, "short").join(" ");
    assert.ok(countWords(s) <= 100 && countChars(s) <= 600);
  });
  it("a model draft keeps only sentences that trace; invented honors and meanings are dropped", () => {
    const vocab = bioVocabulary(bioFactEntries(ALL, "include"), SETTINGS);
    const raw = JSON.stringify({ sentences: [
      "Ray Example is a painter and printmaker based in Toledo, OH.",
      "Ray Example had a solo exhibition, Shift Change, at Riverside Arts Center in 2024.",
      "Ray Example's work is held by the Detroit Institute of Arts.",
      "The acclaimed artist explores themes of labor.",
      "In 2019 Ray Example won a national prize.",
    ] });
    const r = parseBioDraft(raw, vocab);
    assert.equal(r.kept.length, 2);
    assert.equal(r.dropped, 3);
  });
  it("the save path refuses a drafted sentence that no longer traces", () => {
    const vocab = bioVocabulary(bioFactEntries(ALL, "include"), SETTINGS);
    const bio = emptyBio();
    bio.lengths.short = [{ id: "a", text: "Ray Example won the Harbor Prize in 2019.", origin: "draft", approved: true }];
    assert.equal(checkBioSave(bio, vocab).ok, false);
    bio.lengths.short = [{ id: "a", text: "Ray Example won the Harbor Prize in 2019.", origin: "person", approved: true }];
    assert.equal(checkBioSave(bio, vocab).ok, true);
  });
  it("only approved sentences are the bio; counts include spaces", () => {
    const t = bioText([
      { id: "1", text: "One two.", origin: "draft", approved: true },
      { id: "2", text: "Not yet.", origin: "draft", approved: false },
    ]);
    assert.equal(t, "One two.");
    assert.deepEqual(bioCounts(t, "short"), { words: 2, chars: 8, over: false });
  });
});

// ------------------------------------------------------------ the checks --
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
  it("CR-04: an approved drafted sentence that does not trace is a BLOCK; first person and statement words are FIX", () => {
    const bio = emptyBio();
    bio.disclosure = "include";
    bio.lengths.medium = [
      { id: "1", text: "Ray Example won the Harbor Prize in 2019.", origin: "draft", approved: true },
      { id: "2", text: "I make work that explores memory.", origin: "person", approved: true },
    ];
    const items = getCreativeStatus({ entries: ALL, settings: SETTINGS, bio }).openItems;
    assert.ok(items.some((x) => x.rule === "CR-04" && x.severity === "BLOCK"));
    assert.ok(items.some((x) => x.rule === "CR-04" && x.severity === "FIX" && /written about you/.test(x.question)));
    assert.ok(items.some((x) => x.rule === "CR-04" && x.severity === "FIX" && /explores/.test(x.question)));
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
    for (const t of CREATIVE_ARTIFACT_TYPES) assert.ok(sql.includes(`'${t}'`), t);
  });
  it("practice_entry is in the one list of protected tables", () => {
    assert.ok((RLS_PROTECTED_TABLES as readonly string[]).includes("practice_entry"));
  });
});
