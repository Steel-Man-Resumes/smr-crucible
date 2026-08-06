/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@crucible/core", "@crucible/consumer-ui"],
  // The assistant route reads skill/doctrine .md files at runtime via fs. They
  // are NOT imported anywhere, so Next's file tracer has no static reference and
  // will not bundle them into the serverless function -- t.ROY then silently
  // loads zero doctrine in production (it works in local dev only because cwd
  // happens to have the files). Force them into the Lambda. See lib/skills/.
  experimental: {
    // pdfjs (used by lib/text-extraction for PDF text extraction) MUST stay
    // external: when Next bundles it into a serverless chunk, its runtime dynamic
    // import of pdf.worker.mjs points at a chunk path that is never emitted, so
    // "Setting up fake worker failed: Cannot find module .../pdf.worker.mjs" and
    // EVERY text PDF fails on Vercel (works in local dev only). Externalizing
    // loads it from node_modules with the worker intact. (F1, Next 14 key.)
    serverComponentsExternalPackages: ["pdfjs-dist"],
    outputFileTracingIncludes: {
      // Every route that reads skill doctrine off disk needs the files traced
      // into ITS own Lambda. Keep in sync with the callers of loadSkillsForContext.
      "/api/assistant": ["./lib/skills/**/*"],
      "/api/coach": ["./lib/skills/**/*"],
      "/api/health/skills": ["./lib/skills/**/*"],
      // /api/parse uses dynamic OCR imports for photos/scanned PDFs. Keep the
      // worker/core files in the serverless function instead of relying on CDN
      // runtime downloads for executable assets. The pdfjs legacy build + its
      // worker .mjs are force-included so text extraction resolves the worker.
      "/api/parse": [
        "../../node_modules/tesseract.js/**/*",
        "../../node_modules/tesseract.js-core/**/*",
        "../../node_modules/pdfjs-dist/legacy/build/**/*",
      ],
    },
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
        // Retired 2026-07-07 (Troy's standing decision): /walkthrough is the
        // one demo surface. Old /demo links keep working.
        source: "/demo",
        destination: "/walkthrough",
        permanent: true,
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
            // challenges.cloudflare.com = Turnstile (script + widget iframe)
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.openai.com https://api.anthropic.com https://challenges.cloudflare.com; media-src 'self' blob:; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
