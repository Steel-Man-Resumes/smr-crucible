"use client";

/**
 * <StructurePage> -- how an organization's work is organized (house lane L3a,
 * migration 103): programs, cohorts, sites, offices, caseloads, the staff in
 * each, and how many people are enrolled.
 *
 * Everyone on staff sees the tree and who works where. The owner (who holds
 * org.settings.manage) adds, renames, moves, closes and reopens groups and
 * puts staff in them. A group is closed, never deleted; closing asks for it to
 * be empty first, and the page says why when it is not.
 *
 * Counts of people are what the viewer can see: a staff member who does not
 * see everyone gets "you can see" after each count, never a number that
 * includes people outside their reach.
 *
 * What staff membership does is said where it is set: a lead sees the people
 * enrolled here and in the groups below, a member sees the people enrolled
 * here, a viewer sees the group and not the people.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  UNIT_KINDS, UNIT_ROLES, UNIT_ROLE_INFO, UNIT_MAX_DEPTH, type UnitKind, type UnitRole,
} from "@crucible/core/src/orgStructureShared";
import { buildUnitTree, moveTargets, unitCountsLine, unitKindLabel, type UnitLite, type UnitNode } from "@/lib/org-structure-view";
import { useOrgTerms, type OrgWords } from "@/lib/use-org-terms";

interface Unit extends UnitLite { short_code: string | null; description: string | null; starts_on: string | null; ends_on: string | null; closed_at: string | null }
interface Member { org_unit_id: string; user_id: string; role_in_unit: UnitRole; name: string | null }
interface StaffOption { user_id: string; name: string | null; role: string }
interface Data { units: Unit[]; members: Member[]; staff: StaffOption[]; countsArePartial: boolean; ready: boolean; canManage: boolean; canEnroll: boolean }

const btn = "t-focus min-h-[44px] px-3 py-2 text-sm border rounded-[4px]";
const quiet = `${btn} bg-t-panel text-t-phos border-t-line hover:text-t-white`;
const primary = `${btn} bg-t-amber text-[#14100a] border-t-amber font-semibold disabled:opacity-50`;
const field = "plain-field t-focus bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2 min-h-[44px]";

async function post(body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch("/api/org/structure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    return (await res.json().catch(() => ({}))).error || "That did not save. Nothing was changed.";
  } catch {
    return "That did not save. Check your connection and try again.";
  }
}

export function StructurePage() {
  const t = useOrgTerms();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [msg, setMsg] = useState<{ text: string; good?: boolean } | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [s, p] = await Promise.all([
        fetch("/api/org/structure").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/org/profile").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!s) { setFailed(true); return; }
      setData(s); setNeedsSetup(!!p?.needsSetup);
    } catch { setFailed(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (body: Record<string, unknown>, done: string) => {
    setMsg(null);
    const err = await post(body);
    setMsg(err ? { text: err } : { text: done, good: true });
    if (!err) await load();
    return !err;
  }, [load]);

  const tree = useMemo(() => (data ? buildUnitTree(data.units, { showClosed }) : []), [data, showClosed]);
  const closedCount = data?.units.filter((u) => u.status === "closed").length ?? 0;

  if (failed) return (
    <Frame>
      <p role="alert" className="text-sm text-t-white">This page did not load. Nothing was lost.</p>
      <button type="button" onClick={load} className={`${quiet} mt-3`}>Try again</button>
    </Frame>
  );
  if (!data) return <Frame><p className="text-sm text-t-phos-dim">Getting your groups...</p></Frame>;
  if (!data.ready) return <Frame><Title /><p className="text-sm text-t-phos">Programs and groups are not switched on yet. Try again after the next update.</p></Frame>;

  return (
    <Frame>
      <Title />
      <p className="text-sm text-t-phos-dim mb-5 max-w-2xl">
        Your {t.plural("program")}, {t.plural("site")}, {t.plural("team")} and {t.plural("caseload")}, and who works in each. A {t.staff_member} put in a group can work with the {t.participants} enrolled there. Only your owner changes who is where.
      </p>
      {needsSetup && data.canManage && (
        <p className="bg-t-panel border border-t-amber px-4 py-3 mb-5 text-sm text-t-white">
          Setup is not finished. It takes about two minutes and suggests words and groups for your kind of organization.{" "}
          <Link href="/dashboard/setup" className="t-focus font-semibold text-t-amber-bright underline underline-offset-4">Finish setup</Link>
        </p>
      )}
      {msg && <p role={msg.good ? "status" : "alert"} className={`text-sm border px-4 py-3 mb-4 bg-t-panel ${msg.good ? "border-t-line text-t-phos" : "border-t-amber text-t-amber-bright"}`}>{msg.text}</p>}

      {tree.length === 0 ? (
        <p className="text-sm text-t-phos bg-t-panel border border-t-line px-4 py-3 mb-4">
          No groups yet.{data.canManage ? " Add your first one below, or run setup for suggestions." : " Your owner can add them."}
        </p>
      ) : (
        <ul className="space-y-2 mb-4" aria-label="Groups">
          {tree.map((n) => <UnitRow key={n.unit.id} node={n} data={data} t={t} act={act} />)}
        </ul>
      )}
      {closedCount > 0 && (
        <button type="button" className={`${quiet} mb-6`} aria-pressed={showClosed} onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? "Hide closed groups" : `Show closed groups (${closedCount})`}
        </button>
      )}
      {data.canManage && <AddUnitForm t={t} parentId={null} parentName={null} act={act} />}
      {data.canManage && (
        <p className="text-xs text-t-phos-dim mt-6">
          Every change here is recorded with who made it. Want new suggestions? <Link href="/dashboard/setup" className="t-focus underline underline-offset-4">Run setup again</Link> (it keeps the groups you have).
        </p>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) { return <div className="max-w-4xl mx-auto px-4 py-8 sm:py-10">{children}</div>; }
function Title() { return <h1 className="text-2xl font-bold text-t-white mb-1">Structure</h1>; }

function UnitRow({ node, data, t, act }: { node: UnitNode<Unit>; data: Data; t: OrgWords; act: (b: Record<string, unknown>, done: string) => Promise<boolean> }) {
  const u = node.unit;
  const [open, setOpen] = useState<null | "rename" | "move" | "staff" | "add">(null);
  const members = data.members.filter((m) => m.org_unit_id === u.id);
  const closed = u.status === "closed";
  const panelId = `unit-panel-${u.id}`;
  const toggle = (k: NonNullable<typeof open>) => setOpen((cur) => (cur === k ? null : k));
  return (
    <li className={`border rounded-[4px] ${closed ? "border-t-line/60 bg-t-panel/40" : "border-t-line bg-t-panel"}`} style={{ marginLeft: `${Math.min(node.depth - 1, 3) * 1}rem` }}>
      <div className="px-4 py-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-t-white break-words">
            {u.name}{closed && <span className="ml-2 text-xs font-normal text-t-phos-dim">(closed)</span>}
          </p>
          <p className="text-xs text-t-phos-dim">{unitKindLabel(u.kind, t)} · {unitCountsLine(u, t, data.countsArePartial)}</p>
          {members.length > 0 && (
            <p className="text-xs text-t-phos mt-1">
              {members.map((m) => `${m.name || "Unnamed"}${m.role_in_unit === "member" ? "" : ` (${UNIT_ROLE_INFO[m.role_in_unit].label.toLowerCase()})`}`).join(", ")}
            </p>
          )}
        </div>
        {data.canManage && (
          <div className="flex flex-wrap gap-2" role="group" aria-label={`Change ${u.name}`}>
            {!closed && <button type="button" className={quiet} aria-expanded={open === "staff"} aria-controls={panelId} onClick={() => toggle("staff")}>Staff</button>}
            {!closed && <button type="button" className={quiet} aria-expanded={open === "rename"} aria-controls={panelId} onClick={() => toggle("rename")}>Rename</button>}
            {!closed && node.depth < UNIT_MAX_DEPTH && <button type="button" className={quiet} aria-expanded={open === "add"} aria-controls={panelId} onClick={() => toggle("add")}>Add inside</button>}
            {!closed && <button type="button" className={quiet} aria-expanded={open === "move"} aria-controls={panelId} onClick={() => toggle("move")}>Move</button>}
            {closed
              ? <button type="button" className={quiet} onClick={() => act({ action: "reopen_unit", unitId: u.id }, `${u.name} is open again.`)}>Reopen</button>
              : <button type="button" className={quiet} onClick={() => { if (confirm(`Close ${u.name}? It stays on record and can be reopened. Nobody can be enrolled in it while it is closed.`)) act({ action: "close_unit", unitId: u.id }, `${u.name} is closed. It stays on record.`); }}>Close</button>}
          </div>
        )}
      </div>
      <div id={panelId}>
        {open === "rename" && <RenameForm unit={u} act={act} onDone={() => setOpen(null)} />}
        {open === "move" && <MoveForm unit={u} units={data.units} act={act} onDone={() => setOpen(null)} />}
        {open === "staff" && <StaffPanel unit={u} members={members} staff={data.staff} t={t} act={act} />}
        {open === "add" && <div className="px-4 pb-4"><AddUnitForm t={t} parentId={u.id} parentName={u.name} act={act} onDone={() => setOpen(null)} /></div>}
      </div>
      {node.children.length > 0 && (
        <ul className="space-y-2 px-2 pb-2" aria-label={`Inside ${u.name}`}>
          {node.children.map((c) => <UnitRow key={c.unit.id} node={c} data={data} t={t} act={act} />)}
        </ul>
      )}
    </li>
  );
}

const KIND_LABEL: Record<UnitKind, string> = {
  program: "Program", cohort: "Cohort", site: "Site", facility: "Facility", housing_unit: "Housing unit",
  office: "Office", team: "Team", caseload: "Caseload", other: "Other group",
};
function kindOption(k: UnitKind, t: OrgWords) {
  return k === "program" || k === "site" || k === "team" || k === "caseload" ? unitKindLabel(k, t) : KIND_LABEL[k];
}

function AddUnitForm({ t, parentId, parentName, act, onDone }: { t: OrgWords; parentId: string | null; parentName: string | null; act: (b: Record<string, unknown>, done: string) => Promise<boolean>; onDone?: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<UnitKind>(parentId ? "cohort" : "program");
  const [busy, setBusy] = useState(false);
  const id = `add-${parentId ?? "top"}`;
  return (
    <form className="bg-t-panel border border-t-line p-4" onSubmit={async (e) => {
      e.preventDefault(); if (!name.trim() || busy) return;
      setBusy(true);
      const ok = await act({ action: "create_unit", name, kind, parentId }, `${name.trim()} was added.`);
      setBusy(false);
      if (ok) { setName(""); onDone?.(); }
    }}>
      <p className="text-sm font-semibold text-t-white mb-2">{parentName ? `Add a group inside ${parentName}` : "Add a group"}</p>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[12rem]">
          <label htmlFor={`${id}-name`} className="block text-xs text-t-phos-dim mb-1">Name</label>
          <input id={`${id}-name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={`${field} w-full`} placeholder={parentId ? "Spring cohort" : "Job readiness"} />
        </div>
        <div>
          <label htmlFor={`${id}-kind`} className="block text-xs text-t-phos-dim mb-1">Kind</label>
          <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as UnitKind)} className={field}>
            {UNIT_KINDS.map((k) => <option key={k} value={k}>{kindOption(k, t)}</option>)}
          </select>
        </div>
        <button className={primary} disabled={!name.trim() || busy}>{busy ? "Adding..." : "Add"}</button>
      </div>
      <p className="text-xs text-t-phos-dim mt-2">People are enrolled in a {t.program}, a cohort or a {t.caseload}. The other kinds hold groups and staff.</p>
    </form>
  );
}

function RenameForm({ unit, act, onDone }: { unit: Unit; act: (b: Record<string, unknown>, done: string) => Promise<boolean>; onDone: () => void }) {
  const [name, setName] = useState(unit.name);
  const [capacity, setCapacity] = useState(unit.capacity ? String(unit.capacity) : "");
  const id = `rename-${unit.id}`;
  return (
    <form className="px-4 pb-4 flex flex-wrap gap-2 items-end" onSubmit={async (e) => {
      e.preventDefault();
      if (await act({ action: "update_unit", unitId: unit.id, name, capacity: capacity.trim() === "" ? null : capacity }, `Saved ${name.trim()}.`)) onDone();
    }}>
      <div className="flex-1 min-w-[12rem]">
        <label htmlFor={`${id}-name`} className="block text-xs text-t-phos-dim mb-1">New name</label>
        <input id={`${id}-name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={`${field} w-full`} />
      </div>
      <div className="w-32">
        <label htmlFor={`${id}-cap`} className="block text-xs text-t-phos-dim mb-1">Room for (optional)</label>
        <input id={`${id}-cap`} inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/[^0-9]/g, ""))} className={`${field} w-full`} />
      </div>
      <button className={primary} disabled={!name.trim()}>Save</button>
      <button type="button" className={quiet} onClick={onDone}>Cancel</button>
    </form>
  );
}

function MoveForm({ unit, units, act, onDone }: { unit: Unit; units: Unit[]; act: (b: Record<string, unknown>, done: string) => Promise<boolean>; onDone: () => void }) {
  const targets = moveTargets(units, unit.id);
  const [to, setTo] = useState<string>(unit.parent_id ?? "");
  const id = `move-${unit.id}`;
  return (
    <form className="px-4 pb-4 flex flex-wrap gap-2 items-end" onSubmit={async (e) => {
      e.preventDefault();
      if (await act({ action: "move_unit", unitId: unit.id, parentId: to || null }, `${unit.name} was moved.`)) onDone();
    }}>
      <div className="flex-1 min-w-[12rem]">
        <label htmlFor={id} className="block text-xs text-t-phos-dim mb-1">Put {unit.name} inside</label>
        <select id={id} value={to} onChange={(e) => setTo(e.target.value)} className={`${field} w-full`}>
          <option value="">Nothing (top level)</option>
          {targets.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
      <button className={primary}>Move</button>
      <button type="button" className={quiet} onClick={onDone}>Cancel</button>
      <p className="w-full text-xs text-t-phos-dim">Groups go at most {UNIT_MAX_DEPTH} levels deep, so some places are not offered.</p>
    </form>
  );
}

function StaffPanel({ unit, members, staff, t, act }: { unit: Unit; members: Member[]; staff: StaffOption[]; t: OrgWords; act: (b: Record<string, unknown>, done: string) => Promise<boolean> }) {
  const here = new Set(members.map((m) => m.user_id));
  const options = staff.filter((s) => !here.has(s.user_id));
  const [who, setWho] = useState("");
  const [role, setRole] = useState<UnitRole>("member");
  const id = `staff-${unit.id}`;
  return (
    <div className="px-4 pb-4">
      <ul className="divide-y divide-t-line border border-t-line mb-3" aria-label={`Staff in ${unit.name}`}>
        {members.length === 0 && <li className="px-3 py-2 text-sm text-t-phos-dim">Nobody yet.</li>}
        {members.map((m) => (
          <li key={m.user_id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-t-white">{m.name || "Unnamed"}</span>
            <span className="flex flex-wrap gap-2 items-center">
              <label className="sr-only" htmlFor={`${id}-${m.user_id}`}>Role of {m.name || "this person"} in {unit.name}</label>
              <select id={`${id}-${m.user_id}`} value={m.role_in_unit} className={field}
                onChange={(e) => act({ action: "set_member", unitId: unit.id, userId: m.user_id, role: e.target.value }, `${m.name || "They"} is now ${UNIT_ROLE_INFO[e.target.value as UnitRole].label.toLowerCase()} here.`)}>
                {UNIT_ROLES.map((r) => <option key={r} value={r}>{UNIT_ROLE_INFO[r].label}</option>)}
              </select>
              <button type="button" className={quiet} onClick={() => act({ action: "remove_member", unitId: unit.id, userId: m.user_id }, `${m.name || "They"} left ${unit.name}.`)}>Remove</button>
            </span>
          </li>
        ))}
      </ul>
      {options.length > 0 ? (
        <form className="flex flex-wrap gap-2 items-end" onSubmit={async (e) => {
          e.preventDefault(); if (!who) return;
          if (await act({ action: "set_member", unitId: unit.id, userId: who, role }, "Added.")) setWho("");
        }}>
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor={`${id}-who`} className="block text-xs text-t-phos-dim mb-1">Add a {t.staff_member}</label>
            <select id={`${id}-who`} value={who} onChange={(e) => setWho(e.target.value)} className={`${field} w-full`}>
              <option value="">Choose...</option>
              {options.map((s) => <option key={s.user_id} value={s.user_id}>{s.name || "Unnamed"}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-role`} className="block text-xs text-t-phos-dim mb-1">As</label>
            <select id={`${id}-role`} value={role} onChange={(e) => setRole(e.target.value as UnitRole)} className={field}>
              {UNIT_ROLES.map((r) => <option key={r} value={r}>{UNIT_ROLE_INFO[r].label}</option>)}
            </select>
          </div>
          <button className={primary} disabled={!who}>Add</button>
        </form>
      ) : <p className="text-xs text-t-phos-dim">Everyone on your team is already here.</p>}
      <ul className="text-xs text-t-phos-dim mt-3 space-y-1">
        {UNIT_ROLES.map((r) => <li key={r}><span className="text-t-phos">{UNIT_ROLE_INFO[r].label}:</span> {UNIT_ROLE_INFO[r].help}</li>)}
      </ul>
    </div>
  );
}
