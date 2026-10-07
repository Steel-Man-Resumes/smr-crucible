// L5-STUB: replaced at merge
"use client";

/**
 * Thin stand-in for the renderer lane's <ResumePage>: the old on-screen
 * preview moved here unchanged from the output page, plus a DRAFT line when
 * the page is not finished. The real component replaces this file at merge.
 */

import React from "react";
import { escapeHtml as escHtml } from "@/lib/escape-html";
import { splitForMetricEmphasis } from "@/lib/metric-emphasis";

export function ResumePage({ text, draft }: { text: string; draft: boolean }) {
  return (
    <div>
      {draft && (
        <p className="mx-auto mb-2 max-w-[600px] text-center text-[11px] font-bold uppercase tracking-wide text-t-amber-bright">
          Draft: not finished yet
        </p>
      )}
      <ResumePreview text={text} />
    </div>
  );
}

// ─── Resume Preview (mirrors the SMR standard DOCX layout visually) ─────────────────

const PREVIEW_SECTION_HEADERS = new Set([
  "PROFESSIONAL SUMMARY", "CAREER SUMMARY", "SUMMARY",
  "CORE COMPETENCIES", "CORE SKILLS", "KEY QUALIFICATIONS", "AREAS OF EXPERTISE", "TECHNICAL SKILLS",
  "PROFESSIONAL EXPERIENCE", "EXPERIENCE", "WORK HISTORY", "RELEVANT EXPERIENCE",
  "EDUCATION", "EDUCATION & CREDENTIALS", "EDUCATION & CERTIFICATIONS",
  "CERTIFICATIONS", "LICENSES & CERTIFICATIONS",
  "SKILLS", "MILITARY SERVICE", "VOLUNTEER EXPERIENCE",
  "JUSTICE ADVOCACY & COMMUNITY IMPACT", "COMMUNITY IMPACT",
]);

function isPreviewSectionHeader(text: string): boolean {
  return PREVIEW_SECTION_HEADERS.has(text.toUpperCase().replace(/[^A-Z\s&]/g, "").trim());
}

function ResumePreview({ text }: { text: string }) {
  const lines = text.split("\n");

  // Parse header block (name, headline, contact)
  const headerLines: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { if (headerLines.length > 0) break; continue; }
    if (isPreviewSectionHeader(t)) break;
    if (headerLines.length < 4) headerLines.push(t);
    else break;
  }

  const nameLine = headerLines[0] || "";
  const headlineLine = headerLines.length > 2 ? headerLines[1] : "";
  const contactLine =
    headerLines.find((l) => l.includes("|") || l.includes("@") || l.includes("•")) ||
    (headerLines.length > 1 ? headerLines[1] : "");

  // Parse body
  const headerSet = new Set(headerLines.map((l) => l.trim()));
  let pastHeader = false;
  const bodyNodes: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (!pastHeader) {
      if (headerSet.has(trimmed) || !trimmed) {
        if (headerSet.has(trimmed)) headerSet.delete(trimmed);
        if (headerSet.size === 0) pastHeader = true;
        continue;
      }
      pastHeader = true;
    }

    if (!trimmed) {
      bodyNodes.push(<div key={i} className="h-1.5" />);
      continue;
    }

    // Section header
    if (isPreviewSectionHeader(trimmed)) {
      bodyNodes.push(
        <div key={i} className="mt-3 mb-1 pb-0.5 border-b-2" style={{ borderColor: "#1B2A4A" }}>
          <span className="font-bold text-xs" style={{ fontFamily: "Georgia, serif", color: "#1B2A4A" }}>
            {trimmed.toUpperCase()}
          </span>
        </div>
      );
      continue;
    }

    // Bullet
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ")) {
      const bullet = trimmed.replace(/^[-*•]\s*/, "");
      const parts = splitForMetricEmphasis(bullet);
      bodyNodes.push(
        <div key={i} className="flex gap-1.5 pl-3 mb-0.5 leading-snug">
          <span className="flex-shrink-0 text-xs font-bold" style={{ color: "#1B2A4A" }}>&bull;</span>
          <span className="text-xs" style={{ color: "#1a1a1a" }}>
            {parts.map((p, j) =>
              p.bold ? <strong key={j}>{p.text}</strong> : <React.Fragment key={j}>{p.text}</React.Fragment>
            )}
          </span>
        </div>
      );
      continue;
    }

    // Competency line (3+ pipe/bullet separators)
    if ((trimmed.includes(" | ") || trimmed.includes(" • ")) && trimmed.split(/[|•]/).length >= 3) {
      bodyNodes.push(
        <div key={i} className="text-center text-xs font-bold mb-1" style={{ color: "#333333" }}>
          {trimmed}
        </div>
      );
      continue;
    }

    // Job title line (pipe-separated, no @)
    if (trimmed.includes("|") && !trimmed.includes("@")) {
      const parts = trimmed.split("|").map((p) => p.trim());
      bodyNodes.push(
        <div key={i} className="mt-2.5 mb-0.5 text-xs leading-snug">
          <span className="font-bold" style={{ color: "#1a1a1a" }}>{parts[0]}</span>
          {parts.slice(1).map((p, j) => (
            <span key={j} style={{ color: "#555555" }}>{"  |  "}{p}</span>
          ))}
        </div>
      );
      continue;
    }

    // Regular body text
    bodyNodes.push(
      <p key={i} className="text-xs leading-snug mb-0.5" style={{ color: "#1a1a1a" }}>
        {trimmed}
      </p>
    );
  }

  return (
    <div
      className="bg-white rounded shadow-md overflow-hidden border border-gray-200 mx-auto"
      style={{ maxWidth: 600, fontFamily: "Arial, sans-serif" }}
    >
      {/* Navy header block */}
      <div className="px-6 py-4 text-center" style={{ backgroundColor: "#1B2A4A" }}>
        {nameLine && (
          <p
            className="font-bold text-base"
            style={{ fontFamily: "Georgia, serif", color: "#FFFFFF" }}
          >
            {nameLine.toUpperCase()}
          </p>
        )}
        {headlineLine && headlineLine !== contactLine && (
          <p className="text-xs mt-0.5" style={{ color: "#B8C9E0" }}>{headlineLine}</p>
        )}
        {contactLine && (
          <p className="text-xs mt-0.5" style={{ color: "#FFFFFF" }}>{contactLine}</p>
        )}
      </div>
      {/* Body */}
      <div className="px-5 py-3">
        {bodyNodes}
      </div>
      <div className="px-5 pb-2 text-center">
        <p className="text-[10px] text-gray-400">Preview matches your .docx download</p>
      </div>
    </div>
  );
}

// ─── Print-to-PDF helpers ─────────────────────────────────────────────────────

export function resumeTextToStandaloneHtml(text: string): string {
  const lines = text.split("\n");

  const headerLines: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { if (headerLines.length > 0) break; continue; }
    if (isPreviewSectionHeader(t)) break;
    if (headerLines.length < 4) headerLines.push(t);
    else break;
  }

  const nameLine = headerLines[0] || "";
  const headlineLine = headerLines.length > 2 ? headerLines[1] : "";
  const contactLine =
    headerLines.find((l) => l.includes("|") || l.includes("@") || l.includes("•")) ||
    (headerLines.length > 1 ? headerLines[1] : "");

  let headerHtml = `<div style="background:#1B2A4A;padding:20px 24px;text-align:center;">`;
  if (nameLine) headerHtml += `<p style="font-family:Georgia,serif;color:#FFF;font-size:18pt;font-weight:bold;text-transform:uppercase;letter-spacing:2px;margin:0;">${escHtml(nameLine)}</p>`;
  if (headlineLine && headlineLine !== contactLine) headerHtml += `<p style="color:#B8C9E0;font-size:11pt;margin:4px 0 0;">${escHtml(headlineLine)}</p>`;
  if (contactLine) headerHtml += `<p style="color:#FFF;font-size:10pt;margin:4px 0 0;">${escHtml(contactLine)}</p>`;
  headerHtml += `</div>`;

  const headerSet = new Set(headerLines.map((l) => l.trim()));
  let pastHeader = false;
  let bodyHtml = `<div style="padding:12px 20px;">`;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!pastHeader) {
      if (headerSet.has(trimmed) || !trimmed) {
        if (headerSet.has(trimmed)) headerSet.delete(trimmed);
        if (headerSet.size === 0) pastHeader = true;
        continue;
      }
      pastHeader = true;
    }
    if (!trimmed) { bodyHtml += `<div style="height:6px;"></div>`; continue; }

    if (isPreviewSectionHeader(trimmed)) {
      bodyHtml += `<div style="margin-top:12px;margin-bottom:4px;padding-bottom:2px;border-bottom:2px solid #1B2A4A;"><span style="font-family:Georgia,serif;color:#1B2A4A;font-size:11pt;font-weight:bold;">${escHtml(trimmed.toUpperCase())}</span></div>`;
      continue;
    }
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ")) {
      const bullet = trimmed.replace(/^[-*•]\s*/, "");
      // Decide emphasis on the RAW text, then escape each segment. Escaping
      // first meant scanning for digits across HTML entities the escape had
      // just produced (the 39 in &#39;); splitting first removes that hazard
      // instead of working around it.
      const bHtml = splitForMetricEmphasis(bullet)
        .map((p) => (p.bold ? `<strong>${escHtml(p.text)}</strong>` : escHtml(p.text)))
        .join("");
      bodyHtml += `<div style="display:flex;gap:6px;padding-left:12px;margin-bottom:2px;line-height:1.4;"><span style="color:#1B2A4A;font-weight:bold;font-size:10pt;flex-shrink:0;">&bull;</span><span style="font-size:10pt;color:#1a1a1a;">${bHtml}</span></div>`;
      continue;
    }
    if ((trimmed.includes(" | ") || trimmed.includes(" • ")) && trimmed.split(/[|•]/).length >= 3) {
      bodyHtml += `<div style="text-align:center;font-size:10pt;font-weight:bold;margin-bottom:4px;color:#333;">${escHtml(trimmed)}</div>`;
      continue;
    }
    if (trimmed.includes("|") && !trimmed.includes("@")) {
      const parts = trimmed.split("|").map((p) => p.trim());
      const partsHtml = parts.map((p, i) =>
        i === 0 ? `<strong style="color:#1a1a1a;">${escHtml(p)}</strong>` : `<span style="color:#555;">&nbsp;&nbsp;|&nbsp;&nbsp;${escHtml(p)}</span>`
      ).join("");
      bodyHtml += `<div style="margin-top:10px;margin-bottom:2px;font-size:10pt;line-height:1.4;">${partsHtml}</div>`;
      continue;
    }
    bodyHtml += `<p style="font-size:10pt;line-height:1.4;margin-bottom:2px;color:#1a1a1a;">${escHtml(trimmed)}</p>`;
  }
  bodyHtml += `</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Resume (Steel Man Resumes)</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@media print{@page{margin:0.5in;size:letter}body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.no-print{display:none!important}}</style>
</head><body><div style="max-width:7.5in;margin:0 auto;background:#fff;">
${headerHtml}${bodyHtml}
<div class="no-print" style="padding:12px 20px;text-align:center;border-top:1px solid #eee;margin-top:16px;">
<p style="font-size:9pt;color:#999;">Steel Man Resumes &middot; steelmanresumes.com</p>
<p style="font-size:9pt;color:#aaa;">File &rsaquo; Print &rsaquo; Save as PDF to download</p></div>
</div><script>window.onload=function(){setTimeout(function(){window.print()},500)}</script>
</body></html>`;
}
