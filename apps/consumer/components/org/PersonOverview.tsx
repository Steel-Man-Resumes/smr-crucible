/**
 * The top of the participant page for staff (CRM lane C2, 2026-10-25): the
 * header card, the station strip, the at-a-glance row, the Their screen board
 * and the t.ROY rail. Presentational only: no fetch, no hooks, so every rule
 * about what shows is rendered in tests exactly as staff see it.
 *
 * Everything drawn here comes from the payload ClientPage already had. The
 * BL1 gating lives in lib/org-person-view.ts and is applied here, never
 * re-decided.
 */
import React from "react";
import { STATIONS } from "@/lib/refinery-nav";
import {
  SHARE_SCOPES, THEIR_SCREEN, personGlance, personInitials, personStations, progressVisible,
  type GlanceTile, type PersonTab, type PersonView, type ShareScope,
} from "@/lib/org-person-view";
import { openStaffTroy } from "@/lib/staff-troy";

export function scopeStateText(st: PersonView["scopes"][ShareScope], awaitingAcknowledgement?: boolean): string {
  return st.shared ? (st.required ? "Shared (required)" : "Shared")
    : st.stoppedByParticipant ? "Required, stopped by them"
    : st.required ? (awaitingAcknowledgement ? "Required, not acknowledged yet" : "Required, not shared")
    : st.requestPending ? "Asked" : "Not shared";
}

export function PersonHeaderCard({ person, first, joined, caseManager, onCopyEmail, copied }: {
  person: PersonView; first: string; joined: string; caseManager: string | null; onCopyEmail?: () => void; copied?: boolean;
}) {
  const initials = personInitials(person.name);
  return (
    <header className="person-card bg-t-panel border border-t-line rounded-[4px] p-5 mb-4" data-identity={person.identitySource ?? "none"}>
      <div className="flex flex-wrap items-start gap-4">
        <span aria-hidden className="person-avatar">{initials}</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-t-white leading-tight">{person.name || "Name not shared"}</h1>
          {person.email && (
            <button type="button" onClick={onCopyEmail} className="t-focus mt-1 text-sm text-t-phos-dim hover:text-t-white underline-offset-4 hover:underline" title="Copy the email address">
              {person.email}{copied ? <span className="ml-2 text-xs text-t-amber-bright">Copied</span> : null}
            </button>
          )}
          <p className="text-sm text-t-phos-dim mt-1">
            Joined {joined} · {caseManager ? `Case manager: ${caseManager}` : "Unassigned"}
          </p>
          {person.identitySource !== "account" && (
            <p className="text-xs text-t-phos-dim mt-1">
              {person.identitySource === "invite"
                ? "They have not turned on progress sharing. You see only the name and email your organization entered when it invited them."
                : "They have not turned on progress sharing, so their name and progress are not shown."}
            </p>
          )}
        </div>
      </div>
      <ul className="flex flex-wrap gap-2 mt-4" aria-label={`What ${first} has shared`}>
        {SHARE_SCOPES.map((s) => {
          const st = person.scopes[s.key];
          return (
            <li key={s.key} className={`text-xs px-2 py-1 border rounded-[3px] ${st.shared ? "border-t-amber text-t-amber-bright" : "border-t-line text-t-phos-dim"}`}>
              {s.label}: {scopeStateText(st, person.awaitingAcknowledgement)}
            </li>
          );
        })}
      </ul>
    </header>
  );
}

/** The seven stations, the person's one lit. Hollow for everyone who has not shared progress. */
export function StationStrip({ person, first }: { person: PersonView; first: string }) {
  const { lit, cells } = personStations(person);
  const named = !!person.name;
  const line = lit
    ? person.progress?.nextStepAction ? `The next step ${first} is being shown: ${person.progress.nextStepAction}.` : "No next step is showing right now."
    : named ? `Progress is private until ${first} turns on sharing.` : "Progress is private until they turn on sharing.";
  return (
    <section aria-labelledby="person-where" className="forge-workshop refinery-board person-strip rounded-[4px] border border-t-line px-5 py-4 mb-4" data-lit={lit ?? ""}>
      <h2 id="person-where" className="board-eyebrow" style={{ padding: 0 }}>Where they are</h2>
      <ol className="person-strip-path">
        {cells.map((c, i) => (
          <li key={c.id} data-station={c.id} data-tone={c.lit ? "current" : "plain"} aria-current={c.lit ? "step" : undefined}>
            <span className="board-dot" data-tone={c.lit ? "current" : "plain"}><span className="board-dot-num">{i + 1}</span></span>
            <span className="person-strip-label">{c.label}</span>
          </li>
        ))}
      </ol>
      <p className="text-sm text-t-white mt-3">{line}</p>
    </section>
  );
}

export function GlanceRow({ person, openTasks, fmtDay, onPick }: {
  person: PersonView; openTasks: number | null; fmtDay: (s: string) => string; onPick?: (t: GlanceTile) => void;
}) {
  const tiles = personGlance(person, openTasks, fmtDay);
  return (
    <ul className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5" aria-label="At a glance">
      {tiles.map((t) => (
        <li key={t.key} data-tile={t.key}>
          <button type="button" onClick={() => onPick?.(t)} className="t-focus w-full text-left bg-t-panel border border-t-line rounded-[4px] px-4 py-3 hover:border-t-line-strong">
            <span className="block text-[11px] uppercase tracking-wide text-t-phos-dim">{t.label}</span>
            <span className="block text-xl font-bold text-t-white tabular-nums mt-0.5">{t.value}</span>
            <span className="block text-[11px] text-t-phos-dim mt-0.5">{t.note}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Their screen as the board they use: the same seven stations, lit the same
 * way, each saying what it holds and what you can see of it. You see inside
 * an area only if they shared it; opening one is the same logged access as
 * the What they shared tab.
 */
export function TheirScreenBoard({ person, first, onOpenItem }: { person: PersonView; first: string; onOpenItem: (s: ShareScope) => void }) {
  const { lit } = personStations(person);
  const shows = progressVisible(person);
  const p = person.progress;
  return (
    <section>
      <p className="text-xs text-t-phos-dim bg-t-panel border border-t-line px-4 py-3 mb-4">
        This is the path {first} sees when they sign in, so you can point them to the right place. You are not signed in as {first}, and you see inside an area only if {first} shared it.
      </p>
      <ol className="forge-workshop refinery-board person-board rounded-[4px] border border-t-line p-4">
        {THEIR_SCREEN.map((area, i) => {
          const st = STATIONS.find((s) => s.id === area.station)!;
          const here = area.station === lit;
          return (
            <li key={area.station} className="person-board-station" data-station={area.station} data-tone={here ? "current" : "plain"} aria-current={here ? "step" : undefined}>
              <span className="board-dot" data-tone={here ? "current" : "plain"}><span className="board-dot-num">{i + 1}</span></span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${here ? "text-t-amber-bright" : "text-t-white"}`}>
                  {st.label}{here ? <span className="ml-2 text-[11px] font-normal text-t-amber-bright">{first} is here</span> : null}
                </p>
                <p className="text-xs text-t-phos-dim mt-0.5">{area.holds}</p>
                {area.station === "overview" ? (
                  <p className="text-xs text-t-white mt-1">
                    {shows && p
                      ? `${p.nextStepAction ? `The next step ${first} is being shown: ${p.nextStepAction}. ` : "No next step is showing right now. "}${p.applications} ${p.applications === 1 ? "application" : "applications"}, ${p.savedJobs} saved, ${p.practiceSessions} practice ${p.practiceSessions === 1 ? "session" : "sessions"}.`
                      : `Progress is private until ${person.name ? first : "they"} ${person.name ? "turns" : "turn"} on sharing.`}
                  </p>
                ) : area.never ? (
                  <p className="text-xs text-t-phos mt-1" data-never="">{area.never}</p>
                ) : (
                  <span className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                    {area.scopes.map((sc) => {
                      const s = SHARE_SCOPES.find((x) => x.key === sc)!;
                      const state = person.scopes[sc];
                      return (
                        <button key={sc} type="button" onClick={() => onOpenItem(sc)}
                          className={`t-focus text-xs underline underline-offset-4 ${state.shared ? "font-semibold text-t-amber-bright" : "text-t-phos-dim"}`}>
                          {state.shared ? `Open what ${first} shared: ${s.label}` : state.required ? `${s.label}: required by your program. See where it stands` : `${s.label}: not shared. Ask ${first}`}
                        </button>
                      );
                    })}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const RAIL: { skill: "staff-prep-me" | "staff-check-in" | "staff-find-help"; label: string; what: string }[] = [
  { skill: "staff-prep-me", label: "Prep me", what: "Where they are, what is coming, what is open, and what you wrote last time." },
  { skill: "staff-check-in", label: "Draft a check-in", what: "A short text or email for you to send yourself." },
  { skill: "staff-find-help", label: "Find local help", what: "Listings from the public directory, with the date each was checked." },
];

export function PersonRail({ clientId, first }: { clientId: string; first: string }) {
  return (
    <aside aria-labelledby="person-rail-h" className="person-rail bg-t-panel border border-t-line rounded-[4px] p-4">
      <h2 id="person-rail-h" className="text-xs font-semibold uppercase tracking-wide text-[#344b38] mb-1">t.ROY, for your work with {first}</h2>
      <ul className="space-y-2 mt-3">
        {RAIL.map((r) => (
          <li key={r.skill}>
            <button type="button" data-skill={r.skill} onClick={() => openStaffTroy({ clientId, skill: r.skill })}
              className="t-focus w-full text-left border border-t-line rounded-[4px] px-3 py-2 hover:border-[#344b38]">
              <span className="block text-sm font-semibold text-t-white">{r.label}</span>
              <span className="block text-[11px] text-t-phos-dim mt-0.5">{r.what}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-t-phos-dim mt-3">t.ROY drafts. You decide. Nothing is saved or sent until you do it.</p>
    </aside>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }): React.ReactElement {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-3">
      <div className="h-24 bg-t-panel border border-t-line rounded-[4px] animate-pulse" />
      <div className="h-20 bg-t-panel-3 rounded-[4px] animate-pulse" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-t-panel border border-t-line rounded-[4px] animate-pulse" />)}
      </div>
      {Array.from({ length: lines }).map((_, i) => <div key={i} className="h-10 bg-t-panel border border-t-line rounded-[4px] animate-pulse" />)}
    </div>
  );
}
