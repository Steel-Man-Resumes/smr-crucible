/**
 * The handoff tray (staff pass S5): what a staff member has picked to send one
 * person, before they press Send. Kept in sessionStorage for this tab only,
 * keyed by the staff member and the person, so "Send to Alma" from a
 * directory result, a connection or a t.ROY answer collects in one place and
 * survives moving between pages. Nothing is sent from here; the person page's
 * handoff panel sends, and clears the tray when it does.
 *
 * THE KEY NAMES THE ORGANIZATION (review r1 #5):
 * handoff-tray:<orgId>:<staffId>:<personId>. Every function takes an
 * `owner` from trayOwner(orgId, staffId); without an organization there is no
 * tray (nothing is kept, nothing is read).
 *
 * Never localStorage: a shared computer must not keep what a staff member was
 * about to send someone. Cleared at sign-out and account switch with the
 * other staff device copies (boss wiring: the "handoff-tray:" prefix in
 * lib/account-browser-state.ts and lib/confirmed-sign-out.ts).
 */
import { HANDOFF_MAX_ITEMS, type HandoffItemInput } from "@crucible/core/src/staffHandoffShared";
import { parseDraftBody, type DraftItemShape } from "./handoff-draft-body";

export const TRAY_PREFIX = "handoff-tray:";
export const TRAY_EVENT = "handoff-tray-change";

export interface Tray {
  items: HandoffItemInput[];
  /** A note t.ROY drafted (the staff member reviews it before Send). */
  note?: string | null;
  draftedByAssistant?: boolean;
  updatedAt: number;
}

/** A store with the sessionStorage shape, injectable for tests. */
export interface TrayStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

function store(s?: TrayStore | null): TrayStore | null {
  if (s) return s;
  try { return typeof window !== "undefined" ? window.sessionStorage : null; } catch { return null; }
}

const ID_RE = /^[0-9a-f-]{36}$/i;
/** "<orgId>:<staffId>", or null when either is missing: then there is no tray. */
export function trayOwner(orgId: string | null | undefined, staffId: string | null | undefined): string | null {
  return orgId && staffId && ID_RE.test(orgId) && ID_RE.test(staffId) ? `${orgId.toLowerCase()}:${staffId.toLowerCase()}` : null;
}
export const trayKey = (owner: string, personId: string) => `${TRAY_PREFIX}${owner}:${personId.toLowerCase()}`;

/** A day old is stale: start fresh rather than send something forgotten. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function readTray(owner: string, personId: string, s?: TrayStore | null, now = Date.now()): Tray {
  const st = store(s);
  const empty: Tray = { items: [], updatedAt: now };
  if (!st || !owner || !personId) return empty;
  try {
    const raw = st.getItem(trayKey(owner, personId));
    if (!raw) return empty;
    const t = JSON.parse(raw) as Tray;
    if (!t || !Array.isArray(t.items) || typeof t.updatedAt !== "number" || now - t.updatedAt > MAX_AGE_MS) {
      st.removeItem(trayKey(owner, personId));
      return empty;
    }
    return { ...t, items: t.items.slice(0, HANDOFF_MAX_ITEMS) };
  } catch { return empty; }
}

function write(owner: string, personId: string, t: Tray, s?: TrayStore | null): boolean {
  const st = store(s);
  if (!st) return false;
  try {
    st.setItem(trayKey(owner, personId), JSON.stringify(t));
    try { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(TRAY_EVENT, { detail: { personId } })); } catch {}
    return true;
  } catch { return false; }
}

/** The identity of an item, so the same thing is never added twice. */
export function itemKey(it: HandoffItemInput): string {
  switch (it.kind) {
    case "employer": return `employer:${it.employerId.toLowerCase()}`;
    case "resource": return `resource:${it.resourceId.toLowerCase()}`;
    case "next_step": return `step:${it.step.trim().toLowerCase()}`;
    case "job": return `job:${it.jobTitle.trim().toLowerCase()}@${it.company.trim().toLowerCase()}`;
  }
}

export type AddResult = "added" | "already" | "full" | "unavailable";

export function addToTray(owner: string, personId: string, item: HandoffItemInput, s?: TrayStore | null, now = Date.now()): AddResult {
  const t = readTray(owner, personId, s, now);
  if (t.items.some((x) => itemKey(x) === itemKey(item))) return "already";
  if (t.items.length >= HANDOFF_MAX_ITEMS) return "full";
  return write(owner, personId, { ...t, items: [...t.items, item], updatedAt: now }, s) ? "added" : "unavailable";
}

export function removeFromTray(owner: string, personId: string, key: string, s?: TrayStore | null, now = Date.now()): void {
  const t = readTray(owner, personId, s, now);
  write(owner, personId, { ...t, items: t.items.filter((x) => itemKey(x) !== key), updatedAt: now }, s);
}

/** Replace one item (the panel edits a reason or a role in place). */
export function updateTrayItem(owner: string, personId: string, key: string, item: HandoffItemInput, s?: TrayStore | null, now = Date.now()): void {
  const t = readTray(owner, personId, s, now);
  write(owner, personId, { ...t, items: t.items.map((x) => (itemKey(x) === key ? item : x)), updatedAt: now }, s);
}

/**
 * A t.ROY draft lands here: its note, and its items merged after anything the
 * staff member already picked (duplicates skipped, at most ten). It is marked
 * drafted with t.ROY until Send, so the activity log can say so.
 */
export function putDraftInTray(owner: string, personId: string, draft: { note: string; items: HandoffItemInput[] }, s?: TrayStore | null, now = Date.now()): Tray {
  const t = readTray(owner, personId, s, now);
  const keys = new Set(t.items.map(itemKey));
  const merged = [...t.items];
  for (const it of draft.items) {
    if (merged.length >= HANDOFF_MAX_ITEMS) break;
    if (!keys.has(itemKey(it))) { merged.push(it); keys.add(itemKey(it)); }
  }
  const next: Tray = { items: merged, note: draft.note, draftedByAssistant: true, updatedAt: now };
  write(owner, personId, next, s);
  return next;
}

export function clearTray(owner: string, personId: string, s?: TrayStore | null): void {
  const st = store(s);
  try { st?.removeItem(trayKey(owner, personId)); } catch {}
  try { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(TRAY_EVENT, { detail: { personId } })); } catch {}
}

/** Every tray key in a store (sign-out and account switch clear them all). */
export function trayKeysIn(keys: readonly string[]): string[] {
  return keys.filter((k) => k.startsWith(TRAY_PREFIX));
}

/** A store that can list its keys (sessionStorage). */
export interface ListStore { readonly length: number; key(i: number): string | null; removeItem(k: string): void }

/**
 * Remove every tray in this tab: at confirmed sign-out and at account switch,
 * beside clearStaffDraftCache (lib/confirmed-sign-out.ts and
 * lib/account-browser-state.ts call it; boss wiring, must land with the merge).
 */
export function clearHandoffTrays(store: ListStore | null = typeof sessionStorage === "undefined" ? null : sessionStorage): void {
  if (!store || typeof store.key !== "function" || typeof store.length !== "number") return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k && k.startsWith(TRAY_PREFIX)) doomed.push(k); }
    for (const k of doomed) store.removeItem(k);
  } catch { /* blocked storage */ }
}

/* ------------------------------------------- a t.ROY draft, from the chat -- */

export interface HandoffDraftResult {
  status: "needs_confirmation"; action: "handoff_draft"; clientId: string; firstName: string;
  /** Server-computed structure: kinds, checked ids, listing names and places. */
  items: DraftItemShape[];
  /** Every model-written word, claim-checked by the route before it streamed (lib/handoff-draft-body.ts). */
  draftBody: string;
}

/** Is this tool result t.ROY's handoff draft (lib/tools/staff/handoff-tools.ts), and does it parse? */
export function isHandoffDraftResult(r: unknown): r is HandoffDraftResult {
  if (!r || typeof r !== "object") return false;
  const x = r as Record<string, unknown>;
  return x.action === "handoff_draft" && x.status === "needs_confirmation" && typeof x.clientId === "string" && /^[0-9a-f-]{36}$/i.test(x.clientId)
    && typeof x.draftBody === "string" && Array.isArray(x.items) && parseDraftBody(x.draftBody, x.items as DraftItemShape[]) !== null;
}

/** The chat's button label for a draft. */
export const draftButtonLabel = (r: HandoffDraftResult) => `Put this in ${r.firstName === "them" ? "their" : `${r.firstName}'s`} handoff`;

/**
 * The staff member pressed the chat's button: put the draft in that person's
 * tray and return where to go to read it and press Send. Never sends. null
 * when the draft does not parse (nothing is put anywhere).
 */
export function applyHandoffDraft(r: HandoffDraftResult, owner: string | null, s?: TrayStore | null, now = Date.now()): string | null {
  const parsed = parseDraftBody(r.draftBody, r.items, now);
  if (!parsed || !owner) return null;
  putDraftInTray(owner, r.clientId, parsed, s, now);
  return `/dashboard/clients/${r.clientId}?tab=tasks#handoff`;
}
