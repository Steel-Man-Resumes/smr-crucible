"use client";

/**
 * <MySharedTasks> -- things a participant's case manager asked them to do, on
 * the participant's own dashboard. Renders nothing when there are none. The
 * participant can tick one off; that is all they can do to it, and their case
 * manager sees that they did.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

interface Task { id: string; title: string; due_on: string | null; done_at: string | null; from_name: string | null; org_name: string | null }
const day = (s: string, locale?: string) => new Date(s + "T12:00:00Z").toLocaleDateString(locale, { weekday: "long", month: "short", day: "numeric" });

export function MySharedTasks() {
  const t = useTranslations("refineryHome.mySharedTasks");
  const locale = useLocale();
  const [tasks, setTasks] = useState<Task[]>([]);
  const load = useCallback(() => { fetch("/api/tasks").then((r) => (r.ok ? r.json() : { tasks: [] })).then((d) => setTasks(d.tasks ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  if (tasks.length === 0) return null;
  async function tick(task: Task) {
    await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: task.id, done: !task.done_at }) });
    load();
  }
  return (
    <section aria-labelledby="shared-tasks" className="bg-t-panel border border-t-line p-5">
      <h2 id="shared-tasks" className="font-semibold text-t-white mb-3">{t("heading")}</h2>
      <ul className="space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-start gap-3">
            <input id={`task-${task.id}`} type="checkbox" className="t-focus mt-1" checked={!!task.done_at} onChange={() => tick(task)} />
            <label htmlFor={`task-${task.id}`} className={`text-sm ${task.done_at ? "text-t-phos-dim line-through" : "text-t-white"}`}>
              {task.title}
              <span className="block text-xs text-t-phos-dim no-underline">
                {task.from_name ? `${task.from_name}` : t("yourCaseManager")}{task.org_name ? `, ${task.org_name}` : ""}{task.due_on ? ` · ${t("by", { day: day(task.due_on, locale === "es" ? "es" : undefined) })}` : ""}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
