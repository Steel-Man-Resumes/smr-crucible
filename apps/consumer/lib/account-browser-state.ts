import { clearForgeBrowserKeys } from "./refinery-guards";
import { clearTailorBatchStorage } from "./tailor-batch";
import { clearOrgNoteDrafts } from "./org-note-draft";

type LocalStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SessionStore = Pick<Storage, "length" | "key" | "removeItem" | "getItem">;

/** Keys the login and Settings lists cleared that the shared Forge/Refinery list does not. */
export const ACCOUNT_SWITCH_EXTRA_KEYS: readonly string[] = ["consent_record"];

function browserLocal(): LocalStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function browserSession(): SessionStore | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Everything this browser holds for the account that just left: the Forge run,
 * Refinery-derived keys, account extras, this tab's run sessionStorage, the
 * multi-job tailoring queue and staff note drafts (other people's data).
 * Used after an account switch and after deletion, so the next person on a
 * shared computer inherits nothing. One list, so the call sites cannot drift.
 */
export function clearAccountBrowserState(
  local: LocalStore | null = browserLocal(),
  session: SessionStore | null = browserSession(),
): void {
  clearForgeBrowserKeys(local, session);
  clearTailorBatchStorage(session);
  clearOrgNoteDrafts(session);
  if (!local) return;
  for (const key of ACCOUNT_SWITCH_EXTRA_KEYS) {
    try {
      local.removeItem(key);
    } catch {
      // Restricted storage must not stop the rest of the cleanup.
    }
  }
}
