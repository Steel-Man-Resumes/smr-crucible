/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@crucible/core", "@crucible/consumer-ui"],
  // The assistant route reads skill/doctrine .md files at runtime via fs. They
  // are NOT imported anywhere, so Next's file tracer has no static reference and
  // will not bundle them into the serverless function -- t.ROY then silently
  // loads zero doctrine in production (it works in local dev only because cwd
  // happens to have the files). Force them into the Lambda. See lib/skills/.
  experimental: {
    outputFileTracingIncludes: {
      // Every route that reads skill doctrine off disk needs the files traced
      // into ITS own Lambda. Keep in sync with the callers of loadSkillsForContext.
      "/api/assistant": ["./lib/skills/**/*"],
      "/api/coach": ["./lib/skills/**/*"],
      "/api/health/skills": ["./lib/skills/**/*"],
    },
  },
  webpack: (config) => {
    // Worker-only deps in @crucible/core — not used by consumer app
    // tesseract.js not installed — handled gracefully at runtime
    config.externals = [
      ...(config.externals || []),
      "tesseract.js",
    ];
    return config;
  },
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "host", value: "forge.steelmanresumes.com" }],
        destination: "/intro",
        permanent: false,
      },
      {
        source: "/",
        has: [{ type: "host", value: "refinery.steelmanresumes.com" }],
        destination: "/login",
        permanent: false,
      },
      {
        // Renamed 2026-06-09: "Resume Builder" -> "Application Tailor".
        // Keeps old deep-links (saved-artifact ?id=, bookmarks) alive. Next
        // forwards the query string to the destination automatically.
        source: "/dashboard/resume-builder",
        destination: "/dashboard/application-tailor",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        // Prevent browser caching of dashboard pages (back-button after signout)
        source: "/dashboard/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "0" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.openai.com https://api.anthropic.com; media-src 'self' blob:; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
