/** Limits on saved revisions (Phase 5 R1). Pure, so tests and pages can read them. */

/**
 * Saves per account per day (review L6). A finish page saves each distinct
 * change after a short pause, so a real session makes tens; this stops a loop
 * or a script from filling storage. Each artifact also keeps at most 50
 * revisions (core REVISION_KEEP_PER_ARTIFACT; the newest finished one always).
 */
export const REVISION_SAVES_PER_DAY = 200;

/** The plain words for a version too big to store (review L8): not a retry. */
export const REVISION_TOO_LARGE =
  "This version is too big to save to your account. Shorten your longest answers or the text you pasted, and it will save. Your work is still on this page.";
