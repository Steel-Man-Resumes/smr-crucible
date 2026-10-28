"use client";
/**
 * Giving a task to a colleague (staff side lane S4, migration 109).
 *
 * <AssigneeSelect clientId={id} value={ownerId} onChange={setOwnerId} />
 *     on a task form: "Me" plus the teammates who can see this person. Send
 *     the chosen id as `ownerId` with { action: "add" } to /api/org/tasks.
 * <HandTaskOn taskId={t.id} clientId={id} ownerName={t.owner_name} onDone={reload} />
 *     on a task row: hand an open task to a teammate who can see the person.
 *
 * Only people who can see the person are offered. The route and the database
 * refuse anyone else with a plain line, and the new owner gets an Inbox item.
 */
import { useEffect, useState } from "react";

interface Assignee { user_id: string; name: string | null; me: boolean }
const cache = new Map<string, Promise<Assignee[]>>();

/** Who a task about this person (null: about nobody) can go to. One request per person per page. */
export function useTaskAssignees(clientId: string | null): Assignee[] | null {
  const [list, setList] = useState<Assignee[] | null>(null);
  useEffect(() => {
    const key = clientId ?? "-";
    if (!cache.has(key)) {
      cache.set(key, fetch(`/api/org/tasks?assignees=1${clientId ? `&clientId=${clientId}` : ""}`)
        .then((r) => (r.ok ? r.json() : { assignees: [] })).then((d) => (d.assignees ?? []) as Assignee[]).catch(() => []));
    }
    let alive = true;
    cache.get(key)!.then((a) => { if (alive) setList(a); });
    return () => { alive = false; };
  }, [clientId]);
  return list;
}

const label = (a: Assignee) => (a.me ? "Me" : a.name || "A teammate");

export function AssigneeSelect({ clientId, value, onChange, id = "task-owner" }: { clientId: string | null; value: string | null; onChange: (ownerId: string | null) => void; id?: string }) {
  const list = useTaskAssignees(clientId);
  if (!list || list.length <= 1) return null;
  return (
    <>
      <label className="sr-only" htmlFor={id}>Whose task is it</label>
      <select id={id} value={value ?? list[0].user_id} onChange={(e) => onChange(list.find((a) => a.user_id === e.target.value)?.me ? null : e.target.value)}
        className="plain-field t-focus bg-t-panel-2 border border-t-line text-sm text-t-phos px-3 py-2">
        {list.map((a) => <option key={a.user_id} value={a.user_id}>{a.me ? "Mine" : `For ${label(a)}`}</option>)}
      </select>
    </>
  );
}

export function HandTaskOn({ taskId, clientId, ownerId, onDone }: { taskId: string; clientId: string | null; ownerId: string | null; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="t-focus text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-white">Hand on</button>;
  return <HandPicker taskId={taskId} clientId={clientId} ownerId={ownerId} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onDone(); }} />;
}

function HandPicker({ taskId, clientId, ownerId, onClose, onDone }: { taskId: string; clientId: string | null; ownerId: string | null; onClose: () => void; onDone: () => void }) {
  const [pick, setPick] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const list = useTaskAssignees(clientId);
  const choices = (list ?? []).filter((a) => a.user_id !== ownerId);
  async function hand() {
    if (!pick) return;
    setMsg(null);
    try {
      const res = await fetch("/api/org/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "assign", taskId, ownerId: pick }) });
      if (!res.ok) { setMsg((await res.json().catch(() => ({}))).error || "That did not save."); return; }
      onDone();
    } catch { setMsg("That did not save. Check the connection and try again."); }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {list === null ? <span className="text-xs text-t-phos-dim">Getting your team...</span>
        : choices.length === 0 ? <span className="text-xs text-t-phos-dim">Nobody else on your team can see this person yet.</span>
        : (
          <>
            <label className="sr-only" htmlFor={`hand-${taskId}`}>Hand this task to</label>
            <select id={`hand-${taskId}`} value={pick} onChange={(e) => setPick(e.target.value)} className="plain-field t-focus bg-t-panel-2 border border-t-line text-xs text-t-phos px-2 py-1">
              <option value="">Pick a teammate</option>
              {choices.map((a) => <option key={a.user_id} value={a.user_id}>{label(a)}</option>)}
            </select>
            <button type="button" disabled={!pick} onClick={hand} className="t-focus text-xs text-t-phos underline underline-offset-4 hover:text-t-white disabled:opacity-50">Hand it on</button>
          </>
        )}
      <button type="button" onClick={onClose} className="t-focus text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-white">Cancel</button>
      {msg && <span role="alert" className="text-xs text-t-amber-bright">{msg}</span>}
    </span>
  );
}
