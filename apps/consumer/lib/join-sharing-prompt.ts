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

/** "Not now" is remembered in this browser only. Nothing is sent or stored on the server. */
export function dismissKey(userId: string, orgId: string): string {
  return `smr.joinSharingPrompt.dismissed:${userId}:${orgId}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function wasDismissed(storage: StorageLike | null, userId: string, orgId: string): boolean {
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

/** Show only when the server says to ask, we know who is asking, and they have not said "Not now" here. */
export function shouldShowJoinPrompt(
  decision: { show: boolean; orgId?: string } | null,
  userId: string | null | undefined,
  storage: StorageLike | null
): boolean {
  if (!decision?.show || !decision.orgId || !userId) return false;
  return !wasDismissed(storage, userId, decision.orgId);
}

/** Fired after joining an organization or changing sharing, so open screens re-check. */
export const ORG_JOINED_EVENT = "smr:org-joined";
export const SHARING_CHANGED_EVENT = "smr:sharing-changed";
