"use client";

/**
 * The live fix: once the finished documents are back (after the truth
 * check), t.ROY goes down the person's own page and makes each real change
 * on screen. The old line is struck through, the new line types in its
 * place, and the reason sits under it. One change after another, at a pace
 * a person can read, with a Skip. Then the finished page takes over.
 *
 * Only the writer's verified `changes` play (lib/markup-changes.ts checks
 * each new line is in the finished resume), so nothing typed here later
 * disappears. Motion reduced: no animation, the plain before and after list.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { SkipForward } from "lucide-react";
import { TroyMark } from "@crucible/consumer-ui";
import { planReveal, paceFor, pickForReplay, typedChars, type MarkupChange } from "@/lib/markup-changes";
import { ChangesList } from "./ChangesList";

const TICK_MS = 40;
/** A beat on the last line before the finished page takes over. */
const SETTLE_MS = 2200;

export function LiveFix({
  lines,
  changes,
  reduced,
  onDone,
}: {
  /** The person's page, split into lines as they gave it. */
  lines: string[];
  changes: MarkupChange[];
  reduced: boolean | null;
  onDone: () => void;
}) {
  // At most a dozen play, at a pace a person can read, covering each kind of
  // fix top to bottom. The rest are in the list under the finished page.
  const steps = useMemo(() => pickForReplay(planReveal(lines, changes)), [lines, changes]);
  const more = changes.length - steps.length;
  const stepAt = useMemo(() => {
    const m = new Map<number, number>();
    steps.forEach((s, k) => {
      if (s.lineIndex >= 0) m.set(s.lineIndex, k);
    });
    return m;
  }, [steps]);
  const loose = steps.map((s, k) => ({ s, k })).filter(({ s }) => s.lineIndex < 0);
  // Never squeezed: each change at least about four seconds, and with a
  // dozen at most the whole replay stays under about ninety seconds.
  const pace = useMemo(() => paceFor(steps.map((s) => s.change)), [steps]);

  const [i, setI] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const done = i >= steps.length;
  const still = reduced !== false;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // The clock for the current change.
  useEffect(() => {
    if (still || done) return;
    const t = setInterval(() => setElapsed((e) => e + TICK_MS), TICK_MS);
    return () => clearInterval(t);
  }, [still, done, i]);

  useEffect(() => {
    if (still || done) return;
    if (elapsed >= pace[i].total) {
      setI((n) => n + 1);
      setElapsed(0);
    }
  }, [elapsed, still, done, i, pace]);

  // After the last one, settle into the finished page.
  useEffect(() => {
    if (!done || still) return;
    const t = setTimeout(() => onDoneRef.current(), SETTLE_MS);
    return () => clearTimeout(t);
  }, [done, still]);

  // Keep the line being fixed in view inside the page box (never the window).
  const boxRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const looseRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (still || done) return;
    const s = steps[i];
    const el = s.lineIndex >= 0 ? lineRefs.current[s.lineIndex] : looseRefs.current[i];
    const box = boxRef.current;
    if (!el || !box || typeof box.scrollTo !== "function") return;
    box.scrollTo({ top: Math.max(0, el.offsetTop - box.clientHeight / 3), behavior: "smooth" });
  }, [i, still, done, steps]);

  if (!steps.length) return null;

  if (still) {
    return (
      <div className="mt-6" data-testid="live-fix" data-mode="list">
        <ChangesList changes={changes} open />
        <button
          type="button"
          onClick={onDone}
          className="t-focus min-h-touch bg-t-amber px-6 font-term text-sm font-bold text-ws-bg hover:bg-t-amber-bright"
        >
          See my finished page
        </button>
      </div>
    );
  }

  /** One changed line, in whatever state it is in right now. */
  const renderChange = (k: number) => {
    const s = steps[k];
    const c = s.change;
    if (k > i) return <>{s.before}{c.old}{s.after}</>;
    const current = k === i;
    const p = pace[k];
    const struck = !current || elapsed > 0;
    const typed = current ? typedChars(c.new, elapsed - p.strike, p.type) : c.new.length;
    const typing = current && elapsed >= p.strike && typed < c.new.length;
    const showWhy = current && elapsed >= p.strike + p.type;
    return (
      <>
        <span className={`block ${current ? "" : "text-[11px] opacity-60"}`}>
          {s.before}
          {/* A real line-through, so a line that wraps on a phone is struck on every row. */}
          <span
            className={`line-through decoration-2 transition-[text-decoration-color] ${struck ? "decoration-ws-red-bright" : "decoration-transparent"}`}
            style={{ transitionDuration: `${p.strike}ms` }}
          >
            {c.old}
          </span>
          {s.after}
        </span>
        {(typed > 0 || !current) && (
          <span className="block font-semibold">
            {s.before}
            {c.new.slice(0, typed)}
            {typing && <span aria-hidden="true" className="ml-px inline-block w-[2px] animate-pulse bg-ws-bg align-middle" style={{ height: "1em" }} />}
            {!typing && s.after}
          </span>
        )}
        {showWhy && (
          <span className="mt-1 flex items-start gap-1.5 bg-ws-bg px-2 py-1.5 font-body text-[12.5px] leading-snug text-ws-amber-bright animate-fadeIn">
            <TroyMark size={16} className="mt-px shrink-0" />
            <span>{c.why}</span>
          </span>
        )}
      </>
    );
  };

  const lineClass = (on: boolean, changed: boolean) =>
    `relative whitespace-pre-wrap break-words px-1.5 font-body text-[13px] leading-[1.55] text-ws-bg ${
      on ? "bg-ws-amber-bright/40 outline outline-2 outline-ws-amber" : changed ? "bg-ws-amber-bright/15" : ""
    }`;

  const nameLine = lines.findIndex((l) => l.trim());
  const cur = steps[Math.min(i, steps.length - 1)];

  return (
    <div className="mt-6 border border-t-line bg-t-panel p-4 sm:p-6" data-testid="live-fix" data-mode="play">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-base text-t-white">
          {done
            ? more > 0
              ? `Those are the main ones. ${more} more ${more === 1 ? "is" : "are"} in the list under your page.`
              : "That's every line I changed. Here's your finished page."
            : "Watch me fix your page, line by line."}
        </p>
        <div className="flex items-center gap-3">
          {!done && (
            <span className="font-term text-xs text-t-phos-dim" aria-hidden="true">
              {i + 1} of {steps.length}
              {more > 0 ? ` (and ${more} more)` : ""}
            </span>
          )}
          <button
            type="button"
            onClick={onDone}
            className="t-focus inline-flex min-h-touch items-center gap-2 bg-t-amber px-4 font-term text-sm font-bold text-ws-bg hover:bg-t-amber-bright"
            data-testid="live-fix-skip"
          >
            <SkipForward size={16} aria-hidden="true" />
            {done ? "See my finished page" : "Skip to my finished page"}
          </button>
        </div>
      </div>

      {/* What changed, for screen readers, one change at a time. */}
      <p className="sr-only" aria-live="polite">
        {done
          ? "Done. Your finished page is next."
          : `Change ${i + 1} of ${steps.length}. Was: ${cur.change.old}. Now: ${cur.change.new}. Why: ${cur.change.why}`}
      </p>

      <div
        ref={boxRef}
        className="relative max-h-[58vh] overflow-y-auto border border-ws-bg/40 bg-ws-bone py-5 pl-4 pr-4 shadow-[6px_6px_0_#000] sm:pl-8 sm:pr-6 lg:max-h-[70vh]"
        aria-hidden="true"
      >
        {lines.map((line, n) => {
          const k = stepAt.get(n);
          const isName = n === nameLine;
          const heading = !isName && /^[A-Z][A-Z &/:,-]{3,}$/.test(line.trim());
          return (
            <div
              key={n}
              ref={(el) => {
                lineRefs.current[n] = el;
              }}
              className={`${lineClass(k === i && !done, k !== undefined && k < i)} ${
                isName ? "text-[17px] font-semibold" : heading ? "mt-1 font-semibold tracking-wide" : ""
              }`}
            >
              {k !== undefined ? renderChange(k) : line || " "}
            </div>
          );
        })}
        {loose.length > 0 && (
          <div className="mt-4 border-t border-ws-bg/30 pt-3">
            <p className="px-1.5 font-term text-[11px] uppercase tracking-wider text-ws-bg/70">Also changed</p>
            {loose.map(({ k }) => (
              <div
                key={steps[k].id}
                ref={(el) => {
                  looseRefs.current[k] = el;
                }}
                className={lineClass(k === i && !done, k < i)}
              >
                {renderChange(k)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
