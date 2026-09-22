/**
 * Are these two names plausibly the same human?
 *
 * Deliberately generous, because the cost of the two answers is not symmetric.
 * A false "same" pastes one person's details onto someone else's document or
 * account. A false "different" leaves a field blank, or drops data that could
 * have been kept. So middle names, initials and suffixes must not split a
 * match ("Troy Carr" and "Troy Richard Carr" are one person), while genuinely
 * different names must not merge.
 *
 * An absent name on either side returns false: with nothing to compare, we do
 * not get to assume.
 */
export function isSamePerson(a: string | undefined, b: string | undefined): boolean {
  const tokens = (s: string | undefined) =>
    (s ?? "")
      .toLowerCase()
      .replace(/[.,]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !["jr", "sr", "ii", "iii", "iv"].includes(t));

  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;

  // Every token of the shorter name must appear in the longer one.
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t) => long.includes(t));
}
