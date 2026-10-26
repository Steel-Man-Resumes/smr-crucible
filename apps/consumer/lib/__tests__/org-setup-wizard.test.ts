/**
 * The setup wizard's state (lib/org-setup-wizard.ts), the Structure page's
 * tree helpers (lib/org-structure-view.ts) and useOrgTerms' pure half and
 * loader (lib/use-org-terms.ts). House lane L3a.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ORG_TYPES, resolveOrgTerms, templateFor, DEFAULT_ORG_TERMS } from "@crucible/core/src/orgStructureShared";
import {
  addUnit, chooseType, countUnits, initialWizard, nextStep, prevStep, previewSentence, removeUnit, renameUnit, resetTerms,
  resetUnits, setModule, setTerm, setUnitKind, setupPayload, stepProblems, WIZARD_STEPS,
} from "../org-setup-wizard";
import { buildUnitTree, descendantIds, moveTargets, subtreeHeight, unitCountsLine, unitDepth, unitKindLabel, type UnitLite } from "../org-structure-view";
import { invalidateOrgTerms, loadOrgTerms, orgWords, resetOrgTermsCache } from "../use-org-terms";

describe("setup wizard", () => {
  it("starts on the type step and will not move on without a type", () => {
    const s = initialWizard();
    assert.equal(s.step, "type");
    assert.ok(stepProblems(s).length > 0);
    assert.equal(stepProblems(chooseType(s, "housing")).length, 0);
  });
  it("picking a type fills words, modules and groups from its template", () => {
    const s = chooseType(initialWizard(), "community_supervision");
    assert.equal(s.terms.case_manager, "officer");
    assert.equal(s.modules.sites, true);
    assert.equal(s.units[0].children?.[0].kind, "office");
  });
  it("a new type never overwrites what the admin typed", () => {
    let s = chooseType(initialWizard(), "job_center");
    s = setTerm(s, "case_manager", "coach");
    s = setModule(s, "teams", true);
    s = renameUnit(s, [0], "Walk-in help");
    s = chooseType(s, "education_training");
    assert.equal(s.terms.case_manager, "coach", "typed word kept");
    assert.equal(s.terms.participant, "student", "untouched word follows the type");
    assert.equal(s.modules.teams, true, "switched module kept");
    assert.equal(s.units[0].name, "Walk-in help", "edited groups kept");
    s = resetTerms(s);
    assert.equal(s.terms.case_manager, "advisor", "reset brings back the suggestion");
    s = resetUnits(s);
    assert.equal(s.units[0].name, templateFor("education_training").units[0].name);
  });
  it("a saved profile's words count as chosen", () => {
    const saved = resolveOrgTerms({ participant: "member" });
    const s = chooseType(initialWizard({ orgType: "other", terms: saved }), "job_center");
    assert.equal(s.terms.participant, "member");
  });
  it("edits the tree by path and stops at four levels", () => {
    let s = chooseType(initialWizard(), "other");
    s = addUnit(s, [], { kind: "site", name: "North" });
    s = addUnit(s, [1]);
    s = renameUnit(s, [1, 0], "Evening class");
    s = setUnitKind(s, [1, 0], "cohort");
    assert.equal(s.units[1].children?.[0].name, "Evening class");
    assert.equal(s.units[1].children?.[0].kind, "cohort");
    s = addUnit(s, [1, 0]); s = renameUnit(s, [1, 0, 0], "c");
    s = addUnit(s, [1, 0, 0]); s = renameUnit(s, [1, 0, 0, 0], "d");
    const before = countUnits(s.units);
    assert.equal(countUnits(addUnit(s, [1, 0, 0, 0]).units), before, "no fifth level");
    s = removeUnit(s, [1]);
    assert.equal(countUnits(s.units), 1);
  });
  it("names are required, the label rule holds, and existing groups are left alone", () => {
    let s = chooseType(initialWizard(), "other");
    s = addUnit(s, []);
    assert.ok(stepProblems(s, "groups").length > 0, "a blank group name stops the step");
    assert.ok(stepProblems(setTerm(s, "participant", "Offender"), "words").length > 0);
    const kept = chooseType(initialWizard({ hasExistingUnits: true }), "coalition");
    assert.equal(kept.units.length, 0);
    assert.deepEqual(setupPayload(kept).units, []);
    assert.deepEqual(stepProblems(kept, "groups"), []);
  });
  it("the payload is trimmed and complete", () => {
    let s = chooseType(initialWizard(), "reentry_nonprofit");
    s = renameUnit(s, [0], "  Job readiness  ");
    s = { ...s, displayName: "  " };
    const p = setupPayload(s) as { orgType: string; displayName: null; units: { name: string }[]; terms: object; modules: object };
    assert.equal(p.orgType, "reentry_nonprofit");
    assert.equal(p.displayName, null);
    assert.equal(p.units[0].name, "Job readiness");
    assert.ok(p.terms && p.modules);
  });
  it("steps go forward and back within bounds; the preview uses the words", () => {
    assert.equal(nextStep("finish"), "finish");
    assert.equal(prevStep("type"), "type");
    assert.deepEqual(WIZARD_STEPS.map((x) => nextStep(x)), ["words", "groups", "modules", "finish", "finish"]);
    assert.match(previewSentence(templateFor("corrections_facility").terms), /reentry coordinator for 12 residents/);
    for (const t of ORG_TYPES) assert.ok(!/—/.test(previewSentence(templateFor(t).terms)));
  });
});

describe("structure view helpers", () => {
  const u = (id: string, parent: string | null, kind: UnitLite["kind"] = "program", status: UnitLite["status"] = "active", name = id): UnitLite =>
    ({ id, parent_id: parent, kind, name, status, staff_count: 0, open_enrollments: 0 });
  const units = [u("s", null, "site"), u("x", "s"), u("c", "x", "cohort"), u("d", "c", "team"), u("y", null), u("old", null, "program", "closed")];
  it("builds the tree, hiding closed groups unless asked", () => {
    const t = buildUnitTree(units);
    assert.deepEqual(t.map((n) => n.unit.id), ["s", "y"]);
    assert.equal(t[0].children[0].children[0].children[0].depth, 4);
    assert.equal(buildUnitTree(units, { showClosed: true }).length, 3);
  });
  it("an orphan shows at the top instead of vanishing", () => {
    assert.deepEqual(buildUnitTree([u("a", "missing")]).map((n) => n.unit.id), ["a"]);
  });
  it("depth, height, descendants", () => {
    assert.equal(unitDepth(units, "d"), 4);
    assert.equal(subtreeHeight(units, "s"), 3);
    assert.deepEqual([...descendantIds(units, "x")].sort(), ["c", "d"]);
  });
  it("move targets never include itself, its own groups, closed groups, or a place past four levels", () => {
    assert.deepEqual(moveTargets(units, "x").map((t) => t.id).sort(), ["s", "y"], "x has two levels under it: only top groups fit");
    assert.deepEqual(moveTargets(units, "s").map((t) => t.id), [], "s already uses four levels");
    assert.deepEqual(moveTargets(units, "y").map((t) => t.id).sort(), ["c", "s", "x"]);
  });
  it("counts in the organization's words, and says when they are only what you can see", () => {
    const t = resolveOrgTerms({ participant: "resident", participants: "residents", staff_member: "partner staff" });
    const line = unitCountsLine({ ...u("x", null), staff_count: 2, open_enrollments: 1, capacity: 20 }, t, true);
    assert.equal(line, "2 partner staff · 1 resident you can see · room for 20");
    assert.equal(unitCountsLine({ ...u("s", null, "site"), staff_count: 1 }, DEFAULT_ORG_TERMS, false), "1 staff member", "a site does not count enrollments");
    assert.equal(unitKindLabel("program", resolveOrgTerms({ program: "course" })), "Course");
  });
});

describe("useOrgTerms", () => {
  it("helpers", () => {
    const w = orgWords(resolveOrgTerms({ participant: "student", participants: "students", program: "class" }), true);
    assert.equal(w.cap("participant"), "Student");
    assert.equal(w.plural("participant"), "students");
    assert.equal(w.plural("program"), "classes");
    assert.equal(w.ready, true);
  });
  it("loads once, falls back to defaults on any failure, and can be refreshed", async () => {
    resetOrgTermsCache();
    let calls = 0;
    const ok = (async () => { calls++; return new Response(JSON.stringify({ profile: { terms: { participant: "member", participants: "nope<" } } }), { status: 200 }); }) as typeof fetch;
    const t1 = await loadOrgTerms(ok);
    assert.equal(t1.participant, "member");
    assert.equal(t1.participants, "participants", "a bad stored word falls back to the default");
    assert.equal(await loadOrgTerms(ok), t1, "cached");
    assert.equal(calls, 1, "one request for every caller");
    resetOrgTermsCache();
    const down = (async () => { throw new Error("offline"); }) as typeof fetch;
    assert.equal((await loadOrgTerms(down)).participant, "participant", "a failed request gives the defaults");
    resetOrgTermsCache();
    const forbidden = (async () => new Response("{}", { status: 403 })) as typeof fetch;
    assert.equal((await loadOrgTerms(forbidden)).case_manager, "case manager", "someone in no organization gets the defaults");
    invalidateOrgTerms({ participant: "resident" });
    assert.equal((await loadOrgTerms(down)).participant, "resident", "a saved change shows at once, with no request");
    resetOrgTermsCache();
  });
});
