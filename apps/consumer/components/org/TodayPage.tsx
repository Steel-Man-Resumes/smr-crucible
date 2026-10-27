"use client";

/**
 * <TodayPage> -- who needs me, why, and the one thing to do about it.
 *
 * Grouped by REASON, because "what kind of day is this" is the first thing a
 * case manager wants to know. Every line is a sentence already written (by
 * core, orgToday.ts), with one action and a "Prep me" that opens t.ROY on that
 * person. Sections can be hidden (Settings -> My workflow); a section with
 * nothing in it does not render.
 *
 * What is NOT here is as deliberate as what is: someone who shares nothing
 * appears for nothing derived from their work. The page says that once, behind
 * a toggle at the bottom, so an empty section is never mistaken for "nothing
 * is happening".
 *
 * Layout and states follow the CRM design (2026-10-25): date, reason strip,
 * rows with initials and station, a right rail with tasks and This week, real
 * loading and error states with a retry.
 *
 * STAFF BUILD S3: each person can put Today's sections in their own order and
 * fold them, inside what their organization allows (migration 108). Every
 * such change goes through the view action layer (/api/org/prefs/view), so it
 * is logged and can be undone; t.ROY makes the same changes the same way, and
 * the page reads them again when the chat says it changed something.
 */
import { useCallback, useEffect, useState } from "react";
import { orderTodaySections } from "@crucible/core/src/staffPrefsShared";
import { VIEW_CHANGED_EVENT, announceViewChanged } from "@/lib/view-change-events";
import Link from "next/link";
import { useEffectiveRole } from "@/components/RoleProvider";
import { OrgSetupPrompt } from "@/components/org/OrgSetupPrompt";
import { useOrgTerms } from "@/lib/use-org-terms";
import { ListChecks } from "lucide-react";
import { openStaffTroy, STAFF_TROY_READY } from "@/lib/staff-troy";
import { STAFF_TOUR_OPEN_EVENT } from "@/lib/tour/staff-tour";
import { CRM_TOUR_COPY } from "@/lib/tour/crm-beats";
import { stationLabelForStage } from "@/lib/staff-station";
import {
  hiddenItemCount, hiddenSectionCount, nobodySharesLine, personInitials, reasonStrip, relativeWhen, thisWeek, todayDateLine, todayHeadline, toggleCollapsed, visibleItems,
  type TodayItemView, type TodayPayload,
} from "@/lib/today-view";

export type TodayState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "forbidden" }
  | { status: "ready"; data: TodayPayload };

const first = (n: string | null) => (n ?? "").trim().split(/\s+/)[0] || "them";

/** This person's own Today choices and what their role may change (from /api/org/prefs). */
export interface TodayOwn { order: string[]; canOrder: boolean; canFold: boolean; canHide: boolean }

export function TodayPage() {
  const role = useEffectiveRole();
  const [state, setState] = useState<TodayState>({ status: "loading" });
  const [own, setOwn] = useState<TodayOwn>({ order: [], canOrder: true, canFold: true, canHide: true });
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string; changeId?: string | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(async () => {
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    try {
      const [res, prefs] = await Promise.all([
        fetch("/api/org/today", { cache: "no-store" }),
        fetch("/api/org/prefs", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (res.status === 403) { setState({ status: "forbidden" }); return; }
      if (!res.ok) { setState({ status: "error" }); return; }
      setState({ status: "ready", data: await res.json() });
      if (prefs?.effective) {
        const a = prefs.allowed ?? {};
        setOwn({ order: prefs.effective.todayOrder ?? [], canOrder: a.today_order !== false, canFold: a.today_fold !== false, canHide: a.today_hide !== false });
      }
      setNow(Date.now());
    } catch {
      setState({ status: "error" });
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const again = () => { void load(); };
    window.addEventListener(VIEW_CHANGED_EVENT, again);
    return () => window.removeEventListener(VIEW_CHANGED_EVENT, again);
  }, [load]);

  async function task(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/org/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      await load();
      return res.ok;
    } catch {
      return false;
    }
  }

  /** One change to this person's own Today, through the view action layer. */
  async function change(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/org/prefs/view", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { if (d.reason !== "unchanged") setNote({ kind: "err", text: d.error || "That did not save. Try again." }); return false; }
      setNote({ kind: "ok", text: `${d.summary}.`, changeId: d.changeId ?? null });
      return true;
    } catch {
      setNote({ kind: "err", text: "That did not save. Try again." });
      return false;
    }
  }

  // Folding a section is this person's own choice (staff prefs, todayCollapsed).
  // The screen folds at once; the choice is saved behind it, and a failed
  // save only means it unfolds next time.
  async function toggle(key: string) {
    if (state.status !== "ready") return;
    const collapsed = toggleCollapsed(state.data.collapsed, key);
    const folded = collapsed.includes(key);
    setState({ status: "ready", data: { ...state.data, collapsed } });
    const ok = await change({ action: "foldSection", section: key, folded });
    if (!ok) setState((s) => (s.status === "ready" ? { status: "ready", data: { ...s.data, collapsed: toggleCollapsed(s.data.collapsed, key) } } : s));
    else setNote(null); // a fold is its own feedback
  }

  async function arrange(order: string[], hidden: { key: string; hidden: boolean }[]) {
    let ok = true;
    if (own.canOrder) ok = (await change({ action: "setTodayOrder", order })) && ok;
    for (const h of hidden) ok = (await change({ action: "hideSection", section: h.key, hidden: h.hidden })) && ok;
    await load();
    if (ok) announceViewChanged({ target: "pref:todayOrder" });
  }

  async function undo(changeId: string) {
    const res = await fetch("/api/org/prefs/changes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "undo", id: changeId }) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setNote(res?.ok ? { kind: "ok", text: `${d.summary ?? "Undone"}.` } : { kind: "err", text: d.error || "That did not undo. Try again." });
    await load();
  }

  // The staff tour never opens under view-as or assist, so the control is not drawn there (review N-3).
  // First run: the owner sees a nudge to set the organization up (house lane L3a); never under view-as.
  const writable = !role?.impersonating;
  return (
    <>
      {!role?.impersonating && <div className="mx-auto max-w-6xl"><OrgSetupPrompt placement="today" /></div>}
      {note && (
        <div className="mx-auto mb-3 flex max-w-6xl flex-wrap items-center gap-3 text-sm">
          <p role={note.kind === "err" ? "alert" : "status"} className={note.kind === "err" ? "text-t-amber-bright" : "text-t-phos"}>{note.text}</p>
          {note.kind === "ok" && note.changeId && (
            <button type="button" onClick={() => undo(note.changeId!)} className="t-focus min-h-touch text-xs font-semibold text-t-amber-bright underline underline-offset-4">Undo</button>
          )}
        </div>
      )}
      <TodayView state={state} nowMs={now} onRetry={() => { setState({ status: "loading" }); load(); }} onTask={task}
        onToggleSection={writable && own.canFold ? toggle : undefined} tourReady={!role?.impersonating}
        personalOrder={own.order} onArrange={writable && (own.canOrder || own.canHide) ? arrange : undefined} canOrder={own.canOrder} canHide={own.canHide} />
    </>
  );
}

export function TodayView({ state, nowMs, onRetry, onTask, onToggleSection, timeZone, troyReady = STAFF_TROY_READY, tourReady = true, personalOrder, onArrange, canOrder = true, canHide = true }: {
  state: TodayState; nowMs: number; onRetry?: () => void; onTask?: (body: Record<string, unknown>) => Promise<boolean>; timeZone?: string;
  /** This person's own section order (S3). Their order first, then the role's order. */
  personalOrder?: string[];
  /** Arrange my Today (S3): absent when the organization locks both order and hiding, or under view-as. */
  onArrange?: (order: string[], hidden: { key: string; hidden: boolean }[]) => Promise<void>;
  canOrder?: boolean;
  canHide?: boolean;
  /** Fold or unfold a section for this person. Absent: no fold control (view-as, tests). */
  onToggleSection?: (key: string) => void;
  /** Staff t.ROY buttons show only once C4's launcher is merged (STAFF_TROY_READY). */
  troyReady?: boolean;
  /** The "Show me around" control for the staff tour (the shell mounts the tour for staff only). */
  tourReady?: boolean;
}) {
  const terms = useOrgTerms();
  const [arranging, setArranging] = useState(false);
  // data-tour ids are the staff tour's targets (lib/tour/crm-beats.ts); the
  // "Show me around" control opens it (components/tour/StaffTour.tsx listens).
  const header = (sentence: React.ReactNode) => (
    <header className="mb-5" data-tour="crm-today-header">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-t-white">Today</h1>
        {tourReady && (
          <button type="button" data-tour="crm-tour-start" aria-label={CRM_TOUR_COPY.openLabel}
            onClick={() => window.dispatchEvent(new Event(STAFF_TOUR_OPEN_EVENT))}
            className="t-focus min-h-touch rounded-[4px] border border-t-line px-3 text-xs font-medium text-t-bone-dim hover:border-t-line-strong hover:text-t-white">
            {CRM_TOUR_COPY.open}
          </button>
        )}
      </div>
      <p className="mt-1 font-term text-xs uppercase tracking-wider text-t-bone-dim">{todayDateLine(nowMs, timeZone)}</p>
      {sentence ? <p className="mt-3 text-base text-t-white">{sentence}</p> : null}
    </header>
  );

  if (state.status === "loading") {
    return (
      <div className="mx-auto max-w-6xl" aria-busy="true">
        {header(null)}
        <p role="status" className="sr-only">Getting your day ready.</p>
        <div className="mb-6 flex flex-wrap gap-2" aria-hidden="true">
          {[0, 1, 2].map((n) => <span key={n} className="h-8 w-36 animate-pulse rounded-[4px] bg-t-panel-3 motion-reduce:animate-none" />)}
        </div>
        <ul className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((n) => (
            <li key={n} className="flex items-center gap-3 border border-t-line bg-t-panel px-4 py-4">
              <span className="h-9 w-9 flex-none animate-pulse rounded-full bg-t-panel-3 motion-reduce:animate-none" />
              <span className="h-4 flex-1 animate-pulse rounded bg-t-panel-3 motion-reduce:animate-none" />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="mx-auto max-w-6xl">
        {header(null)}
        <div role="alert" className="border border-t-amber bg-t-panel px-4 py-4">
          <p className="font-semibold text-t-white">Your day did not load. Nothing was lost.</p>
          <button type="button" onClick={onRetry} className="t-focus mt-3 min-h-touch rounded-[4px] border border-t-line-strong px-4 text-sm font-medium text-t-white hover:bg-t-panel-2">Try again</button>
        </div>
      </div>
    );
  }
  if (state.status === "forbidden") {
    return (
      <div className="mx-auto max-w-6xl">
        {header(null)}
        <p role="note" className="border border-t-line bg-t-panel px-4 py-4 text-t-white">
          Today is for staff who can open what {terms.participants} have shared. Ask your organization&apos;s owner, or go to <Link href="/dashboard/people" className="t-focus underline underline-offset-4">People</Link>.
        </p>
      </div>
    );
  }

  const d = state.data;
  const items = visibleItems(d);
  const strip = reasonStrip(d);
  const hiddenCount = hiddenSectionCount(d);
  const ordered = orderTodaySections(d.sections, personalOrder);
  const shown = ordered.filter((s) => !d.hidden.includes(s.key));
  const empty = items.length === 0;
  const hiddenItems = hiddenItemCount(d);
  const nobody = nobodySharesLine(d);
  const week = thisWeek(d, nowMs);
  // The staff tour points at the first row about a person (never a task row) and reads its id from it.
  const firstPersonKey = shown.filter((s) => !onToggleSection || !(d.collapsed ?? []).includes(s.key))
    .flatMap((s) => items.filter((i) => i.section === s.key)).find((i) => i.clientId)?.key ?? null;

  return (
    <div className="mx-auto max-w-6xl">
      {header(empty ? (hiddenItems > 0 ? "Nothing in the sections you show." : "Nothing is waiting on you right now.") : todayHeadline(d))}

      {(strip.length > 0 || hiddenCount > 0) && (
        <nav aria-label="Reasons on your list today" data-tour="crm-today-reasons" className="-mx-4 mb-6 flex flex-nowrap items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {strip.map((s) => (
            <a key={s.key} href={`#today-${s.key}`} className="t-focus inline-flex min-h-touch flex-none items-center gap-2 whitespace-nowrap rounded-[4px] border border-t-line bg-t-panel px-3 text-sm text-t-white hover:border-t-line-strong">
              {s.label}
              <span className="rounded-[3px] bg-t-panel-3 px-1.5 font-term text-xs text-t-white">{s.count}</span>
            </a>
          ))}
          {hiddenCount > 0 && (
            <Link href="/dashboard/settings" className="t-focus inline-flex min-h-touch flex-none items-center whitespace-nowrap px-2 text-xs text-t-bone-dim underline underline-offset-4 hover:text-t-white">
              {hiddenCount === 1 ? "1 section hidden in your settings" : `${hiddenCount} sections hidden in your settings`}
            </Link>
          )}
          {onArrange && (
            <button type="button" aria-expanded={arranging} onClick={() => setArranging(!arranging)}
              className="t-focus inline-flex min-h-touch flex-none items-center whitespace-nowrap px-2 text-xs text-t-bone-dim underline underline-offset-4 hover:text-t-white">
              Arrange my Today
            </button>
          )}
        </nav>
      )}
      {onArrange && arranging && (
        <ArrangeToday sections={ordered} hidden={d.hidden} canOrder={canOrder} canHide={canHide}
          onCancel={() => setArranging(false)} onSave={async (order, hidden) => { await onArrange(order, hidden); setArranging(false); }} />
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          {nobody && <p role="note" className="mb-6 border-l-[3px] border-t-amber bg-t-panel px-4 py-3 text-sm text-t-white">{nobody}</p>}

          {empty && hiddenItems > 0 && (
            <p className="mb-6 border border-t-line bg-t-panel px-5 py-4 text-sm text-t-white">
              {hiddenItems === 1 ? "1 item is" : `${hiddenItems} items are`} in sections you hid.{" "}
              <Link href="/dashboard/settings" className="t-focus underline underline-offset-4">Show hidden sections</Link>
            </p>
          )}

          {empty && hiddenItems === 0 && nobody && (
            <section className="border border-t-line bg-t-panel px-5 py-6">
              <p className="text-t-white">Until someone turns sharing on, you can still keep your own tasks here and talk with people about what sharing shows. Each person decides for themselves.</p>
              <Link href="/dashboard/people" className="t-focus mt-4 inline-flex min-h-touch items-center rounded-[4px] bg-[#4f6b57] px-4 text-sm font-semibold text-white hover:bg-[#3d5745]">See who joined</Link>
            </section>
          )}

          {empty && hiddenItems === 0 && !nobody && (
            <section className="border border-t-line bg-t-panel px-5 py-6">
              <p className="text-t-white">Quiet days are when first conversations happen.{troyReady ? " Want t.ROY to suggest who to call?" : ""}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href="/dashboard/people" className="t-focus inline-flex min-h-touch items-center rounded-[4px] bg-[#4f6b57] px-4 text-sm font-semibold text-white hover:bg-[#3d5745]">See everyone</Link>
                {troyReady && (
                  <button type="button" onClick={() => openStaffTroy({ skill: "staff-what-changed" })}
                    className="t-focus min-h-touch rounded-[4px] border border-purple-400 px-4 text-sm font-medium text-purple-800 hover:bg-purple-50">
                    Ask t.ROY who to call
                  </button>
                )}
              </div>
            </section>
          )}

          {week.length > 0 && (
            <details className="mb-6 border border-t-line bg-t-panel px-4 py-2 lg:hidden">
              <summary className="t-focus flex min-h-touch cursor-pointer items-center text-sm font-semibold text-t-white">This week ({week.length})</summary>
              <WeekList week={week} />
            </details>
          )}

          {shown.map((s) => {
            const rows = items.filter((i) => i.section === s.key);
            if (rows.length === 0) return null;
            const folded = !!onToggleSection && (d.collapsed ?? []).includes(s.key);
            return (
              <section key={s.key} aria-labelledby={`today-${s.key}-h`} className="mb-7">
                <h2 id={`today-${s.key}`} tabIndex={-1} className="mb-2 flex items-baseline gap-2 border-b border-t-line pb-2 text-xs font-semibold uppercase tracking-wide text-t-amber-bright scroll-mt-24 focus:outline-none">
                  <span id={`today-${s.key}-h`}>{s.label}</span>
                  <span className="font-term text-t-bone-dim">{rows.length}</span>
                  {onToggleSection && (
                    <button type="button" aria-expanded={!folded} aria-controls={`today-${s.key}-rows`} onClick={() => onToggleSection(s.key)}
                      className="t-focus ml-auto min-h-touch px-2 text-[11px] font-medium normal-case tracking-normal text-t-bone-dim underline underline-offset-4 hover:text-t-white">
                      {folded ? "Show" : "Fold"}<span className="sr-only"> {s.label}</span>
                    </button>
                  )}
                </h2>
                {!folded && (
                  <ul id={`today-${s.key}-rows`} className="space-y-2">
                    {rows.map((i) => <TodayRow key={i.key} item={i} nowMs={nowMs} onTask={onTask} troyReady={troyReady} tourFirst={i.key === firstPersonKey} />)}
                  </ul>
                )}
              </section>
            );
          })}

          <details className="mt-8 max-w-2xl text-xs text-t-phos-dim">
            <summary className="t-focus inline-flex min-h-touch cursor-pointer items-center text-t-bone-dim underline underline-offset-4">Why someone might not be here</summary>
            <p className="mt-2">
              Interviews and follow-up dates appear here only for people who chose to share their applications, and they can see that those dates showed up on your list. Someone who shares nothing will not appear for any of that, which is their choice, not a sign that nothing is happening. Choose which sections you see in Settings, under My workflow.
            </p>
          </details>
        </div>

        <aside aria-label="Your tasks and this week" className="space-y-6">
          {d.volunteer && (
            <p role="note" className="border border-t-line bg-t-panel px-4 py-3 text-sm text-t-white">
              As a volunteer you see the people assigned to you. Placements and invites are handled by staff.
            </p>
          )}
          {d.canAddTasks && <div data-tour="crm-today-tasks"><TaskAdd onTask={onTask} /></div>}
          <section aria-labelledby="today-week-h" className="hidden border border-t-line bg-t-panel px-4 py-4 lg:block">
            <h2 id="today-week-h" className="text-sm font-semibold text-t-white">This week</h2>
            {week.length === 0 ? <p className="mt-2 text-sm text-t-phos-dim">Nothing dated in the next seven days.</p> : <WeekList week={week} />}
          </section>
        </aside>
      </div>
    </div>
  );
}

function WeekList({ week }: { week: { item: TodayItemView; label: string }[] }) {
  return (
    <ul className="mt-2 space-y-2 pb-2">
      {week.map(({ item, label }) => (
        <li key={item.key} className="flex gap-3 text-sm">
          <span className="w-20 flex-none font-term text-xs leading-5 text-t-amber-bright">{label}</span>
          <span className="min-w-0 text-t-white">{item.clientName ? `${first(item.clientName)}: ` : ""}{agendaWhat(item)}</span>
        </li>
      ))}
    </ul>
  );
}

function agendaWhat(i: TodayItemView): string {
  if (i.section === "interviews") return "interview";
  if (i.section === "interview_stalled") return "stalled interview";
  if (i.section === "followups") return "follow-up";
  if (i.section === "retention") return "retention check-in";
  if (i.section === "referrals") return "referral past due";
  return i.reason.replace(/ \((was )?due [^)]*\)/, "").replace(/ · shared with .*$/, "");
}

function TodayRow({ item: i, nowMs, onTask, troyReady, tourFirst = false }: { item: TodayItemView; nowMs: number; onTask?: (body: Record<string, unknown>) => Promise<boolean>; troyReady: boolean; tourFirst?: boolean }) {
  // A retention line is due now; its date is the start date, so no "N days ago".
  const when = i.section === "retention" ? null : relativeWhen(i.when, nowMs);
  const station = stationLabelForStage(i.stage ?? null);
  return (
    <li className="flex flex-wrap items-center gap-3 border border-t-line bg-t-panel px-4 py-3"
      data-tour={tourFirst ? "crm-today-first-row" : undefined} data-client-id={tourFirst && i.clientId ? i.clientId : undefined}>
      <span aria-hidden="true" className="grid h-9 w-9 flex-none place-items-center rounded-full bg-t-panel-3 font-term text-xs font-semibold text-t-white">
        {i.clientId ? personInitials(i.clientName) : <ListChecks size={16} />}
      </span>
      <div className="min-w-[12rem] flex-1">
        <p className="text-sm text-t-white">{i.reason}</p>
        {(station || when) && (
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-t-bone-dim">
            {station && <span><span className="sr-only">Station: </span>{station}</span>}
            {when && <span>{when}</span>}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {i.taskId && (
          <button type="button" onClick={() => onTask?.({ action: "done", taskId: i.taskId })}
            className="t-focus min-h-touch px-2 text-xs text-t-phos underline underline-offset-4 hover:text-t-white">Mark done</button>
        )}
        {i.action.href !== "#" && (
          <Link href={i.action.href} className="t-focus inline-flex min-h-touch items-center whitespace-nowrap rounded-[4px] bg-[#4f6b57] px-3 text-xs font-semibold text-white hover:bg-[#3d5745]">{i.action.label}</Link>
        )}
        {troyReady && i.clientId && (
          <button type="button" onClick={() => openStaffTroy({ clientId: i.clientId!, skill: "staff-prep-me" })}
            aria-label={`Prep me for ${first(i.clientName)}`}
            className="t-focus inline-flex min-h-touch items-center px-2 text-xs font-medium text-purple-800 underline underline-offset-4 hover:text-purple-950">
            Prep me
          </button>
        )}
      </div>
    </li>
  );
}

function TaskAdd({ onTask }: { onTask?: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [failed, setFailed] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (title.trim().length < 2) return;
        const ok = (await onTask?.({ action: "add", title, dueOn: due || null })) ?? false;
        setFailed(!ok);
        if (ok) { setTitle(""); setDue(""); }
      }}
      className="border border-t-line bg-t-panel px-4 py-4"
    >
      <h2 className="text-sm font-semibold text-t-white">Your tasks</h2>
      <label className="mt-3 block text-xs text-t-bone-dim" htmlFor="today-task">Add a task for yourself</label>
      <input id="today-task" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300}
        className="plain-field t-focus mt-1 w-full rounded-[4px] border px-3 py-2 text-sm" />
      <div className="mt-2 flex gap-2">
        <label className="sr-only" htmlFor="today-due">Due date</label>
        <input id="today-due" type="date" value={due} onChange={(e) => setDue(e.target.value)}
          className="plain-field t-focus min-w-0 flex-1 rounded-[4px] border px-3 py-2 text-sm" />
        <button className="t-focus min-h-touch rounded-[4px] bg-[#4f6b57] px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={title.trim().length < 2}>Add</button>
      </div>
      {failed && <p role="alert" className="mt-2 text-xs text-t-red">That task did not save. Try again.</p>}
    </form>
  );
}

/**
 * Arrange my Today (S3): this person's own order, and which sections they
 * show, inside what the organization allows. Nobody else's Today changes.
 */
export function ArrangeToday({ sections, hidden, canOrder, canHide, onSave, onCancel }: {
  sections: { key: string; label: string }[]; hidden: string[]; canOrder: boolean; canHide: boolean;
  onSave: (order: string[], hidden: { key: string; hidden: boolean }[]) => Promise<void>; onCancel: () => void;
}) {
  const [items, setItems] = useState(sections.map((s) => ({ ...s, on: !hidden.includes(s.key) })));
  const [saving, setSaving] = useState(false);
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    const n = [...items];
    [n[i], n[j]] = [n[j], n[i]];
    setItems(n);
  };
  return (
    <section aria-labelledby="arrange-today-h" className="mb-6 border border-t-line bg-t-panel px-4 py-4">
      <h2 id="arrange-today-h" className="text-sm font-semibold text-t-white">Arrange my Today</h2>
      <p className="text-xs text-t-phos-dim">Only your own Today changes. You can undo it from the note that appears, or from My setup.</p>
      {!canOrder && <p role="note" className="mt-2 text-xs text-t-white">Your organization keeps the order of Today the same for everyone.</p>}
      {!canHide && <p role="note" className="mt-2 text-xs text-t-white">Your organization keeps every Today section showing for everyone.</p>}
      <ul className="mt-3 space-y-1">
        {items.map((it, i) => (
          <li key={it.key} className="flex items-center gap-2">
            <label className="flex min-h-touch flex-1 items-center gap-2 text-sm text-t-phos">
              <input type="checkbox" className="t-focus" disabled={!canHide} checked={it.on} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)))} />
              {it.label}
            </label>
            {canOrder && (
              <span className="flex">
                <button type="button" aria-label={`Move ${it.label} up`} disabled={i === 0} onClick={() => move(i, -1)} className="t-focus min-h-touch px-2 text-xs text-t-phos-dim hover:text-t-white disabled:opacity-30">&uarr;</button>
                <button type="button" aria-label={`Move ${it.label} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)} className="t-focus min-h-touch px-2 text-xs text-t-phos-dim hover:text-t-white disabled:opacity-30">&darr;</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={saving}
          onClick={async () => {
            setSaving(true);
            const changedHidden = items.filter((x) => x.on === hidden.includes(x.key)).map((x) => ({ key: x.key, hidden: !x.on }));
            await onSave(items.map((x) => x.key), canHide ? changedHidden : []);
            setSaving(false);
          }}
          className="t-focus min-h-touch rounded-[4px] bg-[#4f6b57] px-4 text-sm font-semibold text-white hover:bg-[#3d5745] disabled:opacity-50">Save my order</button>
        <button type="button" onClick={onCancel} className="t-focus min-h-touch px-3 text-sm text-t-phos-dim underline underline-offset-4">Cancel</button>
      </div>
    </section>
  );
}
