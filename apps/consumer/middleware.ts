import { auth } from "./auth";
import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

/**
 * Middleware = next-auth gate + developer-impersonation write blocking.
 *
 * When a "view"-mode impersonation cookie is present (blue read-only session),
 * every non-GET API request is rejected HERE, at the edge, before any route
 * runs -- read-only is enforced, not promised. Assist mode (red) passes writes
 * through. Invalid/forged cookies are ignored (effectiveAuth also re-verifies).
 */
export default auth(async (req) => {
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
    // All API routes pass through so view-mode write blocking is universal.
    // The authorized() callback still decides auth per-path exactly as before
    // (pre-auth Forge routes remain open -- it returns true for them).
    "/api/:path*",
  ],
  // The Forge flow (/welcome, /resume, /goals, /story, /preferences,
  // /processing, /output) is intentionally NOT protected.
  // No login wall before value delivery.
  // /api/assistant uses dual-mode: IP pre-auth, user post-auth.
  // Hostname routing (forge/refinery subdomains) handled in next.config.mjs redirects.
};
