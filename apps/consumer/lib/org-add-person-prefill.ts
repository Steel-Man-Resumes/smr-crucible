/**
 * "Open Add people with Michael Shaw filled in" (lane S1, staff pass 2026-10-27).
 *
 * t.ROY never adds or invites anyone. The open_add_person tool returns the
 * values the staff member gave; the chat button writes them here and opens
 * Add people; that page reads them ONCE, clears them, fills the form, and
 * says so. The staff member checks the form and presses Send invite
 * themselves. The duplicate warning still runs on the filled values.
 *
 * Same handoff as the note draft (lib/org-note-draft.ts): sessionStorage,
 * keyed by WHO IS VIEWING, so on a shared front-desk browser one staff
 * member's prefill never lands in another's form. The key uses the note
 * draft prefix, so the sign-out sweep (clearOrgNoteDrafts) clears it too.
 * It carries the organization it was made for and expires, so a stale or
 * foreign prefill is dropped, never shown.
 *
 * Pure apart from the storage passed in; browser-safe.
 */
import { ORG_NOTE_DRAFT_PREFIX } from "./org-note-draft";

export const ADD_PERSON_PREFILL_EVENT = "org-add-person-prefill";
/** A prefill is for right now. After this it is dropped unread. */
export const ADD_PERSON_PREFILL_TTL_MS = 15 * 60 * 1000;

export interface AddPersonPrefill {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  /** A program of this organization, matched by the server. Shown as a reminder: enrolling happens after they join. */
  program: string | null;
  /** The organization the server resolved. A prefill for another org is dropped. */
  orgId: string;
  skillRunId?: string;
  at: string;
}

export function addPersonPrefillKey(viewerId: string): string {
  return `${ORG_NOTE_DRAFT_PREFIX}${viewerId}:add-person`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[\p{L}][\p{L}\p{M}' .-]{0,59}$/u;
const EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,190}\.[a-z]{2,24}$/i;

/** A person's name part: letters, spaces, apostrophes, hyphens, periods. Null when it is not a name. */
export function cleanNamePart(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s && NAME.test(s) ? s : null;
}

export function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return EMAIL.test(s) && s.length <= 254 ? s.toLowerCase() : null;
}

/** US-style phone: 10 digits (a leading 1 is dropped). Shown as 555-010-0199. */
export function cleanPhone(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  let d = String(v).replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : null;
}

/** Keep only a well-formed, current prefill for this organization. */
export function parseAddPersonPrefill(raw: unknown, opts: { now?: number; orgId?: string | null } = {}): AddPersonPrefill | null {
  let v: unknown = raw;
  if (typeof raw === "string") { try { v = JSON.parse(raw); } catch { return null; } }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const firstName = cleanNamePart(r.firstName);
  if (!firstName) return null;
  if (typeof r.orgId !== "string" || !UUID.test(r.orgId)) return null;
  if (opts.orgId && opts.orgId.toLowerCase() !== r.orgId.toLowerCase()) return null;
  const at = typeof r.at === "string" ? Date.parse(r.at) : NaN;
  const now = opts.now ?? Date.now();
  if (!Number.isFinite(at) || now - at > ADD_PERSON_PREFILL_TTL_MS || at - now > 60_000) return null;
  const program = typeof r.program === "string" && r.program.trim() ? r.program.trim().slice(0, 80) : null;
  return {
    firstName,
    lastName: cleanNamePart(r.lastName) ?? "",
    email: cleanEmail(r.email),
    phone: cleanPhone(r.phone as string),
    program,
    orgId: r.orgId.toLowerCase(),
    ...(typeof r.skillRunId === "string" && UUID.test(r.skillRunId) ? { skillRunId: r.skillRunId } : {}),
    at: new Date(at).toISOString(),
  };
}

/** The form's one name box. */
export function prefillFullName(p: Pick<AddPersonPrefill, "firstName" | "lastName">): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ");
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const session = (): Store | null => (typeof sessionStorage === "undefined" ? null : sessionStorage);

/** The chat button: write, then tell an already-open Add people page. Never throws. */
export function writeAddPersonPrefill(viewerId: string, prefill: AddPersonPrefill, store: Store | null = session()): boolean {
  if (!store || !viewerId) return false;
  try {
    store.setItem(addPersonPrefillKey(viewerId), JSON.stringify(prefill));
  } catch { return false; }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ADD_PERSON_PREFILL_EVENT));
  return true;
}

/** The Add people page: read once and clear, whatever was there. */
export function takeAddPersonPrefill(viewerId: string, opts: { now?: number; orgId?: string | null } = {}, store: Store | null = session()): AddPersonPrefill | null {
  if (!store || !viewerId) return null;
  try {
    const key = addPersonPrefillKey(viewerId);
    const raw = store.getItem(key);
    if (raw === null) return null;
    store.removeItem(key);
    return parseAddPersonPrefill(raw, opts);
  } catch { return null; }
}
