"use client";

/**
 * Application Tracker — Pipeline board
 *
 * Shows saved jobs progressing through: Saved → Applied → Interviewing → Offered
 * Each status has cross-tool suggestions to help the user prepare.
 */

import { TroyWork } from "@crucible/consumer-ui";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { readOwnForgeSession } from "@/lib/forge-carry";
import Link from "next/link";
import { NEXT_STEP_CHANGED_EVENT } from "@/lib/guidedTour";
import { TierGate } from "@/components/TierGate";
import { ApplyActions } from "@/components/apply/ApplyActions";
import { StatusBadges } from "@/components/apply/StatusBadges";
import { oneActionCostLine, toolRemaining, draftFailureWords, type UsageView } from "@/lib/usage-view";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Application {
  id: string;
  job_title: string;
  company: string;
  location: string | null;
  salary: string | null;
  apply_url?: string | null;
  employer_website?: string | null;
  resume_artifact_id?: string | null;
  cover_letter_artifact_id?: string | null;
  disclosure_plan_id?: string | null;
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
  borderColor: string;
  suggestion: { text: string; href: string } | null;
}[] = [
  {
    status: "saved",
    label: "Saved",
    color: "text-t-phos-dim",
    bgColor: "bg-t-panel",
    borderColor: "border-t-line",
    suggestion: {
      text: "Build a targeted resume for this job",
      href: "/dashboard/application-tailor",
    },
  },
  {
    status: "applied",
    label: "Applied",
    color: "text-t-steel",
    bgColor: "bg-t-panel",
    borderColor: "border-t-steel",
    suggestion: {
      text: "Prep your disclosure plan",
      href: "/dashboard/disclosure",
    },
  },
  {
    status: "heard_back",
    label: "Heard Back",
    color: "text-t-amber-bright",
    bgColor: "bg-t-panel",
    borderColor: "border-t-amber",
    suggestion: {
      text: "Practice interviewing for this role",
      href: "/dashboard/interview",
    },
  },
  {
    status: "interviewing",
    label: "Interviewing",
    color: "text-t-amber-bright",
    bgColor: "bg-t-panel-2",
    borderColor: "border-t-amber",
    suggestion: {
      text: "Review your disclosure script",
      href: "/dashboard/disclosure",
    },
  },
  {
    status: "offered",
    label: "Offered",
    color: "text-t-phos",
    bgColor: "bg-t-panel",
    borderColor: "border-t-phos",
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
  // Shared-computer rule: only a local run marked as this user's is read.
  const ownerUid = useSession().data?.user?.id;
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState("");
  const [interviewReady, setInterviewReady] = useState<string | null>(null);

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
    setStatusNotice("");
    setInterviewReady(null);
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error("status_not_saved");
      await loadApps();
      window.dispatchEvent(new Event(NEXT_STEP_CHANGED_EVENT));
      if (status === "interviewing") {
        setInterviewReady(id);
        setStatusNotice("You got the interview. Let’s prepare with the job and documents you saved.");
      } else setStatusNotice("Application updated.");
    } catch { setStatusNotice("That update did not save. Your application is unchanged. Try again."); }
    setUpdating(null);
  }

  // --- Follow-up drafting (Stage 6 materials) ---
  const [followUpFor, setFollowUpFor] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<
    Record<string, { subject: string; body: string }>
  >({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // The cost line before a draft, from the allowance the tool spends from (/api/usage).
  const [followUpUsage, setFollowUpUsage] = useState<UsageView | null>(null);
  const [followUpErrors, setFollowUpErrors] = useState<Record<string, string>>({});
  const loadFollowUpUsage = () =>
    fetch("/api/usage", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => setFollowUpUsage(v && typeof v.kind === "string" ? (v as UsageView) : null))
      .catch(() => setFollowUpUsage(null));
  useEffect(() => { loadFollowUpUsage(); }, []);
  const followUpCost = oneActionCostLine(followUpUsage ? toolRemaining(followUpUsage, "follow-up") : null);

  function forgeStrengths(): string[] {
    try {
      const s = readOwnForgeSession(ownerUid) || {};
      const raw = s?.forgeOutput?.strengths;
      if (Array.isArray(raw)) {
        return raw.map((x: any) => (typeof x === "string" ? x : x?.title)).filter(Boolean);
      }
    } catch {}
    return [];
  }

  async function draftFollowUp(id: string) {
    setFollowUpFor(id);
    setFollowUpErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
    let failure: string | null = null;
    try {
      const res = await fetch("/api/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: id, forgeContext: { strengths: forgeStrengths() } }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.subject || data.body)) {
        setFollowUps((prev) => ({ ...prev, [id]: { subject: data.subject || "", body: data.body || "" } }));
      } else {
        failure = draftFailureWords(res.ok ? 500 : res.status, data?.error);
      }
    } catch {
      failure = draftFailureWords(0);
    }
    if (failure) setFollowUpErrors((prev) => ({ ...prev, [id]: failure! }));
    setFollowUpFor(null);
    loadFollowUpUsage();
  }

  async function copyFollowUp(id: string) {
    const f = followUps[id];
    if (!f) return;
    const text = `Subject: ${f.subject}\n\n${f.body}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
  }

  const activeApps = apps.filter(
    (a) => !TERMINAL_STATUSES.includes(a.status)
  );
  const archivedApps = apps.filter((a) =>
    TERMINAL_STATUSES.includes(a.status)
  );

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-12 justify-center text-t-phos-dim">
        <TroyWork compact decorative />
        Loading applications...
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <header id={activeApps.length === 0 && archivedApps.length > 0 ? "refinery-tool-application-overview" : undefined}><h1 className="text-2xl font-bold text-t-white mb-2">
        Application Tracker
      </h1>
      <p className="text-base text-t-phos-dim mb-6">
        Track your job applications from saved to offered. Each step has tools
        to help you prepare.
      </p></header>

      {statusNotice && <div role="status" className="mb-5 border border-t-amber bg-t-panel p-4 text-t-phos">
        <p>{statusNotice}</p>
        {interviewReady && <Link href={`/dashboard/interview?applicationId=${encodeURIComponent(interviewReady)}`} className="t-focus mt-2 inline-flex min-h-touch items-center text-t-amber-bright underline">Prepare for this interview with t.ROY</Link>}
      </div>}
      <p className="mb-5 text-sm text-t-phos-dim">You can <Link href="/dashboard/interview" className="t-focus text-t-amber-bright underline">practice an interview anytime</Link>. An invitation moves that job straight to preparation.</p>

      {activeApps.length === 0 && archivedApps.length === 0 && (
        <div id="refinery-tool-application-overview" className="text-center py-16">
          <p className="text-t-phos-dim mb-4">
            No applications yet. Save jobs from the Job Board to start
            tracking.
          </p>
          <Link
            href="/dashboard/jobs"
            className="t-focus inline-flex items-center px-5 py-3 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright transition-colors"
          >
            Find Jobs &rarr;
          </Link>
        </div>
      )}

      {activeApps.length > 0 && (
        <>
          {/* Pipeline summary */}
          <div id="refinery-tool-application-overview" className="flex gap-2 mb-6 overflow-x-auto pb-2">
            {PIPELINE.map((stage) => {
              const count = activeApps.filter(
                (a) => a.status === stage.status
              ).length;
              return (
                <div
                  key={stage.status}
                  className={`flex-1 min-w-[80px] p-3 border text-center ${stage.bgColor} ${stage.borderColor}`}
                >
                  <span className={`text-xl font-bold block ${stage.color}`}>
                    {count}
                  </span>
                  <span className="text-xs text-t-phos-dim">{stage.label}</span>
                </div>
              );
            })}
          </div>

          {/* Application cards grouped by status */}
          <div className="space-y-8" data-tour="applications-list">
            {PIPELINE.map((stage) => {
              const stageApps = activeApps.filter(
                (a) => a.status === stage.status
              );
              if (stageApps.length === 0) return null;

              const nextStage = PIPELINE[PIPELINE.indexOf(stage) + 1];

              return (
                <section key={stage.status}>
                  <h2
                    className={`text-sm font-semibold uppercase mb-3 ${stage.color}`}
                  >
                    {stage.label} ({stageApps.length})
                  </h2>
                  <div className="space-y-3">
                    {stageApps.map((app) => (
                      <div
                        key={app.id}
                        className={`border p-4 ${stage.bgColor} ${stage.borderColor}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-t-white">
                              {app.job_title}
                            </h3>
                            <p className="text-sm text-t-phos-dim">{app.company}</p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-t-phos-dim flex-wrap">
                              {app.location && <span>{app.location}</span>}
                              {app.salary && (
                                <span className="font-medium text-t-amber-bright">
                                  {app.salary}
                                </span>
                              )}
                              <span>{timeAgo(app.status_updated_at)}</span>
                            </div>
                            {/* Per-job status (R1): what's done for this job. */}
                            <div className="mt-2">
                              <StatusBadges
                                hasResume={!!app.resume_artifact_id}
                                hasCover={!!app.cover_letter_artifact_id}
                                hasDisclosure={!!app.disclosure_plan_id}
                              />
                            </div>
                          </div>

                          {/* Status actions. The "saved" stage's apply + mark-
                              applied lives in the ApplyActions block below (the
                              full apply ladder); later stages just advance. */}
                          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                            {["saved", "applied", "heard_back"].includes(app.status) && <button type="button" disabled={updating === app.id} onClick={() => updateStatus(app.id, "interviewing")} className="t-focus min-h-touch border border-t-amber px-3 py-1.5 text-xs font-semibold text-t-amber-bright disabled:opacity-50">I got an interview</button>}
                            {stage.status !== "saved" && nextStage && (
                              <button
                                onClick={() =>
                                  updateStatus(app.id, nextStage.status)
                                }
                                disabled={updating === app.id}
                                className="t-focus px-3 py-1.5 bg-t-panel-2 border border-t-line text-xs font-medium text-t-phos hover:border-t-phos-dim transition-colors disabled:opacity-50"
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
                              className="text-xs text-t-phos-dim hover:text-t-red"
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

                        {/* Apply ladder (R8): the saved stage's real apply step
                            -- direct link, employer site, or a t.ROY-drafted
                            email -- plus the explicit "I applied" that advances
                            the tracker. */}
                        {stage.status === "saved" && (
                          <div className="mt-3">
                            {app.resume_artifact_id && (
                              <p className="text-xs text-t-phos-dim mb-2">
                                Your tailored resume is ready. Apply when you are:
                              </p>
                            )}
                            <ApplyActions
                              applicationId={app.id}
                              applyUrl={app.apply_url || null}
                              employerWebsite={app.employer_website || null}
                              company={app.company}
                              applied={false}
                              onApplied={loadApps}
                              forgeStrengths={forgeStrengths()}
                              resumeArtifactId={app.resume_artifact_id || null}
                            />
                          </div>
                        )}

                        {/* Cross-tool suggestion (the saved-stage "tailor" nudge
                            drops once the resume exists). */}
                        {stage.suggestion &&
                          !(stage.status === "saved" && !!app.resume_artifact_id) && (
                          <Link
                            href={`${stage.suggestion.href}?${stage.suggestion.href.endsWith("application-tailor") ? "job" : "applicationId"}=${encodeURIComponent(app.id)}`}
                            className="t-focus mt-3 flex items-center gap-2 px-3 py-2 bg-t-panel-2 border border-t-line text-xs text-t-amber-bright hover:text-t-amber transition-colors"
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

                        {/* Follow-up drafting (past "saved") */}
                        {["applied", "heard_back", "interviewing"].includes(
                          app.status
                        ) && (
                          <div className="mt-3">
                            <p className="text-[11px] text-t-phos-dim mb-1" data-testid="follow-up-cost-line">{followUpCost.line}</p>
                            {followUpErrors[app.id] && (
                              <p role="alert" className="text-xs text-t-amber-bright mb-2">{followUpErrors[app.id]}</p>
                            )}
                            {!followUps[app.id] ? (
                              <button
                                onClick={() => draftFollowUp(app.id)}
                                disabled={followUpFor === app.id || !followUpCost.canRun}
                                className="t-focus inline-flex items-center gap-2 px-3 py-2 bg-t-panel-2 border border-t-line text-xs font-medium text-t-amber-bright hover:text-t-amber transition-colors disabled:opacity-50"
                              >
                                {followUpFor === app.id
                                  ? "Drafting your follow-up..."
                                  : "Draft a follow-up message"}
                              </button>
                            ) : (
                              <div className="bg-t-panel-2 border border-t-line p-3">
                                <p className="text-xs font-semibold text-t-white">
                                  Subject: {followUps[app.id].subject}
                                </p>
                                <p className="text-xs text-t-phos whitespace-pre-line mt-2 leading-relaxed">
                                  {followUps[app.id].body}
                                </p>
                                <div className="flex items-center gap-3 mt-3">
                                  <button
                                    onClick={() => copyFollowUp(app.id)}
                                    className="t-focus px-3 py-1.5 bg-t-amber text-white text-xs font-bold hover:bg-t-amber-bright"
                                  >
                                    {copiedId === app.id ? "Copied" : "Copy"}
                                  </button>
                                  <button
                                    onClick={() => draftFollowUp(app.id)}
                                    disabled={followUpFor === app.id || !followUpCost.canRun}
                                    className="text-xs text-t-phos-dim hover:text-t-white disabled:opacity-50"
                                  >
                                    {followUpFor === app.id ? "..." : "Redraft"}
                                  </button>
                                  <span className="text-[11px] text-t-phos-dim ml-auto">
                                    Saved to your materials. Review before sending.
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Offered celebration */}
                        {stage.status === "offered" && (
                          <div className="mt-3 bg-t-panel-2 px-3 py-2 border border-t-phos">
                            <p className="text-xs text-t-phos font-medium">
                              You have an offer. Confirm the terms and your next step.
                            </p>
                            <ul className="mt-2 list-disc pl-4 text-xs text-t-phos space-y-1">
                              <li>Ask your contact which conditions remain and which documents to bring.</li>
                              <li>Confirm your start date, time, location and transportation.</li>
                              <li>After you actually start, tell your program contact if you choose to share.</li>
                              <li>Set your own check-in for your first week. An offer alone is not a confirmed start.</li>
                            </ul>
                            <Link href="/dashboard/resources#support" className="t-focus mt-2 inline-flex min-h-touch items-center text-xs underline">Get help with the next step</Link>
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
        <section className="mt-10 pt-6 border-t border-t-line">
          <h2 className="text-sm font-semibold text-t-phos-dim mb-3">
            Archived ({archivedApps.length})
          </h2>
          <div className="space-y-2">
            {archivedApps.map((app) => (
              <div
                key={app.id}
                className="flex items-center justify-between px-3 py-2 bg-t-panel border border-t-line opacity-60"
              >
                <div>
                  <span className="text-sm text-t-white">
                    {app.job_title}
                  </span>
                  <span className="text-xs text-t-phos-dim ml-2">
                    {app.company}
                  </span>
                </div>
                <span className="text-xs text-t-phos-dim capitalize">
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
