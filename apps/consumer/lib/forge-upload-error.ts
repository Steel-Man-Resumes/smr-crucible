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
