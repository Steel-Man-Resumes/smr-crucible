"use client";

/**
 * <TeamAccessPage> -- the organization, as the person who runs it sees it.
 *
 * An org chart first: who is here, as what, carrying how many people, and
 * whether they are actually using the system. Then, for one person at a time,
 * exactly what they can do, in plain words, as switches.
 *
 * A switch that matches what the role already gives stores nothing. Only a
 * DIFFERENCE from the role is recorded, and the screen marks it, so an owner
 * can see at a glance who has been given more or less than their title implies.
 */
import { useCallback, useEffect, useState } from "react";
import { OrgBrandCard } from "@/components/org/OrgBrandCard";

interface Access { capability: string; on: boolean; fromRole: boolean; override: "grant" | "deny" | null }
interface Member {
  userId: string; name: string | null; email: string | null; title: string | null; role: "owner" | "org_admin" | "staff";
  /** Their access matches a named preset (today only "volunteer"). */
  preset?: "volunteer" | null;
  pending: boolean; invitedAt: string | null; caseload: number; lastSignInAt: string | null; notesLast30Days: number;
  access: Access[]; editable: boolean;
}
interface Switch { capability: string; label: string; help: string }
/** A staff invitation (migration 100): status derived on the server. */
export interface StaffInviteView {
  id: string; email: string; name: string | null; role: "org_admin" | "staff"; title: string | null; volunteer: boolean;
  /** A platform admin attached this person directly. The org never learns whether an address had an account. */
  addedBySupport?: boolean;
  status: "pending" | "sent" | "accepted" | "expired" | "revoked" | "declined"; statusWords: string;
  sendCount: number; lastSentAt: string | null; expiresAt: string; invitedAt: string; invitedByName: string | null;
  undeliverable: boolean; canResend: boolean; canRevoke: boolean;
}
const ROLE: Record<Member["role"], string> = { owner: "Owner", org_admin: "Admin", staff: "Staff" };
const ago = (s: string | null) => {
  if (!s) return "never signed in";
  const d = Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
  return d <= 0 ? "signed in today" : d === 1 ? "signed in yesterday" : `signed in ${d} days ago`;
};

export function TeamAccessPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [switches, setSwitches] = useState<Switch[]>([]);
  const [viewerRole, setViewerRole] = useState<Member["role"]>("staff");
  const [orgName, setOrgName] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [invites, setInvites] = useState<StaffInviteView[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/org/access", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) { setMsg(res ? "This page is for the organization's owner and admins." : "The team could not be loaded. Check your connection and reload."); setMembers([]); return; }
    const d = await res.json();
    setMembers(d.members); setSwitches(d.switches); setViewerRole(d.viewer.role); setOrgName(d.viewer.orgName);
    setInvites(d.invites ?? null);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function flip(m: Member, a: Access) {
    setBusy(`${m.userId}:${a.capability}`); setMsg(null);
    const res = await fetch("/api/org/access", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set_capability", userId: m.userId, capability: a.capability, on: !a.on }) }).catch(() => null);
    if (!res) setMsg("That did not save. Check your connection and try again.");
    else if (!res.ok) setMsg((await res.json().catch(() => ({}))).error || "That did not save.");
    await load(); setBusy(null);
  }

  // Role changes and removal already exist on the console's API, with their
  // own rules (nobody promotes themselves; removing staff releases a caseload).
  async function staffAction(action: string, m: Member, extra: Record<string, unknown>) {
    setMsg(null);
    const res = await fetch("/api/partner/org", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, userId: m.userId, ...extra }) }).catch(() => null);
    if (!res) setMsg("That did not save. Check your connection and try again.");
    else if (!res.ok) setMsg((await res.json().catch(() => ({}))).error || "That did not save.");
    if (action === "remove_staff" && res?.ok) setOpenId(null);
    await load();
  }

  async function applyPreset(m: Member) {
    setMsg(null);
    const res = await fetch("/api/org/access", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "apply_preset", userId: m.userId, preset: "volunteer" }) }).catch(() => null);
    if (!res) setMsg("That did not save. Check your connection and try again.");
    else if (!res.ok) setMsg((await res.json().catch(() => ({}))).error || "That did not save.");
    await load();
  }

  if (!members) return <div className="max-w-5xl mx-auto px-4 py-10 text-sm text-t-phos-dim">Loading...</div>;
  const owner = members.filter((m) => m.role === "owner");
  const admins = members.filter((m) => m.role === "org_admin");
  const staff = members.filter((m) => m.role === "staff");
  const open = members.find((m) => m.userId === openId) ?? null;

  const Card = ({ m }: { m: Member }) => {
    const changed = m.access.filter((a) => a.override).length;
    return (
      <button onClick={() => setOpenId(openId === m.userId ? null : m.userId)} aria-expanded={openId === m.userId}
        className={`t-focus text-left border px-3 py-3 w-56 transition-colors ${openId === m.userId ? "border-t-amber bg-t-panel-2" : "border-t-line bg-t-panel hover:border-t-line-strong"}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-t-white truncate">{m.name || m.email}</span>
          <span className={`text-[10px] px-1.5 py-0.5 border flex-shrink-0 ${m.role === "staff" ? "border-t-line text-t-phos-dim" : "border-t-amber text-t-amber-bright"}`}>{m.preset === "volunteer" ? "Volunteer" : ROLE[m.role]}</span>
        </div>
        {m.title && <div className="text-xs text-t-phos-dim truncate">{m.title}</div>}
        <div className="mt-2 text-xs text-t-phos">
          {m.caseload} {m.caseload === 1 ? "person" : "people"} · {m.notesLast30Days} {m.notesLast30Days === 1 ? "note" : "notes"} in 30 days
        </div>
        <div className={`text-xs mt-0.5 ${m.pending ? "text-t-amber-bright" : "text-t-phos-dim"}`}>{m.pending ? "Invited, has not signed in yet" : ago(m.lastSignInAt)}</div>
        {changed > 0 && <div className="text-[10px] text-t-amber-bright mt-1">{changed} {changed === 1 ? "setting differs" : "settings differ"} from {ROLE[m.role].toLowerCase()} defaults</div>}
      </button>
    );
  };
  const Tier = ({ label, people }: { label: string; people: Member[] }) => people.length === 0 ? null : (
    <div className="mb-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-t-phos-dim mb-2 text-center">{label}</p>
      <div className="flex flex-wrap justify-center gap-3">{people.map((m) => <Card key={m.userId} m={m} />)}</div>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-t-white mb-1">Team &amp; access</h1>
      <p className="text-sm text-t-phos-dim mb-6 max-w-2xl">
        Who works at {orgName || "your organization"}, what each person carries, and what each person can do. Choose someone to change their access.
      </p>
      {msg && <p role="alert" className="text-sm text-t-amber-bright border border-t-amber bg-t-panel px-4 py-3 mb-4">{msg}</p>}

      <section aria-label="Organization chart" className="bg-t-panel/40 border border-t-line p-5 mb-6">
        <Tier label="Owner" people={owner} />
        {(admins.length > 0 || staff.length > 0) && <div aria-hidden className="mx-auto h-5 w-px bg-t-line" />}
        <Tier label="Admins" people={admins} />
        {admins.length > 0 && staff.length > 0 && <div aria-hidden className="mx-auto h-5 w-px bg-t-line" />}
        <Tier label="Staff" people={staff} />
      </section>

      {open && (
        <section aria-live="polite" className="bg-t-panel border border-t-amber/50 p-5 mb-6">
          <h2 className="font-semibold text-t-white">{open.name || open.email} · {ROLE[open.role]}</h2>
          <p className="text-xs text-t-phos-dim mb-4">
            {open.role === "owner" ? "The owner can do everything, and that cannot be changed here."
              : !open.editable ? (open.role === "org_admin" ? "Only the owner can change an admin's access." : "You cannot change your own access.")
              : 'Switches marked "changed" differ from what the role gives by default.'}
          </p>
          <ul className="divide-y divide-t-line">
            {open.access.map((a) => {
              const sw = switches.find((s) => s.capability === a.capability);
              if (!sw) return null;
              const key = `${open.userId}:${a.capability}`;
              return (
                <li key={a.capability} className="py-3 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-t-white">{sw.label}{a.override && <span className="ml-2 text-[10px] text-t-amber-bright border border-t-amber px-1">changed</span>}</p>
                    {sw.help && <p className="text-xs text-t-phos-dim">{sw.help}</p>}
                  </div>
                  <button type="button" role="switch" aria-checked={a.on} aria-label={sw.label} disabled={!open.editable || busy === key} onClick={() => flip(open, a)}
                    className={`t-focus relative inline-flex h-7 w-12 flex-shrink-0 items-center border transition-colors disabled:opacity-40 ${a.on ? "bg-t-amber border-t-amber" : "bg-t-panel-2 border-t-line"}`}>
                    <span className={`inline-block h-5 w-5 transform transition-transform ${a.on ? "translate-x-6 bg-[#14100a]" : "translate-x-1 bg-t-phos-dim"}`} />
                  </button>
                </li>
              );
            })}
          </ul>
          {open.editable && (
            <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-t-line">
              {open.role === "staff" && open.preset !== "volunteer" && (
                <button onClick={() => applyPreset(open)}
                  className="t-focus text-xs text-t-phos underline hover:text-t-white">
                  Use volunteer settings (own caseload, no invites, no placements)
                </button>
              )}
              {viewerRole === "owner" && (
                <button onClick={() => staffAction("set_staff_role", open, { role: open.role === "org_admin" ? "staff" : "org_admin" })}
                  className="t-focus text-xs text-t-phos underline hover:text-t-white">
                  {open.role === "org_admin" ? "Make them staff (own caseload only)" : "Make them an admin (sees everyone, manages the team)"}
                </button>
              )}
              <button onClick={() => { if (window.confirm(`Remove ${open.name || open.email} from the team? Their ${open.caseload} ${open.caseload === 1 ? "person goes" : "people go"} back to unassigned. Their notes stay in the record.`)) staffAction("remove_staff", open, {}); }}
                className="t-focus text-xs text-t-amber-bright underline hover:text-t-amber">
                Remove from the team
              </button>
            </div>
          )}
          <p className="text-xs text-t-phos-dim mt-3">
            None of these can show anyone a resume, an application list or a letter that a participant has not chosen to share. Every change here is recorded.
          </p>
        </section>
      )}

      <InviteStaff canAddAdmin={viewerRole === "owner"} onDone={load} />

      <div className="mt-6">
        <StaffInviteList invites={invites} endpoint="/api/org/access" canRevokeAdmin={viewerRole === "owner"} onChanged={load} />
      </div>

      <div className="mt-6"><OrgBrandCard /></div>
    </div>
  );
}

function InviteStaff({ canAddAdmin, onDone }: { canAddAdmin: boolean; onDone: () => void }) {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [title, setTitle] = useState("");
  const [role, setRole] = useState("staff"); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  async function send() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/org/access", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "invite_staff", name, email, role, title }) }).catch(() => null);
    if (!res) { setBusy(false); setMsg("Nothing was saved. Check your connection and try again."); return; }
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg(d.error || "Nothing was saved. Try again."); return; }
    setMsg(d.message || (d.emailed ? `Invitation sent to ${email}.` : "Saved, but the email did not send. Use Resend on the invitation list."));
    setName(""); setEmail(""); setTitle(""); setRole("staff"); onDone();
  }
  const input = "t-focus bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2 w-full";
  return (
    <section className="bg-t-panel border border-t-line p-5">
      <h2 className="font-semibold text-t-white mb-1">Add someone to your team</h2>
      <p className="text-xs text-t-phos-dim mb-4">They get an email from us, sign in, and say yes before they join. Invitations are open for 14 days. Staff start with their own caseload only; you can widen that for one person above.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label htmlFor="st-name" className="block text-xs text-t-phos-dim mb-1">Name</label><input id="st-name" className={input} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label htmlFor="st-email" className="block text-xs text-t-phos-dim mb-1">Work email</label><input id="st-email" type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label htmlFor="st-title" className="block text-xs text-t-phos-dim mb-1">Title (optional)</label><input id="st-title" className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Employment Specialist" /></div>
        <div>
          <label htmlFor="st-role" className="block text-xs text-t-phos-dim mb-1">Role</label>
          <select id="st-role" className={input} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="staff">Staff: works their own caseload</option>
            <option value="volunteer">Volunteer: own caseload only, cannot invite participants or record placements</option>
            {canAddAdmin && <option value="org_admin">Admin: sees everyone, manages the team</option>}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-4 mt-4">
        <button onClick={send} disabled={busy || !name.trim() || !email.trim()} className="t-focus bg-t-amber text-[#14100a] text-sm font-semibold px-4 py-2 disabled:opacity-50">{busy ? "Sending..." : "Send invitation"}</button>
        <p role="status" aria-live="polite" className="text-xs text-t-phos">{msg}</p>
      </div>
    </section>
  );
}

const shortDay = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "never");

/**
 * The staff invitation list, shared by Team & access and Admin > Organizations:
 * status, send count, last sent, expiry, Resend and Revoke. Every action shows
 * what happened, including when nothing changed.
 */
export function StaffInviteList({ invites, endpoint, extra, canRevokeAdmin, onChanged }: {
  invites: StaffInviteView[] | null;
  /** The POST endpoint: /api/org/access (the organization) or /api/admin/orgs (platform admin). */
  endpoint: string;
  /** Sent with every action (the admin route needs orgId). */
  extra?: Record<string, unknown>;
  canRevokeAdmin: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  async function act(action: "resend_invite" | "revoke_invite", inv: StaffInviteView) {
    if (action === "revoke_invite" && !window.confirm(`Revoke the invitation for ${inv.name || inv.email}? The link stops working.`)) return;
    setBusy(inv.id + action); setNote(null);
    const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(extra ?? {}), action, inviteId: inv.id }) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res?.ok) setNote({ ok: false, text: d?.error || "That did not save. Nothing changed." });
    else setNote({ ok: true, text: d?.message || "Done." });
    onChanged();
  }
  if (invites === null) return <p className="text-xs text-t-phos-dim">Invitations could not be loaded. Reload to try again.</p>;
  const open = invites.filter((i) => i.canRevoke);
  const closed = invites.filter((i) => !i.canRevoke);
  const rows = showClosed ? invites : open;
  return (
    <section aria-label="Staff invitations" className="bg-t-panel border border-t-line p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 className="font-semibold text-t-white">Invitations</h2>
        {closed.length > 0 && (
          <button type="button" onClick={() => setShowClosed(!showClosed)} className="t-focus text-xs text-t-phos underline">
            {showClosed ? "Hide answered and revoked" : `Show answered and revoked (${closed.length})`}
          </button>
        )}
      </div>
      {note && <p role={note.ok ? "status" : "alert"} className={`text-xs mb-3 ${note.ok ? "text-t-phos" : "text-t-amber-bright"}`}>{note.text}</p>}
      {rows.length === 0 ? <p className="text-xs text-t-phos-dim">{invites.length === 0 ? "No staff invitations yet." : "No open invitations."}</p> : (
        <ul className="divide-y divide-t-line border border-t-line">
          {rows.map((inv) => (
            <li key={inv.id} className="px-3 py-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-t-white">{inv.name || inv.email} <span className="text-xs text-t-phos-dim">{inv.email}</span></p>
                <p className="text-xs text-t-phos-dim">
                  {inv.role === "org_admin" ? "Admin" : inv.volunteer ? "Volunteer" : "Staff"}{inv.title && !inv.volunteer ? `, ${inv.title}` : ""}
                  {inv.invitedByName ? ` · invited by ${inv.invitedByName}` : ""}
                </p>
                <p className="text-xs mt-1">
                  <span className={`px-1.5 py-0.5 border ${inv.status === "sent" || inv.status === "accepted" ? "border-t-line text-t-phos" : "border-t-amber text-t-amber-bright"}`}>{inv.statusWords}</span>
                  {inv.addedBySupport
                    ? <span className="text-t-phos-dim"> · added directly by Steel Man support on {shortDay(inv.invitedAt)}</span>
                    : <span className="text-t-phos-dim"> · sent {inv.sendCount} {inv.sendCount === 1 ? "time" : "times"} · last sent {shortDay(inv.lastSentAt)}{inv.canRevoke ? ` · ${inv.status === "expired" ? "expired" : "open until"} ${shortDay(inv.expiresAt)}` : ""}</span>}
                </p>
                {inv.undeliverable && inv.canRevoke && <p className="text-xs text-t-amber-bright mt-1">This address cannot receive email; share the sign-up link instead.</p>}
              </div>
              {inv.canRevoke && (
                <span className="flex gap-2">
                  {inv.canResend && (
                    <button type="button" disabled={!!busy || inv.undeliverable} onClick={() => act("resend_invite", inv)}
                      className="t-focus min-h-touch border border-t-amber px-3 text-xs font-semibold text-t-amber-bright disabled:opacity-40">
                      {busy === inv.id + "resend_invite" ? "Sending..." : "Resend"}
                    </button>
                  )}
                  {(inv.role !== "org_admin" || canRevokeAdmin) && (
                    <button type="button" disabled={!!busy} onClick={() => act("revoke_invite", inv)}
                      className="t-focus min-h-touch border border-t-line px-3 text-xs text-t-white disabled:opacity-40">
                      {busy === inv.id + "revoke_invite" ? "Revoking..." : "Revoke"}
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
