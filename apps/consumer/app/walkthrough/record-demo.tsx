"use client";

/**
 * The real RecordChoiceCard and ConfidenceMeter, running the real record pass
 * (lib/record-choice.ts) on a fictional sample page. Used by the guided tour
 * (controlled, fixed layout inside the stage) and by the explore section.
 */

import { useMemo, useState } from "react";
import { RecordChoiceCard } from "@/components/forge/finish/RecordChoiceCard";
import { ConfidenceMeter } from "@/components/forge/finish/ConfidenceMeter";
import { applyRecordChoice, type RecordChoice } from "@/lib/record-choice";
import { SAMPLE_PAGE } from "./sample";

const CHOICES: RecordChoice[] = ["off", "state", "facility"];

export function RecordDemo({
  choice: controlled,
  onChoose,
  fixed = false,
}: {
  choice?: RecordChoice;
  onChoose?: (c: RecordChoice) => void;
  /** Two columns at any width (the tour stage scales the whole scene). */
  fixed?: boolean;
}) {
  const [own, setOwn] = useState<RecordChoice>("off");
  const choice = controlled ?? own;
  const choose = (c: RecordChoice) => (onChoose ? onChoose(c) : setOwn(c));

  const passes = useMemo(() => {
    const out = {} as Record<RecordChoice, ReturnType<typeof applyRecordChoice>>;
    CHOICES.forEach((c) => {
      out[c] = applyRecordChoice(SAMPLE_PAGE, "", c, SAMPLE_PAGE);
    });
    return out;
  }, []);
  const pass = passes[choice];
  // The card lists what the pass found on the page as written.
  const entries = choice === "state" ? passes.state.entries : passes.facility.entries;
  const before = SAMPLE_PAGE.split("\n");
  const after = pass.resume.split("\n");
  const afterSet = new Set(after);

  return (
    <div className={`grid gap-6 ${fixed ? "grid-cols-[5fr_6fr]" : "lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"}`}>
      <div data-tour="record-left" className="rounded-lg border border-white/10 bg-[#eaede9] p-4 text-[#1c1e1b] sm:p-5">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.1em] text-[#54594f]">The Forge finish page · try it</p>
        <div data-tour="record-card">
          <RecordChoiceCard choice={choice} entries={entries} sourceWithheld={[]} busy={false} onChoose={choose} />
        </div>
        <div data-tour="confidence">
          <ConfidenceMeter
            level="medium"
            notes={[
              { line: "Prepared meals and kept the kitchen and dish area clean.", why: "t.ROY wrote this wording from your words; you approved it without changing it." },
              { line: "Loaded and unloaded trucks. Picked and packed orders.", why: "A number t.ROY asked about was skipped. The line is true without it, and weaker." },
            ]}
          />
        </div>
      </div>
      <div data-tour="record-page" className="rounded-lg border border-white/10 bg-white p-5 text-[#1c1e1b] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] sm:p-7">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#54594f]">Sample page · Kevin Talbot is fictional</p>
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#9b6d1d]" aria-live="polite">
            {choice === "off" ? "Left off" : choice === "state" ? "Named as the state" : "As written"}
          </p>
        </div>
        <pre className="whitespace-pre-wrap font-serif text-[13px] leading-relaxed sm:text-sm">
          {after.map((line, i) => {
            const changed = line.trim() !== "" && !before.includes(line);
            const isHead = /^[A-Z][A-Z &]+$/.test(line.trim()) || i === 0;
            return (
              <span
                key={`${choice}-${i}`}
                data-tour={changed ? "record-changed" : i === 4 ? "record-first-job" : undefined}
                className={`wt-line block ${changed ? "bg-[#f6e7c4] text-[#5a3d0c]" : ""} ${isHead ? "font-bold" : ""}`}
              >
                {line || " "}
              </span>
            );
          })}
        </pre>
        {choice === "off" && (
          <p className="mt-3 border-t border-[#d3d8d1] pt-3 text-xs text-[#54594f]">
            Left off: {before.filter((l) => l.trim() && !afterSet.has(l)).length} lines. You bring it up in person, at the right time.
          </p>
        )}
      </div>
    </div>
  );
}
