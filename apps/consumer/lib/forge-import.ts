/**
 * Saving the Forge run in this browser to the account that is signed in.
 *
 * Someone mid-Forge when the sign-in wall goes up has their whole run in this
 * browser only (localStorage "forge_session"). When they sign in, the run is
 * saved to their account through the existing save (/api/forge/save, which
 * calls saveForgeSession: a key that is absent never wipes saved data), so
 * nothing in progress is lost.
 *
 * A browser can be shared (a library, a program's lab), and a browser can be
 * signed in to an account its user did not choose (login CSRF), so a run is
 * never given to an account on a guess (security review 3a r1, H1 and M1):
 *  - THIS IS THE ONLY WAY a run in this browser enters an account. Account
 *    creation no longer carries the run (register ignores any run it is sent),
 *    and the Refinery's sync only saves runs already marked for its account.
 *  - a run marked for ANOTHER account is cleared from this browser (it is safe
 *    in that account), and so is any marked run once nobody is signed in;
 *  - a run with answers that this tab did not watch being made while this
 *    account was signed in is ASKED about, naming the account it would go to
 *    ("Save it to the account for you@example.com?"). No name match, no mark
 *    left by an earlier page, decides it;
 *  - a run this account started in this tab (the run was empty, or already
 *    this account's, the moment before it got answers) is this account's;
 *  - a demo run (sample data) is never saved to an account.
 *
 * Pure: the component (components/forge/ForgeImport.tsx) does the I/O.
 */

/**
 * How far a run has come. Saves happen when this goes up, so a person's
 * account gets the run when it first has a resume, and again when the Forge
 * finishes (the finished output), without a save on every page.
 *   0: no resume yet, 1: a resume (text or built), 2: finished output.
 */
export type RunLevel = 0 | 1 | 2;

export function runLevel(run: Record<string, any>): RunLevel {
  if (run.forgeOutput && typeof run.forgeOutput === "object") return 2;
  if ((typeof run.resumeText === "string" && run.resumeText.trim()) || (run.resumeDoc && typeof run.resumeDoc === "object")) return 1;
  return 0;
}

export type ImportAction =
  /** Nothing to do. */
  | { action: "none" }
  /** Mark the run as this account's (nothing worth saving yet). */
  | { action: "claim" }
  /** Save it to this account now. */
  | { action: "save"; level: RunLevel }
  /** Ask the person whether the run is theirs. */
  | { action: "ask"; level: RunLevel; name: string | null }
  /** The run belongs to another account: clear it from this browser. */
  | { action: "clear" };

export interface ImportUser {
  id: string;
  name?: string | null;
  email?: string | null;
}

/** The name the run carries, if any (from the parsed resume or the built one). Shown in the question, never trusted. */
export function runOwnerName(run: Record<string, any>): string | null {
  const n = run?.forgeOutput?.contact?.name || run?.resumeDoc?.contact?.name;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

/** True when the run holds anything the person told us (beyond where they clicked in). */
export function runHasAnswers(run: Record<string, any>): boolean {
  if (runLevel(run) > 0) return true;
  const filled = (v: unknown) =>
    v !== undefined &&
    v !== null &&
    !(typeof v === "string" && !v.trim()) &&
    !(Array.isArray(v) && v.length === 0) &&
    !(typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
  return [
    "readinessStage",
    "goals",
    "goalNarrative",
    "hookNarrative",
    "challenges",
    "criminalRecord",
    "challengeNarratives",
    "preferences",
    "carriedIn",
    "resumeWorries",
  ].some((k) => filled(run[k]));
}

export function importDecision(
  run: unknown,
  user: ImportUser | null,
  opts: {
    /**
     * The run as this tab last saw it, while this same account was signed in,
     * was empty or already this account's. A run that has answers now was
     * then made here, by this account.
     */
    madeHere?: boolean;
  } = {}
): ImportAction {
  if (!user || !user.id) return { action: "none" };
  if (!run || typeof run !== "object" || Array.isArray(run)) return { action: "none" };
  const r = run as Record<string, any>;
  // Sample data from a partner or observer walkthrough never enters an account.
  if (r.isDemo === true) return { action: "none" };

  const owner = typeof r._ownerUserId === "string" ? r._ownerUserId : null;
  if (owner && owner !== user.id) return { action: "clear" };

  const level = runLevel(r);
  if (owner === user.id) {
    const synced = typeof r._syncedLevel === "number" ? r._syncedLevel : 0;
    return level > synced ? { action: "save", level } : { action: "none" };
  }

  // Unclaimed from here on.
  if (!runHasAnswers(r)) return { action: "claim" };
  if (opts.madeHere === true) return { action: "claim" };
  return { action: "ask", level, name: runOwnerName(r) };
}

/**
 * What a browser with nobody signed in does with the run it holds: a run
 * marked for an account is that account's (saved there), and the next person
 * at this computer must not see it or carry it into another account.
 */
export function signedOutDecision(run: unknown): "clear" | "keep" {
  if (!run || typeof run !== "object" || Array.isArray(run)) return "keep";
  return typeof (run as Record<string, any>)._ownerUserId === "string" ? "clear" : "keep";
}

/** The question, naming the account the run would go to. */
export function importQuestion(email: string | null | undefined, name: string | null): string {
  const who = name ? ` for ${name}` : "";
  const where = email ? ` Save it to the account for ${email}?` : " Save it to the account you are signed in to?";
  return `This computer has a resume in progress${who}.${where}`;
}

/**
 * The fields the account save carries (persistForgeSession / saveForgeSession).
 * Only these are sent. The original upload text (originalResumeText) and the
 * finish page's own state (forgeFinish) are not part of the save contract:
 * they stay in this browser, as before.
 */
export const IMPORT_FIELDS = [
  "readinessStage",
  "resumeText",
  "resumeMethod",
  "resumeDoc",
  "goals",
  "goalNarrative",
  "challenges",
  "criminalRecord",
  "challengeNarratives",
  "preferences",
  "forgeOutput",
  "audience",
  "pagesVisited",
  "startedAt",
] as const;

/** The request body for /api/forge/save. A field the run does not have is left out, never sent empty. */
export function importPayload(run: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of IMPORT_FIELDS) {
    if (run[k] !== undefined && run[k] !== null) out[k] = run[k];
  }
  return out;
}

/** What to write back onto the run after a save succeeded. */
export function afterSave(run: Record<string, any>, userId: string, level: RunLevel): Record<string, unknown> {
  const marks: Record<string, unknown> = { _ownerUserId: userId, _syncedLevel: level };
  // Finished and saved: the Refinery's own sync has nothing left to send for
  // this run. Earlier levels leave those marks alone, so the Refinery still
  // saves the run once it is finished.
  if (level === 2) {
    marks._synced = true;
    marks._syncedAt = run.startedAt || "unknown";
  }
  return marks;
}

/** Same key the Refinery's sync reads (RefineryShell.tsx). */
export const LAST_SYNCED_RUN_KEY = "forge_last_synced_run";
