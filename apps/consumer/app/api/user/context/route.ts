/**
 * GET /api/user/context
 *
 * Assembles the user's full journey into a single authenticated snapshot.
 * Consumed by the AssistantChat to give t.ROY god-like awareness of the
 * user's state -- what they've built, what they haven't done, what's next.
 *
 * Cached at the edge for 30s to avoid hammering the DB on every chat open.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserProfile, getOne, query } from "@crucible/core";

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
  const cp = await getOne<{
    forge_output: Record<string, any> | null;
    profile_data: Record<string, any> | null;
  }>(
    `SELECT forge_output, profile_data FROM consumer_profile WHERE user_id = $1`,
    [userId]
  );
  const fo = cp?.forge_output ?? null;

  // Last 5 resumes
  const resumeRows = await query<{
    id: string;
    target_context: Record<string, any>;
    content: Record<string, any>;
    created_at: string;
  }>(
    `SELECT id, target_context, content, created_at
     FROM refinery_artifact
     WHERE user_id = $1 AND artifact_type = 'resume'
     ORDER BY created_at DESC LIMIT 5`,
    [userId]
  );

  // Most recent disclosure plan
  const disclosureRow = await getOne<{
    target_context: Record<string, any>;
    content: Record<string, any>;
    created_at: string;
  }>(
    `SELECT target_context, content, created_at
     FROM refinery_artifact
     WHERE user_id = $1 AND artifact_type = 'disclosure_plan'
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

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
    disclosurePlan: disclosureRow
      ? {
          exists: true,
          targetJob: disclosureRow.target_context?.targetJob ?? null,
          scriptExcerpt:
            typeof disclosureRow.content?.script === "string"
              ? (disclosureRow.content.script as string).slice(0, 500)
              : null,
          timingAdvice: disclosureRow.content?.timing_advice ?? null,
          completedAt: disclosureRow.created_at,
        }
      : { exists: false },
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
  });
}
