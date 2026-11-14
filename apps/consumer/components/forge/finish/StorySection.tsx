"use client";

/**
 * "Your story": the narrative reconstruction from the Forge analysis
 * leads the output, followed by visible evidence and skills. Deeper hurdle
 * coaching continues in the Refinery.
 */

import React from "react";
import { useLocale, useTranslations } from "next-intl";
import { storyIsChecked, type StoryVerification } from "@/lib/story-verification";
import { escapeHtml as escHtml } from "@/lib/escape-html";
import { formatSalaryRange } from "@/lib/metric-emphasis";

export interface Strength {
  title: string;
  evidence: string;
  source: string;
}

export interface Skill {
  name: string;
  category: string;
}

export interface Resource {
  name: string;
  type: string;
  description: string;
  url?: string;
}

export interface Barrier {
  type: string;
  user_narrative?: string;
  resources: Resource[];
  legal_notes?: string;
}

export interface CareerPath {
  title: string;
  industry?: string;
  match_reason: string;
  salary_range?: string;
  next_steps: string[];
}

export interface ForgeOutput {
  story_verification?: StoryVerification;
  narrative?: {
    headline?: string;
    summary?: string;
    reflection?: string;
    strengths?: Strength[];
  };
  readiness_stage?: string;
  strengths?: Strength[];
  skills?: Skill[];
  barriers?: Barrier[];
  career_paths?: CareerPath[];
}

export function StorySection({
  output,
  strengthsHeading,
  careersHeading,
  reportChecks,
  spotlight = false,
  onRevisit,
  onRetry,
  retrying = false,
  quiet = false,
}: {
  output: ForgeOutput;
  strengthsHeading: string;
  careersHeading: string;
  reportChecks: string[];
  spotlight?: boolean;
  onRevisit?: () => void;
  onRetry?: () => void;
  retrying?: boolean;
  /** Troy 2026-10-20: the page is already re-checking quietly; no draft note until that has failed twice. */
  quiet?: boolean;
}) {
  const t = useTranslations("forgeFinish.story");
  const locale = useLocale();
  const checked = storyIsChecked(output);
  const narrative = output.narrative || {};
  // A claim the checker took off leaves an empty field: nothing blank is shown.
  const strengths = (output.strengths || narrative.strengths || []).filter((x) => x?.title?.trim() && x?.evidence?.trim());
  const skills = (output.skills || []).filter((x) => x?.name?.trim());
  const barriers = output.barriers || [];
  const careerPaths = output.career_paths || [];

  function handlePrintAnalysisPdf() {
    if (!checked) return;
    const html = analysisToStandaloneHtml(output, narrative, t, locale);
    const w = window.open("", "_blank");
    if (!w) { alert(t("popupAlert")); return; }
    w.document.write(html);
    w.document.close();
  }

  return (
    <section id="finish-story" aria-labelledby="finish-story-heading" className={`scroll-mt-20 ${spotlight ? "border border-t-amber bg-t-panel p-5 sm:p-6" : ""}`}>
      <h2 id="finish-story-heading" className="text-xl font-bold text-t-white">
        {t("heading")}
      </h2>
      <p className="mb-6 mt-1 text-sm text-t-phos-dim">
        {t("intro")}
      </p>

      {!checked && !quiet && <div role="status" className="mb-4 border border-t-amber p-4 text-sm text-t-phos">
        <p>{t("draftNote")}</p>
        {onRetry && <button type="button" disabled={retrying} onClick={onRetry} className="t-focus mt-2 min-h-touch underline">{retrying ? t("retrying") : t("retry")}</button>}
      </div>}
      {/* Header / Narrative */}
      <div className={spotlight ? "mb-4" : "mb-10"}>
        <h3 className="mb-3 text-2xl font-bold text-t-white">
          {narrative.headline || t("headlineFallback")}
        </h3>
        {narrative.summary && (
          <p className="mb-3 whitespace-pre-line text-base leading-relaxed text-t-phos">
            {narrative.summary}
          </p>
        )}
        {narrative.reflection && (
          <p className="text-sm italic text-t-amber-bright">
            {narrative.reflection}
          </p>
        )}
      </div>

      {spotlight && strengths.length > 0 && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2" aria-label={t("workAria")}>
          {strengths.slice(0, 6).map((strength, index) => (
            <div key={`${strength.title}-${index}`} className="border border-t-line bg-t-bg p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-t-amber-bright">{t("fromWork")}</p>
              <p className="mt-1 text-sm font-semibold text-t-white">{strength.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-t-phos">{strength.evidence}</p>
            </div>
          ))}
        </div>
      )}
      {spotlight && <p className="mb-4 text-xs text-t-phos-dim">{t("firstDraft")}</p>}
      {spotlight && onRevisit && (
        <button type="button" onClick={onRevisit} className="t-focus mb-5 min-h-touch border border-t-line bg-t-bg px-4 py-2 text-sm font-semibold text-t-white hover:border-t-amber">
          {t("revisit")}
        </button>
      )}
        {/* Skills */}
        {skills.length > 0 && (
          <section id="skills" className="mb-10 scroll-mt-20">
            <h3 className="text-lg font-bold text-t-white mb-4">
              {t("skillsHeading")}
            </h3>
            <div className="flex flex-wrap gap-2">
              {skills.map((s, i) => {
                const kind =
                  s.category === "hard"
                    ? "hard"
                    : s.category === "soft"
                      ? "soft"
                      : "transfer";
                return (
                  <span
                    key={i}
                    className="px-3 py-1.5 text-sm font-medium border"
                    style={{
                      color: `var(--t-skill-${kind})`,
                      borderColor: `var(--t-skill-${kind})`,
                      background: `var(--t-skill-${kind}-bg)`,
                    }}
                  >
                    {s.name}
                  </span>
                );
              })}
            </div>
            <div className="flex gap-4 mt-3 text-xs text-t-phos-dim">
              <span className="flex items-center gap-1">
                <span
                  className="w-2.5 h-2.5 border"
                  style={{
                    background: "var(--t-skill-hard-bg)",
                    borderColor: "var(--t-skill-hard)",
                  }}
                />{" "}
                {t("legendTechnical")}
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="w-2.5 h-2.5 border"
                  style={{
                    background: "var(--t-skill-soft-bg)",
                    borderColor: "var(--t-skill-soft)",
                  }}
                />{" "}
                {t("legendPeople")}
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="w-2.5 h-2.5 border"
                  style={{
                    background: "var(--t-skill-transfer-bg)",
                    borderColor: "var(--t-skill-transfer)",
                  }}
                />{" "}
                {t("legendTransferable")}
              </span>
            </div>
          </section>
        )}

      <details open={!spotlight} className={spotlight ? "border-t border-t-line pt-3" : ""}>
        <summary className={spotlight ? "t-focus cursor-pointer text-sm font-semibold text-t-amber-bright" : "sr-only"}>{t("directions")}</summary>
        <div className={spotlight ? "pt-5" : ""}>

        {/* Report lines that may say more about a credential than the person did.
            Flagged, never removed: the person knows what they hold. */}
        {reportChecks.length > 0 && (
          <section className="mb-10 border border-t-amber bg-t-panel px-4 py-3">
            <p className="mb-1 text-xs font-bold uppercase text-t-amber-bright">{t("checkLinesHeading")}</p>
            <p className="text-xs leading-relaxed text-t-phos">
              {t("checkLinesBody", { count: reportChecks.length })}
            </p>
            <ul className="mt-1.5 space-y-1">
              {reportChecks.map((c, i) => (
                <li key={i} className="text-[11px] leading-relaxed text-t-phos">{`"${c}"`}</li>
              ))}
            </ul>
          </section>
        )}

        {/* Strengths */}
        {!spotlight && strengths.length > 0 && (
          <section id="strengths" className="mb-10 scroll-mt-20">
            <h3 className="text-lg font-bold text-t-white mb-4">
              {strengthsHeading}
            </h3>
            <div className="space-y-3">
              {strengths.map((s, i) => (
                <div
                  key={i}
                  className="bg-t-panel p-5 border border-t-line"
                >
                  <h4 className="font-semibold text-t-amber-bright">{s.title}</h4>
                  <p className="text-sm text-t-phos mt-1">{s.evidence}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mb-8 border border-t-line bg-t-panel p-5">
          <h3 className="text-lg font-semibold">{t("barriersTitle")}</h3>
          <p className="mt-2 text-sm leading-relaxed text-t-phos">{t("barriersBody")}</p>
          {barriers.length > 0 && <p className="mt-2 text-sm text-t-phos-dim">{t("flagged", { list: barriers.map((b) => b.type.replace(/_/g, " ")).join(", ") })}</p>}
          <p className="mt-2 text-xs text-t-phos-dim">{t("disclaimer")}</p>
        </section>

        {/* Career Paths */}
        {careerPaths.length > 0 && (
          <section id="careers" className="mb-10 scroll-mt-20">
            <h3 className="text-lg font-bold text-t-white mb-4">
              {careersHeading}
            </h3>
            <div className="space-y-4">
              {careerPaths.map((cp, i) => (
                <div
                  key={i}
                  className="bg-t-panel p-5 border border-t-line"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="font-semibold text-t-white">
                        {cp.title}
                      </h4>
                      {cp.industry && (
                        <p className="text-sm text-t-phos-dim">{cp.industry}</p>
                      )}
                    </div>
                    {cp.salary_range && (
                      <span className="text-sm font-medium text-t-amber-bright whitespace-nowrap">
                        {cp.salary_range}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-t-phos mt-2">
                    {cp.match_reason}
                  </p>
                  {(cp.next_steps?.length ?? 0) > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-t-phos-dim uppercase mb-1">
                        {t("nextSteps")}
                      </p>
                      <ol className="text-sm text-t-phos-dim space-y-1 list-decimal list-inside">
                        {(cp.next_steps ?? []).map((step, j) => (
                          <li key={j}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

      <button
        onClick={handlePrintAnalysisPdf}
        disabled={!checked}
        className="t-focus w-full border border-t-line bg-transparent px-4 py-3 text-sm font-medium text-t-phos-dim transition-colors hover:border-t-phos-dim hover:text-t-white"
      >
        {t("print")}
      </button>
        </div>
      </details>
    </section>
  );
}

type StoryT = (key: string, values?: Record<string, string | number>) => string;

function analysisToStandaloneHtml(
  output: ForgeOutput,
  narrative: Record<string, unknown>,
  t: StoryT,
  locale: string
): string {
  const date = new Date().toLocaleDateString(locale === "es" ? "es" : "en-US", { year: "numeric", month: "long", day: "numeric" });
  const headline = String(narrative.headline || t("pdf.headlineFallback"));
  const summary = String(narrative.summary || "");
  // P1.6 (Codex 3, Troy decision): the downloadable report SCRUBS the private
  // `reflection` line (it acknowledges the person's journey/record). Barriers,
  // legal context, and resources stay -- that is this report's purpose.

  let body = "";

  if (summary) body += `<h2>${t("pdf.story")}</h2><p class="narrative">${escHtml(summary)}</p>`;

  if (output.strengths?.length) {
    body += `<h2>${t("pdf.strengths")}</h2>`;
    for (const s of output.strengths) {
      body += `<div class="strength"><p class="strength-title">${escHtml(s.title)}</p><p>${escHtml(s.evidence)}</p></div>`;
    }
  }

  if (output.skills?.length) {
    const grouped: Record<string, string[]> = {};
    for (const sk of output.skills) {
      if (!grouped[sk.category]) grouped[sk.category] = [];
      grouped[sk.category].push(sk.name);
    }
    const catLabel = (c: string) => (c === "hard" ? t("pdf.catHard") : c === "soft" ? t("pdf.catSoft") : c === "transferable" ? t("pdf.catTransferable") : c);
    body += `<h2>${t("pdf.skills")}</h2>`;
    for (const [cat, names] of Object.entries(grouped)) {
      body += `<p><strong>${escHtml(catLabel(cat))}:</strong> ${names.map(escHtml).join(", ")}</p>`;
    }
  }

  if (output.career_paths?.length) {
    body += `<h2>${t("pdf.careerPaths")}</h2>`;
    for (const cp of output.career_paths) {
      body += `<div class="career-path">`;
      body += `<h3>${escHtml(cp.title)}${cp.salary_range ? ` <span style="font-weight:normal;color:#666;">${escHtml(formatSalaryRange(cp.salary_range))}</span>` : ""}</h3>`;
      body += `<p>${escHtml(cp.match_reason)}</p>`;
      if (cp.next_steps.length) {
        body += `<ul>${cp.next_steps.map((s) => `<li>${escHtml(s)}</li>`).join("")}</ul>`;
      }
      body += `</div>`;
    }
  }

  if (output.barriers?.length) {
    body += `<h2>${t("barriersTitle")}</h2><p>${t("pdf.flagged", { list: output.barriers.map((b) => escHtml(b.type.replace(/_/g, " "))).join(", ") })}</p><p>${t("pdf.planner")}</p>`;
  }

  return `<!DOCTYPE html><html${locale === "es" ? ' lang="es"' : ""}><head><meta charset="utf-8"><title>${t("pdf.docTitle")}</title>
<style>
body{font-family:Georgia,serif;max-width:8in;margin:0 auto;padding:.5in;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.header{background:#1B2A4A;color:#fff;padding:24px;margin-bottom:28px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.header h1{margin:0 0 4px;font-size:18pt;text-transform:uppercase;letter-spacing:2px}
.header p{margin:0;color:#B8C9E0;font-size:11pt}
.date{color:#B8C9E0;font-size:9pt;margin-top:6px}
.private-banner{background:#f4f1ea;border-left:3px solid #B8860B;padding:10px 14px;margin-bottom:24px;font-size:10pt;line-height:1.5;color:#3a3a3a}
h2{font-size:14pt;color:#1B2A4A;border-bottom:2px solid #1B2A4A;padding-bottom:4px;margin-top:28px}
.narrative{font-size:12pt;line-height:1.8}
.strength{margin-bottom:14px}
.strength-title{font-weight:bold;font-size:11pt;color:#1B2A4A;margin:0 0 2px}
.career-path{margin-bottom:18px;padding:10px 14px;border-left:3px solid #B8C9E0}
.career-path h3{margin:0 0 4px;font-size:11pt;color:#1B2A4A}
.career-path p{margin:0 0 4px;font-size:10pt;color:#444}
ul{margin:4px 0;padding-left:18px}li{font-size:10pt;line-height:1.6}
.footer{margin-top:32px;padding-top:12px;border-top:1px solid #ddd;font-size:9pt;color:#888;text-align:center}
@media print{@page{margin:.5in;size:letter}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.no-print{display:none!important}}
</style></head><body>
<div class="header"><h1>${escHtml(headline)}</h1><p>${t("pdf.subtitle")}</p><p class="date">${date}</p></div>
<div class="private-banner"><strong>${t("pdf.privateLead")}</strong> ${t("pdf.privateBody")}</div>
${body}
<div class="footer no-print"><p>Steel Man Resumes &middot; steelmanresumes.com</p><p>${t("pdf.footerPrint")}</p></div>
<script>window.onload=function(){setTimeout(function(){window.print()},500)}</script>
</body></html>`;
}
