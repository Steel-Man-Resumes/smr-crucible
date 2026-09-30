"use client";

/**
 * <SeeEveryonePanel> -- for the owner and admins, on the main console.
 *
 * Staff see only the people assigned to them. People who join with the
 * organization's code start assigned to nobody, so a new staff member's list
 * is empty until an admin either assigns people or turns on "See everyone" for
 * that staff member. That switch lives on Team & access; this puts the same
 * switch where an admin will find it.
 *
 * It is the SAME guarded action (POST /api/org/access set_capability): the
 * database re-checks who is asking, and every change lands in the audit trail.
 * Nothing is widened by default. An admin decides, one person at a time or all
 * at once, and can turn it back off here.
 */
import { useCallback, useEffect, useState } from "react";
import {
  SEE_EVERYONE_CAPABILITY,
  ownCaseloadStaff,
  seeEveryoneTargets,
  type SeeEveryoneMember,
} from "@crucible/core/src/orgVisibilityShared";

interface ApiMember {
  userId: string; name: string | null; email: string | null; role: "owner" | "org_admin" | "staff"; editable: boolean;
  access: { capability: string; on: boolean }[];
}

export function SeeEveryonePanel({ unassignedJoined }: { unassignedJoined: number | null }) {
  const [members, setMembers] = useState<SeeEveryoneMember[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/org/access");
      if (!res.ok) { setMembers([]); return; }
      const d = await res.json();
      setMembers(((d.members ?? []) as ApiMember[]).map((m) => ({
        userId: m.userId, name: m.name, email: m.email, role: m.role, editable: m.editable,
        seesEveryone: !!m.access.find((a) => a.capability === SEE_EVERYONE_CAPABILITY)?.on,
      })));
    } catch {
      setMembers([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function set(userId: string, on: boolean): Promise<boolean> {
    const res = await fetch("/api/org/access", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set_capability", userId, capability: SEE_EVERYONE_CAPABILITY, on }),
    });
    if (!res.ok) setMsg((await res.json().catch(() => ({}))).error || "That did not save.");
    return res.ok;
  }
  async function flip(m: SeeEveryoneMember) {
    setBusy(m.userId); setMsg(null);
    await set(m.userId, !m.seesEveryone);
    await load(); setBusy(null);
  }
  async function allOn(targets: SeeEveryoneMember[]) {
    setBusy("all"); setMsg(null);
    // One at a time through the same guarded action, so each is checked and recorded.
    let failed = 0;
    for (const m of targets) if (!(await set(m.userId, true))) failed++;
    if (failed) setMsg(`${failed} of ${targets.length} did not save. The rest did.`);
    await load(); setBusy(null);
  }

  if (!members) return null;
  const staff = members.filter((m) => m.role === "staff");
  if (staff.length === 0) return null;
  const limited = ownCaseloadStaff(members);
  const targets = seeEveryoneTargets(members);
  const waiting = (unassignedJoined ?? 0) > 0 && limited.length > 0;

  return (
    <section aria-labelledby="see-everyone-title" className={`mb-8 border bg-t-panel px-4 py-4 ${waiting ? "border-t-amber" : "border-t-line"}`}>
      <h2 id="see-everyone-title" className="text-sm font-semibold text-t-white">Who your staff can see</h2>
      <p className="mt-1 text-xs text-t-phos-dim max-w-3xl">
        Staff see only the people assigned to them, unless you turn on &quot;See everyone&quot; for them.
        Either way they only see people who chose to share their progress.
      </p>
      {waiting && (
        <p className="mt-3 text-sm text-t-amber-bright">
          {unassignedJoined} {unassignedJoined === 1 ? "person has" : "people have"} joined and {unassignedJoined === 1 ? "is" : "are"} not
          assigned to anyone, so staff with &quot;See everyone&quot; off cannot see them. Assign them in the client list, or turn it on here.
        </p>
      )}
      <ul className="mt-3 divide-y divide-t-line">
        {staff.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-sm text-t-white">
              {m.name || m.email}
              <span className="ml-2 text-xs text-t-phos-dim">{m.seesEveryone ? "Sees everyone" : "Sees only their own caseload"}</span>
            </span>
            <button type="button" role="switch" aria-checked={m.seesEveryone}
              aria-label={`See everyone: ${m.name || m.email}`}
              disabled={!m.editable || busy !== null} onClick={() => flip(m)}
              className={`t-focus relative inline-flex h-7 w-12 flex-shrink-0 items-center border transition-colors disabled:opacity-40 ${m.seesEveryone ? "bg-t-amber border-t-amber" : "bg-t-panel-2 border-t-line"}`}>
              <span className={`inline-block h-5 w-5 transform transition-transform ${m.seesEveryone ? "translate-x-6 bg-[#14100a]" : "translate-x-1 bg-t-phos-dim"}`} />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {targets.length > 0 && (
          <button type="button" onClick={() => allOn(targets)} disabled={busy !== null}
            className="t-focus min-h-touch border border-t-amber px-4 py-2 text-sm font-bold text-t-amber-bright hover:bg-t-amber/10 disabled:opacity-50">
            {busy === "all" ? "Saving..." : "Let all staff see everyone"}
          </button>
        )}
        <a href="/dashboard/team" className="t-focus text-xs text-t-phos underline underline-offset-4 hover:text-t-white">
          More access settings
        </a>
        <p role="status" aria-live="polite" className="text-xs text-t-amber-bright">{msg}</p>
      </div>
      <p className="mt-2 text-xs text-t-phos-dim">Every change here is recorded. You can turn it back off at any time.</p>
    </section>
  );
}
