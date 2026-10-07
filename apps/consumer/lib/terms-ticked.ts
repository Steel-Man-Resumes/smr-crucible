/**
 * The email-link form's terms checkbox, carried to the one-tap terms page in
 * THIS browser only (localStorage, same origin), so the person who ticked it
 * is not asked twice. It never records anything by itself: the terms page
 * records it, and only for the same address, the same terms version, within a
 * day. Nothing another site or another device sends can set it.
 */
export const TERMS_TICKED_KEY = "smr_terms_ticked";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function tickedMark(email: string, version: string, now: number = Date.now()) {
  return { email: email.trim().toLowerCase(), v: version, at: now };
}

export function tickedFor(
  mark: unknown,
  email: string | null | undefined,
  version: string,
  now: number = Date.now()
): boolean {
  if (!mark || typeof mark !== "object" || !email) return false;
  const m = mark as { email?: unknown; v?: unknown; at?: unknown };
  if (m.v !== version || typeof m.email !== "string" || typeof m.at !== "number") return false;
  if (m.email !== email.trim().toLowerCase()) return false;
  return now - m.at >= 0 && now - m.at <= MAX_AGE_MS;
}
