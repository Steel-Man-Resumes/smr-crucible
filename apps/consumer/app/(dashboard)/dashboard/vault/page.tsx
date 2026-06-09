"use client";

/**
 * My Materials (W5 vault) -- one place for everything the user has created:
 * resumes, cover letters, follow-ups, disclosure plans, and practice records.
 * Reuses the existing refinery_artifact store (private to the account, encrypted
 * at rest). View, save as PDF, or delete; resumes open in the builder.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

interface Artifact {
  id: string;
  artifact_type: string;
  target_context: { targetJob?: string; targetCompany?: string } | null;
  content: any;
  updated_at: string;
}

const GROUPS: { type: string; label: string }[] = [
  { type: "resume", label: "Resumes" },
  { type: "cover_letter", label: "Cover Letters" },
  { type: "follow_up", label: "Follow-up Messages" },
  { type: "disclosure_plan", label: "Disclosure Plans" },
  { type: "interview_prep", label: "Interview Practice" },
];

function fmt(s: string): string {
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function title(a: Artifact): string {
  const job = a.target_context?.targetJob;
  const co = a.target_context?.targetCompany;
  if (job && co) return `${job} -- ${co}`;
  if (job) return job;
  return fmt(a.updated_at);
}

/** Render an artifact's content as plain text for view/copy/download. */
function toText(a: Artifact): string {
  const c = a.content || {};
  switch (a.artifact_type) {
    case "cover_letter":
      return c.text || "";
    case "follow_up":
      return `Subject: ${c.subject || ""}\n\n${c.body || ""}`;
    case "disclosure_plan":
      return [
        c.timing_advice && `WHEN TO DISCLOSE\n${c.timing_advice}`,
        c.legal_context && `YOUR RIGHTS\n${c.legal_context}`,
        c.script && `YOUR SCRIPT\n${c.script}`,
        Array.isArray(c.tips) && c.tips.length && `TIPS\n- ${c.tips.join("\n- ")}`,
      ]
        .filter(Boolean)
        .join("\n\n");
    case "interview_prep": {
      const fb = c.feedback || {};
      return [
        `Practice: ${c.role || "interview"} (${c.frame || "general"}, ${c.mode || "text"})`,
        fb.overall && `Overall: ${fb.overall}`,
        Array.isArray(fb.strengths) && fb.strengths.length && `Strengths:\n- ${fb.strengths.join("\n- ")}`,
        Array.isArray(fb.improvements) && fb.improvements.length && `To work on:\n- ${fb.improvements.join("\n- ")}`,
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    default:
      return "";
  }
}

export default function VaultPage() {
  const [items, setItems] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function load() {
    fetch("/api/artifacts?limit=100")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => setItems(d.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  // Phase 6: one formatted PDF export for every artifact type (print window),
  // matching the disclosure/interview deliverables. Replaces copy + .txt.
  function downloadPDF(a: Artifact) {
    const c = a.content || {};
    const esc = (s: any) =>
      String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const paras = (s: any) =>
      String(s ?? "")
        .split(/\n{2,}/)
        .filter(Boolean)
        .map((p) => `<p>${esc(p).replace(/\n/g, "<br/>")}</p>`)
        .join("");
    const ul = (arr: any[]) =>
      Array.isArray(arr) && arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";

    let body = "";
    switch (a.artifact_type) {
      case "cover_letter":
        body = paras(c.text);
        break;
      case "follow_up":
        body =
          (c.subject ? `<h2>Subject</h2><p>${esc(c.subject)}</p>` : "") +
          (c.body ? `<h2>Message</h2>${paras(c.body)}` : "");
        break;
      case "disclosure_plan":
        body = [
          c.timing_advice && `<h2>When to Disclose</h2><p>${esc(c.timing_advice)}</p>`,
          c.legal_context && `<h2>Your Rights</h2><p>${esc(c.legal_context)}</p>`,
          c.script && `<h2>What to Say</h2><blockquote>${esc(c.script)}</blockquote>`,
          Array.isArray(c.tips) && c.tips.length && `<h2>Key Tips</h2>${ul(c.tips)}`,
        ]
          .filter(Boolean)
          .join("");
        break;
      case "interview_prep": {
        const fb = c.feedback || {};
        body = [
          c.role && `<p class="meta">Practice role: ${esc(c.role)} (${esc(c.frame || "general")})</p>`,
          fb.frame && `<h2>The Frame to Carry In</h2><blockquote>${esc(fb.frame)}</blockquote>`,
          Array.isArray(fb.strengths) && fb.strengths.length && `<h2>What You Did Well</h2>${ul(fb.strengths)}`,
          Array.isArray(fb.improvements) && fb.improvements.length && `<h2>Areas to Work On</h2>${ul(fb.improvements)}`,
          Array.isArray(fb.better_answers) &&
            fb.better_answers.length &&
            `<h2>Stronger Answers to Model</h2>${fb.better_answers
              .map((b: any) => `<p class="q">${esc(b.question)}</p><blockquote>${esc(b.model_answer)}</blockquote>`)
              .join("")}`,
          fb.overall && `<h2>Overall</h2><p>${esc(fb.overall)}</p>`,
        ]
          .filter(Boolean)
          .join("");
        break;
      }
      default:
        body = paras(toText(a));
    }
    if (!body) body = paras(toText(a));

    const typeLabel = (GROUPS.find((g) => g.type === a.artifact_type)?.label || "Document").replace(/s$/, "");
    const date = fmt(a.updated_at) || new Date().toLocaleDateString();
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${esc(title(a))}</title>
<style>
  @page { margin: 0.85in; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; font-size: 12pt; line-height: 1.6; }
  h1 { font-size: 18pt; margin: 0 0 4pt; }
  .subtitle { font-size: 9.5pt; color: #777; margin-bottom: 20pt; }
  .meta { font-size: 10pt; color: #555; margin: 0 0 12pt; }
  h2 { font-size: 10pt; font-weight: bold; color: #2d5a3d; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 1pt solid #4D7C5A; padding-bottom: 3pt; margin: 20pt 0 8pt; }
  p { margin: 0 0 9pt; } ul { margin: 0 0 9pt; padding-left: 18pt; } li { margin-bottom: 5pt; }
  blockquote { border-left: 3pt solid #4D7C5A; margin: 0 0 9pt; padding: 8pt 14pt; font-style: italic; color: #333; background: #f8f5f0; }
  .q { font-weight: bold; margin: 8pt 0 2pt; }
  .footer { margin-top: 34pt; border-top: 0.5pt solid #ddd; padding-top: 8pt; font-size: 8pt; color: #aaa; text-align: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<h1>${esc(title(a))}</h1>
<p class="subtitle">${esc(typeLabel)} &bull; Built with The Refinery &bull; steelmanresumes.com &bull; ${esc(date)}</p>
${body}
<div class="footer">This is yours, private to your account. Never shared without your permission.</div>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }

  async function remove(id: string) {
    const res = await fetch(`/api/artifacts/${id}`, { method: "DELETE" });
    if (res.ok) setItems((prev) => prev.filter((x) => x.id !== id));
    setConfirmDelete(null);
  }

  if (loading) {
    return <div className="max-w-3xl mx-auto px-4 py-12 text-muted">Loading your materials...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-foreground">My Materials</h1>
      <p className="text-muted mt-1 mb-6">
        Everything you have created, in one place. Private to your account and never shared
        unless you choose to. Save anything as a PDF, or delete it, anytime.
      </p>

      {items.length === 0 && (
        <div className="text-center text-muted bg-white border border-border rounded-xl px-5 py-12">
          Nothing here yet. Build a resume, plan a disclosure, or practice an interview and it
          will show up here.
        </div>
      )}

      <div className="space-y-8">
        {GROUPS.map((g) => {
          const group = items.filter((a) => a.artifact_type === g.type);
          if (group.length === 0) return null;
          return (
            <section key={g.type}>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">
                {g.label} ({group.length})
              </h2>
              <div className="space-y-3">
                {group.map((a) => {
                  const isResume = a.artifact_type === "resume";
                  const open = expanded === a.id;
                  return (
                    <div key={a.id} className="bg-white border border-border rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-medium text-foreground truncate">{title(a)}</h3>
                          <p className="text-xs text-muted mt-0.5">Updated {fmt(a.updated_at)}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isResume ? (
                            <Link
                              href={`/dashboard/application-tailor?id=${a.id}`}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-sage-600 text-white hover:bg-sage-700"
                            >
                              Open in builder
                            </Link>
                          ) : (
                            <button
                              onClick={() => setExpanded(open ? null : a.id)}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-border hover:bg-sage-50"
                            >
                              {open ? "Hide" : "View"}
                            </button>
                          )}
                          {confirmDelete === a.id ? (
                            <>
                              <button onClick={() => remove(a.id)} className="px-2 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700">
                                Delete
                              </button>
                              <button onClick={() => setConfirmDelete(null)} className="text-xs text-muted hover:text-foreground">
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setConfirmDelete(a.id)}
                              className="text-xs text-gray-400 hover:text-red-600"
                              title="Delete"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>

                      {open && !isResume && (
                        <div className="mt-3 border-t border-border pt-3">
                          <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">
                            {toText(a)}
                          </p>
                          <div className="flex items-center gap-3 mt-3">
                            <button onClick={() => downloadPDF(a)} className="px-3 py-1.5 bg-sage-600 text-white text-xs font-medium rounded-lg hover:bg-sage-700">
                              Save PDF
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
