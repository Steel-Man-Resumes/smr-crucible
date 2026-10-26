"use client";
/**
 * Before someone is added or invited (house lane L5, R13): "this may be
 * someone you already have". Names and links only for people the staff member
 * works with; anyone else is counted, never named. A warning, not a block:
 * two people can share a name.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { DUPLICATE_REASON_LABELS, type DuplicateReason } from "@crucible/core/src/orgWorkflowShared";

interface Report { matches: { userId: string; name: string | null; reasons: DuplicateReason[] }[]; othersByReason: Partial<Record<DuplicateReason, number>> }

export function DuplicateWarning({ name, email, phone }: { name: string; email: string; phone?: string }) {
  const [report, setReport] = useState<Report | null>(null);
  useEffect(() => {
    const n = name.trim(), e = email.trim(), p = (phone ?? "").trim();
    if (n.length < 3 && !e.includes("@") && p.replace(/\D/g, "").length < 7) { setReport(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      fetch("/api/org/people/duplicates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: n, email: e, phone: p }) })
        .then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled) setReport(d); }).catch(() => {});
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [name, email, phone]);
  if (!report) return null;
  const others = Object.entries(report.othersByReason) as [DuplicateReason, number][];
  if (report.matches.length === 0 && others.length === 0) return null;
  return (
    <div role="status" className="mt-3 border border-t-amber bg-t-panel-2 px-3 py-2 text-xs text-t-amber-bright">
      <p className="font-semibold">This may be someone your organization already has.</p>
      <ul className="mt-1 space-y-1">
        {report.matches.map((m) => (
          <li key={m.userId}>
            <Link href={`/dashboard/clients/${m.userId}`} className="t-focus underline underline-offset-4">{m.name || "Name not shared"}</Link>
            {": "}{m.reasons.map((r) => DUPLICATE_REASON_LABELS[r]).join(", ")}
          </li>
        ))}
        {others.map(([r, n]) => (
          <li key={r}>{n === 1 ? "1 person" : `${n} people`} you do not work with: {DUPLICATE_REASON_LABELS[r]}. Ask whoever works with them before adding a second record.</li>
        ))}
      </ul>
      <p className="mt-1 text-t-phos">You can still go ahead if this is a different person.</p>
    </div>
  );
}
