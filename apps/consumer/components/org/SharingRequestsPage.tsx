"use client";

/**
 * <SharingRequestsPage> -- everything this staff member (or, for an admin, the
 * organization) has asked participants to share, and what came of it.
 *
 * A decline shows as a decline and nothing else. Participants are told staff
 * do not learn why, and nothing about why is stored.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Req {
  id: string; client_user_id: string; client_name: string | null; scope: string; reason: string;
  status: "pending" | "approved" | "declined" | "cancelled"; requested_by: string | null; requested_by_name: string | null;
  created_at: string; answered_at: string | null;
}
const SCOPE: Record<string, string> = { applications: "applications", resume: "resumes", documents: "cover letters" };
const STATUS: Record<Req["status"], string> = { pending: "Waiting for their answer", approved: "Shared", declined: "Not now", cancelled: "Withdrawn" };
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

export function SharingRequestsPage() {
  const [rows, setRows] = useState<Req[] | null>(null);
  const [viewerId, setViewerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/org/requests");
    if (!res.ok) { setError("Could not load requests."); return; }
    const d = await res.json(); setRows(d.requests); setViewerId(d.viewerId);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function withdraw(id: string) {
    await fetch("/api/org/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "withdraw", requestId: id }) });
    load();
  }

  const open = rows?.filter((r) => r.status === "pending") ?? [];
  const closed = rows?.filter((r) => r.status !== "pending") ?? [];
  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-t-white mb-1">Sharing requests</h1>
      <p className="text-sm text-t-phos-dim mb-6 max-w-2xl">
        You ask from a participant&apos;s page. They see your name and your reason, and they decide. If someone says not now, you are not told why, and it is fine to ask again later for a different reason.
      </p>
      {error && <p role="alert" className="text-sm text-t-amber-bright border border-t-amber bg-t-panel px-4 py-3">{error}</p>}
      {!rows ? <p className="text-sm text-t-phos-dim">Loading...</p> : rows.length === 0 ? (
        <p className="text-sm text-t-phos-dim bg-t-panel border border-t-line px-5 py-8 text-center">
          Nothing asked yet. Open a participant from your caseload and choose a tab they have not shared.
        </p>
      ) : (
        <>
          <Group title={`Waiting (${open.length})`} rows={open} viewerId={viewerId} onWithdraw={withdraw} />
          <Group title="Answered" rows={closed} viewerId={viewerId} onWithdraw={withdraw} />
        </>
      )}
    </div>
  );
}

function Group({ title, rows, viewerId, onWithdraw }: { title: string; rows: Req[]; viewerId: string; onWithdraw: (id: string) => void }) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-t-amber-bright mb-3 pb-2 border-b border-t-line">{title}</h2>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="bg-t-panel border border-t-line p-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-t-white">
                <Link href={`/dashboard/clients/${r.client_user_id}`} className="t-focus font-medium underline decoration-t-line underline-offset-4 hover:decoration-t-amber">
                  {r.client_name || "Participant"}
                </Link>{" "}· {SCOPE[r.scope] ?? r.scope}
              </p>
              <p className="text-sm text-t-phos italic mt-1">&ldquo;{r.reason}&rdquo;</p>
              <p className="text-xs text-t-phos-dim mt-1">
                Asked {day(r.created_at)}{r.requested_by !== viewerId && r.requested_by_name ? ` by ${r.requested_by_name}` : ""}
                {r.answered_at ? ` · answered ${day(r.answered_at)}` : ""}
              </p>
            </div>
            <div className="text-right">
              <p className={`text-xs px-2 py-1 border inline-block ${r.status === "approved" ? "border-t-amber text-t-amber-bright" : "border-t-line text-t-phos-dim"}`}>{STATUS[r.status]}</p>
              {r.status === "pending" && (
                <button onClick={() => onWithdraw(r.id)} className="t-focus block ml-auto mt-2 text-xs text-t-phos-dim underline hover:text-t-white">Withdraw</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
