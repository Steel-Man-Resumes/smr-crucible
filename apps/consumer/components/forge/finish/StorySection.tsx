"use client";

/**
 * "Your story": the narrative reconstruction from the Forge analysis
 * (strengths, skills, hurdles with resources, career paths), moved from the
 * output page with its content unchanged. It sits below the resume now, so
 * the first thing a person sees is the page they came for.
 */

import React from "react";
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
  const checked = storyIsChecked(output);
  const narrative = output.narrative || {};
  // A claim the checker took off leaves an empty field: nothing blank is shown.
  const strengths = (output.strengths || narrative.strengths || []).filter((x) => x?.title?.trim() && x?.evidence?.trim());
  const skills = (output.skills || []).filter((x) => x?.name?.trim());
  const barriers = output.barriers || [];
  const careerPaths = output.career_paths || [];

  function handlePrintAnalysisPdf() {
    if (!checked) return;
    const html = analysisToStandaloneHtml(output, narrative);
    const w = window.open("", "_blank");
    if (!w) { alert("Please allow popups for this site to save the PDF."); return; }
    w.document.write(html);
    w.document.close();
  }

  return (
    <section id="finish-story" aria-labelledby="finish-story-heading" className={`scroll-mt-20 ${spotlight ? "border border-t-amber bg-t-panel p-5 sm:p-6" : ""}`}>
      <h2 id="finish-story-heading" className="text-xl font-bold text-t-white">
        The story behind your resume
      </h2>
      <p className="mb-6 mt-1 text-sm text-t-phos-dim">
        t.ROY's reading of the work you gave us. You decide whether this sounds like you.
      </p>

      {!checked && !quiet && <div role="status" className="mb-4 border border-t-amber p-4 text-sm text-t-phos">
        <p>Story draft: its fact check is incomplete. Your resume and saved corrections are still here. Check the story before exporting it.</p>
        {onRetry && <button type="button" disabled={retrying} onClick={onRetry} className="t-focus mt-2 min-h-touch underline">{retrying ? "Checking story..." : "Retry story check"}</button>}
      </div>}
      {/* Header / Narrative */}
      <div className={spotlight ? "mb-4" : "mb-10"}>
        <h3 className="mb-3 text-2xl font-bold text-t-white">
          {narrative.headline || "Your Story, Reforged"}
        </h3>
        {narrative.summary && (
          <p className="mb-3 text-base leading-relaxed text-t-phos">
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
        <div className="mb-5 grid gap-3 sm:grid-cols-2" aria-label="Work behind this story">
          {strengths.slice(0, 2).map((strength, index) => (
            <div key={`${strength.title}-${index}`} className="border border-t-line bg-t-bg p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-t-amber-bright">From your work</p>
              <p className="mt-1 text-sm font-semibold text-t-white">{strength.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-t-phos">{strength.evidence}</p>
            </div>
          ))}
        </div>
      )}
      {spotlight && <p className="mb-4 text-xs text-t-phos-dim">This is a starting account of your work. The line checks below keep the resume honest.</p>}
      {spotlight && onRevisit && (
        <button type="button" onClick={onRevisit} className="t-focus mb-5 min-h-touch border border-t-line bg-t-bg px-4 py-2 text-sm font-semibold text-t-white hover:border-t-amber">
          Change what t.ROY should lead with
        </button>
      )}
      <details open={!spotlight} className={spotlight ? "border-t border-t-line pt-3" : ""}>
        <summary className={spotlight ? "t-focus cursor-pointer text-sm font-semibold text-t-amber-bright" : "sr-only"}>Explore your strengths, next paths, and resources</summary>
        <div className={spotlight ? "pt-5" : ""}>

        {/* Report lines that may say more about a credential than the person did.
            Flagged, never removed: the person knows what they hold. */}
        {reportChecks.length > 0 && (
          <section className="mb-10 border border-t-amber bg-t-panel px-4 py-3">
            <p className="mb-1 text-xs font-bold uppercase text-t-amber-bright">Check these lines</p>
            <p className="text-xs leading-relaxed text-t-phos">
              {reportChecks.length === 1 ? "This line" : "These lines"} may say more about a card, license or certification than you told us. If you hold it, you can ignore this. If you don't, don't tell an employer you do.
            </p>
            <ul className="mt-1.5 space-y-1">
              {reportChecks.map((c, i) => (
                <li key={i} className="text-[11px] leading-relaxed text-t-phos">{`"${c}"`}</li>
              ))}
            </ul>
          </section>
        )}
  
        {/* Strengths */}
        {strengths.length > 0 && (
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
  
        {/* Skills */}
        {skills.length > 0 && (
          <section id="skills" className="mb-10 scroll-mt-20">
            <h3 className="text-lg font-bold text-t-white mb-4">
              Skills We Found
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
                Technical
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="w-2.5 h-2.5 border"
                  style={{
                    background: "var(--t-skill-soft-bg)",
                    borderColor: "var(--t-skill-soft)",
                  }}
                />{" "}
                People
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="w-2.5 h-2.5 border"
                  style={{
                    background: "var(--t-skill-transfer-bg)",
                    borderColor: "var(--t-skill-transfer)",
                  }}
                />{" "}
                Transferable
              </span>
            </div>
          </section>
        )}
  
        {/* Barriers with Resources */}
        {barriers.length > 0 && (
          <section className="mb-10">
            <h3 className="text-lg font-bold text-t-white mb-4">
              Your Hurdles, and What Can Help
            </h3>
            {/* Coaching-not-legal-advice disclaimer (F6): the analysis can touch
                expungement/ban-the-box, so it carries the same guard the disclosure
                planner does. */}
            <p className="text-xs text-t-phos mb-4 bg-t-panel-2 border border-t-steel/40 px-3 py-2">
              <span className="font-semibold text-t-white">This is career coaching, not legal advice.</span>{" "}
              Laws change and every situation is different. For legal guidance, contact a reentry attorney or free legal aid in your area.
            </p>
            <div className="space-y-4">
              {barriers.map((b, i) => (
                <div
                  key={i}
                  className="bg-t-panel p-5 border border-t-line"
                >
                  <h4 className="font-semibold text-t-white capitalize">
                    {b.type.replace(/_/g, " ")}
                  </h4>
                  {b.user_narrative && (
                    <p className="text-sm text-t-phos-dim mt-1 italic">
                      &ldquo;{b.user_narrative}&rdquo;
                    </p>
                  )}
                  {b.legal_notes && (
                    <p className="text-sm text-t-steel mt-2 bg-t-panel-2 border border-t-steel/40 px-3 py-2">
                      {b.legal_notes}
                    </p>
                  )}
                  {(b.resources?.length ?? 0) > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-medium text-t-phos-dim uppercase">
                        Resources
                      </p>
                      {(b.resources ?? []).map((r, j) => (
                        <div
                          key={j}
                          className="bg-t-panel-2 px-4 py-3 border border-t-line"
                        >
                          <p className="font-medium text-sm text-t-white">{r.name}</p>
                          <p className="text-xs text-t-phos-dim mt-0.5">
                            {r.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
  
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
                        Next Steps
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
        Print or save your story as a PDF
      </button>
        </div>
      </details>
    </section>
  );
}

function analysisToStandaloneHtml(
  output: ForgeOutput,
  narrative: Record<string, unknown>
): string {
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const headline = String(narrative.headline || "Your Career Profile");
  const summary = String(narrative.summary || "");
  // P1.6 (Codex 3, Troy decision): the downloadable report SCRUBS the private
  // `reflection` line (it acknowledges the person's journey/record). Barriers,
  // legal context, and resources stay -- that is this report's purpose.

  let body = "";

  if (summary) body += `<h2>Your Story</h2><p class="narrative">${escHtml(summary)}</p>`;

  if (output.strengths?.length) {
    body += `<h2>Your Strengths</h2>`;
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
    body += `<h2>Skills</h2>`;
    for (const [cat, names] of Object.entries(grouped)) {
      body += `<p><strong>${escHtml(cat)}:</strong> ${names.map(escHtml).join(", ")}</p>`;
    }
  }

  if (output.career_paths?.length) {
    body += `<h2>Career Paths</h2>`;
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
    body += `<h2>Resources for Your Situation</h2>`;
    for (const b of output.barriers) {
      body += `<div class="career-path">`;
      body += `<h3>${escHtml(b.type.replace(/_/g, " "))}</h3>`;
      if (b.legal_notes) body += `<p><em>${escHtml(b.legal_notes)}</em></p>`;
      if (b.resources.length) {
        body += `<ul>${b.resources.map((r) => `<li><strong>${escHtml(r.name)}:</strong> ${escHtml(r.description)}</li>`).join("")}</ul>`;
      }
      body += `</div>`;
    }
    // Coaching-not-legal-advice disclaimer (F6).
    body += `<p style="margin-top:14px;font-size:9pt;color:#555;background:#f4f4f4;border-left:3px solid #B8C9E0;padding:8px 12px;"><strong>This is career coaching, not legal advice.</strong> Laws change and every situation is different. For legal guidance, contact a reentry attorney or free legal aid in your area.</p>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Career Analysis (Steel Man Resumes)</title>
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
<div class="header"><h1>${escHtml(headline)}</h1><p>Your Forge Analysis from Steel Man Resumes</p><p class="date">${date}</p></div>
<div class="private-banner"><strong>Private planning document.</strong> This analysis is for your own use as you plan your next steps. It speaks candidly about your situation, barriers, and resources, so keep it for yourself. Your resume and cover letter are the documents to share with employers.</div>
${body}
<div class="footer no-print"><p>Steel Man Resumes &middot; steelmanresumes.com</p><p>File &rsaquo; Print &rsaquo; Save as PDF to download</p></div>
<script>window.onload=function(){setTimeout(function(){window.print()},500)}</script>
</body></html>`;
}
