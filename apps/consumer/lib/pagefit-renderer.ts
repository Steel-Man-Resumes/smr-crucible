/**
 * Phase 2.5 -- DECISION A validator stub (documented, dependency-free, flag-off).
 *
 * The CANONICAL page-fit answer is the deterministic DOCX model in
 * @crucible/core/src/pageFitShared (estimatePageFit). That models the exact
 * geometry of the .docx the user actually downloads, needs no browser, and ships
 * today. This file is the OPTIONAL cross-check: a headless render that could one
 * day confirm the deterministic model against a real layout engine.
 *
 * It adds NO dependency now and is OFF by default. renderCanonicalPageCount
 * throws unless PAGEFIT_CHROMIUM === "true". The block comment below is the full
 * build spec for when (if) Troy approves wiring it in.
 *
 * DOCTRINE: even the validator never fabricates or edits content -- it only
 * counts pages of a faithful render for comparison against the deterministic
 * estimate.
 */

/**
 * DECISION A (Troy-approved architecture, NOT yet wired in):
 *   serverless @sparticuz/chromium + playwright-core
 *
 * WHEN to build: only if the deterministic DOCX model (pageFitShared) proves too
 * inaccurate in the field. Prefer the model -- it is free, synchronous, and
 * matches the exact download geometry.
 *
 * DEPENDENCIES TO ADD (none are present today; do not add without approval):
 *   - "@sparticuz/chromium" (the serverless-friendly Chromium binary)
 *   - "playwright-core"      (the driver; core avoids bundling a second browser)
 *   Pin both, and add @sparticuz/chromium to Next's serverExternalPackages so it
 *   is not bundled.
 *
 * RENDER PATH (isolated, OFF the tailor hot path):
 *   - A dedicated async route, e.g. POST /api/resume/pagefit-render, that:
 *       1. hashes the content (contentHash) + RENDERER_VERSION for a cache key,
 *       2. returns a cached page count immediately on hit,
 *       3. on miss, launches chromium, loads an HTML template (below), and
 *          reads the rendered page count, then caches it.
 *   - The tailor/download flows NEVER block on this; the UI polls or reads a
 *     cached value. The deterministic estimate is always the immediate answer.
 *
 * HTML TEMPLATE (must mirror the DOCX geometry exactly, from pageFitShared):
 *   - @page { size: 8.5in 11in; margin: 0.28in 0.43in; } so the usable box is
 *     7.64in x 10.44in, identical to USABLE_WIDTH/HEIGHT_TWIPS.
 *   - Fonts: Georgia for name (18pt bold) + section headers (9pt); Arial for
 *     body/bullets/contact (8pt), job titles (8.5pt). Same per-block margins as
 *     BLOCK_SPACING (convert twips -> pt: twips/20).
 *   - BUNDLE the exact font files (Georgia, Arial or metric-compatible
 *     substitutes) and @font-face them from a data: URI or a bundled asset, so
 *     the render is deterministic across environments. Do NOT rely on system
 *     fonts -- they differ between local and serverless and will shift the count.
 *   - Page count = await page.evaluate over the rendered height / page height,
 *     or CSS paged-media via a print-to-pdf and counting PDF pages.
 *
 * CACHING: key = `${contentHash}:${RENDERER_VERSION}`. Bump RENDERER_VERSION in
 * pageFitShared whenever geometry or the template changes so stale renders are
 * never served.
 *
 * REQUIRED VERIFICATION BEFORE PROD:
 *   @sparticuz/chromium behaves DIFFERENTLY locally vs on Vercel serverless
 *   (binary path, /tmp, font availability, cold-start memory). This MUST be
 *   verified on a Vercel PREVIEW deploy -- a green local run does NOT prove it
 *   works in production. Confirm the preview render's page count matches the
 *   deterministic estimate on a spread of fixtures before enabling in prod.
 */

/** Feature flag. Default OFF -- the deterministic model is the shipped answer. */
export function isChromiumRenderEnabled(): boolean {
  return process.env.PAGEFIT_CHROMIUM === "true";
}

/**
 * Cross-check page count via the (unbuilt) chromium renderer. Throws when the
 * flag is off -- which is always, today. Callers MUST wrap this in try/catch so
 * a failure never breaks the deterministic answer.
 */
export async function renderCanonicalPageCount(_content: string): Promise<number> {
  if (!isChromiumRenderEnabled()) {
    throw new Error("chromium renderer not enabled");
  }
  // Intentionally unimplemented: enabling the flag without building the render
  // path (per DECISION A above) is a misconfiguration, not a silent 1-page lie.
  throw new Error(
    "chromium renderer flag is on but the renderer is not built -- see DECISION A in pagefit-renderer.ts"
  );
}
