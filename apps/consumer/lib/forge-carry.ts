/**
 * Shared-computer rule (hotfix 2026-10-07): a Forge run left in a browser is
 * never copied into, or shown inside, an account without the person's yes.
 *
 * The anonymous Forge keeps its run in localStorage (`forge_session`). On a
 * library or reentry-center computer that run may belong to the previous
 * person. Before this fix:
 *  - the create-account form sent it and /api/auth/register saved it into the
 *    new account;
 *  - the Refinery shell silently claimed it on a loose name match;
 *  - Refinery screens read it directly, even when ownership was unknown.
 *
 * Now:
 *  - Sign-up: the form asks a required yes/no with nothing preselected. Only
 *    "Yes" sends the run, and the route saves it only with
 *    `saveForgeRun: true`. "No" erases it from this computer.
 *  - Refinery: an unowned run gets one "Is it yours?" card. Only "Yes" saves it
 *    and marks it owned (`_ownerUserId`). "No" erases it.
 *  - Every Refinery screen (and the Settings export) reads the run through
 *    `readOwnForgeSession(uid)`, which returns null unless the run is marked
 *    as this user's. The only other readers are the Forge itself
 *    (lib/forge-context.tsx) and the two places that must see an unowned run
 *    to ask about it (`readLocalForgeRunRaw`): the sign-up form and the
 *    Refinery shell. A guard test fails on any new mention of the key.
 *  - A run already marked with an owner is never offered to a new account.
 *  - An unowned run idle past the Forge's 24-hour limit is erased, never offered.
 *
 * No imports on purpose: the login page (client), the Refinery shell (client)
 * and the register route (server) all use this file.
 */

/** localStorage key of the anonymous Forge run. */
export const FORGE_SESSION_KEY = "forge_session";

/** localStorage key of the last run this browser synced (RefineryShell run boundary). */
export const FORGE_LAST_SYNCED_RUN_KEY = "forge_last_synced_run";

/** Largest Forge run register will save (UTF-8 bytes of its JSON). Same cap as /api/forge/save. */
export const MAX_FORGE_RUN_BYTES = 1_000_000;

/** Largest register request body, measured on what actually arrived. */
export const MAX_REGISTER_BODY_BYTES = 1_500_000;

/** Same idle limit as the Forge (lib/forge-context.tsx FORGE_SESSION_MAX_IDLE_MS). */
export const FORGE_RUN_MAX_IDLE_MS = 24 * 60 * 60 * 1000;

/** The sign-up form's yes/no about a run on this computer. Nothing is preselected. */
export type ForgeRunChoice = "yes" | "no" | null;
export const FORGE_RUN_CHOICE_DEFAULT: ForgeRunChoice = null;

type ForgeRun = Record<string, any>;
type ReadStore = Pick<Storage, "getItem">;
type WriteStore = Pick<Storage, "removeItem">;

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function asRun(v: unknown): ForgeRun | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as ForgeRun) : null;
}

function parseRun(raw: string | null): ForgeRun | null {
  if (!raw) return null;
  try {
    return asRun(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Is there work worth saving? The same test register has always applied. */
export function forgeRunHasWork(v: unknown): boolean {
  const run = asRun(v);
  return !!run && !!(run.forgeOutput || run.resumeText);
}

/** Past the Forge's idle limit? A run with no `_savedAt` stamp counts as expired, as in the Forge. */
export function forgeRunExpired(v: unknown, now: number = Date.now()): boolean {
  const savedAt = asRun(v)?._savedAt;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return true;
  return now - savedAt > FORGE_RUN_MAX_IDLE_MS;
}

/**
 * THE accessor for Refinery screens. Returns the local Forge run only when it
 * is marked as owned by this signed-in user; null otherwise (no user yet, no
 * run, unowned, someone else's). Never read `forge_session` directly outside
 * this file and the Forge.
 */
export function readOwnForgeSession(
  userId: string | null | undefined,
  storage: ReadStore | null = browserStorage()
): ForgeRun | null {
  if (!userId || !storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(FORGE_SESSION_KEY);
  } catch {
    return null;
  }
  const run = parseRun(raw);
  return run && run._ownerUserId === userId ? run : null;
}

/**
 * Raw read for the two places that must see an UNOWNED run in order to ask
 * about it: the sign-up form and the Refinery shell's "Is it yours?" check.
 * Nothing else may use this.
 */
export function readLocalForgeRunRaw(storage: ReadStore | null = browserStorage()): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(FORGE_SESSION_KEY);
  } catch {
    return null;
  }
}

/**
 * Settings "Export my data": the local run for the download, only when it is
 * this user's. Spread into the export's `localDevice` block.
 */
export function ownForgeRunExportEntry(
  userId: string | null | undefined,
  storage: ReadStore | null = browserStorage()
): Record<string, ForgeRun> {
  const run = readOwnForgeSession(userId, storage);
  return run ? { [FORGE_SESSION_KEY]: run } : {};
}

/** Erase the local run and its sync boundary (the "No, erase it" answer). */
export function eraseLocalForgeRun(storage: WriteStore | null = browserStorage()): void {
  if (!storage) return;
  for (const k of [FORGE_SESSION_KEY, FORGE_LAST_SYNCED_RUN_KEY]) {
    try {
      storage.removeItem(k);
    } catch {
      // ignore
    }
  }
}

/** Sign-up form: the run to ask about, or null (no run, no work, expired, or already owned by an account). */
export function readStoredForgeRun(
  stored: string | null,
  now: number = Date.now()
): ForgeRun | null {
  const run = parseRun(stored);
  if (!run || run._ownerUserId || !forgeRunHasWork(run) || forgeRunExpired(run, now)) return null;
  return run;
}

/**
 * Sign-up form: should the run in storage be erased instead of offered? True
 * for a run already marked with an owner (it is saved in that account; it is
 * never another person's to take) and for an unowned run with work that is
 * past the idle limit.
 */
export function forgeRunToEraseAtSignup(stored: string | null, now: number = Date.now()): boolean {
  const run = parseRun(stored);
  if (!run) return false;
  if (run._ownerUserId) return true;
  return forgeRunHasWork(run) && forgeRunExpired(run, now);
}

/**
 * Identity of a run's content, ignoring bookkeeping (`_savedAt`, `_synced`,
 * owner marks): the Refinery card saves only the run it asked about.
 */
export function forgeRunFingerprint(stored: string | null): string | null {
  const run = parseRun(stored);
  if (!run) return null;
  const keys = Object.keys(run).filter((k) => !k.startsWith("_")).sort();
  return JSON.stringify(keys.map((k) => [k, run[k]]));
}

/** Sign-up form: may the person submit? A run on this computer needs a yes or a no. */
export function forgeChoiceComplete(runOffered: boolean, choice: ForgeRunChoice): boolean {
  return !runOffered || choice === "yes" || choice === "no";
}

/** Client: the Forge fields for the register body. Nothing unless the answer is "yes". */
export function forgeRegisterFields(
  run: unknown,
  choice: ForgeRunChoice
): { forge?: ForgeRun; saveForgeRun?: true } {
  if (choice !== "yes" || !forgeRunHasWork(run)) return {};
  return { forge: run as ForgeRun, saveForgeRun: true };
}

/** Sign-up form, after the account exists: what to do with the local run. */
export function forgeAfterSignup(
  runOffered: boolean,
  choice: ForgeRunChoice
): "erase" | "mark-owned" | "leave" {
  if (!runOffered) return "leave";
  return choice === "yes" ? "mark-owned" : "erase";
}

/**
 * Mark a run as owned by `userId` (the person said "Yes"). Deliberately not
 * marked synced: the Refinery shell then re-saves it once through
 * /api/forge/save, which repairs a best-effort register save that failed.
 */
export function markForgeRunOwned(run: ForgeRun, userId: string): ForgeRun {
  return { ...run, _ownerUserId: userId };
}

/**
 * Refinery shell: what to do with the local run for the signed-in user.
 *  - "none":   nothing to do (no user yet, no run, a fresh unowned run with no
 *              work, or sample data, which is never saved or asked about)
 *  - "purge":  marked as another account's run; remove it
 *  - "erase":  unowned and past the idle limit, with or without work; remove
 *              it, never offer it
 *  - "ask":    unowned with work; show "Is it yours?" and do NOT save or show it
 *  - "owned":  this user's run; the normal sync applies
 * There is no silent claim: an unowned run is never "owned" here, whatever its name.
 */
export type ForgeSyncDecision = "none" | "purge" | "erase" | "ask" | "owned";

export function forgeSyncDecision(
  stored: string | null,
  userId: string | null | undefined,
  now: number = Date.now()
): ForgeSyncDecision {
  if (!userId) return "none";
  const run = parseRun(stored);
  if (!run) return "none";
  if (run._ownerUserId) {
    if (run._ownerUserId !== userId) return "purge";
    // Sample data is never saved to an account, even this account's own demo.
    return run.isDemo === true ? "none" : "owned";
  }
  // Unowned and past the idle limit: erased whether or not it has a resume
  // yet. A half-done run (record answers, no resume) is still the previous
  // person's (review R3).
  if (forgeRunExpired(run, now)) return "erase";
  if (!forgeRunHasWork(run) || run.isDemo === true) return "none";
  return "ask";
}

export type ForgeRunDecision =
  | { ok: true; run: ForgeRun | null }
  | { ok: false; reason: "too_large" };

/**
 * Server: the run register may persist. `run` is null unless the body says
 * `saveForgeRun: true` AND carries a run with work in it. Never logs or
 * returns anything about the run's contents.
 */
export function forgeRunToPersist(body: unknown): ForgeRunDecision {
  const b = asRun(body);
  if (!b || b.saveForgeRun !== true || !forgeRunHasWork(b.forge)) {
    return { ok: true, run: null };
  }
  const bytes = new TextEncoder().encode(JSON.stringify(b.forge)).length;
  if (bytes > MAX_FORGE_RUN_BYTES) return { ok: false, reason: "too_large" };
  return { ok: true, run: b.forge as ForgeRun };
}
