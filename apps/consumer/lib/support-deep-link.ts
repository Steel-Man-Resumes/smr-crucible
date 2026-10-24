/**
 * The deep link into Local help (/dashboard/resources?category=education),
 * used by What comes next. Pure so the rules are tested without a browser.
 */

/** The category a link asks for, only if the search offers it. "all" and unknown words are ignored. */
export function deepLinkCategory(search: string, offered: readonly string[]): string | null {
  let wanted: string | null = null;
  try { wanted = new URLSearchParams(search).get("category"); } catch { return null; }
  return wanted && wanted !== "all" && offered.includes(wanted) ? wanted : null;
}

/**
 * The place a deep-linked search runs with: the saved place only (the one the
 * page hands in), never text the person is typing. Null means wait.
 */
export function deepLinkSearchPlace(pending: boolean, savedPlace: string | null | undefined): string | null {
  if (!pending) return null;
  const place = (savedPlace ?? "").trim();
  return place || null;
}

/**
 * The place Local help fills in, in the order the resources page uses: this
 * person's own Forge run on this device, then the account's city and state.
 */
export function savedSearchPlace(forgeLocation: string | null | undefined, profile: { city?: unknown; state?: unknown } | null | undefined): string {
  const fromForge = typeof forgeLocation === "string" ? forgeLocation.trim() : "";
  if (fromForge) return fromForge;
  return [profile?.city, profile?.state].filter((v): v is string => typeof v === "string" && !!v.trim()).join(", ");
}
