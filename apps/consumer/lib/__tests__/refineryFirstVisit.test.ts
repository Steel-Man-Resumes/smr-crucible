/**
 * Refinery first visit: plain step names, one progress vocabulary, locked-tool
 * lines, and a tour that teaches only tools that exist.
 * Run: npm test  (node --import tsx --test)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  JOURNEY_STAGES,
  JOURNEY_STEP_COUNT,
  STAGE_WHY,
  FORGE_VS_REFINERY_LINE,
  lockedToolLine,
  stepPositionLabel,
  whyForNextStep,
  arcStageForNextStep,
  clientToolUnlocked,
} from "@crucible/core/src/journeyStages";
import { computeNextStep } from "@crucible/core/src/computeNextStep";
import type { UserProfile } from "@crucible/core/src/getUserProfile";
import {
  TOUR_TOOLS,
  TOUR_SETTINGS_PICKS,
  TOUR_NOT_BUILT_YET,
} from "../guidedTour";

const ROOT = join(import.meta.dirname, "..", "..");
const DASH = join(ROOT, "app", "(dashboard)", "dashboard");

const OLD_JARGON = ["Foundation", "Target", "Materials", "Approach", "Orientation"];
const DASHES = /[–—]|--/;

test("step names are plain words, not the old jargon", () => {
  const arc = JOURNEY_STAGES.filter((s) => s.stage >= 1);
  assert.equal(arc.length, JOURNEY_STEP_COUNT);
  for (const s of arc) {
    for (const word of OLD_JARGON) {
      assert.ok(!s.short.includes(word), `short label "${s.short}" still uses "${word}"`);
      assert.ok(!s.nextStepLabel.includes(word), `next-step label "${s.nextStepLabel}" still uses "${word}"`);
    }
  }
  assert.deepEqual(
    arc.map((s) => s.short),
    ["Your resume", "Pick a job to aim at", "Tailor it", "Plan what to say", "Practice the interview", "Apply"]
  );
});

test("every step label, why line and lock line has no em dash, en dash or double hyphen", () => {
  const texts: string[] = [FORGE_VS_REFINERY_LINE, TOUR_NOT_BUILT_YET];
  for (const s of JOURNEY_STAGES) texts.push(s.short, s.nextStepLabel);
  for (const w of Object.values(STAGE_WHY)) texts.push(w);
  for (const state of ["needs_profile", "needs_resume", "full_access"]) {
    texts.push(lockedToolLine({ state }), lockedToolLine({ state, requiresDisclosure: true }));
  }
  for (const t of TOUR_TOOLS) texts.push(t.name, t.line);
  for (const t of TOUR_SETTINGS_PICKS) texts.push(t.name, t.line);
  for (const t of texts) assert.ok(!DASHES.test(t), `dash in: ${t}`);
});

test("the next-step engine uses the same plain words (no 'foundation' or 'orientation' actions)", () => {
  const base = {
    forgeComplete: false,
    onboardingComplete: false,
    onboardingDeferrals: 2,
    savedJobs: [],
  } as unknown as UserProfile;
  const actions = [
    computeNextStep(base).action,
    computeNextStep({ ...base, onboardingDeferrals: 0 }).action,
    computeNextStep({ ...base, forgeComplete: true, onboardingComplete: true }).action,
    computeNextStep({ ...base, forgeComplete: false, onboardingDeferrals: 0 }).action,
  ];
  for (const a of actions) {
    assert.ok(!/foundation|orientation|target job/i.test(a), `jargon in action: ${a}`);
  }
});

test("every stage has a plain reason, and reason codes that reuse a stage get their own", () => {
  for (let st = 0; st <= 6; st++) assert.ok(STAGE_WHY[st]?.length > 10, `no why for stage ${st}`);
  assert.equal(whyForNextStep({ stage: 3, reason: "resume_not_tailored" }), STAGE_WHY[3]);
  assert.notEqual(whyForNextStep({ stage: 2, reason: "default_matches" }), STAGE_WHY[2]);
  assert.notEqual(whyForNextStep({ stage: 6, reason: "follow_up_due" }), STAGE_WHY[6]);
});

test("position label: step N of 6, 'Start here' for the tour, 'Keep going' past the arc", () => {
  assert.equal(stepPositionLabel(2), "Step 2 of 6");
  assert.equal(stepPositionLabel(6), "Step 6 of 6");
  assert.equal(stepPositionLabel(0), "Start here");
  assert.equal(stepPositionLabel(7), "Keep going");
  // RD3 stays fixed: the tour step is stage 0, and after the Forge the arc points at step 2.
  assert.equal(arcStageForNextStep({ stage: 0, reason: "onboarding_pending" }), 2);
});

test("locked-tool line says what opens it, for each state", () => {
  assert.match(lockedToolLine({ state: "needs_profile" }), /profile/i);
  assert.match(lockedToolLine({ state: "needs_resume" }), /tailor a resume/i);
  assert.match(lockedToolLine({ state: "full_access", requiresDisclosure: true, disclosureComplete: false }), /plan what to say/i);
  // Never an empty or misleading line.
  assert.ok(lockedToolLine({ state: "full_access", requiresDisclosure: true, disclosureComplete: true }).length > 0);
});

test("the tour teaches only tools whose pages exist", () => {
  for (const t of TOUR_TOOLS) {
    assert.ok(
      existsSync(join(DASH, t.segment, "page.tsx")),
      `tour names "${t.name}" but /dashboard/${t.segment} has no page`
    );
  }
  assert.ok(TOUR_TOOLS.length >= 6);
});

test("the tour does not give planned tools a row of their own", () => {
  const planned = /one[- ]click|employer map|resources? map/i;
  for (const t of TOUR_TOOLS) assert.ok(!planned.test(t.name + " " + t.line), `planned tool taught as real: ${t.name}`);
  assert.match(TOUR_NOT_BUILT_YET, /not built yet/i);
});

test("the Settings picks are real: each named feature is in the source", () => {
  assert.ok(TOUR_SETTINGS_PICKS.length >= 2 && TOUR_SETTINGS_PICKS.length <= 3);
  for (const p of TOUR_SETTINGS_PICKS) {
    const src = readFileSync(join(ROOT, p.proofFile), "utf8");
    assert.ok(src.includes(p.proofText), `${p.name}: "${p.proofText}" not found in ${p.proofFile}`);
  }
  // And the Settings page actually mounts those sections.
  const settings = readFileSync(join(DASH, "settings", "page.tsx"), "utf8");
  for (const comp of ["CoachSettingsSection", "DecisionLogViewer", "SharingConsentSection"]) {
    assert.ok(settings.includes(`<${comp}`), `Settings page does not render ${comp}`);
  }
});

test("a person who finished every step sees all steps done, not 'Step 2 of 6'", () => {
  // The engine reuses stage 2 and stage 6 for the "all done" states.
  assert.equal(arcStageForNextStep({ stage: 2, reason: "default_matches" }), 7);
  assert.equal(arcStageForNextStep({ stage: 6, reason: "follow_up_due" }), 7);
  assert.equal(stepPositionLabel(arcStageForNextStep({ stage: 2, reason: "default_matches" })), "Keep going");
  // Real step 2 and real step 6 are untouched.
  assert.equal(arcStageForNextStep({ stage: 2, reason: "no_saved_jobs" }), 2);
  assert.equal(arcStageForNextStep({ stage: 6, reason: "no_application" }), 6);
});

test("sidebar and dashboard cards share one gate: Interview needs the disclosure plan", () => {
  const interview = { minState: "full_access", requiresDisclosure: true };
  assert.equal(clientToolUnlocked({ state: "full_access", ...interview, disclosureComplete: false }), false);
  assert.equal(clientToolUnlocked({ state: "full_access", ...interview, disclosureComplete: true }), true);
  assert.equal(clientToolUnlocked({ state: "needs_resume", ...interview, disclosureComplete: true }), false);
  assert.equal(clientToolUnlocked({ state: "needs_resume", minState: "needs_resume" }), true);
  assert.equal(clientToolUnlocked({ state: "needs_profile", minState: "needs_resume" }), false);
  // Both displays call this function (no private copy of the rule).
  const shell = readFileSync(join(ROOT, "app", "(dashboard)", "RefineryShell.tsx"), "utf8");
  const dash = readFileSync(join(DASH, "page.tsx"), "utf8");
  assert.ok(shell.includes("clientToolUnlocked(") && dash.includes("clientToolUnlocked("));
});

test("Settings headings state what it does, with no comparison to other apps", () => {
  const dash = readFileSync(join(DASH, "page.tsx"), "utf8");
  const tour = readFileSync(join(ROOT, "components", "GuidedTour.tsx"), "utf8");
  for (const src of [dash, tour]) assert.ok(!/other apps|than most apps/i.test(src));
});
