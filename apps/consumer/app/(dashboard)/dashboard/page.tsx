"use client";

/**
 * Client Dashboard — Overview
 *
 * Three states:
 * 1. needs_profile → Profile setup form (name, email, phone, city, state)
 * 2. needs_resume  → Job Board + Resume Builder only, locked cards for rest
 * 3. full_access   → Everything unlocked
 *
 * Admin tier bypasses all gates (god mode).
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useUserTier } from "@/lib/useUserTier";
import { useOnboarding, type OnboardingState, type UserContact } from "@/lib/useOnboarding";

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
    color: "bg-sage-50 border-sage-200",
    accent: "text-sage-600",
    minState: "needs_resume",
  },
  {
    href: "/dashboard/resume-builder",
    title: "Resume Builder",
    description: "Build a targeted resume for any job. We help you every step.",
    color: "bg-sky-50 border-sky-200",
    accent: "text-sky-600",
    minState: "needs_resume",
  },
  {
    href: "/dashboard/disclosure",
    title: "Disclosure Planner",
    description: "Plan when and how to talk about your record with employers.",
    color: "bg-warm-50 border-warm-200",
    accent: "text-warm-600",
    minState: "full_access",
  },
  {
    href: "/dashboard/interview",
    title: "Interview Practice",
    description: "AI mock interviews tailored to your target role.",
    color: "bg-sky-50 border-sky-200",
    accent: "text-sky-600",
    minState: "full_access",
  },
  {
    href: "/dashboard/resources",
    title: "Resources",
    description: "Housing, transportation, legal aid, and more.",
    color: "bg-warm-50 border-warm-200",
    accent: "text-warm-600",
    minState: "full_access",
  },
  {
    href: "/dashboard/applications",
    title: "Applications",
    description: "Track your job applications from saved to offered.",
    color: "bg-sage-50 border-sage-200",
    accent: "text-sage-600",
    minState: "full_access",
  },
  {
    href: "/dashboard/progress",
    title: "Progress",
    description: "See how far you've come.",
    color: "bg-sage-50 border-sage-200",
    accent: "text-sage-600",
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
  resume: "/dashboard/resume-builder",
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
        <div className="w-8 h-8 border-3 border-sage-200 border-t-sage-600 rounded-full animate-spin" />
      </div>
    );
  }

  // ─── State: needs_profile ─────────────────────────────────────────────
  if (onboarding.state === "needs_profile" && !isAdmin) {
    return <ProfileSetup contact={onboarding.contact} onComplete={onboarding.refresh} />;
  }

  // ─── State: needs_resume OR full_access ───────────────────────────────
  return (
    <div className="space-y-10">
      {/* Welcome / Narrative */}
      <section>
        {hasForgeData ? (
          <div className="bg-white rounded-2xl p-6 sm:p-8 border border-border">
            <h1 className="text-2xl font-bold text-foreground mb-2">
              {forgeData.narrative?.headline || "Welcome back"}
            </h1>
            {forgeData.narrative?.summary && (
              <p className="text-body text-muted leading-relaxed">
                {forgeData.narrative.summary}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* t.ROY welcome */}
            <div className="bg-sage-600 rounded-2xl p-6 text-white">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="text-white">
                    <path d="M8 1C5.58 1 3 3.13 3 6v4c0 1 .5 2 1 2.5s1 1.5 1 2.5h6c0-1 .5-2 1-2.5S13 11 13 10V6c0-2.87-2.58-5-5-5z" stroke="currentColor" strokeWidth="1.2" fill="none" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-white/90 mb-1">t.ROY</p>
                  <p className="text-sm text-white/80 leading-relaxed">
                    I&apos;m t.ROY. I help at every step. Right now, I&apos;d recommend starting with The Forge
                    -- it takes about 10 minutes and gives me everything I need to build you a great resume.
                  </p>
                </div>
              </div>
            </div>

            {/* Explanation + CTA */}
            <div className="bg-white rounded-2xl p-6 sm:p-8 border border-border">
              <h1 className="text-2xl font-bold text-foreground mb-3">
                Welcome to The Refinery
              </h1>
              <p className="text-body text-muted mb-2">
                The Refinery is where you build real resumes, practice interviews,
                and prepare for employers. But first, we need your story.
              </p>
              <p className="text-sm text-muted mb-6">
                The Forge (free, ~10 minutes) analyzes your resume, identifies your
                strengths, maps career paths, and gives you a starting resume and cover
                letter. Everything you build here starts from that foundation.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/intro"
                  className="inline-flex items-center justify-center px-6 py-3 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 transition-colors min-h-touch"
                >
                  Start The Forge
                </Link>
                <p className="text-xs text-muted self-center">
                  Already completed The Forge? Your data syncs automatically when you sign in.
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Skills snapshot */}
      {forgeData.skills && forgeData.skills.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-foreground mb-3">Your Skills</h2>
          <div className="flex flex-wrap gap-2">
            {forgeData.skills.slice(0, 15).map((s, i) => (
              <span
                key={i}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  s.category === "hard"
                    ? "bg-sky-100 text-sky-700"
                    : s.category === "soft"
                      ? "bg-warm-100 text-warm-700"
                      : "bg-sage-100 text-sage-700"
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
          <h2 className="text-lg font-bold text-foreground mb-3">Career Paths</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {forgeData.career_paths.slice(0, 4).map((cp, i) => (
              <div key={i} className="bg-white rounded-xl p-4 border border-border">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-foreground">{cp.title}</h3>
                  {cp.salary_range && (
                    <span className="text-xs font-medium text-sage-600 whitespace-nowrap">{cp.salary_range}</span>
                  )}
                </div>
                <p className="text-sm text-muted mt-1 line-clamp-2">{cp.match_reason}</p>
              </div>
            ))}
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
              className="block bg-sage-600 text-white rounded-2xl p-6 hover:bg-sage-700 transition-colors"
            >
              <h3 className="font-semibold text-lg mb-1">Find a Job</h3>
              <p className="text-sm text-sage-100">
                {forgeData.career_paths?.[0]?.title
                  ? `Search for "${forgeData.career_paths[0].title}" and other roles that fit.`
                  : "Search real job listings from employers hiring now."}
              </p>
            </Link>
            <Link
              href="/dashboard/resume-builder"
              className="block bg-sky-600 text-white rounded-2xl p-6 hover:bg-sky-700 transition-colors"
            >
              <h3 className="font-semibold text-lg mb-1">Build a Resume</h3>
              <p className="text-sm text-sky-100">
                Start building a resume from your Forge results.
              </p>
            </Link>
          </div>
        </section>
      )}

      {/* Saved work */}
      {totalArtifacts > 0 && (
        <section>
          <h2 className="text-lg font-bold text-foreground mb-4">Your Saved Work</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.entries(artifactCounts).map(([type, count]) => (
              <Link
                key={type}
                href={TYPE_TOOL_HREF[type] || "/dashboard"}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-sage-100 text-sage-700 hover:bg-sage-200 transition-colors"
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
                    className="flex items-center bg-white rounded-xl border border-border hover:border-sage-300 transition-colors"
                  >
                    <Link
                      href={href}
                      className="flex-1 px-4 py-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-foreground truncate">
                          {a.target_context?.targetJob || TYPE_LABELS[a.artifact_type] || a.artifact_type}
                        </span>
                        <span className="text-xs text-muted ml-2 flex-shrink-0">{timeAgo(a.updated_at)}</span>
                      </div>
                    </Link>
                    <button
                      onClick={() => deleteArtifact(a.id)}
                      disabled={deletingArtifact === a.id}
                      className="px-3 py-3 text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 disabled:opacity-50"
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
          <section className="bg-sage-50 rounded-2xl p-6 border border-sage-200">
            <h2 className="font-semibold text-foreground mb-3">
              What&apos;s Next
            </h2>
            <p className="text-sm text-muted mb-4">
              You built a resume for <span className="font-medium text-foreground">{targetJob}</span>
              {targetCompany ? <> at <span className="font-medium text-foreground">{targetCompany}</span></> : ""}.
              Keep preparing:
            </p>
            <div className="flex flex-wrap gap-3">
              {!hasDisclosure && (
                <Link
                  href={`/dashboard/disclosure${targetCompany ? `?company=${encodeURIComponent(targetCompany)}` : ""}`}
                  className="px-4 py-2.5 bg-white border border-sage-200 rounded-xl text-sm font-medium text-sage-700 hover:bg-sage-50 transition-colors"
                >
                  Plan your disclosure
                </Link>
              )}
              {!hasInterview && (
                <Link
                  href={`/dashboard/interview${targetJob ? `?role=${encodeURIComponent(targetJob)}` : ""}`}
                  className="px-4 py-2.5 bg-white border border-sage-200 rounded-xl text-sm font-medium text-sage-700 hover:bg-sage-50 transition-colors"
                >
                  Practice {targetJob} interview
                </Link>
              )}
              <Link
                href="/dashboard/jobs"
                className="px-4 py-2.5 bg-white border border-sage-200 rounded-xl text-sm font-medium text-sage-700 hover:bg-sage-50 transition-colors"
              >
                Find another job
              </Link>
            </div>
          </section>
        );
      })()}

      {/* Tool cards — all visible, locked ones greyed out */}
      <section>
        <h2 className="text-lg font-bold text-foreground mb-4">Your Tools</h2>
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
                  className={`rounded-2xl p-5 border opacity-40 ${tool.color}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className={`font-semibold mb-1 text-gray-400`}>{tool.title}</h3>
                    <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor" className="text-gray-300 flex-shrink-0 mt-0.5">
                      <path d="M9 5V4a3 3 0 10-6 0v1H2v5a1 1 0 001 1h6a1 1 0 001-1V5H9zM4 4a2 2 0 114 0v1H4V4z" />
                    </svg>
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed">{tool.description}</p>
                  <p className="text-xs text-gray-300 mt-2 italic">
                    Build your first resume to unlock
                  </p>
                </div>
              );
            }

            return (
              <Link
                key={tool.href}
                href={tool.href}
                className={`block rounded-2xl p-5 border transition-all hover:shadow-md ${tool.color}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className={`font-semibold mb-1 ${tool.accent}`}>{tool.title}</h3>
                  {count > 0 && (
                    <span className="text-xs font-medium text-sage-600 bg-sage-100 px-2 py-0.5 rounded-full flex-shrink-0">
                      {count} saved
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted leading-relaxed">{tool.description}</p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Data & Privacy */}
      <section className="border-t border-border pt-8">
        <div className="flex gap-3">
          <Link
            href="/dashboard/settings"
            className="text-sm text-muted hover:text-foreground bg-white rounded-xl px-4 py-3 border border-border transition-colors"
          >
            Settings & privacy
          </Link>
        </div>
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
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-foreground mb-2">
        {name ? `Welcome, ${name.split(" ")[0]}` : "Welcome to The Refinery"}
      </h1>
      <p className="text-body text-muted mb-4">
        I analyzed your background in The Forge — now we put it to work.
        These details go on your resume header. Nothing else.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="text-sm font-medium block mb-1">Full Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name (as it appears on a resume)"
            className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors min-h-touch"
            required
          />
          <p className="text-xs text-muted mt-1">Top of every resume we build for you.</p>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors min-h-touch"
          />
          <p className="text-xs text-muted mt-1">Resume header + how employers reach you.</p>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Phone Number *</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(414) 555-1234"
            className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors min-h-touch"
            required
          />
          <p className="text-xs text-muted mt-1">Required on resumes. Employers call this number.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium block mb-1">City</label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Milwaukee"
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors min-h-touch"
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">State</label>
            <input
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="WI"
              maxLength={2}
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors min-h-touch uppercase"
            />
          </div>
          <p className="text-xs text-muted col-span-2">For local job matching.</p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="bg-sage-50 rounded-xl p-4 border border-sage-200">
          <p className="text-xs text-sage-700 leading-relaxed">
            This info goes on your resume and nowhere else. We don&apos;t sell, share, or spam.
            You can update or delete everything anytime in Settings.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving || !name.trim() || !phone.trim()}
          className="w-full px-6 py-4 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 disabled:bg-gray-300 transition-colors min-h-touch"
        >
          {saving ? "Saving..." : "Save & Continue"}
        </button>
      </form>
    </div>
  );
}
