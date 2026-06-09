/**
 * Journey / unlock engine tests.
 *
 * Guards the exact logic that silently breaks: the next-step ladder (the unlock
 * gates) and the proactive coach opener. Pure functions, no I/O, fast.
 *
 * Run: npm test  (node --import tsx --test, no extra deps)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNextStep } from "../computeNextStep";
import { computeProactiveMessage } from "../coachProactive";
import type { UserProfile, SavedJobSummary } from "../getUserProfile";

/** Minimal profile with sane "fresh authenticated user" defaults; override per test. */
function mkProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  const base = {
    onboardingComplete: true,
    onboardingDeferrals: 0,
    forgeComplete: false,
    savedJobs: [] as SavedJobSummary[],
    hasResumeTailoredToTarget: false,
    hasDisclosurePlan: false,
    interviewSessionCount: 0,
    applicationCount: 0,
    practiceSessionsThisWeek: 0,
    barriers: [] as string[],
  };
  return { ...base, ...overrides } as unknown as UserProfile;
}

function job(overrides: Partial<SavedJobSummary> = {}): SavedJobSummary {
  return {
    id: "job-1",
    jobTitle: "Warehouse Associate",
    company: "Acme",
    status: "saved",
    resumeTailored: false,
    followUpAt: null,
    ...overrides,
  } as unknown as SavedJobSummary;
}

// ─── The unlock ladder (computeNextStep) ──────────────────────────────────────

test("Stage 1: no Forge yet -> build the foundation first", () => {
  const r = computeNextStep(mkProfile({ forgeComplete: false }));
  assert.equal(r.stage, 1);
  assert.equal(r.reason, "forge_incomplete");
  assert.equal(r.href, "/intro");
});

test("Stage 0: Forge done but orientation deferred twice -> orientation becomes mandatory", () => {
  const r = computeNextStep(
    mkProfile({ forgeComplete: true, onboardingComplete: false, onboardingDeferrals: 2 })
  );
  assert.equal(r.stage, 0);
  assert.equal(r.reason, "onboarding_required");
});

test("Stage 2: Forge done, oriented, no saved jobs -> find a first target", () => {
  const r = computeNextStep(mkProfile({ forgeComplete: true, savedJobs: [] }));
  assert.equal(r.stage, 2);
  assert.equal(r.reason, "no_saved_jobs");
});

test("Stage 3: saved a job but no tailored resume -> tailor the resume", () => {
  const r = computeNextStep(
    mkProfile({ forgeComplete: true, savedJobs: [job()], hasResumeTailoredToTarget: false })
  );
  assert.equal(r.stage, 3);
  assert.equal(r.reason, "resume_not_tailored");
  assert.match(r.action, /Warehouse Associate/);
});

test("Stage 4: tailored resume but no disclosure plan -> plan disclosure", () => {
  const r = computeNextStep(
    mkProfile({
      forgeComplete: true,
      savedJobs: [job({ resumeTailored: true })],
      hasResumeTailoredToTarget: true,
      hasDisclosurePlan: false,
    })
  );
  assert.equal(r.stage, 4);
  assert.equal(r.reason, "no_disclosure_plan");
});

test("Stage 5: disclosure done but under 2 practice sessions -> practice", () => {
  const r = computeNextStep(
    mkProfile({
      forgeComplete: true,
      savedJobs: [job({ resumeTailored: true })],
      hasResumeTailoredToTarget: true,
      hasDisclosurePlan: true,
      interviewSessionCount: 1,
    })
  );
  assert.equal(r.stage, 5);
  assert.equal(r.reason, "needs_practice");
});

test("Stage 6: everything done, nothing applied -> apply and track", () => {
  const r = computeNextStep(
    mkProfile({
      forgeComplete: true,
      savedJobs: [job({ resumeTailored: true })],
      hasResumeTailoredToTarget: true,
      hasDisclosurePlan: true,
      interviewSessionCount: 2,
      applicationCount: 0,
    })
  );
  assert.equal(r.stage, 6);
  assert.equal(r.reason, "no_application");
});

// ─── The proactive opener (computeProactiveMessage) ──────────────────────────

test("Opener: no trigger for a brand-new user with no Forge", () => {
  assert.equal(computeProactiveMessage(mkProfile({ forgeComplete: false })), null);
});

test("Opener: Forge built, nothing saved -> points at the job board", () => {
  const m = computeProactiveMessage(mkProfile({ forgeComplete: true, savedJobs: [] }));
  assert.equal(m?.reason, "forge_complete");
});

test("Opener: saved a job, no tailored resume -> nudges tailoring", () => {
  const m = computeProactiveMessage(
    mkProfile({ forgeComplete: true, savedJobs: [job()], hasResumeTailoredToTarget: false })
  );
  assert.equal(m?.reason, "tailor_resume");
});

test("Opener: tailored resume, no disclosure plan -> nudges disclosure", () => {
  const m = computeProactiveMessage(
    mkProfile({
      forgeComplete: true,
      savedJobs: [job({ resumeTailored: true })],
      hasResumeTailoredToTarget: true,
      hasDisclosurePlan: false,
    })
  );
  assert.equal(m?.reason, "disclosure");
});
