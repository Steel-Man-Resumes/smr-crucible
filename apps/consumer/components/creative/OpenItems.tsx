"use client";

/** What is left to answer on a creative document. Questions only; never a suggested fact. */

import { createContext, useContext, useState } from "react";
import { FACILITY_ASK_NO, FACILITY_ASK_YES, type CreativeDoc, type CreativeOpenItem, type CreativeStatus } from "@crucible/core/src/creativeChecks";

/**
 * Answers to the one-tap questions (review s2r3): whether a phrase names the
 * place kept off this lane, and whether a reference is an officer. The lane
 * screen provides them; without a provider the cards show no buttons.
 */
export interface OpenItemAnswers {
  onFacilityWord: (phrase: string, isThePlace: boolean) => Promise<boolean>;
  onOfficer: (entryId: string, isOfficer: boolean) => Promise<boolean>;
}
export const OpenItemAnswersContext = createContext<OpenItemAnswers | null>(null);

function AnswerButtons({ item }: { item: CreativeOpenItem }) {
  const answers = useContext(OpenItemAnswersContext);
  const [busy, setBusy] = useState(false);
  if (!answers || !item.answer) return null;
  const labels = item.answer === "facility_word" ? [FACILITY_ASK_YES, FACILITY_ASK_NO] : ["Yes", "No"];
  const send = async (yes: boolean) => {
    if (busy) return;
    setBusy(true);
    if (item.answer === "facility_word" && item.phrase) await answers.onFacilityWord(item.phrase, yes);
    else if (item.answer === "officer" && item.entryId) await answers.onOfficer(item.entryId, yes);
    setBusy(false);
  };
  return (
    <span className="mt-1 flex flex-wrap gap-2">
      {labels.map((label, i) => (
        <button
          key={label}
          type="button"
          disabled={busy}
          onClick={() => send(i === 0)}
          data-testid={`${item.answer}-${i === 0 ? "yes" : "no"}`}
          className="t-focus min-h-touch px-3 border border-t-line text-sm text-t-white hover:border-t-steel disabled:opacity-60"
        >
          {label}
        </button>
      ))}
    </span>
  );
}

export function OpenItems({ status, doc, testId }: { status: CreativeStatus; doc: CreativeDoc; testId?: string }) {
  const items = status.openItems.filter((x) => x.doc === doc || (doc === "artist_resume" && x.doc === "record"));
  const blocks = items.filter((x) => x.severity === "BLOCK").length;
  if (!items.length) {
    return (
      <p className="border border-t-line bg-t-panel px-3 py-2 text-sm text-t-phos" data-testid={testId}>
        Nothing open. Every line traces to your record.
      </p>
    );
  }
  return (
    <section className="border border-t-amber/60 bg-t-panel p-3" data-testid={testId} aria-label="Left to answer">
      <h3 className="text-sm font-semibold text-t-white">
        {blocks ? `Draft: ${blocks} to answer before it's finished` : "A few things to look at"}
      </h3>
      <ul className="mt-2 space-y-2">
        {items.map((x, i) => (
          <li key={`${x.rule}-${i}`} className="text-sm" data-testid={x.answer ? `ask-${x.answer}` : undefined}>
            <span className="block text-xs font-mono text-t-phos-dim break-words">{x.line}</span>
            <span className="block text-t-white">{x.question}</span>
            {x.phrase && <span className="block text-t-amber-bright break-words" data-testid="ask-phrase">&ldquo;{x.phrase}&rdquo;</span>}
            <span className="block text-xs text-t-phos-dim">{x.why}</span>
            <AnswerButtons item={x} />
          </li>
        ))}
      </ul>
    </section>
  );
}
