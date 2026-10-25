/**
 * Today's screen, the pure parts (CRM wave 2026-10-25, lane C1): the header
 * sentence, the reason strip, relative times, the This week agenda, initials.
 * The page component only arranges these; tests run them on fixtures.
 */
export interface TodayItemView {
  key: string; section: string; clientId: string | null; clientName: string | null; reason: string; when: string | null;
  action: { label: string; href: string }; taskId?: string; stage?: number | null;
}
export interface TodayPayload {
  items: TodayItemView[];
  sections: { key: string; label: string }[];
  hidden: string[];
  canAddTasks: boolean;
  reach?: { joined: number; sharing: number } | null;
  volunteer?: boolean;
}

const DAY_MS = 86400000;

/** Midnight of the calendar day `when` falls on, in the viewer's zone. A bare date is that local day. */
function localDay(when: string): number {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(when) ? new Date(`${when}T00:00:00`) : new Date(when);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days from today to `when` (negative = past). */
export function daysFromToday(when: string, nowMs: number): number {
  const n = new Date(nowMs);
  return Math.round((localDay(when) - new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) / DAY_MS);
}

export function relativeWhen(when: string | null, nowMs: number): string | null {
  if (!when || Number.isNaN(new Date(/^\d{4}-\d{2}-\d{2}$/.test(when) ? `${when}T00:00:00` : when).getTime())) return null;
  const d = daysFromToday(when, nowMs);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

export function todayDateLine(nowMs: number, timeZone?: string): string {
  return new Date(nowMs).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", ...(timeZone ? { timeZone } : {}) });
}

/** The items the viewer chose to see. */
export function visibleItems(d: TodayPayload): TodayItemView[] {
  return d.items.filter((i) => !d.hidden.includes(i.section));
}

/** "{n} people need you today. {m} tasks are yours." Singular forms handled; volunteers read "of your assigned people". */
export function todayHeadline(d: TodayPayload): string {
  const items = visibleItems(d);
  const people = new Set(items.filter((i) => i.section !== "tasks" && i.clientId).map((i) => i.clientId)).size;
  const tasks = items.filter((i) => i.section === "tasks").length;
  const who = d.volunteer
    ? (people === 0 ? "None of your assigned people need you right now." : `${people} of your assigned people ${people === 1 ? "needs" : "need"} you today.`)
    : (people === 0 ? "Nobody is waiting on you right now." : `${people} ${people === 1 ? "person needs" : "people need"} you today.`);
  const mine = tasks === 0 ? "" : ` ${tasks} ${tasks === 1 ? "task is" : "tasks are"} yours.`;
  return who + mine;
}

/** One chip per non-empty, visible section, in the code's order, with its count. */
export function reasonStrip(d: TodayPayload): { key: string; label: string; count: number }[] {
  return d.sections
    .filter((s) => !d.hidden.includes(s.key))
    .map((s) => ({ key: s.key, label: s.label, count: d.items.filter((i) => i.section === s.key).length }))
    .filter((s) => s.count > 0);
}

export function hiddenSectionCount(d: TodayPayload): number {
  return d.sections.filter((s) => d.hidden.includes(s.key)).length;
}

/**
 * This week: dated items from today through the next seven days (tasks,
 * interviews, follow-ups), soonest first, plus retention check-ins, which are
 * due now. Only items already on the page; nothing new is read.
 */
export function thisWeek(d: TodayPayload, nowMs: number): { item: TodayItemView; label: string }[] {
  const out: { item: TodayItemView; label: string; sort: number }[] = [];
  for (const i of visibleItems(d)) {
    if (i.section === "retention") { out.push({ item: i, label: "Due now", sort: -1 }); continue; }
    if (!["tasks", "interviews", "followups"].includes(i.section) || !i.when) continue;
    const days = daysFromToday(i.when, nowMs);
    if (days < 0 || days > 7) continue;
    out.push({ item: i, label: relativeWhen(i.when, nowMs) ?? "", sort: days });
  }
  return out.sort((a, b) => a.sort - b.sort).map(({ item, label }) => ({ item, label }));
}

/** Initials for a person's avatar (no photos on staff screens). */
export function personInitials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const pick = parts.length === 1 ? [parts[0]] : [parts[0], parts[parts.length - 1]];
  return pick.map((p) => p[0]!.toUpperCase()).join("");
}

/** The empty-because-nobody-shares line, for people who see the whole organization only. */
export function nobodySharesLine(d: TodayPayload): string | null {
  const r = d.reach;
  if (!r || r.joined === 0 || r.sharing > 0) return null;
  return r.joined === 1
    ? "1 person joined and has not turned on progress sharing yet, so nothing about their work shows here. That is their choice."
    : `${r.joined} people joined. None has turned on progress sharing yet, so nothing about their work shows here. That is their choice.`;
}
