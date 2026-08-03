/**
 * Job Search API — thin HTTP wrapper around lib/job-search-core (runJobSearch).
 * All search logic (cache, JSearch, CareerOneStop fallback, AI enrichment,
 * decision logging, mock mode) lives in the core module so t.ROY's search_jobs
 * tool can call it in-process.
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";
import { runJobSearch } from "@/lib/job-search-core";

export const maxDuration = 30;

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const { targetRole, location, skills, hasRecord, recordType } =
      await request.json();

    const result = await runJobSearch({
      role: targetRole,
      location,
      skills,
      hasRecord,
      recordType,
    });

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
