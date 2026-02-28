export { auth as middleware } from "./auth";

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
  ],
  // The Forge flow (/, /welcome, /resume, /goals, /story, /preferences,
  // /processing, /output) is intentionally NOT protected.
  // No login wall before value delivery.
  // Forge routes (/api/analyze, /api/parse) stay unprotected (IP-rate-limited).
  // /api/assistant uses dual-mode: IP pre-auth, user post-auth.
};
