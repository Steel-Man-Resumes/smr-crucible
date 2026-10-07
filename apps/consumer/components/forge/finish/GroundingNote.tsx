"use client";

/**
 * What the second check (the AI claim trace on the server) found, moved from
 * the output page unchanged. Removed and still-there items are reported
 * separately, so a document is never called clean when a flagged claim could
 * not be taken out.
 */

export type GroundingOutcome = {
  claim: string;
  doc: "resume" | "cover_letter";
  status: "removed" | "changed" | "still_there" | "unmatched" | "also_in" | "credential";
};

export interface GroundingSummary {
  removed: number;
  residual: number;
  unmatched: number;
  /** Documents where the checker reported something but named no phrase we could show. */
  unnamed: ("resume" | "cover_letter")[];
  outcomes: GroundingOutcome[];
}

/** Read the grounding block from /api/forge/generate-docs. Null when it found nothing. */
export function readGrounding(g: any): GroundingSummary | null {
  const outcomes = Array.isArray(g?.outcomes) ? g.outcomes : [];
  if (!((g && (g.removed || g.residual || g.unmatched || g.hasFabrication)) || outcomes.length)) return null;
  return {
    removed: g?.removed || 0,
    residual: g?.residual || 0,
    unmatched: g?.unmatched || 0,
    unnamed: (["resume", "cover_letter"] as const).filter((d) => g?.unnamedByDoc?.[d] === true),
    outcomes,
  };
}

/** How many flagged things are still open for the person to check. */
export function groundingOpenCount(n: GroundingSummary): number {
  const credentialCount = n.outcomes.filter((o) => o.status === "credential").length;
  return n.residual + n.unmatched + n.unnamed.length + credentialCount;
}

export function GroundingNote({ groundingNote }: { groundingNote: GroundingSummary }) {
    const credentialCount = groundingNote.outcomes.filter((o) => o.status === "credential").length;
    const open = groundingNote.residual + groundingNote.unmatched + groundingNote.unnamed.length + credentialCount;
    const docName = (d: "resume" | "cover_letter") => (d === "cover_letter" ? "letter" : d);
    const label = (o: { status: string; doc: "resume" | "cover_letter" }) =>
      o.status === "credential"
        ? `A line in your ${docName(o.doc)} may say more about a card, license or certification than you told us. Check it: `
        : o.status === "removed"
        ? `Taken out of your ${docName(o.doc)}: `
        : o.status === "changed"
          ? `Reworded in your ${docName(o.doc)}. Find the new wording and check it. It used to say: `
          : o.status === "also_in"
          ? `Something like this is also in your ${docName(o.doc)}, check it: `
          : o.status === "still_there"
            ? `Still in your ${docName(o.doc)}, check it: `
            : `We couldn't find these exact words in your ${docName(o.doc)}. Look for anything like them: `;
    return (
      <div className="bg-t-panel border border-t-amber px-4 py-3">
        <p className="text-xs font-bold text-t-amber-bright uppercase mb-1">
          {open > 0 ? "Check these before you send" : "What the check found"}
        </p>
        <p className="text-xs text-t-phos leading-relaxed">
          {groundingNote.removed > 0 &&
            `We took out ${groundingNote.removed} ${groundingNote.removed === 1 ? "detail" : "details"} we couldn't match to what you told us. `}
          {groundingNote.residual > 0 &&
            `${groundingNote.residual === 1 ? "One thing" : `${groundingNote.residual} things`} we flagged may still be in there, maybe reworded. `}
          {credentialCount > 0 &&
            `${credentialCount === 1 ? "One line" : `${credentialCount} lines`} may say more about a card, license or certification than you told us. `}
          {groundingNote.unmatched > 0 &&
            `The check quoted ${groundingNote.unmatched === 1 ? "words" : "some words"} we couldn't find in your documents. `}
          {groundingNote.unnamed.map((d) => `We found something in your ${docName(d)} we couldn't match to what you told us, but couldn't point to the exact words. `)}
          {open > 0
            ? "Read these closely before you send anything."
            : "The check can also reword lines it didn't flag. Read it once before you send it. You know your history best."}
        </p>
        {groundingNote.outcomes.length > 0 && (
          <details className="mt-2" open={open > 0}>
            <summary className="t-focus cursor-pointer text-[11px] text-t-phos-dim underline decoration-dotted underline-offset-2">
              See what we flagged
            </summary>
            <ul className="mt-1.5 space-y-1">
              {groundingNote.outcomes.map((o, i) => (
                <li key={i} className="text-[11px] leading-relaxed text-t-phos">
                  <span className={o.status === "removed" ? "text-t-phos-dim" : "font-bold text-t-amber-bright"}>
                    {label(o)}
                  </span>
                  {`"${o.claim}"`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    );
}
