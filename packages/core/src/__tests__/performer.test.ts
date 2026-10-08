/**
 * Performer lanes (077): the one-page performer resume assembled from the
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
import { applyTitleMode, cleanKindSettings, type CreativeKindSettings } from "../creativeLaneShared";
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

describe("performer lane kind and record kinds (077)", () => {
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
    assert.deepEqual(m.header.unions, ["SAG-AFTRA Eligible"]);
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
      assert.deepEqual(buildPerformerModel([PLAY, u], BASE).header.unions, [status === "member" ? "SAG-AFTRA Member" : "SAG-AFTRA Membership Candidate"]);
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

describe("migration 077", () => {
  const sql = readFileSync(join(__dirname, "..", "..", "migrations", "077_performer_lanes.sql"), "utf8");
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
      { discipline: "Actor (trained at Quentin)" },
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

  it("the name at the top is held too, so a file name made from the printed name never carries it", () => {
    const s = off({ displayName: "Ray Example of San Quentin" });
    const m = buildPerformerModel([PLAY, SQ], s);
    assert.equal(m.header.name, "");
    assert.ok(m.heldFields.some((h) => h.field === "displayName" && h.reason === "names_hidden"));
  });

  it("a hidden venue is public only through a line THIS page prints with its true title (s2r2 N-M1)", () => {
    // A credit at the same venue that the person did not pick for this page.
    const other = entry({ section: "credit", title: "Example Revue", venue: "San Quentin State Prison", year: 2017, details: { medium: "theater" } });
    const s = { ...off({ agent: "Rep since San Quentin State Prison" }), selection: [PLAY.id, SQ.id] };
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
    const m2 = buildPerformerModel([PLAY, SQ, other], off({ agent: "Rep since San Quentin State Prison" }));
    assert.match(performerPlainText(m2), /Example Revue \| {2}\| San Quentin State Prison/);
    assert.ok(!m2.heldFields.some((h) => h.field === "agent"));
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

describe("migration 077 widen helper", () => {
  const sql = readFileSync(join(__dirname, "..", "..", "migrations", "077_performer_lanes.sql"), "utf8");
  const sql76 = readFileSync(join(__dirname, "..", "..", "migrations", "076_cv_lanes.sql"), "utf8");
  it("is the same quote-exact helper as 076 (keeps every existing value, s2r2 N-L4)", () => {
    const fn = (s: string) => s.slice(s.indexOf("CREATE OR REPLACE FUNCTION pg_temp.smr_widen_list_check"), s.indexOf("$fn$;", s.indexOf("CREATE OR REPLACE FUNCTION pg_temp.smr_widen_list_check")));
    assert.equal(fn(sql), fn(sql76));
    assert.doesNotMatch(sql, /\[a-z_\]\+/);
  });
});
