"use client";

/**
 * Admin org directory: every partner org with its seat ledger, one click into
 * any org's dashboard exactly as they see it, and the platform-admin setup
 * actions (create an organization with an owner, add seats, set the daily
 * limit, rotate the code, set or change the owner). Every action is recorded.
 *
 * House build 2026-10-26 (L1, migration 100): close with a reason, reopen,
 * rename, delete an organization with no history; closed organizations hidden
 * behind "Show closed" (open first, each by name); add staff (an existing
 * account now, a new address by invitation); the staff invitation list with
 * status, Resend and Revoke; and, right after Create, what was made.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRealTier } from "@/lib/useUserTier";
import { StaffInviteList, type StaffInviteView } from "@/components/org/TeamAccessPage";

interface Seats { seatsTotal: number | null; seatsClaimed: number; seatsActive: number; seatsFree: number | null; seatsInvited: number; offersOpen?: number; staffCount: number | null; staffTotal: number | null }
interface StaffRow { userId: string; name: string | null; email: string | null; role: "org_admin" | "staff"; title: string | null }
interface OrgRow {
  id: string; code: string; partner_name: string; tier: string; is_active: boolean; org_logo_url: string | null;
  owner_email: string | null; joined: number; staff_count: number; daily_limit: number | null; crm_v2: boolean; max_staff?: number | null; seats?: Seats;
  closed_at?: string | null; close_reason?: string | null;
}
interface OrgDetail {
  org: { id: string; name: string; isActive: boolean; closedAt: string | null; closeReason: string | null; ownerEmail: string | null; ownerName: string | null; ownerIsJobSeeker: boolean };
  staff: StaffRow[];
  invites: StaffInviteView[] | null;
  history: Record<string, number> | null;
  historyWords: string | null;
  canDelete: boolean;
  closedMeans: string;
  deleteMeans: string;
}
interface Created {
  orgId: string; name: string; code: string;
  owner: { email: string; name: string | null; newAccount: boolean; ownerIsJobSeeker: boolean };
  ownerMail: string;
  staff: { name: string | null; email: string | null; role: string }[];
  invites: { email: string; status: string }[];
  warning: string | null;
}
const shortDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

const input = "w-full bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white focus:border-t-amber outline-none";
const btn = "t-focus inline-flex items-center px-3 py-1.5 text-xs font-bold border border-t-amber text-t-amber-bright hover:bg-t-amber/10 disabled:opacity-50";

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; data: any }> {
  // A dropped connection is a failed save, and the screen says so.
  const r = await fetch("/api/admin/orgs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!r) return { ok: false, data: { error: "Nothing was saved. Check your connection and try again." } };
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok && data?.ok !== false, data };
}

function CreatedPanel({ created, onClose }: { created: Created; onClose: () => void }) {
  return (
    <section aria-label="What was created" className="bg-t-panel border border-t-amber/60 p-4 mb-8 text-sm">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold text-t-white">Created: {created.name}</h2>
        <button type="button" onClick={onClose} className={btn}>Done</button>
      </div>
      <dl className="mt-3 grid sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-2">
        <dt className="text-t-phos-dim">Code</dt><dd className="font-mono text-t-phos">{created.code}</dd>
        <dt className="text-t-phos-dim">Owner</dt>
        <dd className="text-t-white">
          {created.owner.name ? `${created.owner.name}, ` : ""}{created.owner.email}{" "}
          <span className="text-t-phos-dim">({created.owner.newAccount ? "new account" : "existing account"}). {created.ownerMail}</span>
          {created.owner.ownerIsJobSeeker && (
            <span className="block text-xs text-t-amber-bright mt-1">This account signs in as a job seeker today, so it may not see the organization workspace until its role is updated.</span>
          )}
        </dd>
        <dt className="text-t-phos-dim">Staff</dt>
        <dd className="text-t-white">{created.staff.length === 0 ? "None yet. The owner runs the organization; add staff below." : created.staff.map((m) => m.name || m.email).join(", ")}</dd>
        <dt className="text-t-phos-dim">Invitations</dt>
        <dd className="text-t-white">{created.invites.length === 0 ? "None yet." : created.invites.map((i) => `${i.email} (${i.status})`).join(", ")}</dd>
      </dl>
      {created.warning && <p className="mt-3 text-xs text-t-amber-bright">{created.warning}</p>}
      <p className="mt-3 text-xs text-t-phos-dim">Its Manage panel is open below: add staff there.</p>
    </section>
  );
}

function CreateOrgForm({ onCreated }: { onCreated: (c: Created) => void }) {
  const [f, setF] = useState({ name: "", ownerEmail: "", ownerName: "", seats: "10" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    const { ok, data } = await post({ action: "create", name: f.name, ownerEmail: f.ownerEmail, ownerName: f.ownerName, seats: Number(f.seats) });
    setBusy(false);
    if (!ok) { setError(data?.error || "The organization was not created. Nothing was saved."); return; }
    const name = f.name.trim();
    setF({ name: "", ownerEmail: "", ownerName: "", seats: "10" });
    const ownerMail = data.ownerCreated
      ? data.undeliverable ? "That address cannot receive email, so the sign-in link was not sent."
        : data.emailed ? "A sign-in link was emailed." : "The sign-in email did not send; they can use \"Email me a sign-in link\" at the login page."
      : "No email was sent: they already have an account and can sign in now.";
    const c = data.created ?? {};
    onCreated({
      orgId: data.orgId, name, code: data.code, ownerMail, warning: data.warning ?? null,
      owner: c.owner ?? { email: f.ownerEmail, name: null, newAccount: !!data.ownerCreated, ownerIsJobSeeker: false },
      staff: c.staff ?? [], invites: c.invites ?? [],
    });
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
        <label className="block"><span className="text-xs text-t-phos-dim block mb-1">Owner email (a new address, or an account that already exists)</span>
          <input className={input} type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} required /></label>
        <label className="block"><span className="text-xs text-t-phos-dim block mb-1">Owner name (used only for an address new to Steel Man)</span>
          <input className={input} value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></label>
      </div>
      {error && <p className="text-sm text-t-red mt-3">{error}</p>}
      <button type="submit" disabled={busy} className={`${btn} mt-4`}>{busy ? "Creating..." : "Create organization"}</button>
    </form>
  );
}

function LifecycleActions({ org, detail, busy, act }: {
  org: OrgRow; detail: OrgDetail | null; busy: string;
  act: (name: string, body: Record<string, unknown>, ok: (d: any) => string, confirmText?: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(org.partner_name);
  const [reason, setReason] = useState("");
  const [confirmName, setConfirmName] = useState("");
  return (
    <div className="sm:col-span-2 border border-t-line p-3 grid sm:grid-cols-2 gap-4">
      <div>
        <div className="text-t-phos-dim mb-1">Rename</div>
        <div className="flex gap-2">
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} aria-label="New name" maxLength={120} />
          <button className={btn} disabled={!!busy || name.trim() === org.partner_name || name.trim().length < 2}
            onClick={() => act("rename", { action: "rename", name }, (d) => `Renamed to ${d.name}. The code, members and history stay.`)}>Rename</button>
        </div>
      </div>
      {org.is_active ? (
        <div>
          <div className="text-t-phos-dim mb-1">Close this organization</div>
          <textarea className={input} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
            placeholder="Why it is closing (only platform admins see this)" aria-label="Why it is closing" />
          <button className={`${btn} mt-2`} disabled={!!busy || reason.trim().length < 3}
            onClick={async () => { if (await act("close", { action: "close", reason }, () => `${org.partner_name} is closed. Members keep their accounts; staff lose the workspace for it; history stays.`,
              `Close ${org.partner_name}?\n\n${detail?.closedMeans ?? ""}`)) setReason(""); }}>Close</button>
          {detail?.closedMeans && <p className="text-t-phos-dim mt-2">{detail.closedMeans}</p>}
        </div>
      ) : (
        <div>
          <div className="text-t-phos-dim mb-1">
            Closed{org.closed_at ? ` on ${shortDate(org.closed_at)}` : ""}{detail?.org.closeReason ? `: ${detail.org.closeReason}` : ""}
          </div>
          <button className={btn} disabled={!!busy}
            onClick={() => act("reopen", { action: "reopen" }, (d) => `${org.partner_name} is open again. Its staff have their workspace back.${d.warning ? ` ${d.warning}` : ""}`,
              `Reopen ${org.partner_name}? Its staff get the workspace back and its code works again.`)}>Reopen</button>
        </div>
      )}
      <div className="sm:col-span-2">
        <div className="text-t-phos-dim mb-1">Delete</div>
        {!detail ? <p className="text-t-phos-dim">Checking its history...</p>
          : !detail.canDelete ? (
            <p className="text-t-phos-dim">
              {detail.history === null ? "Its history could not be checked, so delete is off." : `This organization has ${detail.historyWords || "history"}, so it can only be closed, never deleted.`}
            </p>
          ) : (
            <div>
              <p className="text-t-phos-dim mb-2">{detail.deleteMeans} Nothing points at this one. Type its name to delete it.</p>
              <div className="flex gap-2">
                <input className={input} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={org.partner_name} aria-label="Type the organization's name to delete it" />
                <button className={btn} disabled={!!busy || confirmName.trim() !== org.partner_name.trim()}
                  onClick={() => act("delete", { action: "delete", confirmName }, () => `${org.partner_name} was deleted. It had no members, staff or history.`,
                    `Delete ${org.partner_name} for good? This cannot be undone.`)}>Delete</button>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}

function AddStaffForm({ org, busy, act }: {
  org: OrgRow; busy: string;
  act: (name: string, body: Record<string, unknown>, ok: (d: any) => string, confirmText?: string) => Promise<boolean>;
}) {
  const [f, setF] = useState({ name: "", email: "", role: "staff", title: "" });
  return (
    <div className="sm:col-span-2 border border-t-line p-3">
      <div className="text-t-phos-dim mb-1">Add staff (every change is recorded with your name)</div>
      <p className="text-t-phos-dim mb-2">An account that already exists is added now and gets a short notice. A new address gets an invitation: they sign in with the emailed link and say yes within 14 days.</p>
      <div className="grid sm:grid-cols-2 gap-2">
        <input className={input} placeholder="Name" aria-label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className={input} type="email" placeholder="Email" aria-label="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input className={input} placeholder="Title (optional)" aria-label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <select className={input} aria-label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          <option value="staff">Staff: works their own caseload</option>
          <option value="org_admin">Admin: sees everyone, manages the team</option>
        </select>
      </div>
      <button className={`${btn} mt-2`} disabled={!!busy || !f.name.trim() || !f.email.trim() || !org.is_active}
        onClick={async () => { if (await act("addstaff", { action: "add_staff", ...f }, (d) => d.message || "Saved.")) setF({ name: "", email: "", role: "staff", title: "" }); }}>Add to the team</button>
      {!org.is_active && <p className="text-t-amber-bright mt-1">This organization is closed. Reopen it before adding staff.</p>}
      <p className="text-t-phos-dim mt-2">Volunteer settings are the organization&apos;s choice: its owner sets them on Team &amp; access.</p>
    </div>
  );
}

function OrgActions({ org, onDone }: { org: OrgRow; onDone: (msg: string) => void }) {
  const [seats, setSeats] = useState("5");
  const [limit, setLimit] = useState(String(org.daily_limit ?? 30));
  const [ownerEmail, setOwnerEmail] = useState("");
  const [staffCap, setStaffCap] = useState(String(org.max_staff ?? 10));
  const [brandTier, setBrandTier] = useState("standard");
  const [team, setTeam] = useState<StaffRow[] | null>(null);
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const loadTeam = useCallback(() => {
    fetch(`/api/admin/orgs?orgId=${org.id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: OrgDetail) => { setTeam(d.staff); setDetail(d); setLoadError(""); })
      .catch(() => { setTeam([]); setLoadError("The team and invitations could not be loaded. Close and reopen Manage to try again."); });
  }, [org.id]);
  useEffect(loadTeam, [loadTeam]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const act = async (name: string, body: Record<string, unknown>, ok: (d: any) => string, confirmText?: string): Promise<boolean> => {
    if (confirmText && !window.confirm(confirmText)) return false;
    setBusy(name); setError("");
    const res = await post({ ...body, orgId: org.id });
    setBusy("");
    if (!res.ok) { setError(res.data?.error || "That did not save. Nothing changed."); return false; }
    onDone(ok(res.data));
    loadTeam();
    return true;
  };
  return (
    <div className="bg-t-panel-2 border-t border-t-line px-4 py-4 grid sm:grid-cols-2 gap-4 text-xs">
      {error && <p role="alert" className="sm:col-span-2 text-sm text-t-red">{error}</p>}
      {loadError && <p role="alert" className="sm:col-span-2 text-sm text-t-red">{loadError}</p>}
      <LifecycleActions org={org} detail={detail} busy={busy} act={act} />
      <AddStaffForm org={org} busy={busy} act={act} />
      <div className="sm:col-span-2">
        <StaffInviteList invites={detail ? detail.invites : []} endpoint="/api/admin/orgs" extra={{ orgId: org.id }} canRevokeAdmin onChanged={loadTeam} />
      </div>
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
        <div className="text-t-phos-dim mb-1">Branding (logo is free for every org; co-brand shows the org to its own participants)</div>
        <div className="flex gap-2">
          <select className={input} value={brandTier} onChange={(e) => setBrandTier(e.target.value)} aria-label="Branding tier">
            <option value="standard">Standard: logo on staff screens</option>
            <option value="cobrand">Co-brand: participants see the org</option>
            <option value="full">Full branding</option>
          </select>
          <button className={btn} disabled={!!busy}
            onClick={() => act("brand", { action: "set_brand_tier", tier: brandTier }, (d) => `${org.partner_name} branding is now ${d.tier}.`)}>Set</button>
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
      {error && <p role="alert" className="sm:col-span-2 text-sm text-t-red">{error}</p>}
    </div>
  );
}

export default function AdminOrgsPage() {
  const realTier = useRealTier();
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  const load = useCallback(() => {
    fetch("/api/dev/orgs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { setOrgs(d.orgs); setError(""); })
      .catch(() => setError("Could not load organizations."));
  }, []);
  useEffect(load, [load]);

  const done = (msg: string) => { setNotice(msg); load(); };
  const closedCount = (orgs ?? []).filter((o) => !o.is_active).length;
  const shown = (orgs ?? []).filter((o) => showClosed || o.is_active || o.id === open);

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
      {created && <CreatedPanel created={created} onClose={() => setCreated(null)} />}
      <CreateOrgForm onCreated={(c) => { setCreated(c); setNotice(""); setOpen(c.orgId); load(); }} />
      {orgs && closedCount > 0 && (
        <div className="flex items-center justify-between gap-3 mb-2 text-xs text-t-phos-dim">
          <span>{showClosed ? `Showing all ${orgs.length}, open first.` : `${closedCount} closed ${closedCount === 1 ? "organization is" : "organizations are"} hidden.`}</span>
          <button type="button" className={btn} onClick={() => setShowClosed(!showClosed)} aria-pressed={showClosed}>{showClosed ? "Hide closed" : `Show closed (${closedCount})`}</button>
        </div>
      )}
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
            {shown.map((o) => (
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
                        <span className="text-[10px] text-t-red border border-t-red px-1">closed{o.closed_at ? ` ${shortDate(o.closed_at)}` : ""}</span>
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
