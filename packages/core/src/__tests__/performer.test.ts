/**
 * Performer lanes (078): the one-page performer resume assembled from the
 * practice record (credits by medium in three columns, training, awards,
 * confirmed special skills), credit years stored and checked but hidden by
 * default (C2), union status exactly as held, an age range never an age
 * (CR-08), one page always, and the lane's facility choices. Every person and
 * place is invented.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LANE_KINDS, resolveLaneSettings } from "../careerLaneShared";
import { resolvePracticeEntry, cleanDetails, type PracticeEntry } from "../practiceRecordShared";
import { applyPhraseAnswer, applyTitleMode, cleanKindSettings, type CreativeKindSettings } from "../creativeLaneShared";
import { ageRangeOf, buildPerformerModel, creditText, performerPlainText, performerShownIds } from "../performerShared";
import { getPerformerStatus } from "../performerChecks";
import { exportOpenItemLines, getCreativeStatus } from "../creativeChecks";
import { buildCvModel } from "../cvShared";
import { getCvStatus } from "../cvChecks";
import { CREATIVE_ARTIFACT_TYPES } from "../refineryArtifact";
import { buildArtistResumeModel } from "../creativeLaneShared";

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(9000 + ++n).padStart(12, "0")}`;
function entry(p: Partial<PracticeEntry> & Pick<PracticeEntry, "section" | "title" | "year">): PracticeEntry {
  return { id: id(), user_id: "u", venue: null, city: null, state: null, end_year: null, details: {}, proof: "remembered", names_facility: false, created_at: "", updated_at: "", ...p };
}
const FACILITY = "Example County Correctional Facility";
const PLAY = entry({ section: "credit", title: "Our Town", venue: "Example Street Theatre", city: "Chicago", state: "IL", year: 2024, details: { medium: "theater", role: "Emily Webb", director: "J. Sample" } });
const FILM = entry({ section: "credit", title: "Night Bus", venue: "Example Pictures", year: 2023, details: { medium: "film", billing: "supporting" } });
const TV = entry({ section: "credit", title: "Example City", venue: "Example Network", year: 2022, details: { medium: "tv", role: "Officer Diaz", billing: "co_star" } });
const INSIDE = entry({ section: "credit", title: "Inside Voices Showcase", venue: FACILITY, year: 2019, details: { medium: "theater", role: "Narrator", director: "K. Other" }, names_facility: true });
const CLASS = entry({ section: "training", title: "Scene Study", venue: "Example Acting Studio", city: "Chicago", state: "IL", year: 2023, end_year: 2024, details: { teacher: "R. Coach", duration: "2 years" } });
const UNION = entry({ section: "union", title: "SAG-AFTRA", year: 2024, details: { status: "eligible" } });
const AWARD = entry({ section: "award", title: "Best Ensemble", venue: "Example Theatre Awards", year: 2024, details: { kind: "award" } });
const ALL = [PLAY, FILM, TV, INSIDE, CLASS, UNION, AWARD];
const BASE: CreativeKindSettings = { displayName: "Ray Example", discipline: "Actor / Singer", email: "ray@example.com", height: "5'10\"", hair: "Brown", eyes: "Green", ageRange: "25-35" };
const withInside = (m: "true_title" | "venue_only" | "leave_out", s: CreativeKindSettings = BASE) => applyTitleMode(s, INSIDE.id, m)!;

describe("performer lane kind and record kinds (078)", () => {
  it("a performer lane is a lane kind, dated format, no CV sub-type", () => {
    assert.ok((LANE_KINDS as readonly string[]).includes("performer"));
    const r = resolveLaneSettings({ name: "Acting", kind: "performer", path: "dream", cvType: "academic" }, null);
    assert.ok(r.ok && r.value.kind === "performer" && r.value.cv_type === null && r.value.path === "dream" && r.value.format === "chronological");
    assert.ok((CREATIVE_ARTIFACT_TYPES as readonly string[]).includes("performer_resume"));
  });
  it("a credit needs a medium and a year; a union line needs its exact status; training keeps who and how long", () => {
    assert.deepEqual(resolvePracticeEntry({ section: "credit", title: "Our Town", year: 2024 }), { ok: false, error: "medium_required" });
    assert.deepEqual(resolvePracticeEntry({ section: "credit", title: "Our Town", details: { medium: "theater" } }), { ok: false, error: "year_required" });
    assert.deepEqual(resolvePracticeEntry({ section: "union", title: "SAG-AFTRA", year: 2024 }), { ok: false, error: "union_status_required" });
    assert.deepEqual(resolvePracticeEntry({ section: "union", title: "SAG-AFTRA", year: 2024, details: { status: "sort of" } }), { ok: false, error: "union_status_required" });
    const c = resolvePracticeEntry({ section: "credit", title: "Our Town", year: 2024, details: { medium: "theater", billing: "star of the show", role: "Emily", director: "J. Sample" } });
    assert.ok(c.ok && c.value.details.billing === undefined && c.value.details.role === "Emily");
    assert.deepEqual(cleanDetails("training", { teacher: "R. Coach", duration: "2 years", status: "conferred" }), { teacher: "R. Coach", duration: "2 years" });
  });
  it("lane settings keep the description, skills (each with its own yes) and the years switch; never an unknown key", () => {
    const s = cleanKindSettings({ height: "5'10\"", ageRange: "25-35", skills: [{ text: "Stage combat", confirmed: true }, { text: "stage combat", confirmed: false }, { text: "Juggling" }, null, 7], showYears: "yes", weight: "180" }, {});
    assert.deepEqual(s.skills, [{ text: "Stage combat", confirmed: true }, { text: "Juggling", confirmed: false }]);
    assert.equal(s.showYears, undefined);
    assert.ok(!("weight" in s));
  });
});

describe("the performer page", () => {
  it("credits by medium in three columns: production | role and billing as credited | company, place, director", () => {
    const m = buildPerformerModel(ALL, withInside("true_title"));
    assert.deepEqual(m.credits.map((c) => c.heading), ["Theater", "Film", "Television"]);
    const theater = m.credits[0].rows.map((r) => creditText(r.cols));
    assert.ok(theater.includes("Our Town | Emily Webb | Example Street Theatre, Chicago, IL, Dir. J. Sample"), theater.join(" / "));
    assert.equal(creditText(m.credits[1].rows[0].cols), "Night Bus | Supporting | Example Pictures");
    assert.equal(creditText(m.credits[2].rows[0].cols), "Example City | Officer Diaz (Co-Star) | Example Network");
    assert.equal(m.credits[0].rows[0].cols[0][0].italic, true);
  });
  it("C2: every credit carries its year; the page hides credit years by default; training stays dated", () => {
    const m = buildPerformerModel(ALL, withInside("true_title"));
    assert.equal(m.showYears, false);
    assert.equal(m.credits[0].rows.find((r) => r.entryId === PLAY.id)!.years, "2024");
    const txt = performerPlainText(m);
    assert.ok(!/^2024 {2}Our Town/m.test(txt) && /Our Town \| Emily Webb/.test(txt));
    assert.match(txt, /2023-2024 {2}Scene Study, Example Acting Studio, Chicago, IL, with R\. Coach, 2 years/);
    assert.match(performerPlainText(buildPerformerModel(ALL, { ...withInside("true_title"), showYears: true })), /^2024 {2}Our Town/m);
  });
  it("CR-08: union status exactly as held; an age range never an age; only confirmed skills", () => {
    const s: CreativeKindSettings = { ...withInside("true_title"), skills: [{ text: "Stage combat", confirmed: true }, { text: "Fire breathing", confirmed: false }] };
    const m = buildPerformerModel(ALL, s);
    assert.deepEqual(m.header.unions, ["SAG-AFTRA, eligible"]);
    assert.deepEqual(m.header.stats, ["Height 5'10\"", "Hair Brown", "Eyes Green", "Age range 25-35"]);
    const txt = performerPlainText(m);
    assert.match(txt, /SPECIAL SKILLS\nStage combat/);
    assert.doesNotMatch(txt, /Fire breathing/);
    const st = getPerformerStatus({ entries: ALL, settings: s, model: m });
    assert.ok(st.openItems.some((x) => x.rule === "CR-08" && x.severity === "FIX" && !/Fire/.test(x.line + x.question)));
    for (const [age, ok] of [["25-35", true], ["25 to 35", true], ["34", false], ["35-25", false], ["Age 34", false], ["thirties", false]] as const) {
      assert.equal(!!ageRangeOf(age), ok, age);
      const mm = buildPerformerModel(ALL, { ...withInside("true_title"), ageRange: age });
      assert.equal(mm.header.stats.some((x) => x.startsWith("Age range")), ok, age);
      if (!ok) assert.ok(getPerformerStatus({ entries: ALL, settings: { ...withInside("true_title"), ageRange: age }, model: mm }).openItems.some((x) => x.rule === "CR-08" && x.severity === "BLOCK" && !x.line.includes(age)), age);
    }
    for (const status of ["member", "candidate"] as const) {
      const u = { ...UNION, details: { status } };
      assert.deepEqual(buildPerformerModel([PLAY, u], BASE).header.unions, [status === "member" ? "SAG-AFTRA, member" : "SAG-AFTRA, membership candidate"]);
    }
    const noStatus = { ...UNION, details: {} };
    const m2 = buildPerformerModel([PLAY, noStatus], BASE);
    assert.deepEqual(m2.header.unions, []);
    assert.ok(getPerformerStatus({ entries: [PLAY, noStatus], settings: BASE, model: m2 }).openItems.some((x) => x.rule === "CR-08" && x.severity === "BLOCK"));
  });
  it("personal details anywhere typed (stats, skills, contact) stay off with a neutral BLOCK", () => {
    for (const bad of [{ height: "Age 34" }, { agent: "Born 1990" }, { skills: [{ text: "Married, two kids", confirmed: true }] }] as CreativeKindSettings[]) {
      const s = { ...withInside("true_title"), ...bad };
      const m = buildPerformerModel(ALL, s);
      assert.doesNotMatch(performerPlainText(m), /Age 34|1990|Married/);
      const st = getPerformerStatus({ entries: ALL, settings: s, model: m });
      assert.ok(st.openItems.some((x) => x.severity === "BLOCK" && !/Age 34|1990|Married/.test(x.line)), JSON.stringify(bad));
    }
  });
  it("one page always: past one page is a BLOCK (Selected credits)", () => {
    assert.ok(getPerformerStatus({ entries: ALL, settings: withInside("true_title"), pages: 2 }).openItems.some((x) => x.rule === "STD-F07" && x.severity === "BLOCK"));
    assert.ok(!getPerformerStatus({ entries: ALL, settings: withInside("true_title"), pages: 1 }).openItems.some((x) => x.rule === "STD-F07"));
    const sel = buildPerformerModel(ALL, { ...withInside("true_title"), selection: [PLAY.id, CLASS.id] });
    assert.deepEqual(sel.credits.map((c) => c.heading), ["Selected Theater"]);
    assert.ok(sel.omitted.some((o) => o.entryId === FILM.id && o.reason === "not_selected"));
  });
  it("finished when every line traces and nothing is open", () => {
    const st = getPerformerStatus({ entries: ALL, settings: withInside("true_title"), pages: 1 });
    assert.equal(st.state, "finished", JSON.stringify(st.openItems));
  });
});

describe("facility choices and truth on the performer page", () => {
  it("unset: the inside credit stays off and the page is a DRAFT; the to-do line never names it", () => {
    const m = buildPerformerModel(ALL, BASE);
    assert.doesNotMatch(performerPlainText(m), /Inside Voices|Correctional|Narrator|K\. Other/);
    const st = getPerformerStatus({ entries: ALL, settings: BASE, model: m });
    assert.equal(st.state, "draft");
    for (const l of exportOpenItemLines(st, ALL, BASE, "performer")) assert.doesNotMatch(l, /Inside Voices|Correctional/);
  });
  it("venue only: the medium and the venue, never the production, role or director; billing stays", () => {
    const withBilling = { ...INSIDE, details: { ...INSIDE.details, billing: "ensemble" } };
    const m = buildPerformerModel([PLAY, withBilling], withInside("venue_only"));
    const row = m.credits[0].rows.find((r) => r.entryId === INSIDE.id)!;
    assert.equal(creditText(row.cols), `Stage production | Ensemble | ${FACILITY}`);
    assert.doesNotMatch(performerPlainText(m), /Inside Voices|Narrator|K\. Other/);
  });
  it("leave it off: a typed line or a skill naming it is held with a neutral BLOCK", () => {
    const s = { ...withInside("leave_out"), agent: "Rep since Inside Voices Showcase", skills: [{ text: "Tutoring at Example County Correctional Facility", confirmed: true }] };
    const m = buildPerformerModel(ALL, s);
    assert.doesNotMatch(performerPlainText(m), /Inside Voices|Correctional/);
    const st = getPerformerStatus({ entries: ALL, settings: s, model: m });
    assert.ok(st.openItems.filter((x) => x.rule === "STD-R03" && x.severity === "BLOCK").length >= 2);
    for (const l of exportOpenItemLines(st, ALL, s, "performer")) assert.doesNotMatch(l, /Inside Voices|Correctional/);
  });
  it("CR-01: a line changed after it was built (billing upgraded, year moved) is a BLOCK", () => {
    const m = buildPerformerModel(ALL, withInside("true_title"));
    const up = structuredClone(m);
    up.credits[1].rows[0].cols[1] = [{ text: "Lead" }];
    assert.ok(getPerformerStatus({ entries: ALL, settings: withInside("true_title"), model: up }).openItems.some((x) => x.rule === "CR-01" && x.severity === "BLOCK"));
    const moved = structuredClone(m);
    moved.credits[0].rows[0].years = "2025";
    assert.ok(getPerformerStatus({ entries: ALL, settings: withInside("true_title"), model: moved }).openItems.some((x) => x.rule === "STD-T05"));
    const tr = structuredClone(m);
    tr.sections[0].rows![0].parts = [{ text: "MFA, Acting" }];
    assert.ok(getPerformerStatus({ entries: ALL, settings: withInside("true_title"), model: tr }).openItems.some((x) => x.rule === "CR-01"));
  });
  it("an entry a lane never shows never holds that lane up (artist resume, CV)", () => {
    // INSIDE is unset everywhere: it holds up the performer page only.
    const ar = buildArtistResumeModel([AWARD, INSIDE], { displayName: "Ray" });
    assert.ok(!getCreativeStatus({ entries: [AWARD, INSIDE], settings: { displayName: "Ray" }, artistResume: { model: ar } }).openItems.some((x) => x.entryId === INSIDE.id));
    const cv = buildCvModel([AWARD, INSIDE], { displayName: "Ray" }, "academic");
    assert.ok(!getCvStatus({ entries: [AWARD, INSIDE], settings: { displayName: "Ray" }, cvType: "academic", model: cv }).openItems.some((x) => x.entryId === INSIDE.id));
  });
});

describe("no model anywhere on the performer path", () => {
  it("the pure modules make no network or AI call", () => {
    for (const f of ["performerShared.ts", "performerChecks.ts"]) {
      const src = readFileSync(join(__dirname, "..", f), "utf8");
      assert.doesNotMatch(src, /\bfetch\(|anthropic|openai|callModel|generate/i, f);
    }
  });
});

describe("migration 078", () => {
  const sql = readFileSync(join(__dirname, "..", "..", "migrations", "078_performer_lanes.sql"), "utf8");
  const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  it("widens only (kind, sections, artifact types), in one transaction, with a rollback that frees performer-lane rows first", () => {
    assert.match(sql, /^SET LOCAL lock_timeout = '5s';/m);
    assert.match(code, /smr_widen_list_check\('career_lane', 'kind', 'career_lane_kind_check', ARRAY\['resume', 'creative', 'cv', 'performer'\]\)/);
    for (const s of ["credit", "training", "union"]) assert.ok(code.includes(`'${s}'`), s);
    assert.ok(code.includes("'performer_resume'"));
    assert.doesNotMatch(code, /DROP CONSTRAINT IF EXISTS (career_lane_kind_check|refinery_artifact_artifact_type_check|practice_entry_section_check)/);
    assert.match(sql, /psql -1/);
    const rollback = sql.slice(sql.indexOf("ROLLBACK, in this order"));
    const free = rollback.indexOf("UPDATE refinery_artifact SET lane_id = NULL WHERE lane_id IN (SELECT id FROM career_lane WHERE kind = 'performer');");
    assert.ok(free > 0 && free < rollback.indexOf("DELETE FROM"));
  });
});

describe("performer page: the slice 1 and 2 review lessons hold", () => {
  const SQ = entry({ section: "credit", title: "Shakespeare Inside", venue: "San Quentin State Prison", city: "San Quentin", state: "CA", year: 2018, details: { medium: "theater", role: "Prospero", billing: "lead" }, names_facility: true });
  const off = (extra: CreativeKindSettings = {}) => ({ ...applyTitleMode(BASE, SQ.id, "leave_out")!, ...extra });
  const leak = /Quentin|Shakespeare Inside|Prospero/i;

  it("part of a hidden name (two words, or one distinctive word) in a typed line or a skill is held with a neutral BLOCK", () => {
    for (const extra of [
      { agent: "Rep since the San Quentin days" },
      { discipline: "Actor (trained at San Quentin)" },
      { voice: "Baritone, learned in San Quentin choir" },
      { skills: [{ text: "Stage combat (San Quentin)", confirmed: true }] },
    ] as CreativeKindSettings[]) {
      const s = off(extra);
      const m = buildPerformerModel([PLAY, SQ], s);
      assert.doesNotMatch(performerPlainText(m), leak, JSON.stringify(extra));
      const st = getPerformerStatus({ entries: [PLAY, SQ], settings: s, model: m });
      assert.equal(st.state, "draft", JSON.stringify(extra));
      assert.ok(st.openItems.some((x) => x.rule === "STD-R03" && x.severity === "BLOCK"));
      for (const it of st.openItems) assert.doesNotMatch(`${it.line} ${it.question}`, leak);
      for (const l of exportOpenItemLines(st, [PLAY, SQ], s, "performer", performerShownIds(m))) assert.doesNotMatch(l, leak);
    }
  });

  it("one distinctive word alone in a typed line is one tap: it prints and the page stays a draft until answered (combined review)", () => {
    const s = off({ discipline: "Actor (trained at Quentin)" });
    const m = buildPerformerModel([PLAY, SQ], s);
    assert.equal(m.header.discipline, "Actor (trained at Quentin)");
    assert.ok(m.asks.some((a) => a.field === "discipline" && !a.held));
    assert.equal(getPerformerStatus({ entries: [PLAY, SQ], settings: s, model: m, pages: 1 }).state, "draft");
    // Next to an incarceration word it is held outright.
    const m2 = buildPerformerModel([PLAY, SQ], off({ discipline: "Actor (did time at Quentin)" }));
    assert.equal(m2.header.discipline, "");
  });

  it("the name at the top: a whole hidden name is held (so the file name never carries it); part of one is asked, and a Yes holds it (s2r3)", () => {
    const s = off({ displayName: "Ray Example, San Quentin State Prison" });
    const m = buildPerformerModel([PLAY, SQ], s);
    assert.equal(m.header.name, "");
    assert.ok(m.heldFields.some((h) => h.field === "displayName" && h.reason === "names_hidden"));
    // Combined C-M2: a run of it in the person's own name is held until they answer (so the file name and the
    // document title fall back to the generic ones), with one card. "No" puts it back; "Yes" keeps it off.
    const s2 = off({ displayName: "Ray Example of San Quentin" });
    const m2 = buildPerformerModel([PLAY, SQ], s2);
    assert.equal(m2.header.name, "");
    assert.deepEqual(m2.asks.filter((a) => a.field === "displayName"), [{ field: "displayName", phrase: "Ray Example of San Quentin", held: true }]);
    const st2 = getPerformerStatus({ entries: [PLAY, SQ], settings: s2, model: m2 });
    const ask = st2.openItems.find((x) => x.answer === "facility_word" && x.line === "(top of the page)" && x.phrase === "Ray Example of San Quentin")!;
    assert.equal(ask.severity, "BLOCK");
    assert.ok(!st2.openItems.some((x) => x.rule === "STD-F05" && /name/.test(x.question)), "no 'what name' question while the name is held for an answer");
    assert.equal(buildPerformerModel([PLAY, SQ], applyPhraseAnswer(s2, ask.phrase, "no")!).header.name, "Ray Example of San Quentin");
    assert.doesNotMatch(`${ask.line} ${ask.question} ${ask.why}`, leak);
    const yes = applyPhraseAnswer(s2, ask.phrase, "yes")!;
    const m3 = buildPerformerModel([PLAY, SQ], yes);
    assert.equal(m3.header.name, "");
    assert.ok(m3.heldFields.some((h) => h.field === "displayName" && h.reason === "names_hidden"));
  });

  it("a hidden venue is public only through a facility-named line THIS page prints with its true title (s2r2 N-M1, combined C-H1)", () => {
    // A credit at the same venue that the person did not pick for this page.
    const other = entry({ section: "credit", title: "Example Revue", venue: "San Quentin State Prison", year: 2017, details: { medium: "theater" }, names_facility: true });
    const s = { ...applyTitleMode(off({ agent: "Rep since San Quentin State Prison" }), other.id, "true_title")!, selection: [PLAY.id, SQ.id] };
    const m = buildPerformerModel([PLAY, SQ, other], s);
    assert.doesNotMatch(performerPlainText(m), /Quentin/);
    assert.ok(m.heldFields.some((h) => h.field === "agent"));
    // An entry a performer page never prints (an exhibition, a reference) never makes it public either.
    const ex = entry({ section: "exhibition", title: "Example Group Show", venue: "San Quentin State Prison", year: 2016, details: { kind: "group" } });
    const s3 = off({ agent: "Rep since San Quentin State Prison" });
    const m3 = buildPerformerModel([PLAY, SQ, ex], s3);
    assert.doesNotMatch(performerPlainText(m3), /Quentin/);
    assert.equal(getPerformerStatus({ entries: [PLAY, SQ, ex], settings: s3, model: m3 }).state, "draft");
    // Once that credit is on the page with its true title, the venue is public.
    const s2 = applyTitleMode(off({ agent: "Rep since San Quentin State Prison" }), other.id, "true_title")!;
    const m2 = buildPerformerModel([PLAY, SQ, other], s2);
    assert.match(performerPlainText(m2), /Example Revue \| {2}\| San Quentin State Prison/);
    assert.ok(!m2.heldFields.some((h) => h.field === "agent"));
    // The same credit not marked as naming a facility is judged like any other line: held, and the venue stays hidden.
    const plain = { ...other, names_facility: false };
    const m4 = buildPerformerModel([PLAY, SQ, plain], off({ agent: "Rep since San Quentin State Prison" }));
    assert.doesNotMatch(performerPlainText(m4), /Quentin/);
    assert.ok(m4.omitted.some((o) => o.entryId === plain.id && o.reason === "names_hidden"));
  });

  it("venue only: the billing (a status word) stays; production, role and director never print", () => {
    const m = buildPerformerModel([PLAY, SQ], applyTitleMode(BASE, SQ.id, "venue_only")!);
    const row = m.credits[0].rows.find((r) => r.entryId === SQ.id)!;
    assert.equal(creditText(row.cols), "Stage production | Lead | San Quentin State Prison, San Quentin, CA");
    assert.doesNotMatch(performerPlainText(m), /Shakespeare Inside|Prospero/);
    assert.equal(getPerformerStatus({ entries: [PLAY, SQ], settings: applyTitleMode(BASE, SQ.id, "venue_only")!, model: m, pages: 1 }).state, "finished");
  });

  it("venue only training keeps the place, years and length; never the class name or the teacher", () => {
    const t = entry({ section: "training", title: "Inside Voices Acting Class", venue: FACILITY, year: 2019, end_year: 2020, details: { teacher: "K. Other", duration: "1 year" }, names_facility: true });
    const m = buildPerformerModel([PLAY, t], applyTitleMode(BASE, t.id, "venue_only")!);
    const txt = performerPlainText(m);
    assert.match(txt, new RegExp(`2019-2020 {2}Training, ${FACILITY}, 1 year`));
    assert.doesNotMatch(txt, /Inside Voices|K\. Other/);
  });

  it("a union named on a lane that keeps its name off has nothing to show and stays off", () => {
    const u = entry({ section: "union", title: "Example Inside Players Guild", year: 2020, details: { status: "member" }, names_facility: true });
    const m = buildPerformerModel([PLAY, u], applyTitleMode(BASE, u.id, "venue_only")!);
    assert.deepEqual(m.header.unions, []);
    assert.doesNotMatch(performerPlainText(m), /Inside Players/);
  });

  it("a union line that does not match the record is a BLOCK", () => {
    const m = buildPerformerModel(ALL, withInside("true_title"));
    const up = structuredClone(m);
    up.header.unions = ["SAG-AFTRA Member"];
    assert.ok(getPerformerStatus({ entries: ALL, settings: withInside("true_title"), model: up }).openItems.some((x) => x.rule === "CR-08" && x.severity === "BLOCK" && x.line === "(top of the page)"));
  });

  it("a show's title or a character is never read as a personal detail (s2r2 N-M4); an award name is", () => {
    const play = entry({ section: "credit", title: "Married, With Children: The Musical", venue: "Example Street Theatre", year: 2024, details: { medium: "theater", role: "Single mother, 45 years old" } });
    const m = buildPerformerModel([play], BASE);
    assert.match(performerPlainText(m), /Married, With Children: The Musical \| Single mother, 45 years old/);
    assert.equal(getPerformerStatus({ entries: [play], settings: BASE, model: m, pages: 1 }).state, "finished");
    const aw = entry({ section: "award", title: "Born 1990", venue: "Example Awards", year: 2024, details: { kind: "award" } });
    const m2 = buildPerformerModel([play, aw], BASE);
    assert.doesNotMatch(performerPlainText(m2), /Born 1990/);
    const st = getPerformerStatus({ entries: [play, aw], settings: BASE, model: m2 });
    assert.ok(st.openItems.some((x) => x.entryId === aw.id && x.severity === "BLOCK" && !/1990/.test(x.line)));
  });

  it("no to-do line quotes what the person typed", () => {
    const s: CreativeKindSettings = { ...withInside("true_title"), ageRange: "I am 34", height: "Born 1990" };
    const st = getPerformerStatus({ entries: ALL, settings: s });
    for (const it of st.openItems) assert.doesNotMatch(it.line, /34|1990/);
  });

  it("Selected goes only on the sections the person trimmed", () => {
    const m = buildPerformerModel(ALL, { ...withInside("true_title"), selection: [PLAY.id, INSIDE.id, FILM.id, TV.id, AWARD.id] });
    assert.deepEqual(m.credits.map((c) => c.heading), ["Theater", "Film", "Television"]);
    assert.ok(!m.sections.some((x) => x.key === "training"));
    assert.equal(m.sections.find((x) => x.key === "award")!.heading, "Awards");
    const m2 = buildPerformerModel(ALL, { ...withInside("true_title"), selection: [PLAY.id, CLASS.id, AWARD.id] });
    assert.deepEqual(m2.credits.map((c) => c.heading), ["Selected Theater"]);
  });

  it("C2: a credit year is checked even while hidden; showing years never moves one", () => {
    const s = { ...withInside("true_title"), showYears: true };
    const m = buildPerformerModel(ALL, s);
    assert.match(performerPlainText(m), /^2024 {2}Our Town/m);
    const moved = structuredClone(buildPerformerModel(ALL, withInside("true_title")));
    moved.credits[1].rows[0].years = "2021";
    assert.ok(getPerformerStatus({ entries: ALL, settings: withInside("true_title"), model: moved }).openItems.some((x) => x.rule === "STD-T05" && x.severity === "BLOCK"));
  });
});

describe("migration 078 widen helper", () => {
  const sql = readFileSync(join(__dirname, "..", "..", "migrations", "078_performer_lanes.sql"), "utf8");
  const sql76 = readFileSync(join(__dirname, "..", "..", "migrations", "077_cv_lanes.sql"), "utf8");
  it("is the same quote-exact helper as 077 (keeps every existing value, s2r2 N-L4)", () => {
    const fn = (s: string) => s.slice(s.indexOf("CREATE OR REPLACE FUNCTION pg_temp.smr_widen_list_check"), s.indexOf("$fn$;", s.indexOf("CREATE OR REPLACE FUNCTION pg_temp.smr_widen_list_check")));
    assert.equal(fn(sql), fn(sql76));
    assert.doesNotMatch(sql, /\[a-z_\]\+/);
  });
});

describe("record checks are scoped to the entries a lane reads; hidden names still count everywhere", () => {
  const EX = entry({ section: "exhibition", title: "Inside Out", venue: "Example River Correctional Center", year: 2020, details: { kind: "group" }, names_facility: true });
  const LIC = entry({ section: "license", title: "Barber", venue: "Example State Corrections Board", year: 2021, details: { credentialKind: "license", credentialStatus: "active" }, names_facility: true });
  const DEG = entry({ section: "education", title: "Bachelor of Arts", venue: "Example University", year: 2022, details: { degree: true, status: "conferred" } });
  it("an unmarked exhibition never holds up a CV, but its name typed in Interests is still held", () => {
    const s: CreativeKindSettings = { displayName: "Ray Example", email: "ray@example.com" };
    const st = getCvStatus({ entries: [DEG, EX], settings: s, cvType: "academic" });
    assert.ok(!st.openItems.some((x) => x.entryId === EX.id), JSON.stringify(st.openItems));
    const s2 = { ...s, interests: "Art at Example River Correctional Center" };
    const m = buildCvModel([DEG, EX], s2, "academic");
    assert.ok(m.heldFields.some((h) => h.field === "interests" && h.reason === "names_hidden"));
    assert.equal(getCvStatus({ entries: [DEG, EX], settings: s2, cvType: "academic", model: m }).state, "draft");
  });
  it("an unmarked license never holds up the artist resume; an unmarked exhibition still does", () => {
    const s: CreativeKindSettings = { displayName: "Ray Example" };
    const ar = buildArtistResumeModel([AWARD, LIC], s);
    assert.ok(!getCreativeStatus({ entries: [AWARD, LIC], settings: s, artistResume: { model: ar } }).openItems.some((x) => x.entryId === LIC.id));
    const ar2 = buildArtistResumeModel([AWARD, EX], s);
    assert.ok(getCreativeStatus({ entries: [AWARD, EX], settings: s, artistResume: { model: ar2 } }).openItems.some((x) => x.entryId === EX.id && x.severity === "BLOCK"));
  });
  it("an unmarked CV entry or exhibition never holds up the performer page (its words are only one-tap cards)", () => {
    const st = getPerformerStatus({ entries: [PLAY, LIC, EX], settings: BASE, pages: 1 });
    assert.ok(!st.openItems.some((x) => x.entryId === LIC.id || x.entryId === EX.id), JSON.stringify(st.openItems));
    assert.ok(st.openItems.every((x) => x.answer === "facility_word"), JSON.stringify(st.openItems));
    let s = BASE;
    for (const it of st.openItems) s = applyPhraseAnswer(s, it.phrase, "no")!;
    assert.equal(getPerformerStatus({ entries: [PLAY, LIC, EX], settings: s, pages: 1 }).state, "finished");
  });
});

describe("performer page: the round 3 two-tier matcher (s2r3 N3-H1, N3-L1)", () => {
  // A credit the lane keeps off, with a name people use for the place. Invented people; the town word is real on purpose (a lone town word is only asked about).
  const FOL = entry({ section: "credit", title: "Inside Voices Showcase", venue: "Folsom State Prison", year: 2018, details: { medium: "theater", role: "Narrator", otherNames: ["Greystone"] }, names_facility: true });
  const off = (extra: CreativeKindSettings = {}) => ({ ...applyTitleMode(BASE, FOL.id, "leave_out")!, ...extra });
  const leak = /Folsom State|Greystone|Inside Voices|Narrator/i;
  // The place's word next to a facility word, in another credit's role (combined review: held outright).
  const TWO = entry({ section: "credit", title: "Night Shift", venue: "Example Players", year: 2022, details: { medium: "theater", role: "Folsom prison guard" } });
  // The name people use for it, in a class.
  const NICK = entry({ section: "training", title: "Voice", venue: "Greystone Studio", year: 2021, details: { teacher: "R. Coach" } });
  // The town word alone, in a role: printed and asked about with one tap.
  const LAKE = entry({ section: "credit", title: "Lake Songs", venue: "Lakeside Hall", year: 2023, details: { medium: "music", role: "Townie from Folsom" } });
  const ENTRIES = [PLAY, FOL, TWO, NICK, LAKE];
  const S = off({ agent: "Rep since I did time at Folsom", skills: [{ text: "Greystone choir solos", confirmed: true }, { text: "Stage combat", confirmed: true }] });

  it("a word next to a facility or incarceration word and a name people use for it are held (tier 1); a lone town word prints and gets one card (tier 2)", () => {
    const m = buildPerformerModel(ENTRIES, S);
    const txt = performerPlainText(m);
    assert.doesNotMatch(txt, leak, txt);
    assert.match(txt, /Lake Songs \| Townie from Folsom \| Lakeside Hall/);
    assert.match(txt, /Our Town \| Emily Webb/);
    assert.match(txt, /SPECIAL SKILLS\nStage combat$/m);
    assert.deepEqual(m.omitted.filter((o) => o.reason === "names_hidden").map((o) => o.entryId).sort(), [TWO.id, NICK.id].sort());
    assert.deepEqual(m.heldFields.map((h) => `${h.field}:${h.reason}`).sort(), ["agent:names_hidden", "skills:names_hidden"]);
    assert.deepEqual(m.asks, [{ entryId: LAKE.id, phrase: "Lake Songs Townie from Folsom Lakeside Hall" }]);
    assert.ok(!performerShownIds(m).includes(TWO.id) && !performerShownIds(m).includes(NICK.id) && performerShownIds(m).includes(LAKE.id));

    const st = getPerformerStatus({ entries: ENTRIES, settings: S, model: m, pages: 1 });
    assert.equal(st.state, "draft");
    const ask = st.openItems.filter((x) => x.answer === "facility_word");
    assert.equal(ask.length, 1);
    assert.equal(ask[0].severity, "BLOCK");
    assert.equal(ask[0].doc, "performer");
    assert.equal(ask[0].line, "2023  A line in your record");
    assert.equal(ask[0].phrase, "Lake Songs Townie from Folsom Lakeside Hall");
    // The phrase is on screen only: no line, question or why carries it, and the to-do page never does.
    for (const it of st.openItems) assert.doesNotMatch(`${it.line} ${it.question} ${it.why}`, /Folsom|Greystone|Inside Voices|Narrator/i);
    for (const l of exportOpenItemLines(st, ENTRIES, S, "performer", performerShownIds(m))) assert.doesNotMatch(l, /Folsom|Greystone/i);
    // Without the page's ids nothing is public, and the to-do lines stay clean.
    for (const l of exportOpenItemLines(st, ENTRIES, S, "performer")) assert.doesNotMatch(l, /Folsom|Greystone/i);
  });

  it("a stored 'No' clears the card for good, through later saves; a 'Yes' holds the line; the lane keeps a key, never the words", () => {
    const m = buildPerformerModel(ENTRIES, S);
    const phrase = m.asks[0].phrase;
    const no = applyPhraseAnswer(S, phrase, "no")!;
    assert.doesNotMatch(JSON.stringify(no.phraseAnswers), /Folsom|Lake|Townie/i);
    const after = (s: CreativeKindSettings) => {
      const mm = buildPerformerModel(ENTRIES, s);
      return { m: mm, st: getPerformerStatus({ entries: ENTRIES, settings: s, model: mm, pages: 1 }) };
    };
    const n1 = after(no);
    assert.deepEqual(n1.m.asks, []);
    assert.ok(!n1.st.openItems.some((x) => x.answer === "facility_word"));
    assert.match(performerPlainText(n1.m), /Townie from Folsom/);
    // Another save (the same merge the lane route runs) keeps the answer: the card never comes back.
    const saved = cleanKindSettings({ phone: "555-0100", showYears: true }, no);
    assert.deepEqual(saved.phraseAnswers, no.phraseAnswers);
    const n2 = after(saved);
    assert.deepEqual(n2.m.asks, []);
    assert.match(performerPlainText(n2.m), /Townie from Folsom/);
    // "Yes, take it out": the line comes off every format and blocks with a neutral line.
    const yes = applyPhraseAnswer(saved, phrase, "yes")!;
    const y = after(yes);
    assert.doesNotMatch(performerPlainText(y.m), /Folsom/);
    assert.ok(y.m.omitted.some((o) => o.entryId === LAKE.id && o.reason === "names_hidden"));
    const block = y.st.openItems.find((x) => x.entryId === LAKE.id)!;
    assert.equal(block.severity, "BLOCK");
    assert.equal(block.line, "2023  A line in your record");
    // An answer with no words, or a bad answer, is refused.
    assert.equal(applyPhraseAnswer(S, "  ", "no"), null);
    assert.equal(applyPhraseAnswer(S, phrase, "maybe"), null);
  });

  it("a typed field or a skill that only shares the town word prints and is asked about, one card each", () => {
    const s = off({ discipline: "Actor, Folsom Lake Chorale", skills: [{ text: "Folsom Lake rowing", confirmed: true }] });
    const m = buildPerformerModel([PLAY, FOL], s);
    assert.equal(m.header.discipline, "Actor, Folsom Lake Chorale");
    assert.match(performerPlainText(m), /Folsom Lake rowing/);
    assert.deepEqual(m.asks.map((a) => a.field).sort(), ["discipline", "skills"]);
    const st = getPerformerStatus({ entries: [PLAY, FOL], settings: s, model: m, pages: 1 });
    // Combined review: unanswered cards keep the page a draft.
    assert.equal(st.state, "draft");
    assert.deepEqual(st.openItems.filter((x) => x.answer === "facility_word").map((x) => x.line).sort(), ["(top of the page)", "Special skills"]);
    let n = s;
    for (const a of m.asks) n = applyPhraseAnswer(n, a.phrase, "no")!;
    assert.equal(getPerformerStatus({ entries: [PLAY, FOL], settings: n, pages: 1 }).state, "finished");
  });

  it("settled over the credits it prints: a credit hidden by the lane stays hidden while another credit prints its true title, and a dropped credit never makes its venue public", () => {
    // Another credit at the same place, the person chose its true title on this lane.
    const OPEN = entry({ section: "credit", title: "Open Doors Revue", venue: "Folsom State Prison", year: 2020, details: { medium: "theater", role: "Chorus" }, names_facility: true });
    const s = applyTitleMode(off({ agent: "Rep since Folsom State Prison" }), OPEN.id, "true_title")!;
    const m = buildPerformerModel([PLAY, FOL, OPEN], s);
    const txt = performerPlainText(m);
    // The true-title credit prints, so its venue is public on THIS page; the hidden credit's own title and role never print.
    assert.match(txt, /Open Doors Revue \| Chorus \| Folsom State Prison/);
    assert.match(txt, /Rep since Folsom State Prison/);
    assert.doesNotMatch(txt, /Inside Voices|Narrator/);
    assert.ok(m.omitted.some((o) => o.entryId === FOL.id && o.reason === "leave_out"));
    // The hidden credit's title is still held wherever it is typed.
    const m1 = buildPerformerModel([PLAY, FOL, OPEN], { ...s, discipline: "Actor (Inside Voices Showcase alum)" });
    assert.equal(m1.header.discipline, "");
    // Now that credit carries the place's other name, so the check drops it. A dropped credit never makes the venue public.
    const OPEN2 = { ...OPEN, details: { ...OPEN.details, role: "Greystone choir" } };
    const m2 = buildPerformerModel([PLAY, FOL, OPEN2], s);
    const txt2 = performerPlainText(m2);
    assert.doesNotMatch(txt2, /Folsom|Greystone|Open Doors/);
    assert.ok(m2.omitted.some((o) => o.entryId === OPEN.id && o.reason === "names_hidden"));
    assert.ok(m2.heldFields.some((h) => h.field === "agent" && h.reason === "names_hidden"));
    assert.ok(!performerShownIds(m2).includes(OPEN.id));
    const st2 = getPerformerStatus({ entries: [PLAY, FOL, OPEN2], settings: s, model: m2, pages: 1 });
    assert.equal(st2.state, "draft");
    for (const l of exportOpenItemLines(st2, [PLAY, FOL, OPEN2], s, "performer", performerShownIds(m2))) assert.doesNotMatch(l, /Folsom|Greystone|Open Doors/);
  });

  it("a director or teacher is a person's name: part of a hidden name in it is asked about, never held; the whole name is held", () => {
    const d = entry({ section: "credit", title: "Night Bus Two", venue: "Example Pictures", year: 2024, details: { medium: "film", director: "Folsom State" } });
    const m = buildPerformerModel([PLAY, FOL, d], off());
    assert.match(performerPlainText(m), /Dir\. Folsom State/);
    assert.deepEqual(m.asks, [{ entryId: d.id, phrase: "Folsom State" }]);
    const d2 = { ...d, details: { ...d.details, director: "Folsom State Prison" } };
    const m2 = buildPerformerModel([PLAY, FOL, d2], off());
    assert.doesNotMatch(performerPlainText(m2), /Folsom/);
    assert.ok(m2.omitted.some((o) => o.entryId === d.id && o.reason === "names_hidden"));
  });
});
