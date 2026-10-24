import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resourceEvidenceLabel, employerEvidenceLabel } from "../directory-labels";
import { refineryOpenWithoutResume } from "../lane-task";
const read = (path: string) => readFileSync(path, "utf8");
test("unconfirmed directory records never acquire a checked badge", () => {
 for (const band of ["B", "C", undefined, "unknown"]) {
  const label = resourceEvidenceLabel(band, "2026-10-01", "Source only");
  assert.equal(label.uncertain, true);
  assert.notEqual(label.label, "Steel Man's checked directory");
  assert.match(label.detail, /Call first/);
 }
 assert.match(resourceEvidenceLabel("A", "2026-10-01").detail, /Last checked 2026-10-01/);
 assert.equal(employerEvidenceLabel("B"), "Reported hiring evidence");
});
test("support, practice and private data do not require a resume", () => {
 for (const path of ["resources", "disclosure", "documents", "interview", "vault", "settings"]) {
  if (path !== "settings") assert.equal(refineryOpenWithoutResume(`/dashboard/${path}`, "resume"), true);
 }
 const disclosure = read("app/(dashboard)/dashboard/disclosure/page.tsx");
 assert.match(disclosure, /TierGate requiredTier="client"/);
 assert.doesNotMatch(disclosure, /<OnboardingGate/);
 assert.match(disclosure, /aiConsent/);
});
test("shell context uses authenticated selection and excludes document text", () => {
 const route = read("app/api/workspace-context/route.ts");
 assert.match(route, /effectiveAuth\(\)/);
 assert.match(route, /loadSelectedWork\(userId, selection, false\)/);
 assert.match(route, /private, no-store/);
 assert.doesNotMatch(route, /resumeText:|content_snapshot:/);
});
test("the library explicitly asks for oldest-created resumes, with related outputs optional", () => {
 const page = read("app/(dashboard)/dashboard/vault/page.tsx");
 assert.match(page, /order: "created"/);
 assert.match(page, /showRelated/);
 assert.match(page, /requestSequence/);
 const core = read("../../packages/core/src/refineryArtifact.ts");
 assert.match(core, /created_at ASC, id ASC/);
});
test("tour final action uses the same selected-work policy as the workspace", () => {
 // The tour's writes live in lib/tour/tour-store.ts since the save handler was split out (2026-10-24).
 const route = read("app/api/onboarding/tour/route.ts") + read("lib/tour/tour-store.ts");
 assert.match(route, /loadSelectedWork\(userId, \{\}, false\)/);
 assert.match(route, /workspaceNextAction\(\{ work/);
 assert.match(route, /jsonb_set/);
 assert.match(route, /queryAsUser(?:<[^>]+>)?\(userId/);
 assert.doesNotMatch(route, /recordProgressEvent|INSERT INTO job_application/);
});

test("library selection waits for saved focus and announces successful mutations", () => {
 const page = read("app/(dashboard)/dashboard/vault/page.tsx");
 assert.match(page, /await lanes\.setActive\(c\)\) setLaneFilter\(c\)/);
 assert.match(page, /window\.dispatchEvent\(new Event\("resume-saved"\)\)/);
 const lane = read("components/lanes/useLanes.ts");
 assert.match(lane, /setSwitching\(false\); return false/);
 assert.match(lane, /return true/);
});
