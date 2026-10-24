/** The shape of the person's evidence (lib/person-evidence.ts). Pure and client-safe: no imports. */

/** One finished resume's lines, and the name the card uses for it. */
export interface FinishedBlock {
  name: string;
  lines: string[];
}

export interface PersonEvidence {
  facts: string[];
  unconfirmed: string[];
  finished: FinishedBlock[];
}

export const NO_PERSON_EVIDENCE: PersonEvidence = { facts: [], unconfirmed: [], finished: [] };

/** Read stored or sent person evidence defensively (arrays of strings, bounded). */
export function readPersonEvidence(raw: { personFacts?: unknown; unconfirmedFacts?: unknown; finishedLines?: unknown } | null | undefined): PersonEvidence {
  const strs = (v: unknown, max = 200) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max).map((x) => x.slice(0, 700)) : []);
  const finished = Array.isArray(raw?.finishedLines)
    ? (raw!.finishedLines as unknown[]).slice(0, 50).flatMap((b): FinishedBlock[] => {
        const o = (b ?? {}) as { name?: unknown; lines?: unknown };
        return typeof o.name === "string" ? [{ name: o.name.slice(0, 120), lines: strs(o.lines, 400) }] : [];
      })
    : [];
  return { facts: strs(raw?.personFacts, 40), unconfirmed: strs(raw?.unconfirmedFacts, 40), finished };
}
