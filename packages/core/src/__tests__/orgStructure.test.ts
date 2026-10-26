/**
 * Organization structure (house lane L3a, migration 103): the pure rules, and
 * that the TypeScript lists match the database's own copy in 103.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_ORG_TERMS, DEFAULT_ORG_MODULES, ENROLLMENT_MOVES, ENROLLMENT_STATUSES, ORG_MODULES, ORG_TEMPLATES, ORG_TYPES,
  STATUS_REASONS, TERM_KEYS, UNIT_KINDS, ENROLLABLE_KINDS, PROGRAM_ID_PATTERN,
  canMoveEnrollment, checkUnitTree, flattenUnitTree, labelProblem, LABEL_WORDS, normalizeTerms, pluralTerm, reasonsFor, resolveOrgModules,
  resolveOrgTerms, templateFor, termProblem, unitKindWord, isTimezoneLike, defaultOrgProfile,
} from "../orgStructureShared";
import {
  applyProfilePatch, canAssignEnrollments, cleanEnrollmentInput, cleanProgramId, cleanUnitInput, enrollableUnits, explainStructureError, unitPath,
  canManageStructure, canWriteEnrollments, canReadStructure, ORG_STRUCTURE_SQL,
} from "../orgStructure";
import { unitReachSql } from "../orgUnitReach";
import { capabilitiesForRole, computeOrgCapabilities, DELEGABLE_CAPABILITIES, STAFF_PRESETS, presetOverrideWrites } from "../authz/capabilities";

const SQL = readFileSync(join(__dirname, "..", "..", "migrations", "103_org_structure.sql"), "utf8");
/** The quoted values inside the CHECK list that follows `marker` in 103. */
function sqlList(marker: string): string[] {
  const at = SQL.indexOf(marker);
  assert.ok(at >= 0, `103 has ${marker}`);
  const open = SQL.indexOf("(", SQL.indexOf(" IN ", at));
  let depth = 0; let end = open;
  for (let i = open; i < SQL.length; i++) { if (SQL[i] === "(") depth++; if (SQL[i] === ")") { depth--; if (depth === 0) { end = i; break; } } }
  return Array.from(SQL.slice(open, end).matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
}

describe("the TypeScript lists match 103", () => {
  it("org types, unit kinds, statuses and reasons", () => {
    assert.deepEqual(sqlList("org_type           TEXT"), [...ORG_TYPES]);
    assert.deepEqual(sqlList("kind           TEXT NOT NULL CHECK"), [...UNIT_KINDS]);
    assert.deepEqual(sqlList("status                 TEXT NOT NULL DEFAULT 'enrolled'"), [...ENROLLMENT_STATUSES]);
    assert.deepEqual(sqlList("exit_reason            TEXT CHECK"), [...STATUS_REASONS]);
    assert.deepEqual(sqlList("status_reason          TEXT CHECK"), [...STATUS_REASONS]);
  });
  it("word keys and modules the profile guard accepts", () => {
    assert.deepEqual(sqlList("IF k NOT IN ('participant'"), [...TERM_KEYS]);
    assert.deepEqual(sqlList("IF k NOT IN ('programs'"), [...ORG_MODULES]);
  });
  it("enrollable kinds", () => {
    assert.deepEqual(sqlList("IF v_unit.kind NOT IN"), [...ENROLLABLE_KINDS]);
  });
  it("the moves between statuses", () => {
    const body = SQL.slice(SQL.indexOf("smr_enrollment_move_ok(p_from text"), SQL.indexOf("REVOKE ALL ON FUNCTION public.smr_enrollment_move_ok"));
    const pairs = Array.from(body.matchAll(/\('([a-z]+)', '([a-z]+)'\)/g)).map((m) => `${m[1]}>${m[2]}`).sort();
    const ts = Object.entries(ENROLLMENT_MOVES).flatMap(([from, tos]) => tos.map((to) => `${from}>${to}`)).sort();
    assert.deepEqual(pairs, ts);
  });
  it("the program id pattern and the label words", () => {
    assert.ok(SQL.includes(PROGRAM_ID_PATTERN.source), "same program id pattern");
    const inner = LABEL_WORDS.source.replace(/^\\b\(|\)\\b$/g, "");
    assert.ok(SQL.includes(`\\m(${inner})\\M`), "the same label words, whole words, in 103");
  });
});

describe("words", () => {
  it("defaults are the spec's", () => {
    assert.deepEqual({ ...DEFAULT_ORG_TERMS }, {
      participant: "participant", participants: "participants", staff_member: "staff member", case_manager: "case manager",
      program: "program", site: "site", team: "team", caseload: "caseload", enrollment: "enrollment",
    });
  });
  it("resolve never throws and never leaves a blank", () => {
    for (const bad of [null, undefined, 3, "x", [], { participant: "" }, { participant: 7 }, { nope: "x" }]) {
      const t = resolveOrgTerms(bad);
      for (const k of TERM_KEYS) assert.ok(t[k].length > 0, `${String(bad)} ${k}`);
    }
    assert.equal(resolveOrgTerms({ participant: "  job   seeker " }).participant, "job seeker");
  });
  it("never a label on a person, in any word, any case, singular or plural", () => {
    for (const w of ["felon", "Offenders", "ex-offender", "INMATE", "convicts", "ex-con", "criminals", "prisoner", "delinquents",
                     "parolee", "Probationers", "detainee", "supervisees", "ex-felons"]) {
      for (const k of TERM_KEYS) assert.ok(termProblem(k, w), `${k}: ${w}`);
      assert.ok(labelProblem(`Group for ${w}`), w);
    }
    for (const ok of ["Conviction review clinic", "Criminal record clearing", "Parole office", "Probation team", "supervisor", "client"]) {
      assert.equal(labelProblem(ok), null, ok);
    }
    assert.equal(termProblem("participant", "resident"), null);
    assert.equal(termProblem("case_manager", "officer"), null);
    const { terms, problems } = normalizeTerms({ participant: "offender", case_manager: "navigator" });
    assert.equal(terms.participant, undefined);
    assert.equal(terms.case_manager, "navigator");
    assert.equal(problems[0].key, "participant");
  });
  it("refuses markup, empties and long words; keeps only what differs", () => {
    assert.ok(termProblem("site", "<b>x</b>"));
    assert.ok(termProblem("site", "   "));
    assert.ok(termProblem("site", "x".repeat(41)));
    assert.deepEqual(normalizeTerms({ participant: "participant", site: "center" }).terms, { site: "center" });
  });
  it("plurals", () => {
    assert.equal(pluralTerm("site"), "sites");
    assert.equal(pluralTerm("facility"), "facilities");
    assert.equal(pluralTerm("class"), "classes");
    assert.equal(pluralTerm("partner staff"), "partner staff");
    assert.equal(pluralTerm("day"), "days");
  });
  it("unit kinds use the organization's words where it has them", () => {
    const t = resolveOrgTerms({ program: "course", site: "campus", caseload: "roster" });
    assert.equal(unitKindWord("program", t), "course");
    assert.equal(unitKindWord("site", t), "campus");
    assert.equal(unitKindWord("caseload", t), "roster");
    assert.equal(unitKindWord("housing_unit", t), "housing unit");
  });
});

describe("modules and profile", () => {
  it("modules default on except sites and teams", () => {
    assert.deepEqual({ ...DEFAULT_ORG_MODULES }, { programs: true, sites: false, teams: false, referrals: true, outcomes: true, custom_fields: true, saved_views: true, ai_assist: true });
    assert.equal(resolveOrgModules({ sites: true, programs: "yes", junk: true }).sites, true);
    assert.equal(resolveOrgModules({ programs: "yes" }).programs, true, "a non-boolean keeps the default");
  });
  it("a patch is checked before anything is written", () => {
    const cur = defaultOrgProfile("00000000-0000-4000-8000-000000000001");
    assert.equal(applyProfilePatch(cur, { orgType: "bank" }).ok, false);
    assert.equal(applyProfilePatch(cur, { timezone: "Not/A Zone!" }).ok, false);
    assert.equal(applyProfilePatch(cur, { terms: { participants: "inmates" } }).ok, false);
    assert.equal(applyProfilePatch(cur, { terms: { case_manager: "supervisee coach" } }).ok, false, "every word, not only the participant words");
    assert.equal(applyProfilePatch(cur, { modules: { sites: "on" } }).ok, false);
    assert.equal(applyProfilePatch(cur, { displayName: "x".repeat(121) }).ok, false);
    const r = applyProfilePatch(cur, { orgType: "housing", terms: { participant: "resident" }, modules: { sites: true }, timezone: "America/Denver", displayName: "  " });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.next.orgType, "housing");
      assert.equal(r.next.terms.participant, "resident");
      assert.equal(r.next.terms.case_manager, "case manager", "untouched words keep their value");
      assert.equal(r.next.modules.sites, true);
      assert.equal(r.next.displayName, null);
    }
    assert.ok(isTimezoneLike("America/Indiana/Indianapolis"));
    assert.ok(!isTimezoneLike("America/Chicago; DROP TABLE x"));
  });
});

describe("templates, for every organization type", () => {
  for (const type of ORG_TYPES) {
    it(`${type}: valid words, a valid tree, somewhere to enroll people`, () => {
      const t = templateFor(type);
      for (const k of TERM_KEYS) assert.equal(termProblem(k, t.terms[k]), null, `${type}.${k} = ${t.terms[k]}`);
      assert.deepEqual(checkUnitTree(t.units), [], type);
      const flat = flattenUnitTree(t.units);
      assert.ok(flat.length >= 1, "at least one group");
      assert.ok(flat.some((u) => ENROLLABLE_KINDS.includes(u.kind)), "somewhere a person can be enrolled");
      assert.ok(t.note.length > 10 && !/—|--/.test(t.note), "a plain note, no dashes");
      assert.equal(ORG_TEMPLATES[type].type, type);
      // Never a real organization or person: names are generic.
      for (const u of flat) assert.ok(u.name.length <= 80);
    });
  }
  it("templateFor returns a copy (editing it cannot change the next one)", () => {
    const a = templateFor("workforce_board"); a.units[0].name = "changed";
    assert.notEqual(templateFor("workforce_board").units[0].name, "changed");
  });
  it("community supervision is region > office > caseload, and corrections is facility > housing unit > program", () => {
    const cs = templateFor("community_supervision").units[0];
    assert.equal(cs.children?.[0].kind, "office");
    assert.equal(cs.children?.[0].children?.[0].kind, "caseload");
    const cf = templateFor("corrections_facility").units[0];
    assert.equal(cf.kind, "facility");
    assert.equal(cf.children?.[0].kind, "housing_unit");
    assert.equal(cf.children?.[0].children?.[0].kind, "program");
  });
});

describe("the unit tree check", () => {
  it("refuses five levels, blanks, duplicates among siblings, unknown kinds and too many", () => {
    const deep = [{ kind: "site", name: "a", children: [{ kind: "office", name: "b", children: [{ kind: "team", name: "c", children: [{ kind: "program", name: "d", children: [{ kind: "cohort", name: "e" }] }] }] }] }] as never;
    assert.match(checkUnitTree(deep)[0].message, /4 levels/);
    assert.ok(checkUnitTree([{ kind: "program", name: " " }]).length);
    assert.ok(checkUnitTree([{ kind: "program", name: "A" }, { kind: "cohort", name: "a" }]).length, "case-insensitive duplicate");
    assert.equal(checkUnitTree([{ kind: "program", name: "A", children: [{ kind: "cohort", name: "A" }] }]).length, 0, "same name at another level is fine");
    assert.ok(checkUnitTree([{ kind: "ward" as never, name: "x" }]).length);
    assert.ok(checkUnitTree(Array.from({ length: 61 }, (_, i) => ({ kind: "program" as const, name: `p${i}` }))).length);
  });
  it("flattens parents before children", () => {
    const flat = flattenUnitTree(templateFor("workforce_board").units);
    flat.forEach((u, i) => { if (u.parentIndex !== null) assert.ok(u.parentIndex < i); });
  });
});

describe("enrollments", () => {
  it("moves", () => {
    assert.ok(canMoveEnrollment("referred", "enrolled"));
    assert.ok(canMoveEnrollment("active", "paused"));
    assert.ok(canMoveEnrollment("exited", "active"), "a mistake can be reopened");
    assert.ok(!canMoveEnrollment("referred", "paused"));
    assert.ok(!canMoveEnrollment("completed", "exited"));
    assert.ok(canMoveEnrollment("active", "active"));
  });
  it("reasons are asked for pausing and ending, never offered as left_organization", () => {
    for (const s of ENROLLMENT_STATUSES) assert.ok(!reasonsFor(s).includes("left_organization"), s);
    assert.ok(reasonsFor("exited").length > 0 && reasonsFor("paused").length > 0);
    assert.equal(reasonsFor("active").length, 0);
  });
  it("the organization's own id: plain characters, never a free-text field", () => {
    assert.equal(cleanProgramId("  A-1042 "), "A-1042");
    assert.equal(cleanProgramId(""), null);
    assert.equal(cleanProgramId(null), null);
    assert.equal(cleanProgramId("<script>"), false);
    assert.equal(cleanProgramId("x".repeat(41)), false);
    assert.equal(cleanProgramId(12), false);
  });
  it("a new enrollment is checked", () => {
    const P = "00000000-0000-4000-8000-0000000000aa", U = "00000000-0000-4000-8000-0000000000bb";
    assert.equal(cleanEnrollmentInput({ participantId: "x", unitId: U }).ok, false);
    assert.equal(cleanEnrollmentInput({ participantId: P, unitId: U, status: "completed" }).ok, false, "cannot start finished");
    assert.equal(cleanEnrollmentInput({ participantId: P, unitId: U, enrolledOn: "11/02/2026" }).ok, false);
    const ok = cleanEnrollmentInput({ participantId: P, unitId: U, programParticipantId: " B 7 " });
    assert.ok(ok.ok && ok.v.status === "enrolled" && ok.v.programParticipantId === "B 7");
  });
});

describe("units", () => {
  it("fields are checked and cleaned", () => {
    assert.equal(cleanUnitInput({ kind: "program", name: "" }).ok, false);
    assert.equal(cleanUnitInput({ kind: "ward", name: "x" }).ok, false);
    assert.equal(cleanUnitInput({ kind: "program", name: "x", parentId: "nope" }).ok, false);
    assert.equal(cleanUnitInput({ kind: "program", name: "x", startsOn: "2026-12-01", endsOn: "2026-11-01" }).ok, false);
    assert.equal(cleanUnitInput({ kind: "program", name: "x", capacity: 0 }).ok, false);
    assert.equal(cleanUnitInput({ kind: "program", name: "x", shortCode: "has space" }).ok, false);
    assert.equal(cleanUnitInput({ kind: "program", name: "Offender group" }).ok, false, "label rule on names");
    assert.equal(cleanUnitInput({ kind: "program", name: "Group A", description: "for parolees" }).ok, false, "and descriptions");
    assert.ok(checkUnitTree([{ kind: "program", name: "Inmate services" }]).length, "and in the setup tree");
    const r = cleanUnitInput({ kind: "cohort", name: "  Fall   cohort ", capacity: "12" });
    assert.ok(r.ok && r.unit.name === "Fall cohort" && r.unit.capacity === 12);
    const keep = cleanUnitInput({ name: "Renamed" }, { kind: "site", name: "Old", parentId: null, capacity: 5 });
    assert.ok(keep.ok && keep.unit.kind === "site" && keep.unit.capacity === 5, "an edit keeps what it does not change");
  });
  it("paths and pickers", () => {
    const units = [
      { id: "a", parent_id: null, name: "Center", kind: "site", status: "active" },
      { id: "b", parent_id: "a", name: "Adult", kind: "program", status: "active" },
      { id: "c", parent_id: "b", name: "Fall", kind: "cohort", status: "closed" },
    ] as never[];
    assert.equal(unitPath(units, "c"), "Center / Adult / Fall");
    assert.deepEqual(enrollableUnits(units).map((u: { id: string }) => u.id), ["b"], "sites and closed units are not offered");
  });
});

describe("database refusals in plain words", () => {
  it("passes 103's own sentences through, hides constraint text, maps the rest", () => {
    assert.equal(explainStructureError({ code: "23514", message: "units go at most 4 levels deep" }).error, "Units go at most 4 levels deep.");
    assert.match(explainStructureError({ code: "23514", message: 'new row for relation "org_unit" violates check constraint "x"' }).error, /did not save/);
    assert.equal(explainStructureError({ code: "42501", message: "new row violates row-level security policy" }).status, 403);
    assert.equal(explainStructureError({ code: "23505", message: 'duplicate key value violates unique constraint "enrollment_one_open"' }).status, 409);
    assert.match(explainStructureError({ code: "23505", message: 'duplicate key value violates unique constraint "org_unit_active_name"' }).error, /with that name/);
    assert.equal(explainStructureError({ code: "42P01", message: 'relation "org_unit" does not exist' }).status, 503);
    assert.match(explainStructureError({ code: "22023", message: 'time zone "Mars/Base" not recognized' }).error, /time zone/);
  });
});

describe("capabilities", () => {
  const owner = computeOrgCapabilities("owner"), admin = computeOrgCapabilities("org_admin"), staff = computeOrgCapabilities("staff");
  it("every role can enroll; only the owner manages structure", () => {
    for (const r of ["owner", "org_admin", "staff"] as const) assert.ok(capabilitiesForRole(r).includes("org.enrollment.write"), r);
    assert.ok(canManageStructure({ viaPlatformAdmin: false, capabilities: owner }));
    assert.ok(!canManageStructure({ viaPlatformAdmin: false, capabilities: admin }));
    assert.ok(!canManageStructure({ viaPlatformAdmin: false, capabilities: staff }));
    assert.ok(!canManageStructure({ viaPlatformAdmin: true, capabilities: owner }), "a platform admin acting for an org never writes");
    assert.ok(canWriteEnrollments({ viaPlatformAdmin: false, capabilities: staff }));
    assert.ok(!canWriteEnrollments({ viaPlatformAdmin: true, capabilities: owner }));
    assert.ok(canReadStructure({ capabilities: staff }));
  });
  it("creating, reopening and choosing staff on an enrollment is the assign power (B1)", () => {
    assert.ok(canAssignEnrollments({ viaPlatformAdmin: false, capabilities: owner }));
    assert.ok(canAssignEnrollments({ viaPlatformAdmin: false, capabilities: admin }));
    assert.ok(!canAssignEnrollments({ viaPlatformAdmin: false, capabilities: staff }), "plain staff cannot");
    assert.ok(canAssignEnrollments({ viaPlatformAdmin: false, capabilities: computeOrgCapabilities("staff", ["org.client.assign"]) }), "granted, they can");
    assert.ok(!canAssignEnrollments({ viaPlatformAdmin: false, capabilities: computeOrgCapabilities("org_admin", [], ["org.client.assign"]) }), "deny wins");
    assert.ok(!canAssignEnrollments({ viaPlatformAdmin: true, capabilities: owner }));
    assert.ok(SQL.includes("AND public.smr_enrollment_assigner(access_code_id, NULLIF(current_setting('app.user_id', true), '')::uuid));"), "the insert policy asks the database's assign rule");
    assert.match(SQL, /OLD\.status IN \('completed', 'exited', 'withdrawn'\) AND NEW\.status NOT IN/, "reopening is checked in the guard");
  });
  it("enrollment.write is delegable, the volunteer preset denies it, and 103 appends it to the SQL list", () => {
    assert.ok(DELEGABLE_CAPABILITIES.some((d) => d.capability === "org.enrollment.write"));
    assert.ok(STAFF_PRESETS.volunteer.denies.includes("org.enrollment.write"));
    assert.ok(presetOverrideWrites("volunteer").some((w) => w.capability === "org.enrollment.write" && w.effect === "deny"));
    const vol = computeOrgCapabilities("staff", [], presetOverrideWrites("volunteer").filter((w) => w.effect === "deny").map((w) => w.capability));
    assert.ok(!canWriteEnrollments({ viaPlatformAdmin: false, capabilities: vol }));
    assert.ok(SQL.includes("'org.enrollment.write' = ANY (v_list)"), "103 appends to the live list");
    assert.ok(SQL.includes("o.capability = 'org.enrollment.write' AND o.effect = 'deny'"), "the database writer rule honors the deny");
  });
});

describe("the SQL the module runs", () => {
  it("every statement is scoped to its organization parameter", () => {
    for (const [name, text] of Object.entries(ORG_STRUCTURE_SQL)) {
      assert.match(text, /\$1::uuid/, `${name} names the organization as $1`);
    }
  });
  it("setup never doubles a tree", () => {
    assert.match(ORG_STRUCTURE_SQL.insertSetupUnit, /WHERE NOT EXISTS \(SELECT 1 FROM org_unit x WHERE x.access_code_id = \$1::uuid AND NOT \(x.id = ANY\(\$6::uuid\[\]\)\)\)/);
  });
  it("there is no delete of a unit, a profile or an enrollment anywhere", () => {
    for (const text of Object.values(ORG_STRUCTURE_SQL)) assert.ok(!/DELETE FROM (org_unit|org_profile|enrollment)\b/.test(text));
  });
});


describe("unit reach in the application's own checks (the second wall)", () => {
  const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
  it("is the database's unit rule written out in app SQL, independent of the database functions", () => {
    const q = unitReachSql("$1::uuid", "$3::uuid", "t.client_user_id");
    assert.ok(!/smr_staff_reach|smr_staff_unit_reach|smr_is_volunteer/.test(q), "the second wall does not call the first");
    for (const part of ["ur_u.status = 'active'", "role_in_unit IN ('lead', 'member')", "ur_m.role_in_unit = 'lead' AND ur_m.org_unit_id IN (ur_p1.id, ur_p2.id, ur_p3.id)",
      "('referred', 'enrolled', 'active', 'paused')", "FROM org_staff ur_s", "'org.participant.invite' AND ur_o.effect = 'deny'", "ur_e.participant_user_id = t.client_user_id"]) {
      assert.ok(q.includes(part), part);
    }
  });
  it("every assignment-based reach check also admits unit reach", () => {
    const view = src("orgClientView.ts");
    const inReach = view.slice(view.indexOf("const IN_REACH"), view.indexOf("const SHARED"));
    assert.match(inReach, /unitReachSql\("\$2::uuid", "\$4::uuid", "\$1::uuid"\)/, "IN_REACH: org $2, actor $4, person $1");
    assert.match(view.slice(view.indexOf("const reachOf")), /unitReachSql\("\$1::uuid", "\$3::uuid", who\)/);
    assert.match(src("staffTasks.ts"), /unitReachSql\("\$1::uuid", "\$3::uuid", "t.client_user_id"\)/);
    assert.match(src("staffTasks.ts"), /unitReachSql\("\$1::uuid", "\$3::uuid", "\$4::uuid"\)/, "adding a task about someone");
    assert.match(src("orgToday.ts"), /unitReachSql\("\$1::uuid", "\$3::uuid", who\)/);
    assert.match(src("orgOutcomes.ts"), /unitReachSql\("\$1::uuid", "\$3::uuid", who\)/);
    assert.match(src("partnerDashboard.ts"), /participantsReachedThroughUnits\(opts\.accessCodeId, opts\.assignedToStaffId\)/);
  });
  it("never widens a 'case manager only' sharing requirement", () => {
    const view = src("orgClientView.ts");
    const shared = view.slice(view.indexOf("const SHARED"), view.indexOf("const covered"));
    assert.ok(!/unitReach|smr_staff_unit_reach/.test(shared), "SHARED stays on the assignment alone");
  });
});
