/**
 * The People page line about members who joined but have not turned on
 * progress sharing (walkthrough W03, 2026-10-27). The old copy said they
 * "joined with the code" even when they joined by invitation, and paired
 * "1 more person has" with "have not". This one is neutral about HOW they
 * joined and agrees with the count every time.
 *
 * `program` is the organization's own word (useOrgTerms().program).
 * Returns "" for zero, so callers can render it unconditionally.
 */
export function joinedNotSharingLine(count: number, program = "program", opts: { more?: boolean } = {}): string {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return "";
  const one = n === 1;
  const who = `${n}${opts.more ? " more" : ""} ${one ? "person has" : "people have"}`;
  const word = program.trim() || "program";
  return `${who} joined your ${word} but ${one ? "has" : "have"} not turned on sharing yet. They control that from their own Settings.`;
}
