/**
 * One password rule for every place a password is chosen: create account,
 * reset by email link, and set or change in Settings (F9). Before this,
 * register and reset accepted 8 characters of anything while Settings asked for
 * 10 with a letter and a number, so the weakest door set the real floor.
 *
 * Length beats composition rules for real security (NIST), but a floor plus
 * one number keeps out the truly weak, and a short blocklist stops the obvious
 * ones. Pure (no imports): the server routes and the forms share it, so the
 * form says exactly what the server will say.
 */
export const PASSWORD_MIN_LENGTH = 10;

const COMMON = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwertyuiop", "letmein123", "iloveyou1", "welcome123", "steelman1", "changeme1",
  "password12", "password1234", "qwerty1234", "abc1234567", "1q2w3e4r5t",
]);

/** Plain hint for a password field. */
export const PASSWORD_HINT = `${PASSWORD_MIN_LENGTH}+ characters, with a letter and a number`;

/** What is wrong with a password, in plain words, or null when it is fine. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN_LENGTH)
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (pw.length > 200) return "Use 200 characters or fewer.";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw))
    return "Include at least one letter and one number.";
  if (COMMON.has(pw.toLowerCase()))
    return "That password is too common. Pick something only you would know.";
  return null;
}
