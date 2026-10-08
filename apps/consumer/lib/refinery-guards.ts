/**
 * Shared-computer rules for the Refinery shell (follow-ups to the register
 * hotfix review, round 2: R2, R6, N6, N7, and the welcome tour).
 *
 * Pure so the shell, the dashboard links and the tests read the same rules.
 * The shell does the I/O. The Forge run itself is only ever read through
 * lib/forge-carry.ts.
 */

import { eraseLocalForgeRun, forgeRunOwner } from "./forge-carry";

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
    const runOwner = forgeRunOwner(storage);
    clear = runOwner !== null && runOwner !== uid;
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

// ---- impersonation (security review 3a Part 2 r1, M3) ---------------------------

/**
 * Clear every Forge and Refinery key this browser holds for a person: the
 * Forge run, its last-synced mark, and the derived keys with their owner
 * mark. Called when an admin starts or ends viewing as someone, so neither
 * side's work is ever read as the other's.
 */
export function clearForgeBrowserKeys(storage: Store | null = browserStore()): void {
  if (!storage) return;
  eraseLocalForgeRun(storage);
  for (const k of [...DERIVED_KEYS, DERIVED_OWNER_KEY]) {
    try {
      storage.removeItem(k);
    } catch {
      // ignore
    }
  }
}

/*
 * BOTH HOSTS (security review 3a Part 2 r2, N3). forge.* and refinery.* each
 * have their own localStorage, and a page can only clear its own. So a clear
 * also leaves a mark in a cookie both hosts can read (Domain
 * .steelmanresumes.com in production; host-only on localhost and previews,
 * where there is one host anyway). Each host, the next time it loads the
 * Forge run or settles the Refinery keys, sees a mark newer than the last one
 * it acted on and clears its own keys too. The limit: the other host clears
 * when it is next opened in this browser, not at the same moment, and a
 * browser that blocks cookies gets only the clear on the host in front of it.
 * The server checks (Forge saves refused while impersonating, a loaded run
 * stamped only for its own account) hold on both hosts regardless.
 */
export const FORGE_CLEAR_COOKIE = "smr_forge_clear";
export const FORGE_CLEAR_SEEN_KEY = "smr_forge_clear_seen";

interface CookieDoc {
  cookie: string;
  location?: { hostname: string; protocol: string };
}

function browserDoc(): CookieDoc | null {
  return typeof document === "undefined" ? null : (document as unknown as CookieDoc);
}

/** The cookie attributes for the mark: shared across steelmanresumes.com hosts in production. */
export function forgeClearCookieAttrs(hostname: string, protocol: string): string {
  const shared = hostname === "steelmanresumes.com" || hostname.endsWith(".steelmanresumes.com");
  return `Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax${shared ? "; Domain=.steelmanresumes.com" : ""}${protocol === "https:" ? "; Secure" : ""}`;
}

/** The mark's time from a cookie string, or 0. */
export function readForgeClearMark(cookie: string): number {
  const m = new RegExp(`(?:^|;\\s*)${FORGE_CLEAR_COOKIE}=(\\d{1,16})`).exec(cookie || "");
  return m ? Number(m[1]) : 0;
}

/**
 * Clear this host's keys now and mark the clear for the other host. Used when
 * an impersonation starts, ends (End button) or runs out (the status turns
 * inactive for any reason).
 */
export function clearForgeBrowserKeysEverywhere(
  storage: Store | null = browserStore(),
  doc: CookieDoc | null = browserDoc(),
  now: number = Date.now()
): void {
  clearForgeBrowserKeys(storage);
  try {
    storage?.setItem(FORGE_CLEAR_SEEN_KEY, String(now));
  } catch {
    // ignore
  }
  if (doc) {
    const loc = doc.location ?? { hostname: "", protocol: "" };
    try {
      doc.cookie = `${FORGE_CLEAR_COOKIE}=${now}; ${forgeClearCookieAttrs(loc.hostname, loc.protocol)}`;
    } catch {
      // cookies blocked: this host is cleared; see the limit above
    }
  }
}

/**
 * On load: if another host marked a clear this host has not acted on, clear
 * this host's keys too. Returns whether it cleared.
 */
export function applyForgeClearMark(storage: Store | null = browserStore(), doc: CookieDoc | null = browserDoc()): boolean {
  if (!storage || !doc) return false;
  let mark = 0;
  try {
    mark = readForgeClearMark(doc.cookie);
  } catch {
    return false;
  }
  if (!mark) return false;
  let seen = 0;
  try {
    seen = Number(storage.getItem(FORGE_CLEAR_SEEN_KEY) || 0) || 0;
  } catch {
    return false;
  }
  if (mark <= seen) return false;
  clearForgeBrowserKeys(storage);
  try {
    storage.setItem(FORGE_CLEAR_SEEN_KEY, String(mark));
  } catch {
    // ignore
  }
  return true;
}
