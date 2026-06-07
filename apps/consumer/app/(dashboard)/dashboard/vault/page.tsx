"use client";

/**
 * My Materials (W5 vault) -- one place for everything the user has created:
 * resumes, cover letters, follow-ups, disclosure plans, and practice records.
 * Reuses the existing refinery_artifact store (private to the account, encrypted
 * at rest). View / copy / download / delete; resumes open in the builder.
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function load() {
    fetch("/api/artifacts?limit=100")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => setItems(d.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function copy(a: Artifact) {
    const text = toText(a);
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
    setCopiedId(a.id);
    setTimeout(() => setCopiedId((c) => (c === a.id ? null : c)), 1500);
  }

  function download(a: Artifact) {
    const blob = new Blob([toText(a)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const slug = (a.target_context?.targetJob || a.artifact_type).replace(/\s+/g, "_");
    link.href = url;
    link.download = `${slug}_${a.artifact_type}.txt`;
    link.click();
    URL.revokeObjectURL(url);
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
        unless you choose to. You can download or delete anything anytime.
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
                              href={`/dashboard/resume-builder?id=${a.id}`}
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
                            <button onClick={() => copy(a)} className="px-3 py-1.5 bg-sage-600 text-white text-xs font-medium rounded-lg hover:bg-sage-700">
                              {copiedId === a.id ? "Copied" : "Copy"}
                            </button>
                            <button onClick={() => download(a)} className="px-3 py-1.5 bg-white border border-border text-xs font-medium rounded-lg hover:bg-sage-50">
                              Download .txt
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
