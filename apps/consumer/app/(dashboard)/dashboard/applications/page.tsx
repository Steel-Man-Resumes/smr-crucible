"use client";

/**
 * Application Tracker — Pipeline board
 *
 * Shows saved jobs progressing through: Saved → Applied → Interviewing → Offered
 * Each status has cross-tool suggestions to help the user prepare.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { TierGate } from "@/components/TierGate";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Application {
  id: string;
  job_title: string;
  company: string;
  location: string | null;
  salary: string | null;
  status: string;
  status_updated_at: string;
  applied_at: string | null;
  notes: string | null;
  created_at: string;
}

type PipelineStatus =
  | "saved"
  | "applied"
  | "heard_back"
  | "interviewing"
  | "offered";

const PIPELINE: {
  status: PipelineStatus;
  label: string;
  color: string;
  bgColor: string;
  suggestion: { text: string; href: string } | null;
}[] = [
  {
    status: "saved",
    label: "Saved",
    color: "text-gray-600",
    bgColor: "bg-gray-50",
    suggestion: {
      text: "Build a targeted resume for this job",
      href: "/dashboard/resume-builder",
    },
  },
  {
    status: "applied",
    label: "Applied",
    color: "text-sky-600",
    bgColor: "bg-sky-50",
    suggestion: {
      text: "Prep your disclosure plan",
      href: "/dashboard/disclosure",
    },
  },
  {
    status: "heard_back",
    label: "Heard Back",
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    suggestion: {
      text: "Practice interviewing for this role",
      href: "/dashboard/interview",
    },
  },
  {
    status: "interviewing",
    label: "Interviewing",
    color: "text-warm-600",
    bgColor: "bg-warm-50",
    suggestion: {
      text: "Review your disclosure script",
      href: "/dashboard/disclosure",
    },
  },
  {
    status: "offered",
    label: "Offered",
    color: "text-sage-600",
    bgColor: "bg-sage-50",
    suggestion: null,
  },
];

const TERMINAL_STATUSES = ["declined", "rejected"];

// ─── Main ───────────────────────────────────────────────────────────────────

export default function ApplicationsPageWrapper() {
  return (
    <TierGate requiredTier="client">
      <ApplicationsPage />
    </TierGate>
  );
}

function ApplicationsPage() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const loadApps = useCallback(async () => {
    try {
      const res = await fetch("/api/applications");
      if (res.ok) {
        const data = await res.json();
        setApps(data.applications || []);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  async function updateStatus(id: string, status: string) {
    setUpdating(id);
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (res.ok) {
        await loadApps();
      }
    } catch {}
    setUpdating(null);
  }

  const activeApps = apps.filter(
    (a) => !TERMINAL_STATUSES.includes(a.status)
  );
  const archivedApps = apps.filter((a) =>
    TERMINAL_STATUSES.includes(a.status)
  );

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-12 justify-center text-muted">
        <div className="w-5 h-5 border-2 border-sage-600 border-t-transparent rounded-full animate-spin" />
        Loading applications...
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-foreground mb-2">
        Application Tracker
      </h1>
      <p className="text-body text-muted mb-6">
        Track your job applications from saved to offered. Each step has tools
        to help you prepare.
      </p>

      {activeApps.length === 0 && archivedApps.length === 0 && (
        <div className="text-center py-16">
          <p className="text-muted mb-4">
            No applications yet. Save jobs from the Job Board to start
            tracking.
          </p>
          <Link
            href="/dashboard/jobs"
            className="inline-flex items-center px-5 py-3 bg-sage-600 text-white text-sm font-medium rounded-xl hover:bg-sage-700 transition-colors"
          >
            Find Jobs &rarr;
          </Link>
        </div>
      )}

      {activeApps.length > 0 && (
        <>
          {/* Pipeline summary */}
          <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
            {PIPELINE.map((stage) => {
              const count = activeApps.filter(
                (a) => a.status === stage.status
              ).length;
              return (
                <div
                  key={stage.status}
                  className={`flex-1 min-w-[80px] rounded-xl p-3 border border-border text-center ${stage.bgColor}`}
                >
                  <span className={`text-xl font-bold block ${stage.color}`}>
                    {count}
                  </span>
                  <span className="text-xs text-muted">{stage.label}</span>
                </div>
              );
            })}
          </div>

          {/* Application cards grouped by status */}
          <div className="space-y-8">
            {PIPELINE.map((stage) => {
              const stageApps = activeApps.filter(
                (a) => a.status === stage.status
              );
              if (stageApps.length === 0) return null;

              const nextStage = PIPELINE[PIPELINE.indexOf(stage) + 1];

              return (
                <section key={stage.status}>
                  <h2
                    className={`text-sm font-semibold uppercase tracking-wide mb-3 ${stage.color}`}
                  >
                    {stage.label} ({stageApps.length})
                  </h2>
                  <div className="space-y-3">
                    {stageApps.map((app) => (
                      <div
                        key={app.id}
                        className={`rounded-xl border border-border p-4 ${stage.bgColor}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-foreground">
                              {app.job_title}
                            </h3>
                            <p className="text-sm text-muted">{app.company}</p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted flex-wrap">
                              {app.location && <span>{app.location}</span>}
                              {app.salary && (
                                <span className="font-medium text-sage-600">
                                  {app.salary}
                                </span>
                              )}
                              <span>{timeAgo(app.status_updated_at)}</span>
                            </div>
                          </div>

                          {/* Status actions */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {nextStage && (
                              <button
                                onClick={() =>
                                  updateStatus(app.id, nextStage.status)
                                }
                                disabled={updating === app.id}
                                className="px-3 py-1.5 bg-white border border-border text-xs font-medium rounded-lg hover:bg-sage-50 transition-colors disabled:opacity-50"
                              >
                                {updating === app.id
                                  ? "..."
                                  : `Move to ${nextStage.label}`}
                              </button>
                            )}
                            <button
                              onClick={() =>
                                updateStatus(app.id, "rejected")
                              }
                              className="text-xs text-gray-400 hover:text-gray-600"
                              title="Remove"
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 14 14"
                                fill="none"
                              >
                                <path
                                  d="M1 1l12 12M13 1L1 13"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Cross-tool suggestion */}
                        {stage.suggestion && (
                          <Link
                            href={stage.suggestion.href}
                            className="mt-3 flex items-center gap-2 px-3 py-2 bg-white/70 rounded-lg border border-border text-xs text-sage-600 hover:text-sage-700 hover:bg-white transition-colors"
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 12 12"
                              fill="none"
                              className="flex-shrink-0"
                            >
                              <path
                                d="M6 1v10M1 6h10"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                              />
                            </svg>
                            {stage.suggestion.text} for {app.company}
                          </Link>
                        )}

                        {/* Offered celebration */}
                        {stage.status === "offered" && (
                          <div className="mt-3 bg-sage-100 rounded-lg px-3 py-2 border border-sage-200">
                            <p className="text-xs text-sage-700 font-medium">
                              Congratulations! You earned this.
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}

      {/* Archived */}
      {archivedApps.length > 0 && (
        <section className="mt-10 pt-6 border-t border-border">
          <h2 className="text-sm font-semibold text-muted mb-3">
            Archived ({archivedApps.length})
          </h2>
          <div className="space-y-2">
            {archivedApps.map((app) => (
              <div
                key={app.id}
                className="flex items-center justify-between rounded-lg px-3 py-2 bg-gray-50 border border-border opacity-60"
              >
                <div>
                  <span className="text-sm text-foreground">
                    {app.job_title}
                  </span>
                  <span className="text-xs text-muted ml-2">
                    {app.company}
                  </span>
                </div>
                <span className="text-xs text-muted capitalize">
                  {app.status.replace("_", " ")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
