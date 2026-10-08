/**
 * Shared-computer rules for the Refinery shell (follow-ups to the register
 * hotfix review, round 2: R2, R6, N6, N7, and the welcome tour).
 *
 * Pure and import-free so the shell, the dashboard links and the tests read
 * the same rules. The shell does the I/O.
 */

/** "Edit your resume" from the Refinery: the Forge, told it was opened from an account. */
export const EDIT_RESUME_HREF = "/resume?from=refinery";

// ---- N6 ------------------------------------------------------------------------

/**
 * May the shell sync a Forge run to the account? Not while the role is still
 * loading (null), and never while an admin is viewing as someone else: the
 * save route writes to the EFFECTIVE account, so an admin's own run would land
 * in the person they are viewing.
 */
export function forgeSyncAllowed(role: { impersonating: unknown } | null | undefined): boolean {
  if (!role) return false;
  return !role.impersonating;
}

// ---- N7 and the welcome tour ---------------------------------------------------

export type ForgePromptState = "none" | "ask" | "saving" | "saved" | "failed";

/**
 * Is the "Is it yours?" question open on screen? While it is, nothing may
 * cover it (the welcome tour waits) and nothing may take the person away.
 */
export function forgeQuestionOpen(a: { prompt: ForgePromptState; askNow: boolean }): boolean {
  return a.askNow || a.prompt === "ask" || a.prompt === "saving" || a.prompt === "failed";
}

/**
 * Does the question hold the onboarding bounce (the redirect to the Forge for
 * an account with no Forge work)? While it is open, yes. Right after "Yes"
 * saves, the onboarding numbers still say "no Forge work", so "saved" holds
 * until onboarding has loaded again after the save, then lets go.
 * `onboardingLoads` counts finished onboarding loads; `savedAtLoads` is that
 * count at the moment the save finished.
 */
export function forgeQuestionHoldsBounce(a: {
  prompt: ForgePromptState;
  askNow: boolean;
  onboardingLoads: number;
  savedAtLoads: number | null;
}): boolean {
  if (forgeQuestionOpen(a)) return true;
  if (a.prompt === "saved") return a.savedAtLoads === null || a.onboardingLoads <= a.savedAtLoads;
  return false;
}

// ---- R6 ------------------------------------------------------------------------

/**
 * Keys derived from one person's runs and searches. A Refinery screen reads
 * some of them the moment it mounts (the job search, saved jobs, the approved
 * resume pointer), before the shell's effects run, so the shell settles them
 * during its render, before the page appears.
 */
export const DERIVED_KEYS: readonly string[] = [
  "forge_preload",
  "consumer_progress",
  "saved_jobs",
  "hidden_jobs",
  "refinery_last_job_search",
  "active_baseline_id",
  "interview_struggle_tags",
];

/** The account the derived keys in this browser were written for. */
export const DERIVED_OWNER_KEY = "refinery_derived_owner";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Clear the derived keys when they were written for another account, then
 * mark them as this account's. With no mark yet (a browser from before this
 * shipped), they are cleared only when the Forge run here is marked for
 * another account; otherwise they are taken as this account's, so nobody
 * loses their saved jobs on the first visit after this ships.
 */
export function settleDerivedKeys(uid: string, storage: Store | null = browserStore()): "kept" | "cleared" {
  if (!storage || !uid) return "kept";
  let owner: string | null = null;
  try {
    owner = storage.getItem(DERIVED_OWNER_KEY);
  } catch {
    return "kept";
  }
  let clear = owner !== null && owner !== uid;
  if (owner === null) {
    try {
      const run = JSON.parse(storage.getItem("forge_session") || "null");
      const runOwner = run && typeof run === "object" ? run._ownerUserId : null;
      clear = typeof runOwner === "string" && runOwner !== uid;
    } catch {
      clear = false;
    }
  }
  if (clear) {
    for (const k of DERIVED_KEYS) {
      try {
        storage.removeItem(k);
      } catch {
        // ignore
      }
    }
  }
  try {
    storage.setItem(DERIVED_OWNER_KEY, uid);
  } catch {
    // storage unavailable
  }
  return clear ? "cleared" : "kept";
}
