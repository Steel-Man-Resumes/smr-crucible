/**
 * Is this request from a page on this same site (origin)?
 *
 * For POST routes that write to the signed-in person's account from a browser
 * fetch. The session cookie is SameSite=Lax and, in production, scoped to
 * .steelmanresumes.com so the marketing site can see that someone is signed
 * in. Lax stops other SITES, but every steelmanresumes.com host is the same
 * site, so a page on any of them could otherwise post to these routes with
 * the person's cookie. This check refuses anything but this exact origin.
 *
 *  - Sec-Fetch-Site (every current browser sends it): must be "same-origin".
 *  - Otherwise Origin, when present: its host must be this request's host.
 *  - Neither header: not a browser fetch (a browser always sends one of them
 *    on a cross-origin POST), so it carries no one else's cookie; allowed.
 * And the body must be JSON: a plain HTML form cannot send that content type,
 * and a cross-origin fetch that sets it needs a preflight we never answer.
 *
 * Pure (reads only the headers it is given). Edge-safe.
 */
export function isSameOriginJsonPost(headers: Headers): boolean {
  const type = (headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("application/json")) return false;

  const site = headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";

  const origin = headers.get("origin");
  if (origin === null) return true;
  const host = (headers.get("x-forwarded-host") || headers.get("host") || "").split(",")[0].trim().toLowerCase();
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}
