/**
 * A Refinery edit applied to the saved revision's own text (Phase 5 R1,
 * review H1). Pure and server-safe.
 *
 * The Refinery edits a structured document; a saved revision is text. Printing
 * the structured document again does not give back the Forge's text exactly
 * (separators, heading names, where a headline sits), and a line that only
 * LOOKS different would be asked about again. So an edit is applied as a
 * patch: the lines of the structured document as it was saved (`before`) and
 * as it is now (`after`) are compared, and only lines the person actually
 * changed, added or removed change in the saved text. Every other line keeps
 * its exact saved form.
 *
 *   patchText(saved, before, after) === saved    when before === after
 *
 * Lines are matched to the saved text by their words (lineKey: lower case,
 * punctuation and separators dropped, word order ignored), so a reordered
 * contact line or a "|" turned into "," still finds its saved line.
 */

/** The words of a line, order-free: what makes two lines "the same line". */
export function lineKey(line: string): string {
  return line
    .toLowerCase()
    .replace(/^\s*[-•*]\s+/, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/** Longest common subsequence on exact lines: for each `a` line, the matching `b` index or -1. */
function lcsMatch(a: string[], b: string[]): number[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = new Array<number>(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out[i] = j;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/**
 * Apply the change from `before` to `after` (two printings of the structured
 * document) to `saved` (the revision's text). Lines the person did not touch
 * keep their saved form; changed lines take their new form, in place; added
 * lines go after the line they follow; removed lines go.
 */
/** A line with its separators made the same ("|" "," "•" and spacing), case and words kept. */
export function sepKey(line: string): string {
  return line.replace(/\s*[|,•]\s*/g, "|").replace(/\s+/g, " ").trim();
}

/**
 * `known`: lines whose exact form the person already settled (the saved text
 * and the writer's documents). A new or changed line that differs from one of
 * them ONLY in separators takes that settled form, so a line put back the way
 * it was, or merely reprinted, reads exactly as before. A real edit (a word,
 * a number, punctuation) never matches and keeps the person's form.
 */
export function patchText(saved: string, before: string, after: string, known: string[] = []): string {
  if (before === after) return saved;
  const S = saved.split("\n");
  const A = before.split("\n");
  const B = after.split("\n");

  // 1. Each `before` line to its saved line, by words, in order where possible.
  const savedUsed = new Array<boolean>(S.length).fill(false);
  const toSaved = new Array<number>(A.length).fill(-1);
  let cursor = 0;
  for (let i = 0; i < A.length; i++) {
    const k = lineKey(A[i]);
    if (!k) continue;
    let hit = -1;
    for (let s = cursor; s < S.length; s++) if (!savedUsed[s] && lineKey(S[s]) === k) { hit = s; break; }
    if (hit < 0) for (let s = 0; s < S.length; s++) if (!savedUsed[s] && lineKey(S[s]) === k) { hit = s; break; }
    if (hit >= 0) {
      savedUsed[hit] = true;
      toSaved[i] = hit;
      cursor = hit + 1;
    }
  }

  // 2. What changed between the two printings, as hunks: runs of removed
  //    `before` lines and added `after` lines between two unchanged lines.
  const keep = lcsMatch(A, B); // before line -> after index, or -1 (removed or changed)
  const hunks: Array<{ removed: number[]; added: number[]; anchor: number }> = [];
  {
    let ia = 0;
    let jb = 0;
    const close = (iEnd: number, jEnd: number) => {
      const removed: number[] = [];
      const addedIdx: number[] = [];
      for (let i = ia; i < iEnd; i++) removed.push(i);
      for (let j = jb; j < jEnd; j++) addedIdx.push(j);
      if (removed.length || addedIdx.length) hunks.push({ removed, added: addedIdx, anchor: ia - 1 });
    };
    for (let i = 0; i < A.length; i++) {
      if (keep[i] < 0) continue;
      close(i, keep[i]);
      ia = i + 1;
      jb = keep[i] + 1;
    }
    close(A.length, B.length);
  }
  // A true move (the exact line removed in one place, added in another) keeps its saved form.
  const removedByText = new Map<string, number[]>();
  for (const h of hunks) for (const i of h.removed) if (toSaved[i] >= 0) removedByText.set(A[i], [...(removedByText.get(A[i]) ?? []), i]);
  const settled = new Map<string, string>();
  for (const l of [...S, ...known]) {
    const k = sepKey(l);
    if (k && !settled.has(k)) settled.set(k, l.trim() === l ? l : l.trim());
  }
  const addedLine = (j: number): string => {
    const moved = removedByText.get(B[j]);
    if (moved && moved.length) return S[toSaved[moved.shift()!]];
    return settled.get(sepKey(B[j])) ?? B[j];
  };

  // 3. Where each hunk's new lines go in the saved text. A changed line takes
  //    the place of the saved line it replaces; a pure addition goes after the
  //    nearest earlier line that has a saved place (else after the header).
  const removedSaved = new Set<number>();
  const inPlace = new Map<number, string[]>(); // saved index -> lines emitted in its place
  const placeAfterSaved = new Map<number, string[]>(); // saved index -> lines after it (-1 = top)
  for (const h of hunks) {
    for (const i of h.removed) if (toSaved[i] >= 0) removedSaved.add(toSaved[i]);
    const lines = h.added.map(addedLine);
    if (!lines.length) continue;
    const firstSaved = h.removed.map((i) => toSaved[i]).find((x) => x >= 0);
    if (firstSaved !== undefined) {
      inPlace.set(firstSaved, [...(inPlace.get(firstSaved) ?? []), ...lines]);
      continue;
    }
    let at = h.anchor;
    while (at >= 0 && toSaved[at] < 0) at--;
    const savedAt = at >= 0 ? toSaved[at] : -1;
    placeAfterSaved.set(savedAt, [...(placeAfterSaved.get(savedAt) ?? []), ...lines]);
  }

  // 4. Walk the saved text.
  const out: string[] = [];
  // Lines for the top go after the header block (before its first blank line), so the name stays first.
  const top = placeAfterSaved.get(-1) ?? [];
  const firstBlank = S.findIndex((l, idx) => idx > 0 && !l.trim());
  const topAt = firstBlank >= 0 ? firstBlank - 1 : S.length - 1;
  for (let s = 0; s < S.length; s++) {
    if (inPlace.has(s)) out.push(...inPlace.get(s)!);
    else if (!removedSaved.has(s)) out.push(S[s]);
    if (s === topAt && top.length) out.push(...top);
    const after = placeAfterSaved.get(s);
    if (after) out.push(...after);
  }
  // Tidy: no blank line doubled by a removal, none at the very end.
  const tidy: string[] = [];
  for (const l of out) {
    if (!l.trim() && tidy.length && !tidy[tidy.length - 1].trim()) continue;
    tidy.push(l);
  }
  while (tidy.length && !tidy[tidy.length - 1].trim()) tidy.pop();
  return tidy.join("\n");
}
