/**
 * Public profile summary for steelmanresumes.com personalization.
 *
 * Reads the authjs.session-token cookie (shared across .steelmanresumes.com).
 * Returns a safe, non-sensitive profile snapshot -- no resume text, no criminal
 * record details, no location. Just what the marketing site needs to personalize
 * guides and homepage sections.
 *
 * Called client-side from smr-website pages.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { loadForgeProfile } from "@crucible/core";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ authenticated: false });
  }

  const profile = await loadForgeProfile(session.user.id);

  if (!profile?.forgeOutput) {
    return NextResponse.json({ authenticated: true, profile: null });
  }

  const output = profile.forgeOutput as Record<string, unknown>;

  const careerPaths = (output.career_paths as Array<Record<string, unknown>> | undefined) ?? [];
  const skills = (output.skills as Array<{ name: string } | string> | undefined) ?? [];
  const narrative = output.narrative as Record<string, unknown> | undefined;

  return NextResponse.json(
    {
      authenticated: true,
      profile: {
        headline: (narrative?.headline as string) ?? null,
        readinessStage: profile.readinessStage ?? null,
        goals: profile.goals ?? [],
        challenges: profile.challenges ?? [],
        workType: (profile.preferences as Record<string, string> | undefined)?.work_type ?? null,
        skills: skills.map((s) => (typeof s === "string" ? s : s.name)),
        careerPaths: careerPaths.map((p) => ({
          title: p.title as string,
          industry: p.industry as string,
        })),
        topCareerPath: careerPaths[0]
          ? (careerPaths[0].title as string)
          : null,
      },
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "https://www.steelmanresumes.com",
        "Access-Control-Allow-Credentials": "true",
        "Cache-Control": "private, no-store",
      },
    }
  );
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "https://www.steelmanresumes.com",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Credentials": "true",
    },
  });
}
