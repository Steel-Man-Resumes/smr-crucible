import { auth, isSessionRevoked } from "./auth";
import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { forgeAnonymousRequestHeaders, headersWithoutSessionCookie, revocationCheck } from "@/lib/session-policy";
import { forgeWallState } from "@/lib/forge-access";
import { emailCallbackNeedsButton, interstitialUrlFor } from "@/lib/sign-in-link";

/**
 * Middleware = next-auth gate + developer-impersonation write blocking.
 *
 * When a "view"-mode impersonation cookie is present (blue read-only session),
 * every non-GET API request is rejected HERE, at the edge, before any route
 * runs -- read-only is enforced, not promised. Assist mode (red) passes writes
 * through. Invalid/forged cookies are ignored (effectiveAuth also re-verifies).
 */
export default auth(async (req) => {
  // Login CSRF: an email sign-in link reaches the callback only through our
  // own "Finish signing in" button (lib/sign-in-link.ts).
  if (emailCallbackNeedsButton(req.nextUrl.pathname, req.method, req.headers.get("sec-fetch-site"))) {
    return NextResponse.redirect(interstitialUrlFor(req.nextUrl.toString()), 303);
  }

  const token = req.cookies.get("smr_impersonate")?.value;
  if (
    token &&
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.nextUrl.pathname.startsWith("/api/") &&
    !req.nextUrl.pathname.startsWith("/api/auth") &&
    req.nextUrl.pathname !== "/api/dev/impersonate"
  ) {
    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(process.env.AUTH_SECRET || "")
      );
      if (payload.mode === "view") {
        return NextResponse.json(
          {
            error:
              "Read-only view session -- changes are blocked. Switch to assist mode to make changes.",
          },
          { status: 403 }
        );
      }
    } catch {
      /* invalid cookie: ignore, downstream auth decides */
    }
  }

  // A session still owing its two-step code (or first-proof choice) reaching a
  // Forge route that works signed out: the route runs as if signed out. The
  // session cookie is removed from the request the route sees (the browser
  // keeps it), so nothing is read from or attributed to that account.
  const anonymousHeaders = forgeAnonymousRequestHeaders(
    req.nextUrl.pathname,
    req.auth?.user as any,
    req.headers,
    forgeWallState() === "up"
  );
  if (anonymousHeaders) {
    return NextResponse.next({ request: { headers: anonymousHeaders } });
  }

  // A revoked session on a route that works signed out (the free checker,
  // t.ROY's public chat): served as signed out, never refused (L2).
  const user = req.auth?.user as { id?: string; sid?: string; sit?: unknown } | undefined;
  if (user?.sid && revocationCheck(req.nextUrl.pathname) === "as-open") {
    if (await isSessionRevoked(user.sid, user.id, user.sit)) {
      return NextResponse.next({ request: { headers: headersWithoutSessionCookie(req.headers) } });
    }
  }
});

export const config = {
  matcher: [
    // Protect dashboard and API routes (except auth endpoints and assistant)
    "/dashboard/:path*",
    "/resume-builder/:path*",
    "/disclosure/:path*",
    "/interview/:path*",
    "/jobs/:path*",
    "/resources/:path*",
    "/progress/:path*",
    // The Forge question and build screens (FORGE_SIGN_IN_PAGES in
    // lib/forge-access.ts; a test keeps the two lists equal). They need a
    // session only once the wall is up; before that authorized() lets them
    // through untouched. Exact paths: the public Forge pages, the free checker
    // and every /mini-forge path are never matched.
    "/welcome",
    "/resume",
    "/goals",
    "/story",
    "/preferences",
    "/processing",
    "/output",
    "/rush",
    "/carry",
    // All API routes pass through so view-mode write blocking is universal.
    // The authorized() callback still decides auth per-path exactly as before
    // (pre-auth Forge routes remain open -- it returns true for them).
    "/api/:path*",
  ],
  // The Forge flow is walled by date (lib/forge-access.ts): before the date it
  // works signed out as it always has; after it, sign-in first.
  // /api/assistant uses dual-mode: IP pre-auth, user post-auth.
  // Hostname routing (forge/refinery subdomains) handled in next.config.mjs redirects.
};
