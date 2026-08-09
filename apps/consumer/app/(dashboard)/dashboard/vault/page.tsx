"use client";

/**
 * My Materials (W5 vault) -- one place for everything the user has created:
 * resumes, cover letters, follow-ups, disclosure plans, and practice records.
 * Reuses the existing refinery_artifact store (private to the account, encrypted
 * at rest). View, save as PDF, or delete; resumes open in the builder.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatResumeDownload, type ResumeDocument } from "@/components/resume/resumeModel";
import { printResumePdf } from "@/components/resume/resumePrint";
import { SavedJobsPanel } from "@/components/apply/SavedJobsPanel";

interface Artifact {
  id: string;
  artifact_type: string;
  target_context: {
    targetJob?: string;
    targetCompany?: string;
    source?: string;
    createdFrom?: string;
  } | null;
  content: any;
  is_current?: boolean;
  lane?: string | null;
  is_locked?: boolean;
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
  if (a.artifact_type === "resume") return "Base resume";
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
    case "resume":
      try {
        return formatResumeDownload(c as ResumeDocument);
      } catch {
        return "";
      }
    default:
      return "";
  }
}

/** Lowercased searchable text for an artifact (title, target, and body). */
function haystack(a: Artifact): string {
  return [
    title(a),
    a.target_context?.targetJob,
    a.target_context?.targetCompany,
    toText(a),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** A base resume (built in the Forge) vs a job-tailored one. */
function isBaseResume(a: Artifact): boolean {
  return (
    a.artifact_type === "resume" &&
    !a.target_context?.targetJob &&
    (a.target_context?.source === "forge" ||
      (a.content as any)?.meta?.createdFrom === "forge" ||
      (a.content as any)?.meta?.createdFrom === "fresh")
  );
}

export default function VaultPage() {
  const [items, setItems] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pinning, setPinning] = useState<string | null>(null);
  // R6: lock a resume as an approved per-lane baseline.
  const [locking, setLocking] = useState<string | null>(null);
  const [lockingFor, setLockingFor] = useState<string | null>(null);
  const [laneInput, setLaneInput] = useState<Record<string, string>>({});

  function load() {
    fetch("/api/artifacts?limit=100")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => setItems(d.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  // N4: pin ONE resume as "current" -- it floats to the top and is the default grab.
  async function setCurrent(id: string, makeCurrent: boolean) {
    setPinning(id);
    try {
      const res = await fetch(`/api/artifacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setCurrent: makeCurrent }),
      });
      if (res.ok) {
        // Locally mirror the "one current per user" invariant.
        setItems((prev) =>
          prev.map((a) =>
            a.artifact_type === "resume"
              ? { ...a, is_current: makeCurrent ? a.id === id : a.id === id ? false : a.is_current }
              : a
          )
        );
      }
    } catch {} finally {
      setPinning(null);
    }
  }

  // R6: lock/unlock a resume as an approved per-lane baseline (optionally labeling
  // its career lane). Locked baselines are what the tailor trusts + restructures
  // (R5) and what the "searching as" selector offers.
  async function lockAsBaseline(id: string, lock: boolean, lane?: string) {
    setLocking(id);
    try {
      const res = await fetch(`/api/artifacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lock ? { lock: true, lane: lane || null } : { lock: false }),
      });
      if (res.ok) {
        const { data } = await res.json();
        setItems((prev) =>
          prev.map((a) => (a.id === id ? { ...a, is_locked: data.is_locked, lane: data.lane } : a))
        );
        setLockingFor(null);
        // Nudge any open "searching as" selector to re-read the baseline list.
        try {
          window.dispatchEvent(new Event("baseline-changed"));
        } catch {}
      }
    } catch {} finally {
      setLocking(null);
    }
  }

  // N4/F10: one-click editable DOCX for resumes + cover letters, reusing the
  // Forge DOCX generator (same file quality as the builder's export).
  async function downloadDocx(a: Artifact) {
    const type = a.artifact_type === "resume" ? "resume" : "cover_letter";
    const content = a.artifact_type === "resume" ? toText(a) : a.content?.text || toText(a);
    if (!content) return;
    try {
      const res = await fetch("/api/forge/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, type, format: "docx" }),
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const slug = (title(a) || "document").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "document";
      link.download = `${slug}_SteelMan.docx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("DOCX download error:", err);
    }
  }

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
          // Non-negotiable framing on every disclosure output (master plan s.16)
          `<p class="meta"><strong>This is career coaching, not legal advice.</strong> For legal guidance, contact a reentry attorney or free legal aid in your area.</p>`,
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

  // One artifact card -- shared by the pinned Current Resume section and the groups.
  function renderCard(a: Artifact) {
    const isResume = a.artifact_type === "resume";
    const canDocx = a.artifact_type === "resume" || a.artifact_type === "cover_letter";
    const open = expanded === a.id;
    return (
      <div
        key={a.id}
        className={`bg-t-panel border p-4 ${a.is_current ? "border-t-amber" : "border-t-line"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-t-white truncate">{title(a)}</h3>
              {a.is_current && (
                <span className="flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-t-amber text-white">
                  Current
                </span>
              )}
              {a.is_locked && (
                <span className="flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border border-t-steel text-t-steel">
                  Baseline{a.lane ? ` · ${a.lane}` : ""}
                </span>
              )}
            </div>
            <p className="text-xs text-t-phos-dim mt-0.5">Updated {fmt(a.updated_at)}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setExpanded(open ? null : a.id)}
              className="t-focus px-3 py-1.5 text-xs font-medium bg-t-panel-2 border border-t-line text-t-phos hover:border-t-phos-dim"
            >
              {open ? "Hide" : "View"}
            </button>
            {isResume && (
              <Link
                href={`/dashboard/application-tailor?id=${a.id}`}
                className="t-focus px-3 py-1.5 text-xs font-bold bg-t-amber text-white hover:bg-t-amber-bright"
              >
                {isBaseResume(a) ? "Tailor to a job" : "Open in builder"}
              </Link>
            )}
            {confirmDelete === a.id ? (
              <>
                <button onClick={() => remove(a.id)} className="t-focus px-2 py-1.5 text-xs font-medium bg-t-red text-white hover:opacity-90">
                  Delete
                </button>
                <button onClick={() => setConfirmDelete(null)} className="text-xs text-t-phos-dim hover:text-t-white">
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(a.id)}
                className="text-xs text-t-phos-dim hover:text-t-red"
                title="Delete"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {isResume && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              onClick={() => setCurrent(a.id, !a.is_current)}
              disabled={pinning === a.id}
              className="text-xs font-medium text-t-amber-bright hover:text-t-amber disabled:opacity-50"
            >
              {a.is_current ? "Unpin as current" : "Set as my current resume"}
            </button>
            {a.is_locked ? (
              <button
                onClick={() => lockAsBaseline(a.id, false)}
                disabled={locking === a.id}
                className="text-xs font-medium text-t-steel hover:text-t-white disabled:opacity-50"
              >
                {locking === a.id ? "..." : "Unlock baseline"}
              </button>
            ) : lockingFor === a.id ? (
              <span className="inline-flex items-center gap-2">
                <input
                  value={laneInput[a.id] || ""}
                  onChange={(e) => setLaneInput((m) => ({ ...m, [a.id]: e.target.value }))}
                  placeholder="Lane, e.g. Manufacturing"
                  maxLength={60}
                  className="px-2 py-1 text-xs bg-t-panel border border-t-line text-t-white focus:border-t-steel focus:outline-none"
                />
                <button
                  onClick={() => lockAsBaseline(a.id, true, laneInput[a.id])}
                  disabled={locking === a.id}
                  className="t-focus text-xs font-bold text-white bg-t-steel px-2.5 py-1 hover:opacity-90 disabled:opacity-50"
                >
                  {locking === a.id ? "..." : "Lock"}
                </button>
                <button
                  onClick={() => setLockingFor(null)}
                  className="text-xs text-t-phos-dim hover:text-t-white"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setLockingFor(a.id)}
                className="text-xs font-medium text-t-steel hover:text-t-white"
                title="Lock this as an approved baseline for a career lane"
              >
                Lock as a baseline
              </button>
            )}
          </div>
        )}

        {open && (
          <div className="mt-3 border-t border-t-line pt-3">
            <p className="text-sm text-t-phos whitespace-pre-line leading-relaxed">
              {toText(a)}
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <button
                onClick={() =>
                  isResume ? printResumePdf(a.content as ResumeDocument) : downloadPDF(a)
                }
                className="t-focus px-3 py-1.5 bg-t-amber text-white text-xs font-bold hover:bg-t-amber-bright"
              >
                Save PDF
              </button>
              {canDocx && (
                <button
                  onClick={() => downloadDocx(a)}
                  className="t-focus px-3 py-1.5 bg-t-panel-2 border border-t-line text-t-phos text-xs font-bold hover:border-t-phos-dim"
                >
                  Download .docx
                </button>
              )}
            </div>
            {canDocx && (
              <p className="text-xs text-t-phos-dim mt-2">
                .docx opens in Word to edit. PDF keeps the formatting exactly.
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return <div className="max-w-3xl mx-auto px-4 py-12 text-t-phos-dim">Loading your materials...</div>;
  }

  // Search across everything; the pinned current resume is surfaced on its own.
  const query = q.trim().toLowerCase();
  const filtered = query ? items.filter((a) => haystack(a).includes(query)) : items;
  const currentResume = filtered.find((a) => a.artifact_type === "resume" && a.is_current) || null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-t-white">My Materials</h1>
      <p className="text-t-phos-dim mt-1 mb-6">
        Everything you have created, in one place. Private to your account and never shared
        unless you choose to. Pin your current resume, lock an approved baseline for each
        career lane (so tailoring sharpens it without ever downgrading it), save anything as a
        PDF or Word file, or delete it, anytime.
      </p>

      {/* Saved jobs surfaced here too (R1) -- "my stuff" is where people look for
          them. Renders nothing when there are none. */}
      <div className="mb-8">
        <SavedJobsPanel heading="Your saved jobs" limit={5} />
      </div>

      {items.length === 0 ? (
        <div className="text-center text-t-phos-dim bg-t-panel border border-t-line px-5 py-12">
          Nothing here yet. Build a resume, plan a disclosure, or practice an interview and it
          will show up here.
        </div>
      ) : (
        <>
          <div className="mb-6">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your materials by job, company, or text"
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
            />
          </div>

          {filtered.length === 0 && (
            <div className="text-center text-t-phos-dim bg-t-panel border border-t-line px-5 py-10">
              Nothing matches &ldquo;{q.trim()}&rdquo;.{" "}
              <button onClick={() => setQ("")} className="text-t-amber-bright font-medium hover:text-t-amber">
                Clear search
              </button>
            </div>
          )}

          {/* N4: the pinned current resume, surfaced first. */}
          {currentResume && (
            <section className="mb-8">
              <h2 className="text-sm font-semibold uppercase text-t-amber-bright mb-3">
                Current Resume
              </h2>
              {renderCard(currentResume)}
            </section>
          )}

          <div className="space-y-8">
            {GROUPS.map((g) => {
              // The current resume is shown in its own section above -- don't repeat it.
              const group = filtered.filter(
                (a) => a.artifact_type === g.type && !(a.is_current && a === currentResume)
              );
              if (group.length === 0) return null;
              return (
                <section key={g.type}>
                  <h2 className="text-sm font-semibold uppercase text-t-phos-dim mb-3">
                    {g.label} ({group.length})
                  </h2>
                  <div className="space-y-3">{group.map((a) => renderCard(a))}</div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
