/**
 * Cover letter closings (2026-09-28). One fixed closing rule made every letter
 * end the same way ("I'd like to talk... Thanks for reading."), so a hiring
 * manager who gets letters from several people in one program sees the same
 * template with the names swapped. Each letter now gets one closing style,
 * picked from the person's own details. The same person always gets the same
 * style; different people spread across all of them.
 */

export const LETTER_CLOSING_STYLES = [
  "End with one plain sentence asking for a short call or a meeting. No thank-you line.",
  "End with one sentence about the first thing they want to do in this role, then one short sentence asking to talk.",
  "End by saying they would be glad to show the work in person, then stop.",
  "End with a thank-you that names the role, in one short sentence, then stop.",
  "End by asking one plain question about the job or the team, then stop.",
] as const;

/** Stable 32-bit FNV-1a hash, so the pick does not change between deploys. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function letterClosingStyle(seed: string): string {
  const key = seed.trim().toLowerCase();
  return LETTER_CLOSING_STYLES[hashSeed(key) % LETTER_CLOSING_STYLES.length];
}
