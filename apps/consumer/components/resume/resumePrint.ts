/**
 * Shared resume -> print-to-PDF helper.
 *
 * Builds a print-optimized HTML document from a ResumeDocument and opens it in a
 * new window that auto-prints. ONE implementation shared by the Refinery
 * Application Tailor (ResumeWorkspace) and the Forge resume builder
 * (ResumeBuilder) -- the "unified PDF pattern" the Phase 7 spec calls for.
 *
 * A base resume (no target job) simply omits the subtitle line.
 */

import { type ResumeDocument, formatResumeDownload } from "./resumeModel";
import { escapeHtml } from "../../lib/escape-html";
import { buildResumeFilename } from "../../lib/resume-filename";

/** Build the print-optimized HTML for a resume. Exposed for testing/reuse. */
export function buildResumePrintHtml(doc: ResumeDocument): string {
  const text = formatResumeDownload(doc);
  const nameUpper = escapeHtml((doc.contact.name || "Resume").toUpperCase());
  const job = escapeHtml(doc.meta.targetJob || "");
  const company = escapeHtml(doc.meta.targetCompany || "");
  // The <title> becomes the browser's default "Save as PDF" filename -- slug it
  // to First-Last--Company--Role (Phase 2.6) rather than a spaced sentence.
  const nameTokens = (doc.contact.name || "").trim().split(/\s+/).filter(Boolean);
  const printTitle = escapeHtml(
    buildResumeFilename({
      firstName: nameTokens[0],
      lastName: nameTokens.length > 1 ? nameTokens.slice(1).join(" ") : undefined,
      company: doc.meta.targetCompany || "",
      role: doc.meta.targetJob || "",
      kind: "resume",
    }).replace(/\.docx$/, "")
  );

  const lines = text.split("\n");
  let bodyHtml = "";
  for (const rawLine of lines) {
    const rawTrimmed = rawLine.trim();
    if (!rawTrimmed) {
      bodyHtml += "<br>";
      continue;
    }
    const t = escapeHtml(rawTrimmed);
    if (/^[A-Z &]+$/.test(rawTrimmed) && rawTrimmed.length > 3 && !rawTrimmed.includes("|")) {
      bodyHtml += `<div class="section-header">${t}</div>`;
    } else if (rawTrimmed.startsWith("- ") || rawTrimmed.startsWith("* ")) {
      bodyHtml += `<div class="bullet">${escapeHtml(rawTrimmed.slice(2))}</div>`;
    } else if (rawTrimmed.includes("|") && /\b(19|20)\d{2}\b/.test(rawTrimmed)) {
      // Job/role line ("Title | Employer, 2021 - 2022") -- bold it to match the
      // DOCX hierarchy. The year guard keeps the contact line (no year) as body.
      bodyHtml += `<div class="job-title">${t}</div>`;
    } else {
      bodyHtml += `<div class="body-line">${t}</div>`;
    }
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${printTitle}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#1a1a1a;margin:0;padding:0.5in 0.5in 0.5in 0.5in;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .name{font-family:Georgia,serif;font-size:16pt;font-weight:bold;text-align:center;background:#1B2A4A;color:#fff;padding:8px 0;letter-spacing:0.05em}
  .subtitle{text-align:center;background:#1B2A4A;color:#B8C9E0;font-size:8pt;padding:3px 0 6px}
  .section-header{font-family:Georgia,serif;font-size:9pt;font-weight:bold;color:#1B2A4A;border-bottom:1.5px solid #1B2A4A;margin:12px 0 4px;padding-bottom:2px;text-transform:uppercase;letter-spacing:0.1em}
  .job-title{font-weight:bold;font-size:9pt;color:#1a1a1a;margin:8px 0 1px}
  .bullet{margin:2px 0 2px 14px;font-size:8.5pt;line-height:1.45}
  .bullet::before{content:"\\2022  ";color:#1B2A4A;font-weight:bold}
  .body-line{margin:2px 0;font-size:8.5pt;line-height:1.4}
  br{display:block;margin:3px 0}
  @media print{@page{size:letter;margin:0.4in 0.45in} body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head>
<body>
<div class="name">${nameUpper}</div>
${job || company ? `<div class="subtitle">${[job, company].filter(Boolean).join(" | ")}</div>` : ""}
${bodyHtml}
<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script>
</body></html>`;
}

/**
 * Open the resume in a new window and trigger the browser print dialog (Save as
 * PDF). The page comes from the same layout model as the PDF and Word downloads
 * (the HTML format of /api/forge/download), so the printed page matches them.
 * If that cannot be reached, the older print page below is used so printing
 * still works.
 */
export function printResumePdf(doc: ResumeDocument): void {
  // The window must open on the click itself, or the browser blocks it.
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(
    '<!doctype html><meta charset="utf-8"><title>Resume</title><p style="font:16px sans-serif;padding:24px">Getting your page ready...</p>'
  );
  w.document.close();
  const text = formatResumeDownload(doc);
  const nameTokens = (doc.contact.name || "").trim().split(/\s+/).filter(Boolean);
  fetch("/api/forge/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: text,
      type: "resume",
      format: "html",
      firstName: nameTokens[0],
      lastName: nameTokens.length > 1 ? nameTokens.slice(1).join(" ") : undefined,
      company: doc.meta.targetCompany || undefined,
      role: doc.meta.targetJob || undefined,
    }),
  })
    .then((res) => {
      if (!res.ok) throw new Error("html failed");
      return res.text();
    })
    .then((html) => {
      w.document.open();
      w.document.write(html);
      w.document.close();
      const go = () => {
        w.focus();
        w.print();
      };
      const fonts = (w.document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
      if (fonts && fonts.ready) void fonts.ready.then(() => setTimeout(go, 150));
      else setTimeout(go, 700);
    })
    .catch(() => {
      w.document.open();
      w.document.write(buildResumePrintHtml(doc));
      w.document.close();
    });
}
