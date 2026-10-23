import { test } from "node:test";
import assert from "node:assert/strict";
import { readProgressData, progressStateLabel, stepForNav, navKeepsDirectAccess, safeProgressHref, progressPrimaryAction, progressionAllowanceDisplay, type ProgressData, type ProgressStep } from "../progression-ui";

function snapshot(): ProgressData {
  const ids = ["foundation", "direction", "tailor", "apply", "interview", "offer"] as const;
  return { contextKey: "owned-work", currentStepId: "direction", nextAction: { label: "Choose a job", href: "/dashboard/jobs?laneId=example" },
    steps: ids.map((id) => ({ id, label: id, href: "/dashboard", state: id === "foundation" ? "completed" : id === "direction" ? "current" : "next", access: "existing" })),
    allowance: { enabled: true, remaining: 30, unit: "AI actions", description: "Existing allowance retained." } };
}

test("next guidance does not relock an existing user's tools", () => {
  const data = readProgressData(snapshot());
  const step = data.steps.find((item) => item.id === "tailor")!;
  assert.equal(step.access, "existing");
  assert.match(progressStateLabel(step), /next/i);
  assert.doesNotMatch(progressStateLabel(step), /locked|completed/i);
});

test("early access is distinct from completed preparation, including the recommended step", () => {
  const step: ProgressStep = { id: "interview", label: "Interview", href: "/dashboard/interview", state: "next", access: "early" };
  assert.match(progressStateLabel(step), /early access/i);
  assert.doesNotMatch(progressStateLabel(step), /completed/i);
  assert.match(progressStateLabel({ ...step, state: "current" }), /recommended now.*early access/i);
  assert.match(progressStateLabel({ ...step, state: "completed", access: "earned" }), /completed/i);
});

test("saved resumes, essential support, privacy and practice keep direct navigation", () => {
  for (const href of ["/dashboard/vault", "/dashboard/interview", "/dashboard/resources", "/dashboard/disclosure", "/dashboard/documents", "/dashboard/settings#data", "/dashboard/help"]) assert.equal(navKeepsDirectAccess(href), true, href);
  assert.equal(navKeepsDirectAccess("/dashboard/application-tailor"), false);
  assert.equal(navKeepsDirectAccess("/dashboard/applications"), false);
  assert.equal(stepForNav(snapshot().steps, "/dashboard/interview")?.id, "interview");
  assert.equal(stepForNav(snapshot().steps, "/dashboard/resources"), null);
});

test("server step states are preserved and incomplete or contradictory response shapes fail visibly", () => {
  const data = snapshot();
  assert.deepEqual(readProgressData(data), data);
  assert.throws(() => readProgressData({ ...data, steps: data.steps.slice(1) }));
  assert.throws(() => readProgressData({ ...data, steps: [...data.steps.slice(0, 5), data.steps[0]] }));
  assert.throws(() => readProgressData({ ...data, steps: data.steps.map((step, index) => index ? step : { ...step, access: "unlimited" }) }));
  assert.throws(() => readProgressData({ ...data, nextAction: null }));
  assert.doesNotThrow(() => readProgressData({ ...data, allowance: { ...data.allowance, remaining: null } }));
});

test("next-action links preserve selected context and reject external navigation", () => {
  const href = "/dashboard/interview?applicationId=owned-application&laneId=owned-lane";
  assert.equal(safeProgressHref(href), href);
  for (const unsafe of ["https://outside.example/path", "//outside.example", "/\\outside.example", "/dashboard\nLocation:outside"]) assert.equal(safeProgressHref(unsafe), "/dashboard");
});

test("a locked career step cannot mask support or an urgent selected interview", () => {
  const data = snapshot();
  data.currentStepId = "interview";
  data.steps = data.steps.map((step) => step.id === "interview" ? { ...step, href: "/dashboard/interview", state: "current", access: "locked" } : step);
  for (const nextAction of [{ label: "Find help near you", href: "/dashboard/resources#support" }, { label: "Prepare for your interview", href: "/dashboard/interview?applicationId=priority-job" }]) {
    const primary = progressPrimaryAction({ ...data, nextAction });
    assert.equal(primary.override, true);
    assert.equal(primary.locked, false);
    assert.equal(primary.heading, nextAction.label);
  }
  assert.equal(progressPrimaryAction({ ...data, nextAction: { label: "Interview", href: "/dashboard/interview" } }).locked, true);
});

test("equivalent selected URLs keep a genuine step lock despite query order", () => {
  const data = snapshot();
  data.currentStepId = "tailor";
  data.steps = data.steps.map((step) => step.id === "tailor" ? { ...step, href: "/dashboard/application-tailor?job=owned-job&id=owned-resume", access: "locked" } : step);
  const primary = progressPrimaryAction({ ...data, nextAction: { label: "Tailor", href: "/dashboard/application-tailor?id=owned-resume&job=owned-job" } });
  assert.equal(primary.override, false);
  assert.equal(primary.locked, true);
});

test("legacy per-tool allowances can request a bonus without a fabricated pooled count", () => {
  const display = progressionAllowanceDisplay({ enabled: true, remaining: null, description: "Existing per-tool allowances continue." });
  assert.equal(display.canAsk, true);
  assert.equal(display.remaining, null);
});

test("budget admission failure retains count and explains that it is not current availability", () => {
  const allowance = { enabled: true, remaining: 6, blockedReason: "The daily spending limit has been reached.", description: "Eight daily actions." };
  const display = progressionAllowanceDisplay(allowance);
  assert.equal(display.remaining, 6);
  assert.match(display.countLabel, /left in today/);
  assert.doesNotMatch(display.countLabel, /available/);
  assert.equal(display.blockedReason, allowance.blockedReason);
  assert.equal(readProgressData({ ...snapshot(), allowance }).allowance.remaining, 6);
  assert.throws(() => readProgressData({ ...snapshot(), allowance: { ...allowance, blockedReason: 3 } }));
});
