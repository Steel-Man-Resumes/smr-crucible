/**
 * Enrollments: a participant in a program, cohort or caseload (migration 103,
 * house lane L3a).
 *
 *   GET  ?participant=&unit=&open=1 -> { enrollments, canEnroll }   org.cohort.view, rows the viewer reaches
 *   POST { action: create | status | details, ... }                 org.enrollment.write
 *
 * The database refuses an enrollment for someone the writer does not already
 * reach (RESTRICTIVE reach policy), so nobody widens their own reach by
 * enrolling a stranger. Logic and tests: lib/org-structure-http.ts.
 */
import { requireOrgCapability } from "@/lib/org-guard";
import { listEnrollments, createEnrollment, changeEnrollmentStatus, updateEnrollmentDetails } from "@crucible/core";
import { handleEnrollmentsGet, handleEnrollmentsPost } from "@/lib/org-structure-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view");
  if (!guard.ok) return guard.response;
  return handleEnrollmentsGet(new URL(request.url), guard.actor, { listEnrollments });
}

export async function POST(request: Request) {
  const guard = await requireOrgCapability("org.enrollment.write");
  if (!guard.ok) return guard.response;
  return handleEnrollmentsPost(request, guard.actor, { createEnrollment, changeEnrollmentStatus, updateEnrollmentDetails });
}
