/**
 * Phase 5 R4.5 (Codex review A6): deadlines before lessons. A due follow-up
 * or an interview coming up beats the tour, the Forge, tailoring, the
 * disclosure step and practice. Disclosure is optional ("I don't need this
 * now"). The progress arc and the saved stage still show the ladder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeLadderStep,
  computeNextStep,
  deadlineStep,
  deterministicWhy,
  disclosureSnoozed,
  DISCLOSURE_NOT_NOW_DAYS,
} from "../computeNextStep";
import { readDisclosureNotNow, type SavedJobSummary, type UserProfile } from "../getUserProfile";
import { arcStageForNextStep, isDeadlineStep, whyForNextStep } from "../journeyStages";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function mkProfile(o: Partial<UserProfile> = {}): UserProfile {
  return {
    onboardingComplete: true,
    onboardingDeferrals: 0,
    forgeComplete: true,
    savedJobs: [] as SavedJobSummary[],
    hasResumeTailoredToTarget: false,
    hasDisclosurePlan: false,
    disclosureNotNowAt: null,
    interviewSessionCount: 0,
    applicationCount: 0,
    practiceSessionsThisWeek: 0,
    barriers: [] as string[],
    ...o,
  } as unknown as UserProfile;
}

function job(o: Partial<SavedJobSummary> = {}): SavedJobSummary {
  return { id: "j1", jobTitle: "Line Cook", company: "Sample Diner", status: "applied", resumeTailored: true, followUpAt: null, ...o };
}

test("a due follow-up beats the disclosure step (the Codex reproduction)", () => {
  const p = mkProfile({
    savedJobs: [job({ followUpAt: new Date(NOW - DAY).toISOString() })],
    hasResumeTailoredToTarget: true,
    hasDisclosurePlan: false,
    applicationCount: 1,
  });
  assert.equal(computeLadderStep(p, NOW).reason, "no_disclosure_plan", "the ladder alone would pick disclosure");
  const r = computeNextStep(p, NOW);
  assert.equal(r.reason, "follow_up_due");
  assert.equal(r.href, "/dashboard/applications");
  assert.equal(r.progressStage, 4, "the ladder's place is kept underneath");
  assert.equal(r.progressReason, "no_disclosure_plan");
});

test("an interview coming up beats every lesson, the mandatory tour and the Forge included", () => {
  const interviewing = [job({ status: "interviewing" })];
  for (const p of [
    mkProfile({ savedJobs: interviewing, hasResumeTailoredToTarget: true }), // disclosure next
    mkProfile({ savedJobs: interviewing, hasResumeTailoredToTarget: false }), // tailoring next
    mkProfile({ savedJobs: interviewing, forgeComplete: false }), // Forge next
    mkProfile({ savedJobs: interviewing, onboardingComplete: false, onboardingDeferrals: 2 }), // mandatory tour
    mkProfile({ savedJobs: interviewing, hasResumeTailoredToTarget: true, hasDisclosurePlan: true }), // practice next
  ]) {
    const r = computeNextStep(p, NOW);
    assert.equal(r.reason, "interview_upcoming");
    assert.equal(r.stage, 5);
    assert.equal(r.action, "Get ready for your interview at Sample Diner");
    const link = new URL(r.href, "https://example.test");
    assert.equal(link.pathname, "/dashboard/interview");
    assert.equal(link.searchParams.get("applicationId"), interviewing[0].id);
    assert.equal(link.searchParams.get("role"), "Line Cook");
    assert.equal(link.searchParams.get("company"), "Sample Diner");
  }
});

test("the interview comes before a due follow-up", () => {
  const p = mkProfile({
    savedJobs: [job({ id: "a", followUpAt: new Date(NOW - DAY).toISOString() }), job({ id: "b", status: "interviewing", company: "Sample Hotel" })],
  });
  assert.equal(computeNextStep(p, NOW).reason, "interview_upcoming");
});

test("a follow-up in the future is not due", () => {
  const p = mkProfile({ savedJobs: [job({ followUpAt: new Date(NOW + DAY).toISOString() })], hasResumeTailoredToTarget: true });
  assert.equal(deadlineStep(p, NOW), null);
  assert.equal(computeNextStep(p, NOW).reason, "no_disclosure_plan");
});

test("no company: plain words, no broken query", () => {
  const r = deadlineStep(mkProfile({ savedJobs: [job({ status: "interviewing", company: "", jobTitle: "" })] }), NOW)!;
  assert.equal(r.action, "Get ready for your interview");
  assert.equal(r.href, "/dashboard/interview?applicationId=j1");
});

test("disclosure is optional: 'I don't need this now' skips it for 30 days, then it may come back", () => {
  const base = { savedJobs: [job()], hasResumeTailoredToTarget: true, hasDisclosurePlan: false, applicationCount: 1 };
  const snoozed = mkProfile({ ...base, disclosureNotNowAt: new Date(NOW - DAY).toISOString() });
  assert.equal(DISCLOSURE_NOT_NOW_DAYS, 30);
  assert.equal(disclosureSnoozed(snoozed, NOW), true);
  assert.equal(computeNextStep(snoozed, NOW).reason, "needs_practice", "goes straight to practice");
  const old = mkProfile({ ...base, disclosureNotNowAt: new Date(NOW - 31 * DAY).toISOString() });
  assert.equal(computeNextStep(old, NOW).reason, "no_disclosure_plan");
  const junk = mkProfile({ ...base, disclosureNotNowAt: "not a date" });
  assert.equal(disclosureSnoozed(junk, NOW), false);
});

test("the not-now stamp is read from profile_data.journey, only when it is a date", () => {
  assert.equal(readDisclosureNotNow({ journey: { disclosure_not_now_at: "2026-10-01T00:00:00Z" } }), "2026-10-01T00:00:00Z");
  assert.equal(readDisclosureNotNow({ journey: { disclosure_not_now_at: "soon" } }), null);
  assert.equal(readDisclosureNotNow({ journey: "x" }), null);
  assert.equal(readDisclosureNotNow(null), null);
});

test("the progress arc shows the ladder under a deadline, and the card has its own words", () => {
  const p = mkProfile({ savedJobs: [job({ status: "interviewing" })], hasResumeTailoredToTarget: false });
  const r = computeNextStep(p, NOW);
  assert.equal(isDeadlineStep(r), true);
  assert.equal(arcStageForNextStep(r), 3, "tailoring is still the ladder step");
  assert.match(whyForNextStep(r), /interview coming up/);
  assert.equal(deterministicWhy(r).why, whyForNextStep(r));
  // A cached step from before this change (no progressStage) keeps its old arc.
  assert.equal(arcStageForNextStep({ stage: 6, reason: "follow_up_due" }), 7);
});

test("the saved stage is the ladder's, never the deadline's", () => {
  const src = readFileSync(join(__dirname, "..", "computeNextStep.ts"), "utf8");
  assert.match(src, /\[userId, JSON\.stringify\(next\), next\.progressStage \?\? next\.stage\]/);
});
