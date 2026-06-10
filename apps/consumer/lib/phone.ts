/**
 * Phone formatting -- ONE choke point for how phone numbers render anywhere a
 * human or employer sees them (profile, tailored documents, exports).
 *
 * Users type phones every way imaginable ("2623918137", "262.391.8137",
 * "+1 262 391 8137"). Documents must never ship a raw digit string -- it reads
 * unprofessional on exactly the artifact that has to read professional
 * (identity-desync finding, Fable analysis 2026-06-10).
 */

/** Format a US phone for display: 10 digits -> "(262) 391-8137".
 *  11 digits with leading 1 -> same. Anything else returns the trimmed input
 *  unchanged (international or partial numbers are the user's call). */
export function formatPhoneUS(raw: string | null | undefined): string {
  const input = (raw || "").trim();
  if (!input) return "";
  const digits = input.replace(/\D/g, "");
  const ten =
    digits.length === 10
      ? digits
      : digits.length === 11 && digits.startsWith("1")
        ? digits.slice(1)
        : null;
  if (!ten) return input;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}
