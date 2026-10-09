/**
 * Is this request from a page on one of this app's own origins?
 *
 * For POST routes that write to the signed-in person's account from a browser
 * fetch. The session cookie is SameSite=Lax and, in production, scoped to
 * .steelmanresumes.com so the marketing site can see that someone is signed
 * in. Lax stops other SITES, but every steelmanresumes.com host is the same
 * site, so a page on any of them could otherwise post to these routes with
 * the person's cookie. This check refuses anything but this app's origins.
 *
 *  - Sec-Fetch-Site (every current browser sends it): must be "same-origin".
 *  - Otherwise Origin, when present: it must be one of the app's configured
 *    origins (appOrigins). It is never compared with the request's own Host or
 *    X-Forwarded-Host, which the sender controls (security review 3a r1, L3).
 *  - Neither header: not a browser fetch (a browser always sends one of them
 *    on a cross-origin POST), so it carries no one else's cookie; allowed.
 * And the body must be JSON: a plain HTML form cannot send that content type,
 * and a cross-origin fetch that sets it needs a preflight we never answer.
 *
 * Pure apart from reading the configured origins from the environment.
 */

/** The production hosts this app answers on. */
export const APP_PRODUCTION_ORIGINS = [
  "https://forge.steelmanresumes.com",
  "https://refinery.steelmanresumes.com",
];

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).origin;
  } catch {
    return null;
  }
}

/** This app's origins: the production hosts, the configured auth URL, this deployment's own URL, and localhost in development. */
export function appOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const out = new Set(APP_PRODUCTION_ORIGINS);
  for (const v of [env.AUTH_URL, env.NEXTAUTH_URL, env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
    const o = originOf(v);
    if (o) out.add(o);
  }
  return Array.from(out);
}

function isLocalDev(origin: string, env: Record<string, string | undefined>): boolean {
  if (env.NODE_ENV !== "development") return false;
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export function isSameOriginJsonPost(
  headers: Headers,
  env: Record<string, string | undefined> = process.env
): boolean {
  const type = (headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("application/json")) return false;
  return isSameOriginRequest(headers, env);
}

/**
 * The origin half of isSameOriginJsonPost, for a write that carries no body
 * (a DELETE). Same rules: Sec-Fetch-Site must be "same-origin"; otherwise an
 * Origin, when present, must be one of the app's own.
 */
export function isSameOriginRequest(
  headers: Headers,
  env: Record<string, string | undefined> = process.env
): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";

  const origin = headers.get("origin");
  if (origin === null) return true;
  let o: string;
  try {
    o = new URL(origin).origin;
  } catch {
    return false;
  }
  return appOrigins(env).includes(o) || isLocalDev(o, env);
}
