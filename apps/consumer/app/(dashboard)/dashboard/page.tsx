"use client";

/**
 * Client Dashboard — Overview
 *
 * Authenticated area. Forge data flows in automatically.
 * Shows: narrative summary, skills, career paths, Refinery tool cards.
 * Designed for 6+ month engagement.
 */

import { useState, useEffect } from "react";
import Link from "next/link";

interface DashboardData {
  narrative?: { headline?: string; summary?: string };
  strengths?: Array<{ title: string; evidence: string }>;
  skills?: Array<{ name: string; category: string }>;
  career_paths?: Array<{
    title: string;
    salary_range?: string;
    match_reason: string;
  }>;
  barriers?: Array<{ type: string; resources: unknown[] }>;
}

const REFINERY_TOOLS = [
  {
    href: "/dashboard/resume-builder",
    title: "Resume Builder",
    description:
      "Build targeted resumes for specific jobs. Fading scaffold helps you get better each time.",
    color: "bg-sage-50 border-sage-200",
    accent: "text-sage-600",
  },
  {
    href: "/dashboard/disclosure",
    title: "Disclosure Planner",
    description:
      "Plan when and how to discuss your record. Practice the conversation before the real thing.",
    color: "bg-sky-50 border-sky-200",
    accent: "text-sky-600",
  },
  {
    href: "/dashboard/interview",
    title: "Interview Practice",
    description:
      "AI mock interviews tailored to your target role. Practice tough questions in a safe space.",
    color: "bg-warm-50 border-warm-200",
    accent: "text-warm-600",
  },
  {
    href: "/dashboard/jobs",
    title: "Job Board",
    description:
      "Fair-chance employers who actively hire people with records. Matched to your situation.",
    color: "bg-earth-50 border-earth-200",
    accent: "text-earth-600",
  },
  {
    href: "/dashboard/resources",
    title: "Resources",
    description:
      "Housing, transportation, legal aid, and more — matched to your barriers and location.",
    color: "bg-warm-50 border-warm-200",
    accent: "text-warm-600",
  },
  {
    href: "/dashboard/progress",
    title: "Progress",
    description:
      "See how far you've come. Track sessions, skills found, resumes built, and applications sent.",
    color: "bg-sage-50 border-sage-200",
    accent: "text-sage-600",
  },
];

interface ArtifactSummary {
  id: string;
  artifact_type: string;
  target_context: { targetJob?: string; targetCompany?: string };
  updated_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  resume: "resumes",
  cover_letter: "cover letters",
  disclosure_plan: "disclosure plans",
  interview_prep: "interview sessions",
  resource_list: "resource lists",
  job_match: "job matches",
};

const TYPE_TOOL_HREF: Record<string, string> = {
  resume: "/dashboard/resume-builder",
  disclosure_plan: "/dashboard/disclosure",
  interview_prep: "/dashboard/interview",
  job_match: "/dashboard/jobs",
  resource_list: "/dashboard/resources",
};

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

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData>({});
  const [artifactCounts, setArtifactCounts] = useState<Record<string, number>>({});
  const [recentArtifacts, setRecentArtifacts] = useState<ArtifactSummary[]>([]);

  // Load Forge output — try DB first, fall back to localStorage
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      // Try server-side first (persisted data)
      try {
        const res = await fetch("/api/forge/load");
        if (res.ok) {
          const { data: profile } = await res.json();
          if (!cancelled && profile?.forgeOutput) {
            setData(profile.forgeOutput);
            return;
          }
        }
      } catch {
        // Fall through to localStorage
      }

      // Fallback: localStorage (pre-sync or same-device)
      try {
        const stored = localStorage.getItem("forge_session");
        if (stored) {
          const session = JSON.parse(stored);
          if (!cancelled && session.forgeOutput) {
            setData(session.forgeOutput);
          }
        }
      } catch {
        // Silent — no data available yet
      }
    }

    loadData();
    return () => { cancelled = true; };
  }, []);

  // Load artifact counts + recent artifacts
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

  const hasForgeData = !!(data.narrative || data.skills?.length);
  const totalArtifacts = Object.values(artifactCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-10">
      {/* Welcome / Narrative Summary */}
      <section>
        {hasForgeData ? (
          <div className="bg-white rounded-2xl p-6 sm:p-8 border border-border">
            <h1 className="text-2xl font-bold text-foreground mb-2">
              {data.narrative?.headline || "Welcome back"}
            </h1>
            {data.narrative?.summary && (
              <p className="text-body text-muted leading-relaxed">
                {data.narrative.summary}
              </p>
            )}
          </div>
        ) : (
          <div className="bg-sage-50 rounded-2xl p-6 sm:p-8 border border-sage-200">
            <h1 className="text-2xl font-bold text-foreground mb-2">
              Welcome to your dashboard
            </h1>
            <p className="text-body text-muted mb-4">
              Complete The Forge to populate your dashboard with your story,
              skills, and career paths.
            </p>
            <Link
              href="/welcome"
              className="inline-flex items-center px-6 py-3 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 transition-colors min-h-touch"
            >
              Start The Forge
            </Link>
          </div>
        )}
      </section>

      {/* Skills snapshot */}
      {data.skills && data.skills.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-foreground mb-3">
            Your Skills
          </h2>
          <div className="flex flex-wrap gap-2">
            {data.skills.slice(0, 15).map((s, i) => (
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
            {data.skills.length > 15 && (
              <span className="px-3 py-1.5 text-sm text-muted">
                +{data.skills.length - 15} more
              </span>
            )}
          </div>
        </section>
      )}

      {/* Career paths snapshot */}
      {data.career_paths && data.career_paths.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-foreground mb-3">
            Career Paths
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {data.career_paths.slice(0, 4).map((cp, i) => (
              <div
                key={i}
                className="bg-white rounded-xl p-4 border border-border"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-foreground">{cp.title}</h3>
                  {cp.salary_range && (
                    <span className="text-xs font-medium text-sage-600 whitespace-nowrap">
                      {cp.salary_range}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted mt-1 line-clamp-2">
                  {cp.match_reason}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Your Saved Work */}
      {totalArtifacts > 0 && (
        <section>
          <h2 className="text-lg font-bold text-foreground mb-4">
            Your Saved Work
          </h2>
          {/* Count summary */}
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
          {/* Recent artifacts */}
          {recentArtifacts.length > 0 && (
            <div className="space-y-2">
              {recentArtifacts.map((a) => {
                const href = TYPE_TOOL_HREF[a.artifact_type]
                  ? `${TYPE_TOOL_HREF[a.artifact_type]}?id=${a.id}`
                  : "/dashboard";
                return (
                  <Link
                    key={a.id}
                    href={href}
                    className="block bg-white rounded-xl px-4 py-3 border border-border hover:border-sage-300 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground truncate">
                        {a.target_context?.targetJob || TYPE_LABELS[a.artifact_type] || a.artifact_type}
                      </span>
                      <span className="text-xs text-muted ml-2 flex-shrink-0">
                        {timeAgo(a.updated_at)}
                      </span>
                    </div>
                    {a.target_context?.targetCompany && (
                      <p className="text-xs text-muted mt-0.5">
                        at {a.target_context.targetCompany}
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Refinery Tool Cards */}
      <section>
        <h2 className="text-lg font-bold text-foreground mb-4">
          The Refinery — Your Workshop
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {REFINERY_TOOLS.map((tool) => {
            // Find count for this tool's artifact type
            const typeForTool = Object.entries(TYPE_TOOL_HREF).find(
              ([, href]) => href === tool.href
            )?.[0];
            const count = typeForTool ? artifactCounts[typeForTool] : 0;

            return (
              <Link
                key={tool.href}
                href={tool.href}
                className={`block rounded-2xl p-5 border transition-all hover:shadow-md ${tool.color}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className={`font-semibold mb-1 ${tool.accent}`}>
                    {tool.title}
                  </h3>
                  {count > 0 && (
                    <span className="text-xs font-medium text-sage-600 bg-sage-100 px-2 py-0.5 rounded-full flex-shrink-0">
                      {count} saved
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted leading-relaxed">
                  {tool.description}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Data & Privacy controls — JBS compliance */}
      <section className="border-t border-border pt-8">
        <h2 className="text-lg font-bold text-foreground mb-3">
          Your Data & Privacy
        </h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <Link
            href="/dashboard/settings"
            className="text-sm text-muted hover:text-foreground bg-white rounded-xl px-4 py-3 border border-border transition-colors"
          >
            Manage consent preferences
          </Link>
          <button
            onClick={() => {
              // TODO: Wire to data export API
              alert("Data export will be available soon.");
            }}
            className="text-sm text-muted hover:text-foreground bg-white rounded-xl px-4 py-3 border border-border transition-colors text-left"
          >
            Export all my data
          </button>
          <button
            onClick={() => {
              if (
                confirm(
                  "This will permanently delete all your data. This cannot be undone. Continue?"
                )
              ) {
                // TODO: Wire to data delete API
                alert("Data deletion will be available soon.");
              }
            }}
            className="text-sm text-earth-600 hover:text-earth-700 bg-white rounded-xl px-4 py-3 border border-border transition-colors text-left"
          >
            Delete all my data
          </button>
        </div>
      </section>
    </div>
  );
}
