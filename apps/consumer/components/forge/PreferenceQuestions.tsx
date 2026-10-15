"use client";

/**
 * The preference questions, shared by the screens that can ask them. The path
 * model (lib/forge-path.ts) decides which screen asks each one and in which
 * wording; the answer is always stored in the same place
 * (session.preferences), so moving a question never loses or repeats it.
 */

import type React from "react";
import { Check } from "lucide-react";
import {
  HOURS_OPTIONS,
  SHIFT_OPTIONS,
  TRANSPORT_OPTIONS,
  DISTANCE_OPTIONS,
  type PrefOption,
  togglePreference,
} from "@/lib/forge-preferences";

export const idsOf = (opts: PrefOption[]) => opts.map((o) => o.id);

/**
 * A wrapping row of tap targets. Finer choices (8 environments, 4 shifts, 5
 * ways to get to work) would make a tall stack of full-width cards on a phone,
 * so these sit side by side and wrap. Same selected look as the other Forge
 * option cards.
 */
export function ChoiceChips({
  label,
  options,
  selected,
  onToggle,
  disabled,
  single,
}: {
  label: string;
  options: PrefOption[];
  selected: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
  /** One pick at most: a radio group (arrow keys move the pick; tap the pick again to clear it). */
  single?: boolean;
}) {
  // Radio group keyboard behavior: one tab stop (the pick, or the first chip
  // when nothing is picked), arrow keys move and select.
  const focusable = single
    ? (options.find((o) => selected.includes(o.id)) ?? options[0]).id
    : null;
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!single || disabled) return;
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const current = options.findIndex((o) => o.id === (document.activeElement as HTMLElement | null)?.dataset.id);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const next = options[(Math.max(current, 0) + step + options.length) % options.length];
    if (!selected.includes(next.id)) onToggle(next.id);
    (e.currentTarget.querySelector(`[data-id="${next.id}"]`) as HTMLElement | null)?.focus();
  }
  return (
    <div
      className="flex flex-wrap gap-2"
      role={single ? "radiogroup" : "group"}
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            role={single ? "radio" : "checkbox"}
            aria-checked={on}
            data-id={o.id}
            tabIndex={single ? (o.id === focusable ? 0 : -1) : undefined}
            disabled={disabled}
            onClick={() => onToggle(o.id)}
            className={`t-focus min-h-touch rounded-[6px] border px-4 py-2 text-left text-base transition-all ${
              on
                ? "border-[#4f6b57] bg-[#e3ede5] font-medium text-t-white"
                : "border-t-line bg-t-panel text-t-white hover:border-t-line-strong hover:bg-t-panel-2"
            } ${disabled ? "cursor-default" : ""}`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[3px] border ${
                  on ? "border-[#4f6b57] bg-[#4f6b57]" : "border-t-line-strong bg-white"
                }`}
              >
                {on && <Check size={13} strokeWidth={2.4} className="text-white" aria-hidden="true" />}
              </span>
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Question({
  title,
  hint,
  children,
  testId,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId}>
      <h3 className="mb-1 font-medium text-t-white">{title}</h3>
      {hint && <p className="mb-3 text-sm text-t-phos-dim">{hint}</p>}
      {!hint && <div className="mb-2" />}
      {children}
    </div>
  );
}

/** Wording per variant (forge-path rules R4 and R5). */
const SCHEDULE_WORDING: Record<string, { title: string; hint: string; shifts: string }> = {
  default: {
    title: "What schedule works for you?",
    hint: "Pick every one that fits.",
    shifts: "Any shifts you can or can't work? Skip this if it doesn't matter.",
  },
  steady: {
    title: "You want steady work. What schedule works for you?",
    hint: "Pick every one that fits. I only ask this once.",
    shifts: "Which shifts can you count on working? Skip this if it doesn't matter.",
  },
  flexible: {
    title: "Your job has to fit your life. What schedule works?",
    hint: "Pick every one that fits. I only ask this once.",
    shifts: "Which shifts work around your appointments and family? Skip what doesn't matter.",
  },
  family: {
    title: "What hours work around childcare or family care?",
    hint: "Pick every one that fits.",
    shifts: "Which shifts can you cover? Skip this if it doesn't matter.",
  },
};

export function ScheduleQuestion({
  variant,
  hours,
  shifts,
  setHours,
  setShifts,
  disabled,
}: {
  variant: string;
  hours: string[];
  shifts: string[];
  setHours: (fn: (prev: string[]) => string[]) => void;
  setShifts: (fn: (prev: string[]) => string[]) => void;
  disabled?: boolean;
}) {
  const w = SCHEDULE_WORDING[variant] ?? SCHEDULE_WORDING.default;
  return (
    <Question title={w.title} hint={w.hint} testId={`q-schedule-${variant}`}>
      <div className="space-y-4">
        <ChoiceChips
          label="Hours"
          options={HOURS_OPTIONS}
          selected={hours}
          disabled={disabled}
          onToggle={(id) =>
            setHours((prev) => togglePreference(prev, id, idsOf(HOURS_OPTIONS), { exclusive: ["any"] }))
          }
        />
        <div>
          <p className="mb-2 text-sm text-t-phos-dim">{w.shifts}</p>
          <ChoiceChips
            label="Shifts"
            options={SHIFT_OPTIONS}
            selected={shifts}
            disabled={disabled}
            onToggle={(id) => setShifts((prev) => togglePreference(prev, id, idsOf(SHIFT_OPTIONS)))}
          />
        </div>
      </div>
    </Question>
  );
}

/** Transit first for someone who named a transportation challenge; a car last. */
const TRANSIT_ORDER = ["bus", "walk", "ride", "bike", "drive"];

export function CommuteQuestion({
  variant,
  modes,
  distance,
  setModes,
  setDistance,
  disabled,
}: {
  variant: string;
  modes: string[];
  distance: string | null;
  setModes: (fn: (prev: string[]) => string[]) => void;
  setDistance: (fn: (prev: string | null) => string | null) => void;
  disabled?: boolean;
}) {
  const transit = variant === "transit";
  const options = transit
    ? [...TRANSPORT_OPTIONS].sort((a, b) => TRANSIT_ORDER.indexOf(a.id) - TRANSIT_ORDER.indexOf(b.id))
    : TRANSPORT_OPTIONS;
  return (
    <Question
      title={transit ? "How do you get around right now?" : "How do you get to work, and how far can you go each day?"}
      hint={transit ? "Pick every way you can get there. No car is fine." : "Pick every way you can get there."}
      testId={`q-commute-${variant}`}
    >
      <div className="space-y-4">
        <ChoiceChips
          label="Ways to get to work"
          options={options}
          selected={modes}
          disabled={disabled}
          onToggle={(id) => setModes((prev) => togglePreference(prev, id, idsOf(TRANSPORT_OPTIONS)))}
        />
        <div>
          <p className="mb-2 text-sm text-t-phos-dim">
            {transit
              ? "About how long can the trip be, one way, by bus, on foot or with a ride?"
              : "About how long can the trip be, one way?"}
          </p>
          <ChoiceChips
            label="One-way travel time"
            single
            options={DISTANCE_OPTIONS}
            selected={distance ? [distance] : []}
            disabled={disabled}
            onToggle={(id) => setDistance((prev) => (prev === id ? null : id))}
          />
        </div>
      </div>
    </Question>
  );
}
