/**
 * Custom fields (house build L4, migration 104): validation for every type,
 * the sensitive rule, definitions, display and export. Pure; no database.
 * Fictional fields and people only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CUSTOM_FIELD_TYPES, aiSafeFields, defFromRow, exportableFields, formatCustomFieldValue, isIsoDate, isSensitiveField, normalizeNewFieldDef,
  normalizeOptions, optionIdFor, sensitiveWordIn, slugifyFieldKey, validateCustomFieldValue, type CustomFieldDef,
} from "../customFieldsShared";
import { buildCaseloadCsv, caseloadCsvCell } from "../caseloadExportShared";

const def = (over: Partial<CustomFieldDef>): CustomFieldDef => ({
  id: "00000000-0000-4000-8000-000000000001", entity: "participant", key: "f", label: "Field", type: "text", options: [],
  required: false, help: null, sensitive: false, position: 0, retiredAt: null, ...over,
});
const OPTS = [{ id: "stable", label: "Stable" }, { id: "shelter", label: "Shelter" }, { id: "old", label: "Old choice", retired: true }];
const STAFF = "11111111-2222-4333-8444-555555555555";

describe("validateCustomFieldValue: every type", () => {
  it("covers every declared type (a new type needs a test here)", () => {
    assert.deepEqual([...CUSTOM_FIELD_TYPES].sort(), ["boolean", "date", "long_text", "multi_select", "number", "single_select", "staff_member", "text", "url"]);
  });
  it("empty clears, unless the field is needed", () => {
    for (const t of CUSTOM_FIELD_TYPES) {
      assert.deepEqual(validateCustomFieldValue(def({ type: t, options: OPTS }), ""), { ok: true, value: null }, t);
      assert.deepEqual(validateCustomFieldValue(def({ type: t, options: OPTS }), null), { ok: true, value: null }, t);
      const r = validateCustomFieldValue(def({ type: t, options: OPTS, required: true, label: "Housing" }), undefined);
      assert.equal(r.ok, false, t);
      assert.match((r as { error: string }).error, /Housing needs an answer/);
    }
    assert.deepEqual(validateCustomFieldValue(def({ type: "multi_select", options: OPTS }), []), { ok: true, value: null });
  });
  it("text: one line, trimmed, at most 500, control characters gone", () => {
    assert.deepEqual(validateCustomFieldValue(def({ type: "text" }), "  two\nlines\u0007 "), { ok: true, value: "two lines" });
    assert.equal(validateCustomFieldValue(def({ type: "text" }), "x".repeat(501)).ok, false);
    assert.deepEqual(validateCustomFieldValue(def({ type: "text" }), 42), { ok: true, value: "42" });
    assert.equal(validateCustomFieldValue(def({ type: "text" }), { a: 1 }).ok, false);
    assert.deepEqual(validateCustomFieldValue(def({ type: "text", required: true }), "   "), { ok: false, error: "Field needs an answer." });
  });
  it("long_text keeps line breaks, at most 5,000", () => {
    assert.deepEqual(validateCustomFieldValue(def({ type: "long_text" }), "a\r\nb"), { ok: true, value: "a\nb" });
    assert.equal(validateCustomFieldValue(def({ type: "long_text" }), "x".repeat(5001)).ok, false);
  });
  it("number: numbers and numeric text, never NaN or Infinity", () => {
    assert.deepEqual(validateCustomFieldValue(def({ type: "number" }), "1,250.5"), { ok: true, value: 1250.5 });
    assert.deepEqual(validateCustomFieldValue(def({ type: "number" }), 0), { ok: true, value: 0 });
    for (const bad of ["abc", Infinity, NaN, true, 1e13]) assert.equal(validateCustomFieldValue(def({ type: "number" }), bad).ok, false, String(bad));
  });
  it("date: real calendar dates only", () => {
    assert.deepEqual(validateCustomFieldValue(def({ type: "date" }), "2026-10-29"), { ok: true, value: "2026-10-29" });
    for (const bad of ["2026-02-30", "10/29/2026", "2026-13-01", 20261029]) assert.equal(validateCustomFieldValue(def({ type: "date" }), bad).ok, false, String(bad));
    assert.equal(isIsoDate("2024-02-29"), true);
    assert.equal(isIsoDate("2023-02-29"), false);
  });
  it("boolean: true/false and yes/no, nothing else", () => {
    assert.deepEqual(validateCustomFieldValue(def({ type: "boolean" }), false), { ok: true, value: false });
    assert.deepEqual(validateCustomFieldValue(def({ type: "boolean" }), "yes"), { ok: true, value: true });
    assert.equal(validateCustomFieldValue(def({ type: "boolean" }), "maybe").ok, false);
    assert.equal(validateCustomFieldValue(def({ type: "boolean" }), 1).ok, false);
  });
  it("single_select: a live choice by id; a retired one only if it was already picked", () => {
    const d = def({ type: "single_select", options: OPTS });
    assert.deepEqual(validateCustomFieldValue(d, "shelter"), { ok: true, value: "shelter" });
    assert.equal(validateCustomFieldValue(d, "Shelter").ok, false, "a label is not an id");
    assert.equal(validateCustomFieldValue(d, "old").ok, false, "a retired choice is not offered");
    assert.deepEqual(validateCustomFieldValue(d, "old", { allowRetiredOption: ["old"] }), { ok: true, value: "old" });
    assert.equal(validateCustomFieldValue(d, "nope").ok, false);
  });
  it("multi_select: live choices, each once, kept in the field's order", () => {
    const d = def({ type: "multi_select", options: OPTS });
    assert.deepEqual(validateCustomFieldValue(d, ["shelter", "stable", "shelter"]), { ok: true, value: ["stable", "shelter"] });
    assert.equal(validateCustomFieldValue(d, ["stable", "nope"]).ok, false);
    assert.equal(validateCustomFieldValue(d, "stable").ok, false);
    assert.equal(validateCustomFieldValue(d, [1]).ok, false);
  });
  it("staff_member: a staff id of this organization", () => {
    const d = def({ type: "staff_member" });
    assert.deepEqual(validateCustomFieldValue(d, STAFF.toUpperCase()), { ok: true, value: STAFF });
    assert.equal(validateCustomFieldValue(d, "Alma").ok, false);
    assert.equal(validateCustomFieldValue(d, STAFF, { staffIds: new Set(["99999999-2222-4333-8444-555555555555"]) }).ok, false, "someone else's staff");
    assert.equal(validateCustomFieldValue(d, STAFF, { staffIds: new Set([STAFF]) }).ok, true);
  });
  it("url: http or https only (no javascript:, no data:)", () => {
    const d = def({ type: "url" });
    assert.deepEqual(validateCustomFieldValue(d, " https://example.org/p?x=1 "), { ok: true, value: "https://example.org/p?x=1" });
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://example.org", "example.org", "https://", `https://a.org/${"x".repeat(2001)}`]) {
      assert.equal(validateCustomFieldValue(d, bad).ok, false, bad);
    }
  });
});

describe("the sensitive rule", () => {
  it("an admin's tick makes a field sensitive", () => {
    assert.equal(isSensitiveField({ sensitive: true, label: "Shoe size" }), true);
    assert.equal(isSensitiveField({ sensitive: false, label: "Shoe size" }), false);
  });
  it("record, health and identity words make it sensitive whatever the box says", () => {
    for (const label of ["Parole end date", "Probation officer", "Offense type", "Case number", "DOC number", "Release date", "Medication", "Mental health notes", "SSN", "Immigration status", "Court date"]) {
      assert.equal(isSensitiveField({ sensitive: false, label }), true, label);
    }
    assert.equal(sensitiveWordIn({ label: "Housing", key: "supervision_level" }), "supervision", "the key counts");
    assert.equal(sensitiveWordIn({ label: "Notes", help: "Anything from the court file" }), "court", "the help counts");
  });
  it("whole words only: ordinary fields stay ordinary", () => {
    for (const label of ["Housing status", "Shoe size", "Forklift certified", "Preferred shift", "Transportation", "Docs received", "Recorder"]) {
      assert.equal(isSensitiveField({ sensitive: false, label }), false, label);
    }
  });
  it("exports leave sensitive fields out unless ticked by id; AI never gets them", () => {
    const a = def({ id: "a", key: "housing", label: "Housing" });
    const b = def({ id: "b", key: "po", label: "Parole officer" });
    const c = def({ id: "c", key: "x", label: "Shoe size", sensitive: true });
    const r = def({ id: "r", key: "old", label: "Old thing", retiredAt: "2026-10-01" });
    assert.deepEqual(exportableFields([a, b, c, r]).map((d) => d.id), ["a", "r"]);
    assert.deepEqual(exportableFields([a, b, c], ["b"]).map((d) => d.id), ["a", "b"]);
    assert.deepEqual(aiSafeFields([a, b, c, r]).map((d) => d.id), ["a"]);
  });
});

describe("definitions", () => {
  it("keys come from labels and are stable slugs", () => {
    assert.equal(slugifyFieldKey("Housing status"), "housing_status");
    assert.equal(slugifyFieldKey("  Año de llegada! "), "ano_de_llegada");
    assert.equal(slugifyFieldKey("2nd shift ok"), "f_2nd_shift_ok");
    assert.match(slugifyFieldKey("!!"), /^[a-z][a-z0-9_]{1,39}$/);
    assert.equal(optionIdFor("Stable", ["stable"]), "stable_2");
  });
  it("a new field is cleaned; a record word forces sensitive", () => {
    const r = normalizeNewFieldDef({ label: " Probation   end ", entity: "participant", type: "date", sensitive: false });
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && { label: r.def.label, key: r.def.key, sensitive: r.def.sensitive }, { label: "Probation end", key: "probation_end", sensitive: true });
    assert.equal(normalizeNewFieldDef({ label: "", entity: "participant", type: "text" }).ok, false);
    assert.equal(normalizeNewFieldDef({ label: "X", entity: "household", type: "text" }).ok, false);
    assert.equal(normalizeNewFieldDef({ label: "X", entity: "participant", type: "file" }).ok, false);
    assert.equal(normalizeNewFieldDef({ label: "X", entity: "participant", type: "single_select", options: [] }).ok, false, "a list needs a choice");
    assert.equal(normalizeNewFieldDef({ label: "X", entity: "participant", type: "text", help: "y".repeat(301) }).ok, false);
  });
  it("choices keep their ids, get new ones from labels, and are retired rather than removed", () => {
    const prev = [{ id: "stable", label: "Stable" }, { id: "shelter", label: "Shelter" }];
    const r = normalizeOptions([{ id: "stable", label: "Stable housing" }, "Couch surfing"], prev);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.options, [{ id: "stable", label: "Stable housing" }, { id: "couch_surfing", label: "Couch surfing" }, { id: "shelter", label: "Shelter", retired: true }]);
    assert.equal(normalizeOptions(["A", "a"]).ok, false, "the same choice twice");
    assert.equal(normalizeOptions([{ label: "A", retired: true }]).ok, false, "at least one live choice");
  });
  it("a row from SQL becomes a definition; an unknown type is dropped", () => {
    assert.equal(defFromRow({ id: "x", entity: "participant", key: "k", label: "L", type: "file" }), null);
    const d = defFromRow({ id: "x", entity: "enrollment", key: "k", label: "L", type: "single_select", options: [{ id: "a", label: "A" }, { id: "", label: "bad" }, "junk"], position: 3, retired_at: null });
    assert.deepEqual(d?.options, [{ id: "a", label: "A" }]);
    assert.equal(d?.position, 3);
  });
});

describe("display and the caseload export", () => {
  it("values read as words; a retired choice still reads by its label", () => {
    const names = new Map([[STAFF, "Alma Reyes"]]);
    assert.equal(formatCustomFieldValue(def({ type: "single_select", options: OPTS }), "old"), "Old choice");
    assert.equal(formatCustomFieldValue(def({ type: "multi_select", options: OPTS }), ["stable", "shelter"]), "Stable, Shelter");
    assert.equal(formatCustomFieldValue(def({ type: "boolean" }), false), "No");
    assert.equal(formatCustomFieldValue(def({ type: "date" }), "2026-10-29"), "Oct 29, 2026");
    assert.equal(formatCustomFieldValue(def({ type: "date" }), "2026-10-29", undefined, { csv: true }), "2026-10-29");
    assert.equal(formatCustomFieldValue(def({ type: "staff_member" }), STAFF, names), "Alma Reyes");
    assert.equal(formatCustomFieldValue(def({ type: "staff_member" }), STAFF), "Someone no longer on staff");
    assert.equal(formatCustomFieldValue(def({ type: "text" }), null), "");
  });
  it("csv cells are quoted when needed and never run as a formula", () => {
    assert.equal(caseloadCsvCell('a "b", c'), '"a ""b"", c"');
    assert.equal(caseloadCsvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(caseloadCsvCell("-1+2"), "'-1+2");
    assert.equal(caseloadCsvCell(null), "");
  });
  it("the caseload CSV has the org's fields, leaves sensitive ones out unless ticked, keeps retired ones marked", () => {
    const defs = [
      def({ id: "a", key: "housing", label: "Housing", type: "single_select", options: OPTS, position: 1 }),
      def({ id: "b", key: "po_name", label: "Parole officer", position: 2 }),
      def({ id: "r", key: "shift", label: "Shift", retiredAt: "2026-10-01", position: 0 }),
      def({ id: "e", key: "cohort_note", label: "Cohort note", entity: "enrollment" }),
    ];
    const rows = [{ userId: "p1", name: "Dana Whitfield", email: "dana@example.invalid", currentStage: 3, nextStepAction: null, applications: 2, hired: false, lastActiveAt: "2026-10-20T10:00:00Z", joinedAt: "2026-09-01T00:00:00Z", assignedStaffName: "Alma Reyes" }];
    const values = { p1: { housing: "shelter", po_name: "Officer X", shift: "nights", cohort_note: "never" } };
    const plain = buildCaseloadCsv(rows, defs, values);
    const [head, line] = plain.csv.split("\n");
    assert.equal(head, "name,email,stage,next_step,applications,hired,last_active,joined,case_manager,Housing,Shift (retired)");
    assert.equal(line, "Dana Whitfield,dana@example.invalid,3,,2,no,2026-10-20,2026-09-01,Alma Reyes,Shelter,nights");
    assert.doesNotMatch(plain.csv, /Officer X|Parole|never/);
    assert.deepEqual(plain.sensitiveIncluded, []);
    const ticked = buildCaseloadCsv(rows, defs, values, { includeSensitiveIds: ["b"] });
    assert.match(ticked.csv, /Parole officer/);
    assert.match(ticked.csv, /Officer X/);
    assert.deepEqual(ticked.sensitiveIncluded, ["po_name"]);
  });
});

describe("the database half keeps the rules (source checks)", () => {
  const src = readFileSync(new URL("../customFields.ts", import.meta.url), "utf8");
  it("every read and write runs in the org scope, never through an unscoped helper", () => {
    assert.doesNotMatch(src, /\b(query|getOne|insert)\s*\(/);
    assert.match(src, /runScoped/);
  });
  it("values are read and written only within reach (the second wall)", () => {
    assert.match(src.slice(src.indexOf("export async function getFieldValues")), /\$\{reachSql\("v\.participant_user_id", units\)\}/);
    const set = src.slice(src.indexOf("export async function setFieldValues"));
    assert.match(set, /reachSql\("\$4::uuid", units\)/);
    assert.match(set, /reachSql\("e\.participant_user_id", units\)/);
    assert.match(set, /That person is not on your caseload/);
  });
  it("managing fields needs org.settings.manage, never a platform admin acting for an org; writing values needs org.note.write", () => {
    assert.match(src, /canManageFields = \(a: OrgActor\) => !a\.viaPlatformAdmin && a\.capabilities\.has\("org\.settings\.manage"\)/);
    assert.match(src, /canWriteFieldValues = \(a: OrgActor\) => !a\.viaPlatformAdmin && a\.capabilities\.has\("org\.note\.write"\)/);
    for (const fn of ["createFieldDef", "updateFieldDef", "reorderFieldDefs", "setFieldRetired"]) {
      const body = src.slice(src.indexOf(`export async function ${fn}`));
      assert.match(body.slice(0, 300), /canManageFields\(actor\)/, fn);
    }
  });
  it("reach is the same predicate as notes (L3a): assigned, sees everyone, or through a unit in app SQL; assignment only without 103", async () => {
    const { reachSql } = await import("../customFields");
    const without = reachSql("v.participant_user_id", false);
    assert.doesNotMatch(without, /enrollment|unit_member|org_unit/, "without 103's tables the predicate never names them");
    assert.match(without, /client_staff_assignment a/);
    const withUnits = reachSql("v.participant_user_id", true);
    assert.match(withUnits, /ur_m\.org_unit_id = ur_u\.id AND ur_m\.role_in_unit IN \('lead', 'member'\)/);
    assert.match(withUnits, /ur_m\.role_in_unit = 'lead' AND ur_m\.org_unit_id IN \(ur_p1\.id, ur_p2\.id, ur_p3\.id\)/, "a lead covers three levels below");
    assert.match(withUnits, /ur_e\.status IN \('referred', 'enrolled', 'active', 'paused'\)/);
    assert.match(withUnits, /ur_u\.status = 'active'/);
    assert.match(withUnits, /ur_e\.participant_user_id = v\.participant_user_id/);
    assert.match(withUnits, /capability = 'org\.participant\.invite' AND ur_o\.effect = 'deny'[\s\S]*capability = 'org\.outcome\.write' AND ur_o\.effect = 'deny'/, "never a volunteer");
    assert.doesNotMatch(withUnits, /smr_staff_reach/, "the second wall does not lean on the first");
  });
  it("sensitive is one way in the app too: unticking is refused with a plain way out", () => {
    const upd = src.slice(src.indexOf("export async function updateFieldDef"));
    assert.match(upd, /if \(current\.sensitive && patch\.sensitive === false\)/);
    assert.match(upd, /retire it and make a new field/);
    assert.match(upd, /const sensitive = forced !== null \|\| current\.sensitive \|\| patch\.sensitive === true;/);
  });
  it("earlier answers: managers only, within reach", () => {
    const h = src.slice(src.indexOf("export async function getFieldValueHistory"));
    assert.match(h.slice(0, 200), /canSeeFieldHistory\(actor\)/);
    assert.match(src, /canSeeFieldHistory = \(a: OrgActor\) => canManageFields\(a\)/);
    assert.match(h, /\$\{reachSql\("h\.participant_user_id", units\)\}/);
  });
  it("a field is never deleted; the app only retires it", () => {
    assert.doesNotMatch(src, /DELETE FROM custom_field_def/);
  });
});
