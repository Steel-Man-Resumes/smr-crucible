import { auth } from "./auth";
import { NextResponse } from "next/server";

// Wrap auth middleware with hostname-based routing
export default auth((req) => {
  const hostname = req.headers.get("host") || "";
  const pathname = req.nextUrl.pathname;

  // Hostname-based routing for domain swap
  if (pathname === "/") {
    if (hostname.includes("forge.steelmanresumes.com")) {
      return NextResponse.redirect(new URL("/intro", req.url));
    }
    if (hostname.includes("refinery.steelmanresumes.com")) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
  }

  // For protected routes, check auth (req.auth is populated by the wrapper)
  if (!req.auth && isProtectedRoute(pathname)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

function isProtectedRoute(pathname: string): boolean {
  const protectedPrefixes = [
    "/dashboard",
    "/resume-builder",
    "/disclosure",
    "/interview",
    "/jobs",
    "/resources",
    "/progress",
    "/api/dashboard",
    "/api/disclosure-guide",
    "/api/interview-practice",
    "/api/job-search",
    "/api/resources-search",
    "/api/resume-generate",
    "/api/access-code",
    "/api/usage",
    "/api/artifacts",
  ];

  return protectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  );
}

export const config = {
  matcher: [
    // Root path for hostname routing
    "/",
    // Protect dashboard and API routes (except auth endpoints and assistant)
    "/dashboard/:path*",
    "/resume-builder/:path*",
    "/disclosure/:path*",
    "/interview/:path*",
    "/jobs/:path*",
    "/resources/:path*",
    "/progress/:path*",
    // API routes that require auth (not forge-related)
    "/api/dashboard/:path*",
    // Refinery AI endpoints (user-rate-limited, require auth)
    "/api/disclosure-guide",
    "/api/interview-practice",
    "/api/job-search",
    "/api/resources-search",
    "/api/resume-generate",
    // Access code management
    "/api/access-code/:path*",
    "/api/usage",
    // Artifact persistence (requires auth)
    "/api/artifacts/:path*",
  ],
  // The Forge flow (/welcome, /resume, /goals, /story, /preferences,
  // /processing, /output) is intentionally NOT protected.
  // No login wall before value delivery.
  // Forge routes (/api/analyze, /api/parse, /api/forge/*) stay unprotected (IP-rate-limited).
  // /api/assistant uses dual-mode: IP pre-auth, user post-auth.
};
