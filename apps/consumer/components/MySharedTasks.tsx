"use client";

/**
 * <MySharedTasks> -- things a participant's case manager asked them to do, on
 * the participant's own dashboard. Renders nothing when there are none. The
 * participant can tick one off; that is all they can do to it, and their case
 * manager sees that they did.
 */
import { useCallback, useEffect, useState } from "react";

interface Task { id: string; title: string; due_on: string | null; done_at: string | null; from_name: string | null; org_name: string | null }
const day = (s: string) => new Date(s + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

export function MySharedTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const load = useCallback(() => { fetch("/api/tasks").then((r) => (r.ok ? r.json() : { tasks: [] })).then((d) => setTasks(d.tasks ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  if (tasks.length === 0) return null;
  async function tick(t: Task) {
    await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: t.id, done: !t.done_at }) });
    load();
  }
  return (
    <section aria-labelledby="shared-tasks" className="bg-t-panel border border-t-line p-5">
      <h2 id="shared-tasks" className="font-semibold text-t-white mb-3">From your case manager</h2>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-start gap-3">
            <input id={`task-${t.id}`} type="checkbox" className="t-focus mt-1" checked={!!t.done_at} onChange={() => tick(t)} />
            <label htmlFor={`task-${t.id}`} className={`text-sm ${t.done_at ? "text-t-phos-dim line-through" : "text-t-white"}`}>
              {t.title}
              <span className="block text-xs text-t-phos-dim no-underline">
                {t.from_name ? `${t.from_name}` : "Your case manager"}{t.org_name ? `, ${t.org_name}` : ""}{t.due_on ? ` · by ${day(t.due_on)}` : ""}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
