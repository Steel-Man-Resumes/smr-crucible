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

/**
 * The question, worded as the Refinery asks it (lib/forge-carry.ts hotfix):
 * the run's own name is never shown (it may be the previous person's), and the
 * account it would go to is named on the button.
 */
export const IMPORT_QUESTION = "There's a resume in progress on this computer. Is it yours?";

export function importYesLabel(email: string | null | undefined): string {
  return email ? `Yes, save it to ${email}` : "Yes, save it to my account";
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

/*
 * NOTHING READS A RUN BEFORE ITS OWNER IS SETTLED (security review 3a r2, L1).
 * The Forge pages read the run through the Forge provider, which shows them
 * only this view: the run when it is this account's (or holds nothing yet),
 * and an empty run otherwise, until the person answers "Is it yours?". The
 * raw run is read only by the component that asks (ForgeImport). The same
 * rule as the Refinery's readOwnForgeSession (lib/forge-carry.ts), applied to
 * the Forge's in-memory copy.
 */
export type RunAuth =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "pending" }
  | { status: "authenticated"; userId: string };

export function forgeRunView(run: Record<string, any>, auth: RunAuth): { visible: Record<string, any>; mayUse: boolean } {
  const empty = { visible: {}, mayUse: false };
  const owner = typeof run?._ownerUserId === "string" ? run._ownerUserId : null;
  if (auth.status === "authenticated") {
    if (owner === auth.userId) return { visible: run, mayUse: true };
    if (!owner && !runHasAnswers(run) && run?.isDemo !== true) return { visible: run, mayUse: true };
    if (!owner && run?.isDemo === true) return { visible: run, mayUse: true }; // sample data, never saved
    return empty;
  }
  if (auth.status === "unauthenticated") {
    // Signed out (the Forge before the wall): the browser's own anonymous run.
    // A run marked for an account is that account's, and is being cleared.
    return owner ? empty : { visible: run, mayUse: true };
  }
  // Still loading, or half signed in: nothing that holds answers yet.
  return owner || runHasAnswers(run) ? empty : { visible: run, mayUse: false };
}

/**
 * A write made while this account is signed in, to a run that was empty or
 * already this account's, makes the run this account's: the person started
 * it here (the same rule as madeHere, at the moment of the write).
 */
export function stampOwnerOnWrite(prev: Record<string, any>, next: Record<string, any>, userId: string | null): Record<string, any> {
  if (!userId || next._ownerUserId || next.isDemo === true) return next;
  const prevOwner = prev?._ownerUserId;
  if (prevOwner === userId || (!prevOwner && !runHasAnswers(prev ?? {}))) return { ...next, _ownerUserId: userId };
  return next;
}

/**
 * May a Forge page send the run to the server (the build, the documents)?
 * Signed in: only when the stored run is this account's (readOwnForgeSession,
 * lib/forge-carry.ts), or sample data. Signed out: the browser's own
 * anonymous run (the Forge before the wall). Loading or half signed in: no.
 */
export function mayUseRunFor(
  auth: RunAuth,
  view: { mayUse: boolean; isDemo?: unknown },
  readOwn: (userId: string) => unknown
): boolean {
  if (auth.status === "authenticated") return !!readOwn(auth.userId) || (view.isDemo === true && view.mayUse);
  if (auth.status === "unauthenticated") return view.mayUse;
  return false;
}
