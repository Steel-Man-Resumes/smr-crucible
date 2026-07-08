"use client";

/**
 * Dashboard — Overview
 *
 * Audience-aware: client / partner / observer / admin each see a different entry experience.
 *
 * Client states:
 * 1. needs_profile → Profile setup form
 * 2. needs_resume  → Job Board + Application Tailor only, locked cards for rest
 * 3. full_access   → Everything unlocked
 *
 * Partner: methodology review mode — bypass Forge gate, show tool landscape + deep links.
 * Observer: evidence mode — research citations, tool explainers, methodology/evidence pages.
 * Admin: god mode (everything unlocked, all states skipped).
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useUserTier } from "@/lib/useUserTier";
import { useOnboarding, type OnboardingState, type UserContact } from "@/lib/useOnboarding";
import { JourneyHeader } from "@/components/JourneyHeader";
import { TBtn } from "@crucible/consumer-ui";

// ─── Tool definitions ──────────────────────────────────────────────────────

interface ToolCard {
  href: string;
  title: string;
  description: string;
  color: string;
  accent: string;
  /** Minimum onboarding state to unlock */
  minState: OnboardingState;
}

const ALL_TOOLS: ToolCard[] = [
  {
    href: "/dashboard/jobs",
    title: "Job Board",
    description: "Find real job listings from fair-chance employers hiring now.",
    color: "bg-t-panel border-t-phos",
    accent: "text-t-phos",
    minState: "needs_resume",
  },
  {
    href: "/dashboard/application-tailor",
    title: "Application Tailor",
    description: "Tailor your resume to a specific job -- with a matching cover letter and disclosure brief.",
    color: "bg-t-panel border-t-steel",
    accent: "text-t-steel",
    minState: "needs_resume",
  },
  {
    href: "/dashboard/disclosure",
    title: "Disclosure Planner",
    description: "Plan when and how to talk about your record with employers.",
    color: "bg-t-panel border-t-amber",
    accent: "text-t-amber-bright",
    minState: "full_access",
  },
  {
    href: "/dashboard/interview",
    title: "Interview Practice",
    description: "Text or live voice mock interviews tailored to your target role.",
    color: "bg-t-panel border-t-steel",
    accent: "text-t-steel",
    minState: "full_access",
  },
  {
    href: "/dashboard/resources",
    title: "Fair-Chance Lanes",
    description: "Find realistic fair-chance job lanes and live search paths.",
    color: "bg-t-panel border-t-amber",
    accent: "text-t-amber-bright",
    minState: "full_access",
  },
  {
    href: "/dashboard/applications",
    title: "Applications",
    description: "Track your job applications from saved to offered.",
    color: "bg-t-panel border-t-phos",
    accent: "text-t-phos",
    minState: "full_access",
  },
  {
    href: "/dashboard/progress",
    title: "Progress",
    description: "See how far you've come.",
    color: "bg-t-panel border-t-phos",
    accent: "text-t-phos",
    minState: "full_access",
  },
];

const STATE_RANK: Record<string, number> = {
  full_access: 0,
  needs_resume: 1,
  needs_profile: 2,
  loading: 3,
};

function isToolUnlocked(tool: ToolCard, state: OnboardingState, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return (STATE_RANK[state] ?? 3) <= (STATE_RANK[tool.minState] ?? 3);
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface DashboardData {
  narrative?: { headline?: string; summary?: string };
  strengths?: Array<{ title: string; evidence: string }>;
  skills?: Array<{ name: string; category: string }>;
  career_paths?: Array<{
    title: string;
    salary_range?: string;
    match_reason: string;
  }>;
}

const TYPE_LABELS: Record<string, string> = {
  resume: "resumes",
  cover_letter: "cover letters",
  disclosure_plan: "disclosure plans",
  interview_prep: "interview sessions",
};

const TYPE_TOOL_HREF: Record<string, string> = {
  resume: "/dashboard/application-tailor",
  disclosure_plan: "/dashboard/disclosure",
  interview_prep: "/dashboard/interview",
  job_match: "/dashboard/jobs",
  resource_list: "/dashboard/resources",
};

interface ArtifactSummary {
  id: string;
  artifact_type: string;
  target_context: { targetJob?: string; targetCompany?: string };
  updated_at: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const tier = useUserTier();
  const isAdmin = tier === "admin";
  const onboarding = useOnboarding();

  // Forge data
  const [forgeData, setForgeData] = useState<DashboardData>({});
  const [artifactCounts, setArtifactCounts] = useState<Record<string, number>>({});
  const [recentArtifacts, setRecentArtifacts] = useState<ArtifactSummary[]>([]);

  // Load Forge output
  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      try {
        const res = await fetch("/api/forge/load");
        if (res.ok) {
          const { data: profile } = await res.json();
          if (!cancelled && profile?.forgeOutput) {
            setForgeData(profile.forgeOutput);
            return;
          }
        }
      } catch {}
      try {
        const stored = localStorage.getItem("forge_session");
        if (stored) {
          const session = JSON.parse(stored);
          if (!cancelled && session.forgeOutput) setForgeData(session.forgeOutput);
        }
      } catch {}
    }
    loadData();
    return () => { cancelled = true; };
  }, []);

  // Load artifact counts
  useEffect(() => {
    async function loadArtifacts() {
      try {
        const [countsRes, recentRes] = await Promise.all([
          fetch("/api/artifacts/counts"),
          fetch("/api/artifacts?limit=5"),
        ]);
        if (countsRes.ok) {
          const { data } = await countsRes.json();
          setArtifactCounts(data || {});
        }
        if (recentRes.ok) {
          const { data } = await recentRes.json();
          setRecentArtifacts(data || []);
        }
      } catch {}
    }
    loadArtifacts();
  }, []);

  const [deletingArtifact, setDeletingArtifact] = useState<string | null>(null);

  async function deleteArtifact(id: string) {
    setDeletingArtifact(id);
    try {
      const res = await fetch(`/api/artifacts/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRecentArtifacts((prev) => prev.filter((a) => a.id !== id));
        // Refresh counts
        const countsRes = await fetch("/api/artifacts/counts");
        if (countsRes.ok) {
          const { data } = await countsRes.json();
          setArtifactCounts(data || {});
        }
        onboarding.refresh();
      }
    } catch {} finally {
      setDeletingArtifact(null);
    }
  }

  const hasForgeData = !!(forgeData.narrative || forgeData.skills?.length);
  const totalArtifacts = Object.values(artifactCounts).reduce((a, b) => a + b, 0);

  // ─── State: Loading ───────────────────────────────────────────────────
  if (onboarding.state === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-[3px] border-t-line border-t-[#D4A84B] animate-spin" />
      </div>
    );
  }

  // ─── Audience: Partner ────────────────────────────────────────────────
  if (tier === "partner") {
    return <PartnerDashboard />;
  }

  // ─── Audience: Observer ───────────────────────────────────────────────
  if (tier === "observer") {
    return <ObserverDashboard />;
  }

  // ─── State: needs_profile ─────────────────────────────────────────────
  if (onboarding.state === "needs_profile" && !isAdmin) {
    return <ProfileSetup contact={onboarding.contact} onComplete={onboarding.refresh} />;
  }

  // ─── State: needs_resume OR full_access ───────────────────────────────
  return (
    <div className="space-y-10 font-term">
      <MiniForgeBanner />
      <JourneyHeader />
      {/* Welcome / Narrative */}
      <section>
        {hasForgeData ? (
          <div className="bg-t-panel p-6 sm:p-8 border border-t-line">
            <h1 className="text-2xl font-bold text-t-white mb-2">
              {forgeData.narrative?.headline || "Welcome back"}
            </h1>
            {forgeData.narrative?.summary && (
              <p className="text-base text-t-phos-dim leading-relaxed">
                {forgeData.narrative.summary}
              </p>
            )}
          </div>
        ) : (
          <div className="max-w-lg mx-auto py-8">
            {/* t.ROY — clear gate */}
            <div className="bg-t-panel-2 border border-t-amber p-6 mb-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-t-panel border border-t-line flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="text-t-amber">
                    <path d="M8 1C5.58 1 3 3.13 3 6v4c0 1 .5 2 1 2.5s1 1.5 1 2.5h6c0-1 .5-2 1-2.5S13 11 13 10V6c0-2.87-2.58-5-5-5z" stroke="currentColor" strokeWidth="1.2" fill="none" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-t-amber-bright mb-1">t.ROY</p>
                  <p className="text-sm text-t-phos leading-relaxed">
                    I&apos;m t.ROY. The Refinery is where the real work happens -- targeted
                    resumes, interview practice, disclosure strategy, job matching. But I
                    need your story first. The Forge takes about 10 minutes and gives me
                    everything I need to help you win.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-t-panel p-6 sm:p-8 border border-t-line text-center">
              <h1 className="text-2xl font-bold text-t-white mb-3">
                Start with The Forge
              </h1>
              <p className="text-base text-t-phos-dim mb-2">
                The Forge analyzes your resume, identifies your strengths, maps career
                paths, and builds your narrative. Everything in The Refinery is built
                on that foundation.
              </p>
              <p className="text-sm text-t-phos-dim mb-6">
                This isn&apos;t a resume template tool. It&apos;s a narrative engine that turns
                your real story into career ammunition.
              </p>
              <Link
                href="/intro"
                className="t-focus inline-flex items-center justify-center px-8 py-4 bg-t-amber text-[#14100a] shadow-[3px_3px_0_#000] text-lg font-bold hover:bg-t-amber-bright transition-colors min-h-touch"
              >
                Start The Forge
              </Link>
              <p className="text-xs text-t-phos-dim mt-4">
                Free. ~10 minutes. No account needed until you&apos;re ready to save.
              </p>
              <p className="text-xs text-t-phos-dim mt-2">
                Already completed The Forge on another device? Your data syncs automatically.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Skills snapshot */}
      {forgeData.skills && forgeData.skills.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-t-white mb-3">Your Skills</h2>
          <div className="flex flex-wrap gap-2">
            {forgeData.skills.slice(0, 15).map((s, i) => (
              <span
                key={i}
                className={`px-3 py-1.5 text-sm font-medium border bg-t-panel-2 ${
                  s.category === "hard"
                    ? "border-t-steel text-t-steel"
                    : s.category === "soft"
                      ? "border-t-amber text-t-amber-bright"
                      : "border-t-phos text-t-phos"
                }`}
              >
                {s.name}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Career paths */}
      {forgeData.career_paths && forgeData.career_paths.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-t-white mb-3">Career Paths</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {forgeData.career_paths.slice(0, 4).map((cp, i) => (
              <div key={i} className="bg-t-panel p-4 border border-t-line">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-t-white">{cp.title}</h3>
                  {cp.salary_range && (
                    <span className="text-xs font-medium text-t-amber-bright whitespace-nowrap">{cp.salary_range}</span>
                  )}
                </div>
                <p className="text-sm text-t-phos-dim mt-1 line-clamp-2">{cp.match_reason}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* How the Refinery works -- shown when forge data is available but no tailored resume yet */}
      {onboarding.state === "needs_resume" && !isAdmin && hasForgeData && (
        <section className="bg-t-panel border border-t-steel p-6">
          <h2 className="font-semibold text-t-white mb-3">Here&apos;s how the Refinery works</h2>
          <p className="text-sm text-t-phos-dim mb-4">
            Your Forge profile is your base resume -- one strong, structured record of your real
            experience. The Refinery aims it at real jobs and gets smarter the more you use it.
          </p>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 bg-t-amber text-[#14100a] text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">
                1
              </span>
              <div>
                <p className="text-sm font-semibold text-t-white">Start from your base resume</p>
                <p className="text-xs text-t-phos-dim leading-relaxed">
                  Your one strong, structured resume, built from your Forge. Refine it anytime in the Forge builder.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 bg-t-amber text-[#14100a] text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">
                2
              </span>
              <div>
                <p className="text-sm font-semibold text-t-white">Tailor it to a specific job</p>
                <p className="text-xs text-t-phos-dim leading-relaxed">
                  The Application Tailor aims your base resume at the posting&apos;s exact requirements, using your
                  Forge profile. This unlocks the rest -- do it for as many jobs as you want.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 opacity-55">
              <span className="w-6 h-6 bg-t-line text-t-phos-dim text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">
                3
              </span>
              <div>
                <p className="text-sm font-semibold text-t-white">Everything else unlocks</p>
                <p className="text-xs text-t-phos-dim leading-relaxed">
                  Interview practice, disclosure strategy, and application tracking all unlock after your first
                  tailored resume. The grayed-out tools below open automatically.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Primary CTA when no resume yet */}
      {onboarding.state === "needs_resume" && !isAdmin && (
        <section>
          <div className="grid sm:grid-cols-2 gap-4">
            <Link
              href={forgeData.career_paths?.[0]?.title
                ? `/dashboard/jobs?q=${encodeURIComponent(forgeData.career_paths[0].title)}`
                : "/dashboard/jobs"}
              className="block bg-t-panel border border-t-amber p-6 hover:bg-t-panel-2 transition-colors"
            >
              <h3 className="font-semibold text-lg text-t-white mb-1">Find a Job to Tailor For</h3>
              <p className="text-sm text-t-phos-dim">
                {forgeData.career_paths?.[0]?.title
                  ? `Search "${forgeData.career_paths[0].title}" and other roles that fit, then tailor your resume to one. That unlocks the rest.`
                  : "Real listings, fair-chance employers first. Pick one and tailor your resume to it -- that unlocks the rest."}
              </p>
            </Link>
            <Link
              href="/resume"
              className="block bg-t-panel border border-t-steel p-6 hover:bg-t-panel-2 transition-colors"
            >
              <h3 className="font-semibold text-lg text-t-white mb-1">Build Your Base Resume</h3>
              <p className="text-sm text-t-phos-dim">
                Your one strong resume, built from your real experience. Refine it in the Forge builder anytime.
              </p>
            </Link>
          </div>
        </section>
      )}

      {/* Saved work */}
      {totalArtifacts > 0 && (
        <section>
          <h2 className="text-lg font-bold text-t-white mb-4">Your Saved Work</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.entries(artifactCounts).map(([type, count]) => (
              <Link
                key={type}
                href={TYPE_TOOL_HREF[type] || "/dashboard"}
                className="px-3 py-1.5 text-sm font-medium border border-t-line bg-t-panel text-t-phos hover:border-t-phos-dim hover:text-t-white transition-colors"
              >
                {count} {TYPE_LABELS[type] || type}
              </Link>
            ))}
          </div>
          {recentArtifacts.length > 0 && (
            <div className="space-y-2">
              {recentArtifacts.map((a) => {
                const href = TYPE_TOOL_HREF[a.artifact_type]
                  ? `${TYPE_TOOL_HREF[a.artifact_type]}?id=${a.id}`
                  : "/dashboard";
                return (
                  <div
                    key={a.id}
                    className="flex items-center bg-t-panel border border-t-line hover:border-t-phos-dim transition-colors"
                  >
                    <Link
                      href={href}
                      className="flex-1 px-4 py-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-t-white truncate">
                          {a.target_context?.targetJob || TYPE_LABELS[a.artifact_type] || a.artifact_type}
                        </span>
                        <span className="text-xs text-t-phos-dim ml-2 flex-shrink-0">{timeAgo(a.updated_at)}</span>
                      </div>
                    </Link>
                    <button
                      onClick={() => deleteArtifact(a.id)}
                      disabled={deletingArtifact === a.id}
                      className="px-3 py-3 text-t-phos-dim hover:text-t-red transition-colors flex-shrink-0 disabled:opacity-50"
                      title="Delete"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M3 3l8 8M11 3l-8 8" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* What's Next — contextual suggestions based on what they've done */}
      {onboarding.state === "full_access" && recentArtifacts.length > 0 && (() => {
        const latestResume = recentArtifacts.find((a) => a.artifact_type === "resume");
        const targetJob = latestResume?.target_context?.targetJob;
        const targetCompany = latestResume?.target_context?.targetCompany;
        const hasDisclosure = (artifactCounts.disclosure_plan || 0) > 0;
        const hasInterview = (artifactCounts.interview_prep || 0) > 0;

        if (!targetJob || (hasDisclosure && hasInterview)) return null;

        return (
          <section className="bg-t-panel border border-t-line p-6">
            <h2 className="font-semibold text-t-white mb-3">
              What&apos;s Next
            </h2>
            <p className="text-sm text-t-phos-dim mb-4">
              You built a resume for <span className="font-medium text-t-white">{targetJob}</span>
              {targetCompany ? <> at <span className="font-medium text-t-white">{targetCompany}</span></> : ""}.
              Keep preparing:
            </p>
            <div className="flex flex-wrap gap-3">
              {!hasDisclosure && (
                <Link
                  href={`/dashboard/disclosure${targetCompany ? `?company=${encodeURIComponent(targetCompany)}` : ""}`}
                  className="t-focus px-4 py-2.5 bg-t-panel-2 border border-t-line text-sm font-medium text-t-phos hover:border-t-phos-dim hover:text-t-white transition-colors"
                >
                  Plan your disclosure
                </Link>
              )}
              {!hasInterview && (
                <Link
                  href={`/dashboard/interview${targetJob ? `?role=${encodeURIComponent(targetJob)}` : ""}`}
                  className="t-focus px-4 py-2.5 bg-t-panel-2 border border-t-line text-sm font-medium text-t-phos hover:border-t-phos-dim hover:text-t-white transition-colors"
                >
                  Practice {targetJob} interview
                </Link>
              )}
              <Link
                href="/dashboard/jobs"
                className="t-focus px-4 py-2.5 bg-t-panel-2 border border-t-line text-sm font-medium text-t-phos hover:border-t-phos-dim hover:text-t-white transition-colors"
              >
                Find another job
              </Link>
            </div>
          </section>
        );
      })()}

      {/* Tool cards — all visible, locked ones greyed out */}
      <section>
        <h2 className="text-lg font-bold text-t-white mb-4">Your Tools</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ALL_TOOLS.map((tool) => {
            const unlocked = isToolUnlocked(tool, onboarding.state, isAdmin);
            const typeForTool = Object.entries(TYPE_TOOL_HREF).find(
              ([, href]) => href === tool.href
            )?.[0];
            const count = typeForTool ? artifactCounts[typeForTool] : 0;

            if (!unlocked) {
              return (
                <div
                  key={tool.href}
                  className="p-5 border border-t-line bg-t-panel opacity-40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold mb-1 text-t-phos-dim">{tool.title}</h3>
                    <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor" className="text-t-phos-dim flex-shrink-0 mt-0.5">
                      <path d="M9 5V4a3 3 0 10-6 0v1H2v5a1 1 0 001 1h6a1 1 0 001-1V5H9zM4 4a2 2 0 114 0v1H4V4z" />
                    </svg>
                  </div>
                  <p className="text-sm text-t-phos-dim leading-relaxed">{tool.description}</p>
                  <p className="text-xs text-t-phos-dim mt-2 italic">
                    Build your first resume to unlock
                  </p>
                </div>
              );
            }

            return (
              <Link
                key={tool.href}
                href={tool.href}
                className={`block p-5 border transition-all hover:bg-t-panel-2 ${tool.color}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className={`font-semibold mb-1 ${tool.accent}`}>{tool.title}</h3>
                  {count > 0 && (
                    <span className="text-xs font-medium text-t-amber-bright border border-t-amber px-2 py-0.5 flex-shrink-0">
                      {count} saved
                    </span>
                  )}
                </div>
                <p className="text-sm text-t-phos-dim leading-relaxed">{tool.description}</p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Data & Privacy */}
      <section className="border-t border-t-line pt-8">
        <div className="flex gap-3">
          <Link
            href="/dashboard/settings"
            className="t-focus text-sm text-t-phos-dim hover:text-t-white bg-t-panel px-4 py-3 border border-t-line transition-colors"
          >
            Settings & privacy
          </Link>
        </div>
      </section>
    </div>
  );
}

// ─── Partner Dashboard ────────────────────────────────────────────────────────

function PartnerDashboard() {
  const TOOL_OVERVIEW = [
    {
      title: "The Forge",
      href: "/intro",
      description: "8-page career analysis. Detects readiness stage, extracts skills, builds redemption narrative, maps career paths, and connects barriers to next steps. Free for all clients — no account needed until they want to save.",
      research: "Stages of Change (Prochaska), Narrative Identity (McAdams), Giordano's hooks-for-change",
    },
    {
      title: "Application Tailor",
      href: "/dashboard/application-tailor",
      description: "Targeted resume, cover letter, and disclosure brief for a specific job. Pulls from the client's Forge profile -- every version is grounded in their actual skills and story, not a template.",
      research: "ATS optimization, Bandura mastery experiences",
    },
    {
      title: "Disclosure Planner",
      href: "/dashboard/disclosure",
      description: "Personalized plan for when and how to discuss a criminal record. Includes jurisdiction-specific ban-the-box guidance, a natural-sounding script, and a pivot strategy using the client's strengths.",
      research: "Pager structural barriers, WI §973.015, ban-the-box compliance",
    },
    {
      title: "Interview Practice",
      href: "/dashboard/interview",
      description: "AI mock interviews tailored to role, level, and disclosure needs. Includes written practice plus live voice rehearsal through OpenAI Realtime.",
      research: "SDT competence-building, Bandura performance accomplishments, voice practice for transfer",
    },
    {
      title: "Job Board",
      href: "/dashboard/jobs",
      description: "Real listings via JSearch API — no hallucinated jobs. Fair-chance employers flagged and sorted first. No outbound links; everything renders natively.",
      research: "SHRM fair-chance employer data, Granovetter weak ties",
    },
    {
      title: "Fair-Chance Lanes",
      href: "/dashboard/resources",
      description: "Curated fair-chance opportunity lanes, employer signals, and handoffs into live listings, targeted resumes, interview practice, and disclosure planning.",
      research: "SHRM fair-chance hiring, CareerOneStop reentry guidance, Granovetter weak ties",
    },
  ];

  return (
    <div className="space-y-10 font-term">
      {/* Header */}
      <section className="bg-t-panel p-6 sm:p-8 border border-t-line">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-t-panel-2 border border-t-line flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="text-t-amber">
              <path d="M8 1C5.58 1 3 3.13 3 6v4c0 1 .5 2 1 2.5s1 1.5 1 2.5h6c0-1 .5-2 1-2.5S13 11 13 10V6c0-2.87-2.58-5-5-5z" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-t-amber-bright mb-1">t.ROY — Partner View</p>
            <h1 className="text-2xl font-bold text-t-white mb-2">Welcome to The Refinery</h1>
            <p className="text-base text-t-phos-dim leading-relaxed">
              You&apos;re seeing this as a partner organization. The tools below are what your clients experience — each one is built on peer-reviewed research and designed specifically for justice-impacted people. Walk through any tool to see it in action, or go deeper into the methodology.
            </p>
          </div>
        </div>
      </section>

      {/* Deep methodology links */}
      <section className="grid sm:grid-cols-2 gap-4">
        <Link
          href="/dashboard/methodology"
          className="block bg-t-panel border border-t-amber p-6 hover:bg-t-panel-2 transition-colors"
        >
          <h3 className="font-semibold text-lg text-t-white mb-1">Full Methodology Playbook</h3>
          <p className="text-sm text-t-phos-dim">
            10 behavioral rules, research foundation, how each feature was designed. The full picture for program directors and case managers.
          </p>
        </Link>
        <Link
          href="/dashboard/evidence"
          className="block bg-t-panel border border-t-steel p-6 hover:bg-t-panel-2 transition-colors"
        >
          <h3 className="font-semibold text-lg text-t-white mb-1">Evidence & Outcomes</h3>
          <p className="text-sm text-t-phos-dim">
            Research citations, outcome data, differentiators. Built for funders, grant applications, and accreditation reviewers.
          </p>
        </Link>
      </section>

      {/* Try it with a client */}
      <section className="bg-t-panel border border-t-line p-6">
        <h2 className="font-semibold text-t-white mb-2">Try it with a client</h2>
        <p className="text-sm text-t-phos-dim mb-4">
          The Forge takes about 10 minutes. Walk through it yourself or sit with a client while they do — you&apos;ll see exactly what they experience and what it produces.
        </p>
        <TBtn href="/intro" size="sm">start The Forge</TBtn>
      </section>

      {/* Tool-by-tool breakdown */}
      <section>
        <h2 className="text-lg font-bold text-t-white mb-4">What each tool does</h2>
        <div className="space-y-3">
          {TOOL_OVERVIEW.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="block bg-t-panel p-5 border border-t-line hover:border-t-phos-dim transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-t-white mb-1">{tool.title}</h3>
                  <p className="text-sm text-t-phos-dim leading-relaxed mb-2">{tool.description}</p>
                  <p className="text-xs text-t-amber-bright font-medium">Research basis: {tool.research}</p>
                </div>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-t-phos-dim flex-shrink-0 mt-1">
                  <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Settings */}
      <section className="border-t border-t-line pt-8">
        <Link
          href="/dashboard/settings"
          className="t-focus text-sm text-t-phos-dim hover:text-t-white bg-t-panel px-4 py-3 border border-t-line transition-colors"
        >
          Settings & privacy
        </Link>
      </section>
    </div>
  );
}

// ─── Observer Dashboard ───────────────────────────────────────────────────────

function ObserverDashboard() {
  const HEADLINE_CITATIONS = [
    {
      finding: "Affect labeling reduces amygdala reactivity by up to 50%",
      source: "Lieberman et al., 2007",
      detail: "fMRI study. Putting feelings into words activates prefrontal cortex and dampens amygdala response — the mechanism behind why free-text prompts are therapeutic, not just data collection.",
    },
    {
      finding: "A criminal record reduces job callbacks by 50% for white applicants — and 64% for Black applicants",
      source: "Pager, 2003 (Milwaukee audit study)",
      detail: "Black applicants without records were called back less than white applicants with records. Employment barriers are structural, not motivational. This tool is designed to navigate that system — not pretend it doesn't exist.",
    },
    {
      finding: "85% of HR professionals say justice-impacted employees perform the same as or better than other employees",
      source: "SHRM, 2021",
      detail: "31% lower turnover in year one. The fair-chance employer matching in this tool is built on evidence that hiring people with records is good business — not charity.",
    },
    {
      finding: "Redemption sequences (bad→good narratives) predict higher well-being and generativity",
      source: "McAdams & McLean, 2013",
      detail: "Narrative identity theory. People who construct redemption arcs show better outcomes than those with contamination sequences. The Forge is a structured redemption narrative builder.",
    },
    {
      finding: "Lasting desistance requires both a concrete 'hook for change' and identity transformation",
      source: "Giordano et al., 2002",
      detail: "A job offer without identity work, or identity work without a concrete opportunity, both fail. This tool addresses both simultaneously.",
    },
  ];

  return (
    <div className="space-y-10 font-term">
      {/* Header */}
      <section className="bg-t-panel p-6 sm:p-8 border border-t-line">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-t-panel-2 border border-t-line flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="text-t-steel">
              <path d="M8 1C5.58 1 3 3.13 3 6v4c0 1 .5 2 1 2.5s1 1.5 1 2.5h6c0-1 .5-2 1-2.5S13 11 13 10V6c0-2.87-2.58-5-5-5z" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-t-steel mb-1">t.ROY — Evidence View</p>
            <h1 className="text-2xl font-bold text-t-white mb-2">Built on evidence. Designed for scrutiny.</h1>
            <p className="text-base text-t-phos-dim leading-relaxed">
              Every feature in this tool has a research basis. This view surfaces the citations, outcomes data, and design decisions. The full evidence deck is in the Evidence tab.
            </p>
          </div>
        </div>
      </section>

      {/* Key citations */}
      <section>
        <h2 className="text-lg font-bold text-t-white mb-4">Five findings this tool is built on</h2>
        <div className="space-y-3">
          {HEADLINE_CITATIONS.map((c, i) => (
            <div key={i} className="bg-t-panel p-5 border border-t-line">
              <p className="font-semibold text-t-white mb-1">&ldquo;{c.finding}&rdquo;</p>
              <p className="text-xs font-medium text-t-steel mb-2">{c.source}</p>
              <p className="text-sm text-t-phos-dim leading-relaxed">{c.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Deep links */}
      <section className="grid sm:grid-cols-2 gap-4">
        <Link
          href="/dashboard/evidence"
          className="block bg-t-panel border border-t-steel p-6 hover:bg-t-panel-2 transition-colors"
        >
          <h3 className="font-semibold text-lg text-t-white mb-1">Full Evidence Deck</h3>
          <p className="text-sm text-t-phos-dim">
            All citations, methodology notes, and outcome data. Structured for grant applications and academic review.
          </p>
        </Link>
        <Link
          href="/dashboard/methodology"
          className="block bg-t-panel border border-t-amber p-6 hover:bg-t-panel-2 transition-colors"
        >
          <h3 className="font-semibold text-lg text-t-white mb-1">Design Methodology</h3>
          <p className="text-sm text-t-phos-dim">
            How each behavioral rule translates into a feature. The 10 non-negotiables and why they exist.
          </p>
        </Link>
      </section>

      {/* Try it */}
      <section className="bg-t-panel border border-t-line p-6">
        <h2 className="font-semibold text-t-white mb-2">See it in action</h2>
        <p className="text-sm text-t-phos-dim mb-4">
          The Forge demo runs with sample data — Jordan, a warehouse worker from Milwaukee navigating a felony record. Walk through all 8 pages and see what the tool produces.
        </p>
        <TBtn href="/intro" size="sm">launch demo</TBtn>
      </section>

      {/* Settings */}
      <section className="border-t border-t-line pt-8">
        <Link
          href="/dashboard/settings"
          className="t-focus text-sm text-t-phos-dim hover:text-t-white bg-t-panel px-4 py-3 border border-t-line transition-colors"
        >
          Settings & privacy
        </Link>
      </section>
    </div>
  );
}

// ─── Profile Setup Component ────────────────────────────────────────────────

function ProfileSetup({
  contact,
  onComplete,
}: {
  contact: UserContact | null;
  onComplete: () => void;
}) {
  const [name, setName] = useState(contact?.name || "");
  const [email, setEmail] = useState(contact?.email || "");
  const [phone, setPhone] = useState(contact?.phone || "");
  const [city, setCity] = useState(contact?.city || "");
  const [state, setState] = useState(contact?.state || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setError("Name and phone number are required for your resume.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, city, state }),
      });

      if (res.ok) {
        onComplete();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not save. Please try again.");
        setSaving(false);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto font-term">
      <h1 className="text-2xl font-bold text-t-white mb-2">
        {name ? `Welcome, ${name.split(" ")[0]}` : "Welcome to The Refinery"}
      </h1>
      <p className="text-base text-t-phos-dim mb-4">
        I analyzed your background in The Forge — now we put it to work.
        These details go on your resume header. Nothing else.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="text-sm font-medium text-t-white block mb-1">Full Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name (as it appears on a resume)"
            className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
            required
          />
          <p className="text-xs text-t-phos-dim mt-1">Top of every resume we build for you.</p>
        </div>

        <div>
          <label className="text-sm font-medium text-t-white block mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
          />
          <p className="text-xs text-t-phos-dim mt-1">Resume header + how employers reach you.</p>
        </div>

        <div>
          <label className="text-sm font-medium text-t-white block mb-1">Phone Number *</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(414) 555-1234"
            className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
            required
          />
          <p className="text-xs text-t-phos-dim mt-1">Required on resumes. Employers call this number.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">City</label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Milwaukee"
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">State</label>
            <input
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="WI"
              maxLength={2}
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch uppercase"
            />
          </div>
          <p className="text-xs text-t-phos-dim col-span-2">For local job matching.</p>
        </div>

        {error && <p className="text-sm text-t-red">{error}</p>}

        <div className="bg-t-panel p-4 border border-t-line">
          <p className="text-xs text-t-phos leading-relaxed">
            This info goes on your resume and nowhere else. We don&apos;t sell, share, or spam.
            You can update or delete everything anytime in Settings.
          </p>
        </div>

        <TBtn type="submit" disabled={saving || !name.trim() || !phone.trim()} className="w-full">
          {saving ? "saving..." : "save & continue"}
        </TBtn>
      </form>
    </div>
  );
}

// ─── Mini Forge welcome banner ────────────────────────────────────────────

function MiniForgeBanner() {
  const searchParams = useSearchParams();
  const [dismissed, setDismissed] = useState(false);

  if (searchParams.get("welcome") !== "mini-forge" || dismissed) return null;

  return (
    <div className="bg-t-panel border border-t-line p-5 flex items-start gap-4 font-term">
      <div className="flex-1">
        <p className="font-semibold text-t-white">Welcome. You started this inside.</p>
        <p className="text-sm text-t-phos-dim mt-1">
          Your career plan from The Mini Forge is loaded. Your tools are ready.
        </p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-t-phos-dim hover:text-t-white text-sm shrink-0"
        aria-label="Dismiss"
      >
        Done
      </button>
    </div>
  );
}
