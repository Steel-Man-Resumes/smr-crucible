/**
 * Which commit is production actually running?
 *
 * "Deploy succeeded" and "the new code is live" are different facts, and the
 * gap between them has cost this project more than one false conclusion: a
 * fix verified against the previous build looks exactly like a fix that did
 * not work. Server-only changes cannot be found by searching the client
 * bundle, so this is the one place to ask.
 *
 * The short SHA of a commit is not a secret; it is on every GitHub page.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown").slice(0, 7),
    env: process.env.VERCEL_ENV ?? "unknown",
  });
}
