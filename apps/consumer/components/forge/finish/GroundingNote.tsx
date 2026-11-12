"use client";

/**
 * What the second check (the AI claim trace on the server) found, moved from
 * the output page unchanged. Removed and still-there items are reported
 * separately, so a document is never called clean when a flagged claim could
 * not be taken out.
 */

import { useTranslations } from "next-intl";

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
    const t = useTranslations("forgeFinish.grounding");
    const credentialCount = groundingNote.outcomes.filter((o) => o.status === "credential").length;
    const open = groundingNote.residual + groundingNote.unmatched + groundingNote.unnamed.length + credentialCount;
    const docName = (d: "resume" | "cover_letter") => (d === "cover_letter" ? t("docLetter") : t("docResume"));
    const label = (o: { status: string; doc: "resume" | "cover_letter" }) =>
      o.status === "credential"
        ? t("labelCredential", { doc: docName(o.doc) })
        : o.status === "removed"
        ? t("labelRemoved", { doc: docName(o.doc) })
        : o.status === "changed"
          ? t("labelChanged", { doc: docName(o.doc) })
          : o.status === "also_in"
          ? t("labelAlsoIn", { doc: docName(o.doc) })
          : o.status === "still_there"
            ? t("labelStillThere", { doc: docName(o.doc) })
            : t("labelUnmatched", { doc: docName(o.doc) });
    return (
      <div className="bg-t-panel border border-t-amber px-4 py-3">
        <p className="text-xs font-bold text-t-amber-bright uppercase mb-1">
          {open > 0 ? t("headingOpen") : t("headingDone")}
        </p>
        <p className="text-xs text-t-phos leading-relaxed">
          {groundingNote.removed > 0 &&
            t("removedCount", { count: groundingNote.removed })}
          {groundingNote.residual > 0 &&
            t("residualCount", { count: groundingNote.residual })}
          {credentialCount > 0 &&
            t("credentialCount", { count: credentialCount })}
          {groundingNote.unmatched > 0 &&
            t("unmatchedCount", { count: groundingNote.unmatched })}
          {groundingNote.unnamed.map((d) => t("unnamed", { doc: docName(d) }))}
          {open > 0
            ? t("tailOpen")
            : t("tailDone")}
        </p>
        {groundingNote.outcomes.length > 0 && (
          <details className="mt-2" open={open > 0}>
            <summary className="t-focus cursor-pointer text-[11px] text-t-phos-dim underline decoration-dotted underline-offset-2">
              {t("seeFlagged")}
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
