"use client";

/**
 * /dashboard/invites: answer an invitation to join an organization's staff
 * (migration 100). Reached from the invitation email and from the line the
 * shell shows while one is open. Nothing changes until the person says yes.
 */
import { useCallback, useEffect, useState } from "react";

interface Invite { id: string; orgName: string; role: "org_admin" | "staff"; title: string | null; invitedByName: string | null; expiresAt: string; expired: boolean }

const roleWords = (i: Invite) => (i.role === "org_admin" ? "an admin" : i.title ? `staff (${i.title})` : "staff");
const day = (s: string) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function StaffInvitesPage() {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    const res = await fetch("/api/staff-invites", { cache: "no-store" }).catch(() => null);
    const d = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || !d) { setError(d?.error || "Your invitations could not be loaded. Try again."); setInvites([]); return; }
    setInvites(d.invites ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function answer(i: Invite, accept: boolean) {
    setBusy(i.id); setError(""); setNotice("");
    const res = await fetch("/api/staff-invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inviteId: i.id, accept }) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res?.ok) { setError(d?.error || "That did not save. Try again."); await load(); return; }
    setNotice(d.message || (accept ? "You are on the team." : "You said no. Nothing changed."));
    if (accept && d.result === "ok") { window.setTimeout(() => { window.location.href = "/dashboard"; }, 1500); return; }
    await load();
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold text-t-white">Invitations</h1>
      <p className="mb-6 text-sm text-t-phos-dim">An organization asked you to join its team. Nothing changes unless you say yes. You can only answer your own invitations.</p>
      {notice && <p role="status" className="mb-4 border border-t-amber/40 bg-t-panel px-4 py-3 text-sm text-t-amber-bright">{notice}</p>}
      {error && <p role="alert" className="mb-4 border border-t-red bg-t-panel px-4 py-3 text-sm text-t-red">{error}</p>}
      {!invites ? <p className="text-sm text-t-phos-dim">Loading...</p> : invites.length === 0 ? (
        <p className="text-sm text-t-phos-dim">You have no open invitations.</p>
      ) : (
        <ul className="space-y-3">
          {invites.map((i) => (
            <li key={i.id} className="border border-t-line bg-t-panel p-4">
              <p className="font-semibold text-t-white">{i.orgName}</p>
              <p className="mt-1 text-sm text-t-phos">
                {i.invitedByName ? `${i.invitedByName} invited you` : "You were invited"} to join as {roleWords(i)}.
              </p>
              <p className="mt-1 text-xs text-t-phos-dim">
                {i.expired ? `This invitation expired on ${day(i.expiresAt)}. Ask them to send it again.` : `Open until ${day(i.expiresAt)}.`}
              </p>
              <p className="mt-2 text-xs text-t-phos-dim">
                As staff you work with the people this organization serves: your caseload, your case notes, and anything a participant chooses to share with you. Your own account and your own work stay yours.
              </p>
              {!i.expired && (
                <div className="mt-3 flex flex-wrap gap-3">
                  <button type="button" disabled={busy === i.id} onClick={() => answer(i, true)}
                    className="t-focus min-h-touch bg-t-amber px-4 text-sm font-semibold text-[#14100a] disabled:opacity-50">{busy === i.id ? "Saving..." : "Yes, join the team"}</button>
                  <button type="button" disabled={busy === i.id} onClick={() => answer(i, false)}
                    className="t-focus min-h-touch border border-t-line px-4 text-sm text-t-white disabled:opacity-50">No, thanks</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
