/**
 * Turn what a person typed in the job board's "Where?" box into a place the
 * job providers can find, using the same public Census list the Forge's
 * location field uses (lib/location-search.ts).
 *
 * Why (2026-11-18, live demo): "OH, cinncinati" returned nothing. The state came
 * first and the city was misspelled, so the providers could not geocode it,
 * while "OH" alone worked. The box is free text, so the server fixes the shape:
 *   "OH, cinncinati"  -> "Cincinnati, OH"   (state first, one-letter slip)
 *   "cincinati oh"    -> "Cincinnati, OH"
 *   "45202"           -> "Cincinnati, OH 45202"
 * Anything it cannot place with confidence goes through unchanged.
 *
 * Pure: takes the index, so it is unit tested without the file.
 */

import { foldName, placeValue, resolveZip, splitQuery, type LocationIndex } from "./location-search";
import { stateCodeFrom } from "./location-state";

export interface ResolvedJobLocation {
  /** What to send the providers. */
  value: string;
  /** True when it differs from what the person typed (show "Searched X"). */
  changed: boolean;
}

/** Levenshtein distance, stopping early once it passes `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** "OH, cincinnati" / "ohio cincinnati": a leading state with a name after it. */
function leadingState(raw: string): { name: string; state: string } | null {
  const comma = raw.indexOf(",");
  if (comma > 0) {
    const st = stateCodeFrom(raw.slice(0, comma));
    const rest = raw.slice(comma + 1).trim();
    if (st && rest && !stateCodeFrom(rest)) return { name: rest, state: st };
    return null;
  }
  const words = raw.split(" ");
  for (const take of [2, 1]) {
    if (words.length > take) {
      const st = stateCodeFrom(words.slice(0, take).join(" "));
      if (st) return { name: words.slice(take).join(" "), state: st };
    }
  }
  return null;
}

/** Best Census place for a name in a state: exact, then a close spelling. */
function matchPlace(index: LocationIndex, name: string, state: string): string | null {
  const key = foldName(name);
  if (!key) return null;
  const pools = [index.places, index.counties];
  for (const pool of pools) {
    const exact = pool.find((e) => e.st === state && e.key === key);
    if (exact) return placeValue(exact.name, exact.st);
  }
  // Close spelling only for names long enough that a slip is unambiguous.
  if (key.length < 5) return null;
  const max = key.length >= 8 ? 2 : 1;
  for (const pool of pools) {
    let best: { d: number; value: string } | null = null;
    // The list is ordered most likely first, so the first hit at a distance wins ties.
    for (const e of pool) {
      if (e.st !== state) continue;
      const d = editDistance(key, e.key, max);
      if (d <= max && (!best || d < best.d)) best = { d, value: placeValue(e.name, e.st) };
      if (best?.d === 1 && max === 1) break;
    }
    if (best) return best.value;
  }
  return null;
}

export function resolveJobLocation(index: LocationIndex | null, typed: string): ResolvedJobLocation {
  const raw = typed.replace(/\s+/g, " ").trim();
  const keep = { value: raw, changed: false };
  if (!raw || !index) return keep;

  const zip = raw.match(/^(\d{5})(-\d{4})?$/);
  if (zip) {
    const v = resolveZip(index, zip[1]);
    return v ? { value: v, changed: v !== raw } : keep;
  }

  // A state alone ("OH", "Ohio") is already a search the providers handle.
  if (stateCodeFrom(raw)) return keep;

  const lead = leadingState(raw);
  const split = lead ?? splitQuery(raw);
  if (!split.state) return keep;

  const zipTail = raw.match(/\b(\d{5})\b/)?.[1];
  const name = split.name.replace(/\b\d{5}(-\d{4})?\b/, "").replace(/,\s*$/, "").trim();
  const found = matchPlace(index, name, split.state);
  if (!found) {
    // At least put it in "Name, ST" order so a provider has a chance.
    return lead ? { value: `${lead.name}, ${lead.state}`, changed: true } : keep;
  }
  const value = zipTail ? `${found} ${zipTail}` : found;
  return { value, changed: foldName(value) !== foldName(raw) };
}
