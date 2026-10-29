"use client";
/**
 * Connections the client missed (staff pass S5).
 *
 * <ConnectionsPanel>: on a person's page. <CaseloadConnections>: across the
 * people the staff member reaches (/dashboard/connections).
 *
 * Both start with a button, never on page load: looking reads the jobs and
 * resumes the person shares, and every read is recorded where they can see
 * it. Matches come only from what they shared, each with why it matched, the
 * hiring mark or the help listing's standing, and a "Send to <first name>"
 * that puts it in their handoff. Their record is never read or matched on.
 */
import { useState } from "react";
import Link from "next/link";
import type { HandoffItemInput } from "@crucible/core/src/staffHandoffShared";
import { SendToButton } from "@/components/org/SendToButton";
import { evidenceWords } from "@/lib/handoff-words";

interface EmployerMatch { kind: "employer"; id: string; name: string; band: "A" | "B"; location: string | null; applyUrl: string | null; checkedAt: string | null; reason: string; whyForThem: string; role: string; sites?: number }
interface ResourceMatch { kind: "resource"; id: string; name: string; band: string; area: string; place: string; checkedAt: string | null; reason: string; whyForThem: string }
export interface PersonConnectionsView {
  clientId: string; name: string | null; firstName: string; status: "ok" | "nothing_shared" | "not_in_reach" | "directory_unavailable";
  shared: { applications: boolean; resume: boolean }; employers: EmployerMatch[]; resources: ResourceMatch[]; note: string;
}

export const LOOK_LINE = "Looking reads the jobs and resumes they share with you. It is recorded where they can see it. Their record is never used.";

/** The kind and place in front of the standing: "Employer, Lansing, MI and 3 more locations. " */
export function matchPlaceLine(m: EmployerMatch | ResourceMatch): string {
  if (m.kind === "resource") return `${m.area}. `;
  const more = (m.sites ?? 1) - 1;
  const where = m.location ? `, ${m.location}${more > 0 ? ` and ${more} more location${more === 1 ? "" : "s"}` : ""}` : more > 0 ? `, ${more + 1} locations` : "";
  return `Employer${where}. `;
}

/** What a match becomes in their handoff. The why is written for them; staff can edit it before sending. */
export function matchToItem(m: EmployerMatch | ResourceMatch): HandoffItemInput {
  return m.kind === "employer"
    ? { kind: "employer", employerId: m.id, name: m.name, role: m.role, location: m.location, applyUrl: m.applyUrl, why: m.whyForThem }
    : { kind: "resource", resourceId: m.id, name: m.name, why: m.whyForThem };
}

function Matches({ p, viewerId, canSend }: { p: PersonConnectionsView; viewerId: string | null; canSend: boolean }) {
  if (p.status !== "ok") return <p className="text-sm text-t-phos-dim">{p.note}</p>;
  const all: (EmployerMatch | ResourceMatch)[] = [...p.employers, ...p.resources];
  if (all.length === 0) return <p className="text-sm text-t-phos-dim">{p.note}</p>;
  return (
    <>
      <ul className="space-y-3">
        {all.map((m) => (
          <li key={`${m.kind}:${m.id}`} className="border-l-2 border-t-line pl-3">
            <p className="text-sm text-t-white">{m.name}
              <span className="ml-2 text-xs text-t-phos-dim">{matchPlaceLine(m)}{evidenceWords(m.kind, m.band, m.checkedAt)}.</span>
            </p>
            <p className="text-xs text-t-phos mt-1">Why: {m.reason}</p>
            {canSend && <div className="mt-1"><SendToButton personId={p.clientId} personName={p.name} viewerId={viewerId} item={matchToItem(m)} /></div>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-t-phos-dim mt-3">{p.note}</p>
    </>
  );
}

export function ConnectionsPanel({ clientId, first, viewerId, canSend }: { clientId: string; first: string; viewerId: string | null; canSend: boolean }) {
  const [data, setData] = useState<PersonConnectionsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function look() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/org/clients/${clientId}/connections`, { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error || "That did not load. Try again."); return; }
      setData(d.connections);
    } catch { setErr("That did not load. Check the connection and try again."); }
    finally { setBusy(false); }
  }
  return (
    <section aria-labelledby="connections-h" className="bg-t-panel border border-t-line p-5 mt-6">
      <h2 id="connections-h" className="font-semibold text-t-white">Connections {first} may have missed</h2>
      <p className="text-xs text-t-phos-dim mt-1">Employers with the hiring mark and places for job help that fit what {first} shares with you. {LOOK_LINE}</p>
      <button type="button" disabled={busy} onClick={look} className="t-focus mt-3 border border-t-line text-sm text-t-phos px-3 py-1.5 disabled:opacity-50">
        {busy ? "Looking..." : data ? "Look again" : "Look for connections"}
      </button>
      {err && <p role="status" className="text-sm text-t-phos mt-2">{err}</p>}
      {data && <div className="mt-4"><Matches p={data} viewerId={viewerId} canSend={canSend} /></div>}
    </section>
  );
}

export function CaseloadConnections({ viewerId, canSend }: { viewerId: string | null; canSend: boolean }) {
  const [data, setData] = useState<{ people: PersonConnectionsView[]; notSharing: number; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function look() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/org/connections", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error || "That did not load. Try again."); return; }
      setData(d);
    } catch { setErr("That did not load. Check the connection and try again."); }
    finally { setBusy(false); }
  }
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-t-white">Connections people may have missed</h1>
      <p className="text-sm text-t-phos-dim mt-2">
        For the people you work with who share their job applications or resumes: employers with the hiring mark and places for job help that fit, each with why. Up to 25 people, newest sharing first.
      </p>
      <p className="text-xs text-t-phos-dim mt-1">{LOOK_LINE}</p>
      <button type="button" disabled={busy} onClick={look} className="t-focus mt-4 bg-t-amber text-[#14100a] text-sm font-semibold px-4 py-2 disabled:opacity-50">
        {busy ? "Looking..." : data ? "Look again" : "Look for connections"}
      </button>
      {err && <p role="status" className="text-sm text-t-phos mt-3">{err}</p>}
      {data && (
        <div className="mt-6 space-y-6">
          {data.people.length === 0 && <p className="text-sm text-t-phos-dim">No new matches right now.</p>}
          {data.people.map((p) => (
            <section key={p.clientId} className="bg-t-panel border border-t-line p-5">
              <h2 className="font-semibold text-t-white"><Link className="t-focus underline underline-offset-4" href={`/dashboard/clients/${p.clientId}?tab=tasks`}>{p.name || "Someone on your list"}</Link></h2>
              <div className="mt-3"><Matches p={p} viewerId={viewerId} canSend={canSend} /></div>
            </section>
          ))}
          {data.notSharing > 0 && <p className="text-sm text-t-phos-dim">{data.notSharing} {data.notSharing === 1 ? "person shares" : "people share"} nothing to match on yet. You can ask them to share from their page.</p>}
          <p className="text-xs text-t-phos-dim">{data.note}</p>
        </div>
      )}
    </div>
  );
}
