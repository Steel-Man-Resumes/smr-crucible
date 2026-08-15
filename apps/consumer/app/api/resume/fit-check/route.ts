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
import { auth } from "@/auth";
import { computeFitPlan } from "@crucible/core/src/pageFit";
import {
  isChromiumRenderEnabled,
  renderCanonicalPageCount,
} from "@/lib/pagefit-renderer";

export const runtime = "nodejs";
export const maxDuration = 15;

// Mirror the download route's document cap so the same content that downloads
// can be checked, and nothing larger.
const MAX_DOCUMENT_CHARS = 200_000;

interface FitCheckBody {
  content?: unknown;
  type?: unknown;
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

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
