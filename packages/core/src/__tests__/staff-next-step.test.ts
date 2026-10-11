/**
 * Phase 5 review M3: program staff never see an employer name or a role
 * through progress sharing alone. The person's own next step can say
 * "Get ready for your interview at Sample Diner"; the staff reads (the client
 * page header and the caseload/cohort table) select only the step's reason and
 * stage from users.next_step_cache and show a fixed label.
 *
 * The "staff reader" below has progress scope and no applications scope: it
 * gets exactly the keys the two staff queries select, from the cache exactly
 * as getNextStep stores it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeNextStep } from "../computeNextStep";
import { STAFF_STEP_LABELS, staffStepLabel } from "../journeyStages";
import type { SavedJobSummary, UserProfile } from "../getUserProfile";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const SRC = join(__dirname, "..");
const STAFF_FILES = ["orgClientView.ts", "partnerDashboard.ts"];

function person(o: Partial<UserProfile>): UserProfile {
  return {
    onboardingComplete: true, onboardingDeferrals: 0, forgeComplete: true, savedJobs: [] as SavedJobSummary[],
    hasResumeTailoredToTarget: false, hasDisclosurePlan: false, disclosureNotNowAt: null,
    interviewSessionCount: 0, applicationCount: 0, practiceSessionsThisWeek: 0, barriers: [] as string[], ...o,
  } as unknown as UserProfile;
}
const job = (o: Partial<SavedJobSummary> = {}): SavedJobSummary => ({
  id: "j1", jobTitle: "Line Cook", company: "Sample Diner", status: "applied", resumeTailored: false, followUpAt: null, ...o,
});

/** The keys of next_step_cache that a staff query selects. */
function staffSelectedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const f of STAFF_FILES) {
    const src = readFileSync(join(SRC, f), "utf8");
    for (const m of src.matchAll(/next_step_cache\s*->>?\s*'([a-zA-Z_]+)'/g)) keys.add(m[1]);
    assert.doesNotMatch(src, /next_step_cache(?![a-z_])(?!\s*->>\s*'(reason|stage)')/, `${f} reads next_step_cache some other way`);
  }
  return keys;
}

/** What a staff reader with progress scope (no applications scope) is handed. */
function staffReaderView(cacheJson: string) {
  const cache = JSON.parse(cacheJson) as Record<string, unknown>;
  const row: Record<string, unknown> = {};
  for (const k of staffSelectedKeys()) row[`next_step_${k}`] = cache[k] == null ? null : String(cache[k]);
  return { row, nextStepAction: staffStepLabel(row.next_step_reason as string, row.next_step_stage as string) };
}

test("the staff queries select only reason and stage from the cached step", () => {
  assert.deepEqual([...staffSelectedKeys()].sort(), ["reason", "stage"]);
  for (const f of STAFF_FILES) {
    const src = readFileSync(join(SRC, f), "utf8");
    assert.match(src, /nextStepAction: staffStepLabel\(/, f);
    assert.doesNotMatch(src, /->>'action'|->>'href'/, f);
  }
});

test("an interview, a due follow-up and a tailoring step: staff never see the employer or the role", () => {
  const cases = [
    person({ savedJobs: [job({ status: "interviewing" })] }),
    person({ savedJobs: [job({ followUpAt: new Date(NOW - 86400000).toISOString() })], applicationCount: 1 }),
    person({ savedJobs: [job()] }),
  ];
  for (const p of cases) {
    const own = computeNextStep(p, NOW);
    const stored = JSON.stringify(own); // what getNextStep writes to users.next_step_cache
    assert.ok(/Sample Diner|Line Cook/.test(own.action + own.href), "the person's own step names the job");
    const staff = staffReaderView(stored);
    const seen = JSON.stringify(staff);
    assert.ok(!seen.includes("Sample Diner"), seen);
    assert.ok(!seen.includes("Line Cook"), seen);
    assert.ok(staff.nextStepAction && staff.nextStepAction.length > 0);
  }
});

test("every reason the ladder can return has a fixed staff label", () => {
  const src = readFileSync(join(SRC, "computeNextStep.ts"), "utf8");
  const reasons = new Set([...src.matchAll(/reason: "([a-z_]+)"/g)].map((m) => m[1]));
  assert.ok(reasons.size >= 10);
  for (const r of reasons) assert.ok(STAFF_STEP_LABELS[r], `no staff label for ${r}`);
  assert.equal(staffStepLabel("interview_upcoming", 5), "Get ready for an interview");
  assert.equal(staffStepLabel(null, "4"), "Plan what to say");
  assert.equal(staffStepLabel(null, null), null);
});
