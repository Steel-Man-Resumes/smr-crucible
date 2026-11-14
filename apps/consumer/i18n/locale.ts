/**
 * Site language (Spanish version, 2026-11-12). Pure: no I/O, safe in tests,
 * the browser and the edge.
 *
 * One setting for the whole product, English or Spanish. Where it lives:
 * - a cookie (LANG_COOKIE) for everyone, signed in or not, shared across
 *   *.steelmanresumes.com in production (see langCookieDomain); the Forge
 *   works without an account, so the cookie is the runtime truth;
 * - users.coach_language for the account, so the choice follows a person to
 *   another browser. A signed-in person who uses a switch writes both.
 * Precedence when rendering: the cookie, else the account (adopted into the
 * cookie once after sign-in, only when no cookie was set), else English.
 * Nothing is ever forced from the browser's Accept-Language header.
 *
 * Only values on the allowlist are ever honored; anything else is English.
 */

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LANG_COOKIE = "smr_lang";
/** One year, in seconds. */
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The cookie's Domain attribute. In production the choice is shared across
 * every steelmanresumes.com host (forge, refinery, the marketing site), the
 * same scope the session cookie already has, so one tap holds everywhere. The
 * value is only "en" or "es"; it never decides anything about identity.
 * Elsewhere (Vercel previews on *.vercel.app, localhost) it stays host-scoped,
 * because a browser drops a cookie whose Domain is not the page's own.
 */
export const LANG_COOKIE_SHARED_DOMAIN = ".steelmanresumes.com";

export function langCookieDomain(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.NODE_ENV === "production" && env.VERCEL_ENV === "production" ? LANG_COOKIE_SHARED_DOMAIN : undefined;
}

/** The language names, each in its own language (never translated). */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", es: "Español" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The locale a cookie value stands for: allowlisted, else the default. */
export function resolveLocale(cookieValue: string | null | undefined): Locale {
  return isLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;
}

/** The raw cookie value from a Cookie header (API routes read requests, not next/headers). */
export function langCookieValue(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === LANG_COOKIE) return v.join("=");
  }
  return null;
}

/** The locale an API request should answer in. */
export function localeFromCookieHeader(cookieHeader: string | null | undefined): Locale {
  return resolveLocale(langCookieValue(cookieHeader));
}

/**
 * A suggestion from the browser's language, for a one-time offer only. Never
 * used to pick the language on its own.
 */
export function suggestedLocale(acceptLanguage: string | null | undefined): Locale | null {
  if (!acceptLanguage) return null;
  const first = acceptLanguage.split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("es")) return "es";
  if (first.startsWith("en")) return "en";
  return null;
}

/** The value for <html lang>. */
export function htmlLang(locale: Locale): "en" | "es" {
  return locale;
}
