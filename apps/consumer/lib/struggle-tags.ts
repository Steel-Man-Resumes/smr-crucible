/**
 * Progressive practice -- struggle tags (Phase 5.9).
 *
 * A PURE classifier that reads the interview feedback the coach already
 * produces (improvements, disclosure_notes, overall) and derives a small set of
 * "things to work on next" tags. These carry from one practice session to the
 * next so the setup screen can gently offer: "Last time you wanted to work on
 * X -- want to target that?"
 *
 * DOCTRINE: this is encouraging, never a deficit list. Every tag id and label
 * is framed as a skill to build, not a failing. There is no shaming tag string.
 * No DB, no network -- feedback in, tags out.
 */
export type StruggleTagId =
  | "owning_the_gap"
  | "specifics"
  | "staying_calm"
  | "closing"
  | "confidence";

export interface StruggleTagDef {
  id: StruggleTagId;
  /** Encouraging phrasing for "want to work on X". Never a deficit label. */
  label: string;
  /** Keywords in the feedback that point at this skill. */
  match: RegExp;
}

// Order here is the priority order when we cap the list.
export const STRUGGLE_TAGS: StruggleTagDef[] = [
  {
    id: "owning_the_gap",
    label: "owning your story",
    match:
      /\b(own(ing|ership)?|took responsibilit|responsib|accountab|blame|minimiz|excuse|the gap|your (record|background|past)|disclos)/i,
  },
  {
    id: "specifics",
    label: "giving specific examples",
    match:
      /\b(specific|example|concrete|detail|vague|general|quantif|numbers?|metrics?|results?|star\b)/i,
  },
  {
    id: "staying_calm",
    label: "staying calm and steady",
    match:
      /\b(calm|nervous|anxious|rushed|slow down|slowing down|breath|pause|composure|steady|defensive|flustered)/i,
  },
  {
    id: "closing",
    label: "closing the interview strong",
    match:
      /\b(clos(e|ing)|wrap(ping)? up|final impression|last impression|questions to ask|ask(ing)? questions|follow[- ]?up|end (of|the))/i,
  },
  {
    id: "confidence",
    label: "speaking with confidence",
    match:
      /\b(confiden|hesitat|uncertain|undersell|sell yourself|assertive|believe in yourself|speak up|own your strength)/i,
  },
];

export const STRUGGLE_TAG_IDS: StruggleTagId[] = STRUGGLE_TAGS.map((t) => t.id);

const TAG_BY_ID: Record<string, StruggleTagDef> = Object.fromEntries(
  STRUGGLE_TAGS.map((t) => [t.id, t])
);

/** Shape of the parts of the feedback scorecard this classifier reads. */
export interface StruggleFeedbackInput {
  improvements?: unknown;
  disclosure_notes?: unknown;
  overall?: unknown;
}

function textPool(feedback: StruggleFeedbackInput | null | undefined): string {
  if (!feedback || typeof feedback !== "object") return "";
  const parts: string[] = [];
  if (Array.isArray(feedback.improvements)) {
    for (const item of feedback.improvements) {
      if (typeof item === "string") parts.push(item);
    }
  }
  if (typeof feedback.disclosure_notes === "string") parts.push(feedback.disclosure_notes);
  if (typeof feedback.overall === "string") parts.push(feedback.overall);
  return parts.join("  \n");
}

/**
 * Derive up to `max` struggle-tag ids from a feedback scorecard. Empty or
 * unusable feedback yields no tags. Themes are read from "areas to work on"
 * (improvements), the disclosure note, and the overall read -- never from the
 * strengths, so we never flip a win into a to-do.
 */
export function deriveStruggleTags(
  feedback: StruggleFeedbackInput | null | undefined,
  max = 3
): StruggleTagId[] {
  const pool = textPool(feedback);
  if (!pool.trim()) return [];
  const hits: StruggleTagId[] = [];
  for (const tag of STRUGGLE_TAGS) {
    if (tag.match.test(pool)) hits.push(tag.id);
  }
  return hits.slice(0, Math.max(0, max));
}

/** Encouraging label for a tag id, for the "want to work on X" prompt. */
export function struggleTagLabel(id: string): string {
  return TAG_BY_ID[id]?.label ?? "";
}

/** Filter an arbitrary array down to known, valid tag ids (defensive read of
 *  server-stored struggle_tags before showing them). */
export function knownStruggleTags(ids: unknown): StruggleTagId[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: StruggleTagId[] = [];
  for (const id of ids) {
    if (typeof id === "string" && id in TAG_BY_ID && !seen.has(id)) {
      seen.add(id);
      out.push(id as StruggleTagId);
    }
  }
  return out;
}
