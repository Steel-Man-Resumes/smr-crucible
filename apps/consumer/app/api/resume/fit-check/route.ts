/**
 * Phase 2.5 -- Page-fit check API.
 *
 * Returns a deterministic estimate of how many pages the resume will be when
 * downloaded as the TORI-standard DOCX (built by /api/forge/download), and how
 * full the last page is. This is DISTINCT from /api/fit-check, which is a
 * JD-vs-resume semantic match. Here "fit" means PAGE fit.
 *
 * DOCTRINE: TRUTH WINS. The engine never fabricates and never drops content. It
 * models the exact download geometry (see @crucible/core/src/pageFitShared) and
 * returns an advisory ledger (computeFitPlan) so a human decides what to cut. It
 * is an ESTIMATE of Word's pagination, not a pixel-perfect render.
 *
 * Auth is required (the content is in the body, so no per-artifact ownership is
 * needed, but auth stops anonymous abuse of the compute endpoint). Pure compute,
 * fast. When PAGEFIT_CHROMIUM is on, a best-effort chromium cross-check page
 * count is added, wrapped in try/catch so it can never break the real answer.
 */

import { NextResponse } from "next/server";
import { computeFitPlan } from "@crucible/core/src/pageFit";
import {
  isChromiumRenderEnabled,
  renderCanonicalPageCount,
} from "@/lib/pagefit-renderer";
import { withRateLimit } from "@/lib/withRateLimit";

export const runtime = "nodejs";
export const maxDuration = 15;

// Mirror the download route's document cap so the same content that downloads
// can be checked, and nothing larger.
const MAX_DOCUMENT_CHARS = 200_000;

interface FitCheckBody {
  content?: unknown;
  type?: unknown;
}

/**
 * ANONYMOUS-SAFE (fixed 2026-09-19). This route required a session, and the
 * Forge output page -- which is deliberately pre-auth -- was made to call it
 * automatically. Every anonymous person finishing the Forge got a silent 401
 * and an error card where the page-length advice should have been.
 *
 * Auth was never protecting DATA here: the content arrives in the body and the
 * computation is pure, so there is no per-artifact ownership to enforce. The
 * header said as much -- auth existed to stop anonymous abuse of a compute
 * endpoint. IP rate limiting is the right tool for that, and it is what every
 * other pre-auth Forge route already uses.
 */
async function handlePost(request: Request) {
  try {
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > 500_000) {
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }

    const body = (await request.json()) as FitCheckBody;
    const content = body.content;

    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "content must be text" },
        { status: 400 }
      );
    }
    if (content.length > MAX_DOCUMENT_CHARS) {
      return NextResponse.json({ error: "content is too large" }, { status: 413 });
    }

    // Deterministic answer -- the canonical, always-returned result.
    const plan = computeFitPlan(content);

    // Optional chromium cross-check (off by default). Never let it break the
    // deterministic answer.
    let chromiumPageCount: number | undefined;
    if (isChromiumRenderEnabled()) {
      try {
        chromiumPageCount = await renderCanonicalPageCount(content);
      } catch (err) {
        console.error("pagefit chromium cross-check failed (non-fatal):", err);
      }
    }

    return NextResponse.json({
      status: plan.status,
      band: plan.result.band,
      pageCount: plan.result.pageCount,
      finalPageFullness: plan.result.finalPageFullness,
      perPage: plan.result.perPage,
      ledger: plan.ledger,
      cannotReachBandByLevers: plan.cannotReachBandByLevers ?? false,
      rendererVersion: plan.result.rendererVersion,
      ...(chromiumPageCount !== undefined ? { chromiumPageCount } : {}),
    });
  } catch (error: any) {
    console.error("Page fit-check error:", error);
    return NextResponse.json(
      { error: "Could not check page fit right now. Please try again." },
      { status: 500 }
    );
  }
}

export const POST = withRateLimit(handlePost, {
  mode: "ip",
  endpoint: "resume-fit-check",
});
