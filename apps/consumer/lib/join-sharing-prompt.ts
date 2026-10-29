/**
 * App-side helpers for the one-time "share your progress?" prompt.
 * Pure (no network, no database) so the rules are unit-tested.
 */
import {
  JOIN_SHARING_TEXT_VERSION,
  JOIN_SHARING_COLLECTION_METHOD,
  SETTINGS_SHARING_TEXT_VERSION,
} from "@crucible/core/src/joinSharingPromptShared";

export type ConsentSource = "settings" | "join_prompt";

/**
 * What gets written with a consent grant, by where the yes was given.
 * Settings grants are recorded exactly as they were before this prompt existed.
 */
export function consentGrantRecord(source: ConsentSource, settingsTextVersion: string, orgId: string | null) {
  if (source === "join_prompt") {
    return {
      textVersion: JOIN_SHARING_TEXT_VERSION,
      collectionMethod: JOIN_SHARING_COLLECTION_METHOD,
      context: { collected_from: JOIN_SHARING_COLLECTION_METHOD, access_code_id: orgId } as Record<string, unknown>,
      eventContext: { access_code_id: orgId } as Record<string, unknown>,
    };
  }
  return {
    textVersion: settingsTextVersion,
    collectionMethod: "settings",
    context: { collected_from: "settings" } as Record<string, unknown>,
    eventContext: undefined as Record<string, unknown> | undefined,
  };
}

/**
 * The wording version a Settings grant is recorded with. The progress-sharing
 * switch has its own words and its own version; every other layer keeps the
 * shared one, so rewording this switch never relabels a yes to something else.
 */
export function settingsTextVersionFor(layer: string, defaultVersion: string): string {
  return layer === "sharing" ? SETTINGS_SHARING_TEXT_VERSION : defaultVersion;
}

/**
 * "Not now" is remembered in this browser only. Nothing is stored on the
 * server, and the server never reads it.
 *
 * Two places in this browser (demo review 2026-10-28: Ceci said Not now on the
 * Refinery, then the Forge asked again): localStorage, and a small cookie the
 * Forge and Refinery hosts share (Domain .steelmanresumes.com in production,
 * host-only elsewhere). Each host has its own localStorage, so the cookie is
 * what carries the answer across. It holds only a short one-way token per
 * person and organization (review 2026-10-29: the cookie reaches every
 * steelmanresumes.com subdomain, so raw ids, which could tie a person to a
 * program, never go in it), no words and no choice beyond "do not ask here again".
 */
export function dismissKey(userId: string, orgId: string): string {
  return `smr.joinSharingPrompt.dismissed:${userId}:${orgId}`;
}

export const DISMISS_COOKIE = "smr_jsp_not_now";
const ID_RE = /^[0-9A-Za-z-]{1,64}$/;
const TOKEN_RE = /^[0-9a-z]{14}$/;

/** One-way token for a person and organization (two 32-bit FNV-1a passes, base 36). Not the ids. */
export function dismissToken(userId: string, orgId: string): string {
  const s = `${userId}.${orgId}`;
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return h.toString(36).padStart(7, "0");
  };
  return fnv(0x811c9dc5) + fnv(0x2f6b1a3d);
}
const MAX_COOKIE_PAIRS = 8;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** The tokens in the Not now cookie; anything malformed (including old raw-id pairs) is ignored. */
export function readDismissCookie(cookie: string | null | undefined): string[] {
  const m = new RegExp(`(?:^|;\\s*)${DISMISS_COOKIE}=([^;]*)`).exec(cookie || "");
  if (!m) return [];
  return m[1].split(".").filter((tok) => TOKEN_RE.test(tok));
}

/** The document.cookie assignment that adds this pair (newest kept, at most eight). Null for an id that is not an id. */
export function dismissCookieAssignment(cookie: string | null | undefined, userId: string, orgId: string, hostname: string, protocol: string): string | null {
  if (!ID_RE.test(userId) || !ID_RE.test(orgId)) return null;
  const pair = dismissToken(userId, orgId);
  const pairs = [...readDismissCookie(cookie).filter((p) => p !== pair), pair].slice(-MAX_COOKIE_PAIRS);
  const shared = hostname === "steelmanresumes.com" || hostname.endsWith(".steelmanresumes.com");
  return `${DISMISS_COOKIE}=${pairs.join(".")}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${shared ? "; Domain=.steelmanresumes.com" : ""}${protocol === "https:" ? "; Secure" : ""}`;
}

export function wasDismissed(storage: StorageLike | null, userId: string, orgId: string, cookie?: string | null): boolean {
  if (readDismissCookie(cookie).includes(dismissToken(userId, orgId))) return true;
  try {
    return !!storage && storage.getItem(dismissKey(userId, orgId)) === "1";
  } catch {
    return false;
  }
}

export function rememberDismissed(storage: StorageLike | null, userId: string, orgId: string): void {
  try {
    storage?.setItem(dismissKey(userId, orgId), "1");
  } catch {
    // Private browsing or a full disk: they may be asked once more. Never an error.
  }
}

/** Show only when the server says to ask, we know who is asking, and they have not said "Not now" on either host. */
export function shouldShowJoinPrompt(
  decision: { show: boolean; orgId?: string } | null,
  userId: string | null | undefined,
  storage: StorageLike | null,
  cookie?: string | null
): boolean {
  if (!decision?.show || !decision.orgId || !userId) return false;
  return !wasDismissed(storage, userId, decision.orgId, cookie);
}

/** Fired after joining an organization or changing sharing, so open screens re-check. */
export const ORG_JOINED_EVENT = "smr:org-joined";
export const SHARING_CHANGED_EVENT = "smr:sharing-changed";
