/**
 * Interview JD auto-fill helpers (Phase 5.6) -- PURE.
 *
 * When the user picks a saved job, we prefer the JD snapshot stored with that
 * application over anything they paste, so they never have to re-paste a
 * description we already captured. These helpers decide which JD text wins and
 * put a plain-language age on the snapshot ("saved 3 days ago"). No DB, no
 * network -- inputs in, decision out.
 */
export type JdSource = "snapshot" | "pasted" | "none";

export interface PickedJd {
  text: string;
  source: JdSource;
}

/**
 * Choose the JD to interview against. A saved snapshot wins over a paste (it is
 * the captured, provenance-tracked copy). Falls back to the pasted text, then to
 * nothing. Whitespace-only inputs count as empty.
 */
export function pickJdSource(
  snapshotText: string | null | undefined,
  pastedText: string | null | undefined
): PickedJd {
  const snap = (snapshotText ?? "").trim();
  if (snap) return { text: snap, source: "snapshot" };
  const pasted = (pastedText ?? "").trim();
  if (pasted) return { text: pasted, source: "pasted" };
  return { text: "", source: "none" };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Plain-language age of a JD snapshot from its fetched-at timestamp. Returns ""
 * when there is no usable date. Never says a negative age (a clock skew reads as
 * "today").
 */
export function formatSnapshotAge(
  fetchedAt: string | Date | null | undefined,
  now: Date = new Date()
): string {
  if (!fetchedAt) return "";
  const then = fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt);
  const ms = then.getTime();
  if (Number.isNaN(ms)) return "";

  const days = Math.floor((now.getTime() - ms) / DAY_MS);
  if (days <= 0) return "saved today";
  if (days === 1) return "saved yesterday";
  if (days < 7) return `saved ${days} days ago`;
  if (days < 14) return "saved 1 week ago";
  if (days < 30) return `saved ${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "saved 1 month ago";
  return `saved ${Math.floor(days / 30)} months ago`;
}
