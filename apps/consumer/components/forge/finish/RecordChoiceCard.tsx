"use client";

/**
 * DEC-51: the record on the page is a spectrum the person chooses, shown once
 * above the fix list with a preview of exactly which entries it touches. The
 * pass that applies it runs on the written document (lib/record-choice.ts),
 * so the page can never say one thing and print another.
 */

import { useEffect, useState } from "react";
import { recordEntryLabel, type RecordChoice, type RecordEntry } from "@/lib/record-choice";

const BTN = "t-focus min-h-touch border px-3 py-2 text-left text-xs transition-colors";

const OPTIONS: Array<{ value: RecordChoice; label: string; body: string }> = [
  { value: "off", label: "Leave it off the page", body: "The usual Steel Man move. You bring it up in person, at the right time." },
  { value: "state", label: "Show the work, name the state", body: "The job stays. The employer reads as the state, not the facility." },
  { value: "facility", label: "Name the facility as I wrote it", body: "Everything stays the way you wrote it." },
];

export function RecordChoiceCard({
  choice,
  entries,
  sourceWithheld,
  busy,
  onChoose,
  decisionKey,
}: {
  decisionKey?: string;
  choice: RecordChoice;
  /** Inside entries found on the written page by the pass. */
  entries: RecordEntry[];
  /** Source lines held back (older runs, or lines outside any job entry). */
  sourceWithheld: string[];
  busy: boolean;
  onChoose: (choice: RecordChoice) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (!decisionKey) return;
    try { setCollapsed(sessionStorage.getItem(`forge-record-choice:${decisionKey}`) === choice); } catch { /* Keep the choice usable without storage. */ }
  }, [decisionKey, choice]);
  if (collapsed) return (
    <div className="mb-4 border border-t-line bg-t-panel px-4 py-3" data-testid="record-choice-done">
      <p className="text-xs text-t-phos">Your choice: {OPTIONS.find((o) => o.value === choice)?.label}</p>
      {busy && <p role="status" className="mt-1 text-xs text-t-phos">Updating your documents...</p>}
      <button type="button" disabled={busy} className="t-focus mt-1 min-h-touch text-xs text-t-phos underline disabled:opacity-60" onClick={() => setCollapsed(false)}>Change this choice</button>
    </div>
  );
  if (entries.length === 0 && sourceWithheld.length === 0) return null;
  const preview =
    choice === "off"
      ? Array.from(new Set([...entries.map((e) => recordEntryLabel(e, "off")), ...sourceWithheld]))
      : choice === "state"
        ? entries.map((e) => recordEntryLabel(e, "state"))
        : entries.map((e) => e.header);
  return (
    <section className="mb-4 border border-t-line bg-t-panel px-4 py-3" data-testid="record-choice-card" aria-labelledby="record-choice-title">
      <p id="record-choice-title" className="text-xs font-bold uppercase text-t-amber-bright">Your record on this page</p>
      <p className="mt-1 text-xs leading-relaxed text-t-phos">
        Some of your work happened inside. You decide how it shows. Nothing about a record gets added either way.
      </p>
      <div className="mt-3 grid gap-2" role="radiogroup" aria-label="How your inside work shows on the page">
        {OPTIONS.map((o) => {
          const on = o.value === choice;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => {
                setCollapsed(true);
                try { if (decisionKey) sessionStorage.setItem(`forge-record-choice:${decisionKey}`, o.value); } catch { /* Optional UI preference. */ }
                if (!on) onChoose(o.value);
              }}
              className={`${BTN} ${on ? "border-t-amber bg-t-panel-2 text-t-white" : "border-t-line bg-t-panel text-t-phos hover:border-t-phos-dim hover:text-t-white"} disabled:opacity-60`}
              data-testid={`record-choice-${o.value}`}
            >
              <span className="block text-sm font-semibold">{o.label}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed">{o.body}</span>
            </button>
          );
        })}
      </div>
      {preview.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-t-phos-dim">
            {choice === "off" ? "Left off the page" : choice === "state" ? "On the page as" : "On the page as you wrote it"}
          </p>
          <ul className="mt-1 space-y-1">
            {preview.map((line, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-t-phos" data-testid="record-choice-preview">
                &ldquo;{line}&rdquo;
              </li>
            ))}
          </ul>
        </div>
      )}
      {busy && <p role="status" className="mt-2 text-xs text-t-phos">Rebuilding your documents with that choice...</p>}
    </section>
  );
}
