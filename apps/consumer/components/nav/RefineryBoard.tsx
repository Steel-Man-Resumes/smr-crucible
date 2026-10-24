"use client";

/**
 * The Refinery nav as a game board: one vertical path of stations in the
 * order the work happens, lit by the server-owned progression. Below it the
 * Toolbox and You groups; at the foot of the path the Steel Man meter.
 *
 * Access is decided where it was before (the shell's tier gate and the
 * server's progress through stepForNav). This component only shows it.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, LockKeyhole } from "lucide-react";
import { lockedToolLine } from "@crucible/core/src/journeyStages";
import { previewIdForHref } from "@/lib/featurePreviews";
import { navKeepsDirectAccess, progressStateLabel, stepForNav, type ProgressStep, type ProgressStepId } from "@/lib/progression-ui";
import {
  ASK_TROY_ACTION, ASK_TROY_HINT, BOARD_GROUPS, STATIONS, boardShowsItem, boardSwitchAllows, expandedStation, linkIsCurrent, stationForPath, stationStatus,
  type BoardLink, type Station, type StationId, type StationStatus,
} from "@/lib/refinery-nav";
import type { UserTier } from "@/lib/useUserTier";
import type { OnboardingState } from "@/lib/useOnboarding";
import { SteelManMeter } from "@/components/steelman/SteelManMeter";
// Styles: components/nav/refinery-board.css, imported by RefineryShell (keeps this file renderable in tests).

export interface RefineryBoardProps {
  userTier: UserTier;
  pathname: string;
  steps: readonly ProgressStep[] | null;
  currentStepId: ProgressStepId | null;
  onboardingState: OnboardingState;
  disclosureComplete: boolean;
  /** The shell's tier and onboarding gate for non-client tiers. */
  isUnlocked: (item: BoardLink) => boolean;
  labelFor: (item: BoardLink) => string;
  ask: (step: ProgressStep) => void;
  hidePartner: boolean;
  /** Server switches (components/ServerSwitches); switched-off steps are left out. */
  switches: { recordStep: boolean };
  /** Ids go on the copy the person can see (desktop sidebar or open drawer). */
  carryIds: boolean;
  /** Mobile strip tap: open the drawer with this station expanded. */
  focusStation?: StationId | null;
  onItemClick?: () => void;
}

interface Access {
  step: ProgressStep | null;
  guidedLocked: boolean;
  directAccess: boolean;
  unlocked: boolean;
  lockLine: string;
  previewId: string | null;
}

export function RefineryBoard(props: RefineryBoardProps) {
  const { userTier, pathname, steps, currentStepId, carryIds, onItemClick } = props;
  const here = stationForPath(pathname);
  const auto = expandedStation(pathname, currentStepId);
  const [opened, setOpened] = useState<Partial<Record<StationId, boolean>>>({});
  // A new page resets manual toggles; the station holding that page opens.
  useEffect(() => { setOpened({}); }, [pathname]);
  useEffect(() => { if (props.focusStation) setOpened((o) => ({ ...o, [props.focusStation as StationId]: true })); }, [props.focusStation]);
  const client = userTier === "client";

  function access(item: BoardLink, guided: boolean): Access {
    const step = client && guided ? stepForNav((steps ?? []) as ProgressStep[], item.href) : null;
    const guidedLocked = step?.access === "locked";
    const directAccess = !guidedLocked || navKeepsDirectAccess(item.href);
    // Missing progress is not evidence that an existing user lost access.
    // Server APIs still decide whether the requested operation is allowed.
    const unlocked = client ? directAccess : props.isUnlocked(item);
    const lockLine = step?.reason || lockedToolLine({ state: props.onboardingState, requiresDisclosure: item.requiresDisclosure, disclosureComplete: props.disclosureComplete });
    const previewId = !unlocked && !guidedLocked ? previewIdForHref(item.href) : null;
    return { step, guidedLocked, directAccess, unlocked, lockLine, previewId };
  }

  function askButton(step: ProgressStep) {
    return (
      <button type="button" aria-haspopup="dialog" onClick={() => { onItemClick?.(); props.ask(step); }}
        className="t-focus board-ask mt-1 flex min-h-touch w-full flex-col items-start text-left">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-t-amber-bright underline underline-offset-2"><LockKeyhole size={11} aria-hidden="true" />{ASK_TROY_ACTION}</span>
        <span className="text-[10px] leading-snug text-t-bone-dim">{ASK_TROY_HINT}</span>
      </button>
    );
  }

  /** A link row: station header (`header`) or a child / group item. */
  function row(item: BoardLink, opts: { header?: Station; status?: StationStatus; guided: boolean }) {
    const a = access(item, opts.guided);
    const header = opts.header;
    const current = a.unlocked && linkIsCurrent(item.href, pathname);
    const id = carryIds ? item.legacyId : undefined;
    const label = props.labelFor(item);
    const stepLine = header ? opts.status?.step ?? a.step : a.step;
    const cls = header
      ? `t-focus board-station-link ${current ? "is-here" : ""}`
      : `t-focus board-child-link ${current ? "is-here" : ""}`;
    const body = (
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {header && !stepLine && header.blurb ? <span className="board-sub">{header.blurb}</span> : null}
        {stepLine ? <span className="board-sub">{a.guidedLocked && a.directAccess ? "Guided step: " : ""}{header && opts.status?.named ? `${stepLine.label}: ` : ""}{progressStateLabel(stepLine)}</span> : null}
        {!a.unlocked ? <span className="board-sub board-lock-line">{a.lockLine}</span> : null}
        {a.guidedLocked && !a.directAccess ? <span className="board-sub board-ask-hint"><LockKeyhole size={10} aria-hidden="true" className="mr-1 inline" />{ASK_TROY_ACTION}. {ASK_TROY_HINT}</span> : null}
      </span>
    );
    const mark = !header ? (a.guidedLocked || !a.unlocked ? <LockKeyhole size={12} className="shrink-0 opacity-70" aria-hidden="true" /> : a.step?.state === "completed" ? <CheckCircle2 size={13} className="shrink-0 text-t-phos" aria-hidden="true" /> : null) : null;
    let control;
    if (a.guidedLocked && !a.directAccess && a.step) {
      const step = a.step;
      control = <button id={id} type="button" aria-haspopup="dialog" onClick={() => { onItemClick?.(); props.ask(step); }} className={cls} title={a.lockLine}>{body}{mark}</button>;
    } else if (a.unlocked || a.previewId) {
      control = (
        <Link id={id} href={a.unlocked ? item.href : `/dashboard/preview/${a.previewId}`} onClick={onItemClick}
          data-tour={`nav-${item.href.split(/[?#]/)[0].split("/").pop()}`} aria-current={current ? "page" : undefined}
          title={!a.unlocked ? `${a.lockLine} See a preview.` : undefined} className={cls}>
          {body}{mark}
        </Link>
      );
    } else {
      control = <div id={id} aria-disabled="true" title={a.lockLine} className={`${cls} cursor-not-allowed opacity-70`}>{body}{mark}</div>;
    }
    return (
      <>
        {control}
        {a.guidedLocked && a.step && a.directAccess ? askButton(a.step) : null}
      </>
    );
  }

  function dot(station: Station, index: number, status: StationStatus) {
    return (
      <span className="board-dot" data-tone={status.tone} aria-hidden="true">
        {status.tone === "completed" ? <CheckCircle2 size={14} /> : status.tone === "locked" ? <LockKeyhole size={11} /> : <span className="board-dot-num">{index + 1}</span>}
      </span>
    );
  }

  const stations = STATIONS.filter((s) => boardShowsItem(s, userTier));
  return (
    <div className="refinery-board">
      <p className="board-eyebrow">Your path</p>
      <ol className="board-path" aria-label="Your path, in order">
        {stations.map((station, index) => {
          const status = stationStatus(station, steps, currentStepId);
          const children = station.children.filter((c) => boardShowsItem(c, userTier) && boardSwitchAllows(c, props.switches));
          const isOpen = opened[station.id] ?? (station.id === auto || station.id === props.focusStation);
          const childrenId = `${carryIds ? "" : "x-"}board-${station.id}-views`;
          return (
            <li key={station.id} id={carryIds ? station.navId : undefined} data-tour={station.navId} data-station={station.id}
              data-tone={status.tone} data-here={here === station.id ? "true" : undefined} className="board-station">
              <div className="board-station-head">
                {dot(station, index, status)}
                <div className="min-w-0 flex-1">{row(station, { header: station, status, guided: true })}</div>
                {children.length ? (
                  <button type="button" className="t-focus board-toggle" aria-expanded={isOpen} aria-controls={childrenId}
                    aria-label={`${isOpen ? "Hide" : "Show"} ${station.label} views`}
                    onClick={() => setOpened((o) => ({ ...o, [station.id]: !isOpen }))}>
                    <ChevronDown size={14} aria-hidden="true" className={isOpen ? "rotate-180" : ""} />
                  </button>
                ) : null}
              </div>
              {children.length ? (
                <ul id={childrenId} hidden={!isOpen} aria-label={`${station.label} views`} className="board-children">
                  {children.map((child) => (
                    <li key={`${child.href}:${child.label}`}>{row(child, { guided: child.href === "/dashboard/application-tailor" })}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div id={carryIds ? "refinery-meter" : undefined} data-tour="refinery-meter" className="board-meter">
        <SteelManMeter compact />
      </div>
      {BOARD_GROUPS.map((group) => {
        const items = group.items.filter((item) => boardShowsItem(item, userTier) && boardSwitchAllows(item, props.switches) && !(group.id === "program" && props.hidePartner));
        if (!items.length) return null;
        return (
          <section key={group.id} id={carryIds ? group.navId : undefined} data-tour={group.navId} aria-label={group.label} className="board-group">
            <p className="board-eyebrow">{group.label}</p>
            <ul>{items.map((item) => <li key={`${item.href}:${item.label}`}>{row(item, { guided: false })}</li>)}</ul>
          </section>
        );
      })}
    </div>
  );
}
