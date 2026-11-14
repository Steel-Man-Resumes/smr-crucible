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
import { useTranslations } from "next-intl";
import { NEXT_STEP_CHANGED_EVENT } from "@/lib/guidedTour";
import { TierGate } from "@/components/TierGate";
import { useServerText } from "@/components/ServerTextProvider";
import { ApplyActions } from "@/components/apply/ApplyActions";
import { StatusBadges } from "@/components/apply/StatusBadges";
import { CheckAndFinish } from "@/components/lanes/CheckAndFinish";
import { revisionStatusOf, type TailoredStatus } from "@/lib/tailor-readiness";
import { toolRemaining, type UsageView } from "@/lib/usage-view";

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
  color: string;
  bgColor: string;
  borderColor: string;
  suggestion: { href: string } | null;
}[] = [
  {
    status: "saved",
    color: "text-t-phos-dim",
    bgColor: "bg-t-panel",
    borderColor: "border-t-line",
    suggestion: {
      href: "/dashboard/application-tailor",
    },
  },
  {
    status: "applied",
    color: "text-t-steel",
    bgColor: "bg-t-panel",
    borderColor: "border-t-steel",
    suggestion: {
      href: "/dashboard/disclosure",
    },
  },
  {
    status: "heard_back",
    color: "text-t-amber-bright",
    bgColor: "bg-t-panel",
    borderColor: "border-t-amber",
    suggestion: {
      href: "/dashboard/interview",
    },
  },
  {
    status: "interviewing",
    color: "text-t-amber-bright",
    bgColor: "bg-t-panel-2",
    borderColor: "border-t-amber",
    suggestion: {
      href: "/dashboard/disclosure",
    },
  },
  {
    status: "offered",
    color: "text-t-phos",
    bgColor: "bg-t-panel",
    borderColor: "border-t-phos",
    suggestion: null,
  },
];

const TERMINAL_STATUSES = ["declined", "rejected"];

/**
 * W13 (2026-10-28): the tracker says what the Tailor says. The newest
 * revision of the tailored resume decides "finished" or "draft" (the same
 * read as the Tailor's Check and finish line); a draft gets the same way out.
 */
function TailoredReadiness({ artifactId }: { artifactId: string }) {
  const t = useTranslations("refineryResume.applications");
  const [status, setStatus] = useState<TailoredStatus | null>(null);
  useEffect(() => {
    let live = true;
    setStatus(null);
    fetch(`/api/revisions?artifactId=${encodeURIComponent(artifactId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setStatus(revisionStatusOf(j)))
      .catch(() => live && setStatus("unknown"));
    return () => {
      live = false;
    };
  }, [artifactId]);
  const line = status === "finished" ? t("readiness.finished") : status === "draft" ? t("readiness.draft") : status === "unknown" ? t("readiness.unknown") : null;
  if (!line) return null;
  return (
    <div className="mb-2" data-testid="tracker-readiness" data-status={status ?? ""}>
      <p className="text-xs text-t-phos-dim">{line}</p>
      {status === "draft" && <CheckAndFinish artifactId={artifactId} status="draft" showBadge={false} />}
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export default function ApplicationsPageWrapper() {
  return (
    <TierGate requiredTier="client">
      <ApplicationsPage />
    </TierGate>
  );
}

function ApplicationsPage() {
  const t = useTranslations("refineryResume.applications");
  const ts = useServerText();
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
        setStatusNotice(t("interviewReady"));
      } else setStatusNotice(t("updated"));
    } catch { setStatusNotice(t("updateFailed")); }
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
  // The cost line the usage helper builds, in the person's language. A reason the server gave stays as it is.
  const followUpCost = ((r: ReturnType<typeof toolRemaining> | null): { line: string; canRun: boolean } => {
    const cost = t("cost.base");
    if (!r) return { line: cost, canRun: true };
    if (r.paused) return { line: t("cost.paused"), canRun: false };
    if (r.blockedReason) return { line: ts(r.blockedReason), canRun: false };
    if (r.left === null) return { line: cost, canRun: true };
    if (r.left <= 0) return { line: `${cost} ${t("cost.none")}`, canRun: false };
    return { line: `${cost} ${t("cost.left", { left: r.left })}`, canRun: true };
  })(followUpUsage ? toolRemaining(followUpUsage, "follow-up") : null);
  const draftFailureWords = (status: number, error?: unknown): string => {
    const said = typeof error === "string" && error.trim() && error.length < 300 ? error.trim() : "";
    if (status === 401) return t("failure.401");
    if (status === 429 || status === 403) return said || t("failure.allowance");
    if (status === 404) return t("failure.404");
    return t("failure.other");
  };

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
    const text = `${t("followUpSubject", { subject: f.subject })}\n\n${f.body}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
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
        {t("loading")}
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <header id={activeApps.length === 0 && archivedApps.length > 0 ? "refinery-tool-application-overview" : undefined}><h1 className="text-2xl font-bold text-t-white mb-2">
        {t("title")}
      </h1>
      <p className="text-base text-t-phos-dim mb-6">
        {t("intro")}
      </p></header>

      {statusNotice && <div role="status" className="mb-5 border border-t-amber bg-t-panel p-4 text-t-phos">
        <p>{statusNotice}</p>
        {interviewReady && <Link href={`/dashboard/interview?applicationId=${encodeURIComponent(interviewReady)}`} className="t-focus mt-2 inline-flex min-h-touch items-center text-t-amber-bright underline">{t("prepInterview")}</Link>}
      </div>}
      <p className="mb-5 text-sm text-t-phos-dim">{t.rich("practiceAnytime", { link: (chunks) => <Link href="/dashboard/interview" className="t-focus text-t-amber-bright underline">{chunks}</Link> })}</p>

      {activeApps.length === 0 && archivedApps.length === 0 && (
        <div id="refinery-tool-application-overview" className="text-center py-16">
          <p className="text-t-phos-dim mb-4">
            {t("empty")}
          </p>
          <Link
            href="/dashboard/jobs"
            className="t-focus inline-flex items-center px-5 py-3 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright transition-colors"
          >
            {t("findJobs")}
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
                  <span className="text-xs text-t-phos-dim">{t(`stage.${stage.status}`)}</span>
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
                    {t(`stage.${stage.status}`)} ({stageApps.length})
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
                              <span>{timeAgo(app.status_updated_at, t)}</span>
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
                            {["saved", "applied", "heard_back"].includes(app.status) && <button type="button" disabled={updating === app.id} onClick={() => updateStatus(app.id, "interviewing")} className="t-focus min-h-touch border border-t-amber px-3 py-1.5 text-xs font-semibold text-t-amber-bright disabled:opacity-50">{t("gotInterview")}</button>}
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
                                  : t("moveTo", { stage: t(`stage.${nextStage.status}`) })}
                              </button>
                            )}
                            <button
                              onClick={() =>
                                updateStatus(app.id, "rejected")
                              }
                              className="text-xs text-t-phos-dim hover:text-t-red"
                              title={t("remove")}
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
                              <TailoredReadiness artifactId={app.resume_artifact_id} />
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
                            {t("suggestionFor", { text: t(`suggestion.${stage.status}`), company: app.company })}
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
                                  ? t("drafting")
                                  : t("draftFollowUp")}
                              </button>
                            ) : (
                              <div className="bg-t-panel-2 border border-t-line p-3">
                                <p className="text-xs font-semibold text-t-white">
                                  {t("followUpSubject", { subject: followUps[app.id].subject })}
                                </p>
                                <p className="text-xs text-t-phos whitespace-pre-line mt-2 leading-relaxed">
                                  {followUps[app.id].body}
                                </p>
                                <div className="flex items-center gap-3 mt-3">
                                  <button
                                    onClick={() => copyFollowUp(app.id)}
                                    className="t-focus px-3 py-1.5 bg-t-amber text-white text-xs font-bold hover:bg-t-amber-bright"
                                  >
                                    {copiedId === app.id ? t("copied") : t("copy")}
                                  </button>
                                  <button
                                    onClick={() => draftFollowUp(app.id)}
                                    disabled={followUpFor === app.id || !followUpCost.canRun}
                                    className="text-xs text-t-phos-dim hover:text-t-white disabled:opacity-50"
                                  >
                                    {followUpFor === app.id ? "..." : t("redraft")}
                                  </button>
                                  <span className="text-[11px] text-t-phos-dim ml-auto">
                                    {t("savedMaterials")}
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
                              {t("offer.title")}
                            </p>
                            <ul className="mt-2 list-disc pl-4 text-xs text-t-phos space-y-1">
                              <li>{t("offer.1")}</li>
                              <li>{t("offer.2")}</li>
                              <li>{t("offer.3")}</li>
                              <li>{t("offer.4")}</li>
                            </ul>
                            <Link href="/dashboard/resources#support" className="t-focus mt-2 inline-flex min-h-touch items-center text-xs underline">{t("offer.help")}</Link>
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
            {t("archived", { count: archivedApps.length })}
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
                  {app.status === "declined" || app.status === "rejected" ? t(`archivedStatus.${app.status}`) : app.status.replace("_", " ")}
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

function timeAgo(dateStr: string, t: (key: string, values?: Record<string, string | number>) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("ago.now");
  if (mins < 60) return t("ago.mins", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("ago.hours", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("ago.days", { n: days });
  return new Date(dateStr).toLocaleDateString();
}
