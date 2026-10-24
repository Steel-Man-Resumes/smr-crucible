/**
 * GET /api/user/context
 *
 * Assembles the user's full journey into a single authenticated snapshot.
 * Consumed by the AssistantChat to give t.ROY god-like awareness of the
 * user's state -- what they've built, what they haven't done, what's next.
 *
 * Private account-bound snapshot; never cached.
 */

import { readJobFit } from "@/lib/job-fit";
import { disclosurePlanContext, LATEST_DISCLOSURE_PLAN_SQL, LATEST_DISCLOSURE_SCRIPT_SQL, type DisclosureRow } from "@/lib/disclosure-context";
import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { getUserProfile, queryAsUser, getOneAsUser, RECENT_RESUMES_FOR_CONTEXT_SQL } from "@crucible/core";

export const revalidate = 0; // always fresh -- context freshness matters

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Base profile: identity + forge flags + jobs + location (single function)
  const profile = await getUserProfile(userId);
  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Full forge output for rich narrative, strengths, career paths
  const cp = await getOneAsUser<{
    preferences: Record<string, unknown> | null;
    forge_output: Record<string, any> | null;
    profile_data: Record<string, any> | null;
  }>(userId, 
    `SELECT forge_output, profile_data, preferences FROM consumer_profile WHERE user_id = $1`,
    [userId]
  );
  const fo = cp?.forge_output ?? null;

  // Last 5 resumes
  const resumeRows = await queryAsUser<{
    id: string;
    target_context: Record<string, any>;
    content: Record<string, any>;
    created_at: string;
  }>(userId, 
    RECENT_RESUMES_FOR_CONTEXT_SQL,
    [userId]
  );

  // The disclosure plan: newest record conversation plan, with the script
  // from the newest one that holds one (lib/disclosure-context.ts). A hurdle
  // plan without the record hurdle is a hurdle_plan and never read here.
  const [disclosureRow, disclosureScriptRow] = await Promise.all([
    getOneAsUser<DisclosureRow>(userId, LATEST_DISCLOSURE_PLAN_SQL, [userId]),
    getOneAsUser<DisclosureRow>(userId, LATEST_DISCLOSURE_SCRIPT_SQL, [userId]),
  ]);

  // Onboarding state (mirrors useOnboarding logic)
  const hasProfile = !!(profile.name?.trim());
  const hasJobResume = resumeRows.some(
    (r) => r.target_context?.createdFrom === "job" || r.content?.meta?.createdFrom === "job"
  );
  const onboardingState = !hasProfile
    ? "needs_profile"
    : !hasJobResume
    ? "needs_resume"
    : "full_access";

  return NextResponse.json({
    accountId: userId,
    sessionAccountId: session.impersonation?.adminId ?? userId,
    workPreferences: readJobFit(cp?.preferences?.jobFit),
    profile: {
      name: profile.name,
      email: profile.email,
      city: profile.city,
      state: profile.state,
      tier: profile.tier,
    },
    forge: fo
      ? {
          headline: fo.headline ?? null,
          summary: fo.narrative?.summary ?? fo.summary ?? null,
          strengths: fo.narrative?.strengths ?? fo.strengths ?? [],
          skills: fo.skills ?? [],
          careerPaths: fo.career_paths ?? fo.careerPaths ?? [],
          readinessStage: profile.readinessStage,
          hasCriminalRecord: profile.barriers.includes("criminal_record"),
          barriers: profile.barriers.filter((b) => b !== "criminal_record"),
          goals: (cp?.profile_data as any)?.goals ?? [],
          goalNarrative: (cp?.profile_data as any)?.goalNarrative ?? null,
        }
      : null,
    resumes: resumeRows.map((r) => ({
      id: r.id,
      targetJob:
        r.target_context?.targetJob ??
        r.content?.meta?.targetJob ??
        null,
      targetCompany:
        r.target_context?.targetCompany ??
        r.content?.meta?.targetCompany ??
        null,
      createdFrom:
        r.target_context?.createdFrom ??
        r.content?.meta?.createdFrom ??
        null,
      summary: r.content?.summary ?? null,
      createdAt: r.created_at,
    })),
    disclosurePlan: disclosurePlanContext(disclosureRow, disclosureScriptRow),
    applications: profile.savedJobs.slice(0, 10).map((j) => ({
      id: j.id,
      company: j.company,
      role: j.jobTitle,
      status: j.status,
      resumeTailored: j.resumeTailored,
      followUpAt: j.followUpAt,
    })),
    journey: {
      onboardingState,
      disclosureComplete: profile.hasDisclosurePlan,
      forgeComplete: profile.forgeComplete,
      interviewSessionCount: profile.interviewSessionCount,
      applicationCount: profile.applicationCount,
      hasResumeTailoredToTarget: profile.hasResumeTailoredToTarget,
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
