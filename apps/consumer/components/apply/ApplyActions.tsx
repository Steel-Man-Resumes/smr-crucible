"use client";

/**
 * Apply ladder (Wave R / R8) + apply-link honesty (Phase 3.1) + Quick Apply
 * (Phase 3.3) + Fit Check (Phase 3.4).
 *
 * Surfaced the moment a tailored resume is ready (in the workspace) and on the
 * saved-job / Applications cards. The ladder, in order:
 *   1. apply_url         -> classified, honest label + expectation + prep list
 *   2. employer_website  -> same, when the direct link is missing or unreadable
 *   3. neither / invalid -> t.ROY drafts an application email + coaches where to
 *                           find the employer's address (draft-only, never sent)
 *
 * The apply link is no longer shown with a static "Apply now": classifyApplyUrl
 * reads where it actually goes (a real employer form, a job board that needs an
 * account, a Google/search hop) and says so plainly. An UNREADABLE link is never
 * rendered as a raw broken link -- we fall to the employer site or the email.
 *
 * Quick Apply attaches the user's EXISTING resume as-is (provenance
 * baseline_as_is -- never counted as tailored). Fit Check reads the saved JD
 * snapshot and the chosen resume and reports matches, evidence-linked gaps, and
 * a recommendation with a one-click route to the right next step.
 *
 * Applying doesn't flip status automatically (opening a link isn't applying), so
 * there is always an explicit "I applied" control that advances the tracker.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { classifyApplyUrl } from "@/lib/apply-destination";
import Link from "next/link";
import { usePremium } from "@/components/premium/PremiumGate";
import { toolIsOpen } from "@/lib/premium";

interface ApplyActionsProps {
  applicationId: string;
  applyUrl: string | null;
  employerWebsite: string | null;
  company: string;
  applied: boolean;
  /** Called after the application is marked applied, so the parent can refresh. */
  onApplied?: () => void;
  /** Real strengths (Forge) referenced only in the rung-3 email draft. */
  forgeStrengths?: string[];
  candidateName?: string;
  /**
   * The resume to use for Quick Apply / Fit Check. When absent we fall back to
   * the active baseline in localStorage (BaselineSelector's choice).
   */
  resumeArtifactId?: string | null;
}

interface EmailDraft {
  subject: string;
  body: string;
  whereToFind: string;
}

interface FitGap {
  requirement: string;
  evidenceInResume: string | null;
}
interface FitResult {
  matches: string[];
  gaps: FitGap[];
  recommendation: "as_is" | "fine_tune" | "full_tailor";
  rationale: string;
  jdFetchedAt: string | null;
  jdTruncated: boolean;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

function snapshotAge(iso: string | null, t: Translate): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return t("ageToday");
  if (days === 1) return t("ageYesterday");
  return t("ageDays", { days });
}

export function ApplyActions({
  applicationId,
  applyUrl,
  employerWebsite,
  company,
  applied,
  onApplied,
  forgeStrengths,
  candidateName,
  resumeArtifactId,
}: ApplyActionsProps) {
  const t = useTranslations("refineryResume.apply");
  const tp = useTranslations("refineryResume.premium");
  const [marking, setMarking] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<"subject" | "body" | null>(null);
  const [showPrep, setShowPrep] = useState(false);

  // Resume for Quick Apply / Fit Check: the prop, else the active baseline.
  const [baselineId, setBaselineId] = useState<string | null>(null);
  useEffect(() => {
    if (resumeArtifactId) return;
    try {
      setBaselineId(localStorage.getItem("active_baseline_id"));
    } catch {}
  }, [resumeArtifactId]);
  const resumeId = resumeArtifactId || baselineId;
  // One-click apply is a premium tool (lib/premium.ts). Unknown status: show
  // the button; the server checks every call.
  const { status: premium } = usePremium();
  const oneClickOpen = toolIsOpen(premium, "one_click_apply") !== false;

  const [checking, setChecking] = useState(false);
  const [fit, setFit] = useState<FitResult | null>(null);
  const [fitErr, setFitErr] = useState<string | null>(null);
  const [applyingAsIs, setApplyingAsIs] = useState(false);
  const [asIsDone, setAsIsDone] = useState(false);
  const [asIsErr, setAsIsErr] = useState<string | null>(null);
  // Phase 5 R1: the server says which version attaches and whether it is a
  // draft. A draft attaches only after the person chooses it, and says so.
  const [asIsDraftAsk, setAsIsDraftAsk] = useState<string | null>(null);
  const [asIsResult, setAsIsResult] = useState<{ number: number; status: "draft" | "finished" } | null>(null);

  // Apply-ladder rung selection with honesty: prefer the direct apply link, but
  // only when it is READABLE. An unreadable link never renders -- fall to the
  // employer site, else the email rung.
  const applyClass = classifyApplyUrl(applyUrl);
  const siteClass = classifyApplyUrl(employerWebsite);
  const applyLinkUnreadable = !!applyUrl && applyClass.kind === "invalid";

  let chosenUrl: string | null = null;
  let chosen = applyClass;
  if (applyUrl && applyClass.kind !== "invalid") {
    chosenUrl = applyUrl;
    chosen = applyClass;
  } else if (employerWebsite && siteClass.kind !== "invalid") {
    chosenUrl = employerWebsite;
    chosen = siteClass;
  }

  async function markApplied() {
    setMarking(true);
    try {
      await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: applicationId, status: "applied" }),
      });
      onApplied?.();
    } catch {}
    setMarking(false);
  }

  async function draftEmail() {
    setDrafting(true);
    setDraftErr(null);
    try {
      const res = await fetch("/api/apply-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId,
          forgeContext: { strengths: forgeStrengths || [], name: candidateName || "" },
        }),
      });
      if (res.ok) {
        setDraft(await res.json());
      } else {
        const e = await res.json().catch(() => ({}));
        setDraftErr(e.error || t("draftEmailError"));
      }
    } catch {
      setDraftErr(t("draftEmailError"));
    }
    setDrafting(false);
  }

  async function checkFit() {
    if (!resumeId) return;
    setChecking(true);
    setFitErr(null);
    try {
      const res = await fetch("/api/fit-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, artifactId: resumeId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFit({
          matches: data.matches || [],
          gaps: data.gaps || [],
          recommendation: data.recommendation || "fine_tune",
          rationale: data.rationale || "",
          jdFetchedAt: data.jdFetchedAt || null,
          jdTruncated: !!data.jdTruncated,
        });
      } else if (res.status === 404 && (data.error === "no_jd_snapshot" || data.error === "application_not_found")) {
        setFitErr(t("noPosting"));
      } else {
        setFitErr(data.error === "resume_not_found" ? t("resumeNotFound") : t("fitError"));
      }
    } catch {
      setFitErr(t("fitError"));
    }
    setChecking(false);
  }

  async function applyAsIs(acceptDraft = false) {
    if (!resumeId) return;
    setApplyingAsIs(true);
    setAsIsErr(null);
    try {
      const res = await fetch("/api/quick-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, artifactId: resumeId, ...(acceptDraft ? { acceptDraft: true } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAsIsDone(true);
        setAsIsDraftAsk(null);
        if (data?.revision) setAsIsResult({ number: data.revision.number, status: data.revision.status });
      } else if (res.status === 409 && data.error === "draft") {
        setAsIsDraftAsk(data.message || t("draftStill"));
      } else {
        // A locked or unavailable sponsored tool says why in plain words (lib/premium.ts).
        const premiumWords = data.code === "premium_locked" || data.code === "premium_unavailable";
        setAsIsErr(
          data.error === "resume_not_found"
            ? t("resumeNotFound")
            : premiumWords && typeof data.error === "string"
              ? data.error
              : t("attachError")
        );
      }
    } catch {
      setAsIsErr(t("attachError"));
    }
    setApplyingAsIs(false);
  }

  async function copy(which: "subject" | "body", text: string) {
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
    setCopied(which);
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
  }

  if (applied) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-t-amber-bright border border-t-amber bg-t-panel-2">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t("applied")}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        {chosenUrl ? (
          <a
            href={chosenUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="t-focus inline-flex items-center gap-1.5 px-4 py-2 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright transition-colors"
          >
            {chosen.kind === "employer_ats"
              ? `${t("dest.employer_ats.label")}${chosen.host ? ` (${chosen.host})` : ""}`
              : chosen.kind === "job_board" || chosen.kind === "aggregator" || chosen.kind === "employer_site"
                ? t(`dest.${chosen.kind}.label`, { host: chosen.host || t(`dest.${chosen.kind}.default`) })
                : t(`dest.${chosen.kind}.label`)}
            <span aria-hidden="true">&#8599;</span>
          </a>
        ) : (
          <button
            onClick={draftEmail}
            disabled={drafting}
            className="t-focus inline-flex items-center px-4 py-2 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright transition-colors disabled:opacity-50"
          >
            {drafting ? t("drafting") : t("draftEmail")}
          </button>
        )}

        <button
          onClick={markApplied}
          disabled={marking}
          className="t-focus px-3 py-2 bg-t-panel-2 border border-t-line text-xs font-medium text-t-phos hover:border-t-phos-dim hover:text-t-white transition-colors disabled:opacity-50"
        >
          {marking ? "..." : t("iApplied")}
        </button>
      </div>

      {/* Honest expectation for the chosen apply link. */}
      {chosenUrl && (
        <div className="text-[11px] text-t-phos-dim">
          <p>{t(`dest.${chosen.kind}.expectation`)}</p>
          {chosen.prep.length > 0 && (
            <>
              <button
                onClick={() => setShowPrep((s) => !s)}
                className="t-focus mt-1 text-t-steel hover:text-t-white transition-colors"
                aria-expanded={showPrep}
              >
                {showPrep ? t("hidePrep") : t("showPrep")}
              </button>
              {showPrep && (
                <ul className="mt-1 ml-4 list-disc space-y-0.5">
                  {chosen.prep.map((p, i) => (
                    <li key={i}>{t(`dest.${chosen.kind}.prep.${i}`)}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {/* The direct link was unreadable -- say so plainly. We already fell to the
          next rung above, so this is context, not a dead end. */}
      {applyLinkUnreadable && (
        <p className="text-[11px] text-t-amber-bright">
          {t("unreadable")}{" "}
          {chosenUrl ? t("useSite") : t("useEmail")}
        </p>
      )}

      {!chosenUrl && !applyLinkUnreadable && !draft && (
        <p className="text-[11px] text-t-phos-dim">
          {t("noLinkSaved")}
        </p>
      )}

      {draftErr && <p className="text-xs text-t-red">{draftErr}</p>}

      {/* Quick Apply + Fit Check -- only when we have a resume to use. */}
      {resumeId && (
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <button
            onClick={checkFit}
            disabled={checking}
            className="t-focus px-3 py-1.5 bg-t-panel-2 border border-t-line text-xs font-medium text-t-phos hover:border-t-phos-dim hover:text-t-white transition-colors disabled:opacity-50"
          >
            {checking ? t("checkingFit") : t("checkFit")}
          </button>
          {asIsDone ? (
            <span className="text-[11px] text-t-amber-bright" data-testid="quick-apply-done">
              {asIsResult
                ? asIsResult.status === "finished"
                  ? t("attachedFinished", { number: asIsResult.number })
                  : t("attachedDraft", { number: asIsResult.number })
                : t("attachedCurrent")}
            </span>
          ) : asIsDraftAsk ? (
            <span className="text-[11px] text-t-phos" data-testid="quick-apply-draft">
              {asIsDraftAsk}{" "}
              <button
                onClick={() => applyAsIs(true)}
                disabled={applyingAsIs}
                className="t-focus underline underline-offset-2 hover:text-t-white disabled:opacity-50"
              >
                {t("attachDraft")}
              </button>
            </span>
          ) : !oneClickOpen ? (
            <span className="text-[11px] text-t-phos-dim" data-testid="one-click-locked">
              {t("oneClickLocked", { tool: tp("tool.one_click_apply") })}{" "}
              <Link href="/dashboard/settings#premium" className="underline underline-offset-2 hover:text-t-white">
                {t("howToGet")}
              </Link>
              {". "}
              {t.rich("youCanStill", {
                link: (chunks) => (
                  <Link href={`/dashboard/application-tailor?job=${applicationId}`} className="underline underline-offset-2 hover:text-t-white">
                    {chunks}
                  </Link>
                ),
              })}
            </span>
          ) : (
            <button
              onClick={() => applyAsIs()}
              disabled={applyingAsIs}
              className="t-focus px-3 py-1.5 bg-t-panel-2 border border-t-line text-xs font-medium text-t-phos hover:border-t-phos-dim hover:text-t-white transition-colors disabled:opacity-50"
            >
              {applyingAsIs ? t("attaching") : t("applyAsIs")}
            </button>
          )}
        </div>
      )}
      {fitErr && <p className="text-xs text-t-red">{fitErr}</p>}
      {asIsErr && <p className="text-xs text-t-red">{asIsErr}</p>}

      {/* Fit Check result. */}
      {fit && (
        <div className="mt-1 bg-t-panel-2 border border-t-line p-3 text-xs">
          <p className="font-semibold text-t-white mb-1">{t(`rec.${fit.recommendation}`)}</p>
          {fit.rationale && <p className="text-t-phos mb-2">{fit.rationale}</p>}

          {fit.matches.length > 0 && (
            <div className="mb-2">
              <p className="text-[11px] font-semibold text-t-phos-dim mb-0.5">{t("linesUp")}</p>
              <ul className="ml-4 list-disc space-y-0.5 text-t-phos">
                {fit.matches.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          {fit.gaps.length > 0 && (
            <div className="mb-2">
              <p className="text-[11px] font-semibold text-t-phos-dim mb-0.5">{t("gaps")}</p>
              <ul className="ml-4 list-disc space-y-0.5 text-t-phos">
                {fit.gaps.map((g, i) => (
                  <li key={i}>
                    {g.requirement}
                    {g.evidenceInResume && (
                      <span className="text-t-phos-dim"> {t("partlyThere", { evidence: g.evidenceInResume })}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* One-click route to the recommended next step. */}
          <div className="flex items-center gap-2 flex-wrap mt-2">
            {fit.recommendation === "as_is" ? (
              !asIsDone && oneClickOpen && (
                <button
                  onClick={() => applyAsIs()}
                  disabled={applyingAsIs}
                  className="t-focus px-3 py-1.5 bg-t-amber text-white text-xs font-bold hover:bg-t-amber-bright transition-colors disabled:opacity-50"
                >
                  {applyingAsIs ? t("attaching") : t("useAsIs")}
                </button>
              )
            ) : (
              <a
                href={`/dashboard/application-tailor?job=${applicationId}`}
                className="t-focus px-3 py-1.5 bg-t-amber text-white text-xs font-bold hover:bg-t-amber-bright transition-colors"
              >
                {fit.recommendation === "fine_tune" ? t("fineTune") : t("tailor")}
              </a>
            )}
          </div>

          {(fit.jdFetchedAt || fit.jdTruncated) && (
            <p className="text-[11px] text-t-phos-dim mt-2">
              {fit.jdFetchedAt && t("basedOn", { age: snapshotAge(fit.jdFetchedAt, t) })}
              {fit.jdTruncated && ` ${t("trimmed")}`}
            </p>
          )}
        </div>
      )}

      {draft && (
        <div className="mt-1 bg-t-panel-2 border border-t-line p-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-xs font-semibold text-t-white">{t("subject", { subject: draft.subject })}</p>
            <button
              onClick={() => copy("subject", draft.subject)}
              className="t-focus text-[11px] text-t-phos-dim hover:text-t-white flex-shrink-0"
            >
              {copied === "subject" ? t("copied") : t("copy")}
            </button>
          </div>
          <p className="text-xs text-t-phos whitespace-pre-line leading-relaxed">{draft.body}</p>
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={() => copy("body", draft.body)}
              className="t-focus px-3 py-1.5 bg-t-amber text-white text-xs font-bold hover:bg-t-amber-bright transition-colors"
            >
              {copied === "body" ? t("copied") : t("copyEmail")}
            </button>
            <button
              onClick={draftEmail}
              disabled={drafting}
              className="text-xs text-t-phos-dim hover:text-t-white disabled:opacity-50"
            >
              {drafting ? "..." : t("redraft")}
            </button>
          </div>
          <p className="text-[11px] text-t-phos-dim bg-t-panel border border-t-line px-3 py-2 mt-3 leading-relaxed">
            <span className="font-semibold text-t-white">{t("whereToSend")}</span> {draft.whereToFind}
          </p>
          <p className="text-[11px] text-t-phos-dim mt-2">
            {t("attachNote")}
          </p>
        </div>
      )}
    </div>
  );
}
