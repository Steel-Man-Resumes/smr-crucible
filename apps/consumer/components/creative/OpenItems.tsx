"use client";

/** What is left to answer on a creative document. Questions only; never a suggested fact. */

import type { CreativeDoc, CreativeStatus } from "@crucible/core/src/creativeChecks";

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
          <li key={`${x.rule}-${i}`} className="text-sm">
            <span className="block text-xs font-mono text-t-phos-dim break-words">{x.line}</span>
            <span className="block text-t-white">{x.question}</span>
            <span className="block text-xs text-t-phos-dim">{x.why}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
