/** Only the server tool executor calls this projection. Never ingest request messages/tool results. */
export interface StaffToolEvidence {
  tool: "read_staff_tasks" | "read_participant_progress" | "draft_staff_check_in";
  facts: Record<string, unknown>;
  names: string[];
  numbers: number[];
  labels: string[];
}
const obj = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const str = (v: unknown, max = 300) => typeof v === "string" ? v.slice(0, max) : null;
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const date = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/.test(v) ? v.slice(0, 35) : null;
export function projectStaffToolEvidence(tool: string, result: unknown): StaffToolEvidence | null {
  const r = obj(result);
  if (!r) return null;
  const names: string[] = [], numbers: number[] = [], labels: string[] = [];
  const name = (v: unknown) => { const n = str(v, 80); if (n) names.push(n); return n; };
  if (tool === "read_staff_tasks" && r.status === "ok" && Array.isArray(r.tasks)) {
    const tasks = r.tasks.slice(0, 20).flatMap((raw) => {
      const t = obj(raw); if (!t) return [];
      const title = str(t.title); if (!title) return [];
      labels.push(title);
      return [{ title, participant: name(t.participant), dueOn: date(t.dueOn), doneAt: date(t.doneAt), shared: t.shared === true }];
    });
    numbers.push(tasks.length);
    return { tool, names, numbers, labels, facts: { readAt: date(r.readAt), tasks, shownCount: tasks.length, more: r.more === true, meaning: "Recorded tasks, not confirmed contacts or participant outcomes." } };
  }
  if ((tool === "read_participant_progress" && r.status === "ok") || (tool === "draft_staff_check_in" && r.status === "draft_only" && r.saved === false && r.sent === false)) {
    const rawRows = tool === "read_participant_progress" ? r.data : r.source;
    if (!Array.isArray(rawRows)) return null;
    const people = rawRows.slice(0, 1).flatMap((raw) => {
      const row = obj(raw); if (!row) return [];
      const progress = obj(row.progress);
      let sharedProgress: Record<string, unknown> | null = null;
      if (progress) {
        sharedProgress = { nextStepAction: str(progress.nextStepAction), hasTailoredResume: progress.hasTailoredResume === true, lastActiveAt: date(progress.lastActiveAt) };
        for (const key of ["applications", "savedJobs", "practiceSessions"]) {
          const n = number(progress[key]); sharedProgress[key] = n;
          if (n !== null) numbers.push(n);
        }
        if (sharedProgress.nextStepAction) labels.push(String(sharedProgress.nextStepAction));
      }
      return [{ name: name(row.name ?? row.firstName), sharedProgress }];
    });
    return { tool, names, numbers, labels, facts: { people, saved: false, sent: false, meaning: "Null sharedProgress means no shared progress facts. Drafts are not saved or sent." } };
  }
  return null;
}
export function createStaffEvidenceCollector() {
  const items: StaffToolEvidence[] = [];
  return {
    items,
    record(tool: string, result: unknown) {
      if (items.length >= 5) return;
      const projected = projectStaffToolEvidence(tool, result);
      if (projected) items.push(projected);
    },
  };
}
