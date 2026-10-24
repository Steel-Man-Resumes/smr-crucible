"use client";

/**
 * Admin org directory: every partner org with its seat ledger, one click into
 * any org's dashboard exactly as they see it, and the platform-admin setup
 * actions (create an organization with an owner, add seats, set the daily
 * limit, rotate the code, set or change the owner). Every action is recorded.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRealTier } from "@/lib/useUserTier";

interface Seats { seatsTotal: number | null; seatsClaimed: number; seatsActive: number; seatsFree: number | null; seatsInvited: number; offersOpen?: number; staffCount: number | null; staffTotal: number | null }
interface StaffRow { userId: string; name: string | null; email: string | null; role: "org_admin" | "staff"; title: string | null }
interface OrgRow {
  id: string; code: string; partner_name: string; tier: string; is_active: boolean; org_logo_url: string | null;
  owner_email: string | null; joined: number; staff_count: number; daily_limit: number | null; crm_v2: boolean; max_staff?: number | null; seats?: Seats;
}

const input = "w-full bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white focus:border-t-amber outline-none";
const btn = "t-focus inline-flex items-center px-3 py-1.5 text-xs font-bold border border-t-amber text-t-amber-bright hover:bg-t-amber/10 disabled:opacity-50";

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; data: any }> {
  const r = await fetch("/api/admin/orgs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok && data?.ok !== false, data };
}

function CreateOrgForm({ onDone }: { onDone: (msg: string) => void }) {
  const [f, setF] = useState({ name: "", ownerEmail: "", ownerName: "", seats: "10" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    const { ok, data } = await post({ action: "create", name: f.name, ownerEmail: f.ownerEmail, ownerName: f.ownerName, seats: Number(f.seats) });
    setBusy(false);
    if (!ok) { setError(data?.error || "The organization was not created."); return; }
    setF({ name: "", ownerEmail: "", ownerName: "", seats: "10" });
    const owner = data.ownerCreated
      ? data.emailed ? "That address was new to Steel Man, so an account was made and a sign-in link was emailed." : "That address was new to Steel Man, so an account was made. The sign-in email did not send; they can use \"Email me a sign-in link\" at the login page."
      : "The owner already had an account and can sign in now.";
    onDone(`Created. Code ${data.code}. ${owner}${data.warning ? ` ${data.warning}` : ""}`);
  };
  return (
    <form onSubmit={submit} className="bg-t-panel border border-t-line p-4 mb-8">
      <h2 className="text-lg font-bold text-t-white mb-1">Create organization</h2>
      <p className="text-xs text-t-phos-dim mb-4">
        Makes a seat code for the client journey with the owner set, the organization workspace on, required sharing off,
        a random 12-character code, and a daily limit of 30 per person so new-account limits still apply.
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block"><span className="text-xs text-t-phos-dim block mb-1">Organization name</span>
          <input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
        <label className="block"><span className="text-xs text-t-phos-dim block mb-1">Seats</span>
          <input className={input} type="number" min={1} max={1000} value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} required /></label>
        <label className="block"><span className="text-xs text-t-phos-dim block mb-1">Owner email</span>
          <input className={input} type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} required /></label>
        <label className="block"><span className="text-xs text-t-phos-dim block mb-1">Owner name (used only for an address new to Steel Man)</span>
          <input className={input} value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></label>
      </div>
      {error && <p className="text-sm text-t-red mt-3">{error}</p>}
      <button type="submit" disabled={busy} className={`${btn} mt-4`}>{busy ? "Creating..." : "Create organization"}</button>
    </form>
  );
}

function OrgActions({ org, onDone }: { org: OrgRow; onDone: (msg: string) => void }) {
  const [seats, setSeats] = useState("5");
  const [limit, setLimit] = useState(String(org.daily_limit ?? 30));
  const [ownerEmail, setOwnerEmail] = useState("");
  const [staffCap, setStaffCap] = useState(String(org.max_staff ?? 10));
  const [team, setTeam] = useState<StaffRow[] | null>(null);
  const loadTeam = useCallback(() => {
    fetch(`/api/admin/orgs?orgId=${org.id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setTeam(d.staff))
      .catch(() => setTeam([]));
  }, [org.id]);
  useEffect(loadTeam, [loadTeam]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const act = async (name: string, body: Record<string, unknown>, ok: (d: any) => string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(name); setError("");
    const res = await post({ ...body, orgId: org.id });
    setBusy("");
    if (!res.ok) { setError(res.data?.error || "That did not save."); return; }
    onDone(ok(res.data));
  };
  return (
    <div className="bg-t-panel-2 border-t border-t-line px-4 py-4 grid sm:grid-cols-2 gap-4 text-xs">
      <div>
        <div className="text-t-phos-dim mb-1">Add seats</div>
        <div className="flex gap-2">
          <input className={input} type="number" min={1} max={1000} value={seats} onChange={(e) => setSeats(e.target.value)} />
          <button className={btn} disabled={!!busy || org.seats?.seatsTotal == null}
            onClick={() => act("seats", { action: "add_seats", seats: Number(seats) }, (d) => `${org.partner_name} now has ${d.seatsTotal} seats.`)}>Add</button>
        </div>
        {org.seats?.seatsTotal == null && <p className="text-t-phos-dim mt-1">This one has no seat limit, so there is nothing to add to.</p>}
      </div>
      <div>
        <div className="text-t-phos-dim mb-1">Daily limit per person (30 keeps new-account limits)</div>
        <div className="flex gap-2">
          <input className={input} type="number" min={1} max={1000} value={limit} onChange={(e) => setLimit(e.target.value)} />
          <button className={btn} disabled={!!busy}
            onClick={() => act("limit", { action: "set_daily_limit", dailyLimit: Number(limit) }, (d) => `${org.partner_name} daily limit is now ${d.dailyLimit}.`)}>Set</button>
        </div>
      </div>
      <div>
        <div className="text-t-phos-dim mb-1">Set or change the owner</div>
        <div className="flex gap-2">
          <input className={input} type="email" placeholder="owner email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
          <button className={btn} disabled={!!busy || !ownerEmail}
            onClick={() => act("owner", { action: "set_owner", ownerEmail }, (d) =>
              `${org.partner_name} owner changed.${d.ownerCreated ? (d.emailed ? " A new account was made and a sign-in link emailed." : " A new account was made; the email did not send.") : ""}${d.warning ? ` ${d.warning}` : ""}`,
              `Make ${ownerEmail} the owner of ${org.partner_name}? The current owner loses owner access.`)}>Set</button>
        </div>
      </div>
      <div>
        <div className="text-t-phos-dim mb-1">Staff places (staff use the Refinery outside the seat count)</div>
        <div className="flex gap-2">
          <input className={input} type="number" min={0} max={1000} value={staffCap} onChange={(e) => setStaffCap(e.target.value)} />
          <button className={btn} disabled={!!busy}
            onClick={() => act("staffcap", { action: "set_staff_cap", maxStaff: Number(staffCap) }, (d) => `${org.partner_name} can now have up to ${d.maxStaff} staff.`)}>Set</button>
        </div>
      </div>
      <div>
        <div className="text-t-phos-dim mb-1">Rotate the code</div>
        <button className={btn} disabled={!!busy}
          onClick={() => act("rotate", { action: "rotate_code" }, (d) => `${org.partner_name} has a new code: ${d.code}. The old one no longer works.`,
            `Give ${org.partner_name} a new code? The old code stops working right away, including links already shared. Members and seats stay.`)}>New code</button>
      </div>
      <div className="sm:col-span-2">
        <div className="text-t-phos-dim mb-1">Team, for support (every change is recorded with your name)</div>
        {!team ? <p className="text-t-phos-dim">Loading...</p> : team.length === 0 ? <p className="text-t-phos-dim">No staff yet.</p> : (
          <ul className="divide-y divide-t-line border border-t-line">
            {team.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="text-t-white">{m.name || m.email} <span className="text-t-phos-dim">{m.role === "org_admin" ? "Admin" : "Staff"}{m.title ? `, ${m.title}` : ""}</span></span>
                <span className="flex gap-2">
                  <button className={btn} disabled={!!busy}
                    onClick={() => act("role", { action: "set_staff_role", userId: m.userId, role: m.role === "org_admin" ? "staff" : "org_admin" },
                      () => { loadTeam(); return `${m.name || m.email} is now ${m.role === "org_admin" ? "staff" : "an admin"} at ${org.partner_name}.`; },
                      `Make ${m.name || m.email} ${m.role === "org_admin" ? "staff" : "an admin"} at ${org.partner_name}?`)}>
                    {m.role === "org_admin" ? "Make staff" : "Make admin"}
                  </button>
                  <button className={btn} disabled={!!busy}
                    onClick={() => act("remove", { action: "remove_staff", userId: m.userId },
                      () => { loadTeam(); return `${m.name || m.email} was removed from ${org.partner_name}'s team.`; },
                      `Remove ${m.name || m.email} from ${org.partner_name}'s team? Their caseload goes back to unassigned.`)}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="sm:col-span-2 text-sm text-t-red">{error}</p>}
    </div>
  );
}

export default function AdminOrgsPage() {
  const realTier = useRealTier();
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/dev/orgs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setOrgs(d.orgs))
      .catch(() => setError("Could not load organizations."));
  }, []);
  useEffect(load, [load]);

  const done = (msg: string) => { setNotice(msg); load(); };

  if (realTier !== "admin") {
    return <div className="max-w-4xl mx-auto px-4 py-12 text-t-phos-dim">Admins only.</div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-t-white mb-1">Organizations</h1>
      <p className="text-t-phos-dim text-sm mb-2">
        Every partner org on the platform. &quot;Open dashboard&quot; shows you exactly what
        that org&apos;s admins see.
      </p>
      <p className="text-t-phos-dim text-xs mb-6">
        A seat is claimed when someone joins or is invited and stays claimed if they leave, so
        free seats are the total minus claimed. Active now is who is a member today.
      </p>
      {notice && <p className="text-sm text-t-amber-bright bg-t-panel border border-t-amber/40 px-4 py-3 mb-6" role="status">{notice}</p>}
      <CreateOrgForm onDone={done} />
      {error && <p className="text-sm text-t-red">{error}</p>}
      {!orgs && !error && <p className="text-t-phos-dim text-sm">Loading...</p>}
      {orgs && (
        <div className="overflow-x-auto bg-t-panel border border-t-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-t-phos-dim border-b border-t-line">
                <th className="px-4 py-3 font-semibold">Organization</th>
                <th className="px-4 py-3 font-semibold">Code</th>
                <th className="px-4 py-3 font-semibold">Owner</th>
                <th className="px-4 py-3 font-semibold text-center">Seats claimed</th>
                <th className="px-4 py-3 font-semibold text-center">Active now</th>
                <th className="px-4 py-3 font-semibold text-center">Free</th>
                <th className="px-4 py-3 font-semibold text-center">Staff</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            {orgs.map((o) => (
              <tbody key={o.id} className="border-b border-t-line last:border-0">
                <tr>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {o.org_logo_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={o.org_logo_url}
                          alt=""
                          className="h-7 w-7 object-contain bg-white border border-t-line p-0.5"
                        />
                      )}
                      <span className="font-medium text-t-white">{o.partner_name}</span>
                      {!o.is_active && (
                        <span className="text-[10px] text-t-red border border-t-red px-1">inactive</span>
                      )}
                    </div>
                    <div className="text-[11px] text-t-phos-dim mt-0.5">
                      {o.tier === "client" ? "Seat code" : o.tier === "partner" ? "Partner code" : o.tier}
                      {`, daily limit ${o.daily_limit ?? "default"}`}
                      {o.crm_v2 ? ", workspace on" : ", old workspace"}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-t-phos">{o.code}</td>
                  <td className="px-4 py-3 text-xs text-t-phos-dim">{o.owner_email || "No owner"}</td>
                  <td className="px-4 py-3 text-center text-t-white">
                    {o.seats?.seatsTotal != null ? `${o.seats.seatsClaimed} of ${o.seats.seatsTotal}` : `${o.seats?.seatsClaimed ?? 0}, no limit`}
                  </td>
                  <td className="px-4 py-3 text-center text-t-white">{o.seats?.seatsActive ?? o.joined}</td>
                  <td className="px-4 py-3 text-center text-t-white">{o.seats?.seatsFree ?? "--"}</td>
                  <td className="px-4 py-3 text-center text-t-white">
                    {o.seats?.staffTotal != null ? `${o.staff_count} of ${o.seats.staffTotal}` : o.staff_count}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setOpen(open === o.id ? null : o.id)} className={`${btn} mr-2`} aria-expanded={open === o.id}>
                      Manage
                    </button>
                    <Link
                      href={`/dashboard/partner?codeId=${o.id}`}
                      className="t-focus inline-block px-3 py-1.5 text-xs font-bold border border-[#2d5a85] text-[#2d5a85] hover:bg-[#e9f0f7]"
                    >
                      Open dashboard
                    </Link>
                  </td>
                </tr>
                {open === o.id && (
                  <tr><td colSpan={8} className="p-0"><OrgActions org={o} onDone={done} /></td></tr>
                )}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}
