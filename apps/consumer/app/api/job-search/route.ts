/**
 * Job Search API — thin HTTP wrapper around lib/job-search-core (runJobSearch).
 * All search logic (cache, JSearch, CareerOneStop fallback, AI enrichment,
 * decision logging, mock mode) lives in the core module so t.ROY's search_jobs
 * tool can call it in-process.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withRateLimit } from "@/lib/withRateLimit";
import { runJobSearch } from "@/lib/job-search-core";
import { getHiddenEmployerSet, isHiddenEmployer } from "@crucible/core";

export const maxDuration = 30;

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const { targetRole, location, skills, hasRecord, recordType } =
      await request.json();

    // Resolve the caller once: userId attributes the enrichment AI cost to the
    // right person (else it lands user_id NULL and is invisible in own/per-user
    // rollups), and the same session drives the hidden-employer filter below.
    const session = await auth();
    const userId = session?.user?.id ?? null;

    const result = await runJobSearch({
      role: targetRole,
      location,
      skills,
      hasRecord,
      recordType,
      userId,
    });

    // N1: filter out employers this user has hidden. Applied per-user AFTER the
    // (shared, per-role) cache, so hiding is honored on cache hits too. Fail-open:
    // a hidden-set lookup error never blocks the search.
    try {
      if (userId && Array.isArray(result.jobs) && result.jobs.length > 0) {
        const hidden = await getHiddenEmployerSet(userId);
        if (hidden.size > 0) {
          result.jobs = result.jobs.filter((j) => !isHiddenEmployer(j.company, hidden));
        }
      }
    } catch (filterErr) {
      console.error("Hidden-employer filter skipped:", filterErr);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Job search error:", error);
    return NextResponse.json({
      jobs: [],
      fair_chance_info: "",
      error: "search_failed",
    });
  }
}

export const POST = withRateLimit(handlePost, {
  mode: "user",
  endpoint: "jobs",
  requiredTier: "client",
});
