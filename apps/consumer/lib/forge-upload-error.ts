/**
 * The message the Forge upload shows when /api/parse refuses a file.
 *
 * A 401 never means the file was bad: the Forge needs no sign-in, so a 401
 * comes from a sign-in this browser still carries (revoked, or one that never
 * finished). Say so plainly instead of passing the sign-in error through as if
 * the file had failed.
 */
export const FORGE_UPLOAD_SIGN_IN_MESSAGE =
  "Your file is fine. This browser still has an old or unfinished sign-in, and it stopped the upload. Sign in again or sign out, then try your file one more time.";

export function forgeUploadErrorMessage(status: number, error: unknown): string {
  if (status === 401) return FORGE_UPLOAD_SIGN_IN_MESSAGE;
  return typeof error === "string" && error ? error : "Something went wrong. Try again?";
}

/* ---------------------------------------------------------------- FU1 -- */

/**
 * Where the upload comes back to after a sign-in step: the file step, with a
 * marker that asks the person to pick the file again. A browser cannot carry
 * a chosen file across a page change, and keeping a copy of a resume in the
 * browser's storage on what may be a shared computer is worse than asking
 * once more. Nothing about the file is stored.
 */
export const FORGE_UPLOAD_RETURN_PATH = "/resume?upload=again";

/** What the file step says when the person comes back from that step. */
export const FORGE_UPLOAD_PICK_AGAIN_MESSAGE =
  "You're back. Pick your file again and it will upload. Browsers can't hold on to a file while you sign in.";

export type ForgeUploadAuthAction =
  | { kind: "go"; url: string }
  | { kind: "message"; message: string };

/**
 * FU1 (Troy's walk, 2026-10-05): a 401 on upload from a half-finished
 * sign-in sends the person to the step it is waiting on, and back to the file
 * step afterwards. The server says which step in the 401 body (auth.ts):
 *   mfaRequired     the two-step code (or the first-proof password choice)
 *   termsRequired   the one-tap terms page
 *   signInRequired  the Forge sign-in (once the wall is up)
 * Anything else (a revoked session) keeps the plain message, which already
 * says what to do. Pure, so the page and the tests share it.
 */
export function forgeUploadAuthAction(status: number, body: unknown, returnPath: string = FORGE_UPLOAD_RETURN_PATH): ForgeUploadAuthAction | null {
  if (status !== 401) return null;
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const back = encodeURIComponent(returnPath);
  if (b.mfaRequired === true) return { kind: "go", url: `/login/verify?callbackUrl=${back}` };
  if (b.termsRequired === true) return { kind: "go", url: `/login/terms?callbackUrl=${back}` };
  if (b.signInRequired === true) return { kind: "go", url: `/login?from=forge&callbackUrl=${back}` };
  return { kind: "message", message: FORGE_UPLOAD_SIGN_IN_MESSAGE };
}

/** True when the file step was opened on the way back from a sign-in step. */
export function isUploadReturn(search: string): boolean {
  try {
    return new URLSearchParams(search).get("upload") === "again";
  } catch {
    return false;
  }
}
