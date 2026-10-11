/**
 * Which of the writer's changes may be shown (Phase 6 integration H3, L2).
 *
 * The live replay and the recap say "t.ROY changed this line". A line that is
 * waiting on a card (a people claim set aside to ask, a fact the person must
 * confirm, a line asked the stricter way) is not a finished fix: it may come
 * off when they answer. The server drops those before it returns `changes`
 * (generate-docs, from its own finish gate over the final documents), and the
 * recap shows only changes whose new line is still on the resume as it reads
 * now (after card edits, "No" or "Take it off").
 *
 * Pure: no I/O.
 */

import type { FinishView } from "./finish-gate";
import { plainPunctuationText } from "./legal-sanitize";

const key = (l: string) => plainPunctuationText(String(l ?? "").replace(/^\s*[-•*]\s*/, "")).text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * H3: every change whose new line has an open card is dropped. The plain
 * "Looks right" job tap (a header whose facts are all the person's) is not a
 * question about the line's truth, so it does not hold a change back.
 */
export function changesNotAwaitingCards<T extends { new: string }>(changes: ReadonlyArray<T>, view: Pick<FinishView, "groups" | "general">): T[] {
  const waiting = new Set(
    view.groups
      .filter((g) => (g.target === "resume" || g.target === "skill") && !(g.job && !g.job.changes))
      .map((g) => key(g.line))
  );
  for (const i of view.general) if (i.line) waiting.add(key(i.line));
  return changes.filter((c) => !waiting.has(key(c.new)));
}

/** L2: the changes whose new line is still on the resume as it reads now. */
export function changesStillOnPage<T extends { new: string }>(changes: ReadonlyArray<T>, resumeText: string): T[] {
  const lines = new Set((resumeText || "").split("\n").map(key).filter(Boolean));
  return changes.filter((c) => lines.has(key(c.new)));
}
