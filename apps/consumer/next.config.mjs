/**
 * The extraction worker (lib/extract-worker.ts) loads mammoth and pdf.js by
 * path at run time, so the tracer cannot see what they need. Ship mammoth with
 * its whole dependency tree, and pdf.js's package file, with the route that
 * reads uploads. Keep in step with mammoth's dependencies (npm ls mammoth).
 */
const MAMMOTH_TREE = [
  "../../node_modules/{mammoth,@xmldom/xmldom,sprintf-js,base64-js,bluebird,dingbat-to-unicode,jszip,lie,immediate,pako,readable-stream,core-util-is,inherits,process-nextick-args,safe-buffer,string_decoder,util-deprecate,setimmediate,lop,duck,underscore,option,path-is-absolute,xmlbuilder}/**/*",
  "../../node_modules/pdfjs-dist/package.json",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@crucible/core", "@crucible/consumer-ui"],
  // pdfjs (used by lib/text-extraction for PDF text extraction) MUST stay
  // external: when Next bundles it into a serverless chunk, its runtime dynamic
  // import of pdf.worker.mjs points at a chunk path that is never emitted, so
  // "Setting up fake worker failed: Cannot find module .../pdf.worker.mjs" and
  // EVERY text PDF fails on Vercel (works in local dev only). Externalizing
  // loads it from node_modules with the worker intact. (F1; Next 15 moved this
  // key out of experimental, where it was serverComponentsExternalPackages.)
  //
  // tesseract.js (image OCR in the same file) must stay external for the same
  // reason. Bundled, it computes its worker path from the CHUNK's __dirname
  // (.next/worker-script/node/index.js, which does not exist), the worker
  // thread dies with MODULE_NOT_FOUND, and tesseract only listens through
  // `worker.onerror`, which Node ignores, so createWorker() never settles and
  // every image upload hung until the 60 s limit (504, found 2026-10-02).
  //
  // mammoth must stay external too: lib/extract-worker.ts runs it (and pdfjs)
  // in a worker thread that loads it by path from node_modules, so it has to
  // exist there in the function, traced from text-extraction.ts's own import.
  serverExternalPackages: ["pdfjs-dist", "tesseract.js", "mammoth"],
  // The assistant route reads skill/doctrine .md files at runtime via fs. They
  // are NOT imported anywhere, so Next's file tracer has no static reference and
  // will not bundle them into the serverless function -- t.ROY then silently
  // loads zero doctrine in production (it works in local dev only because cwd
  // happens to have the files). Force them into the Lambda. See lib/skills/.
  // (Top-level since Next 15; it was experimental.outputFileTracingIncludes.)
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
      ...MAMMOTH_TREE,
      "../../node_modules/tesseract.js/**/*",
      "../../node_modules/tesseract.js-core/**/*",
      // The OCR worker thread is started from a file path, not an import, so
      // the tracer never sees what IT requires. Its Node-side dependencies:
      "../../node_modules/regenerator-runtime/**/*",
      "../../node_modules/is-url/**/*",
      "../../node_modules/wasm-feature-detect/**/*",
      "../../node_modules/bmp-js/**/*",
      "../../node_modules/pdfjs-dist/legacy/build/**/*",
    ],
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
            // googletagmanager.com / google-analytics.com = GA4 thin acquisition layer (lib/ga.ts)
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com; connect-src 'self' https://api.openai.com https://api.anthropic.com https://challenges.cloudflare.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com; media-src 'self' blob:; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'",
          },
        ],
      },
      {
        // Emailed sign-in links open this page with a one-time token and the
        // email address in the query string. Never send its URL on as a
        // referrer (same-origin pages would otherwise see the full URL, and
        // analytics would collect it). Listed after the global rule so this
        // value wins for this path.
        source: "/login/finish",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        // Password reset links carry a live token and the email address the
        // same way. Same rule.
        source: "/reset-password",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
