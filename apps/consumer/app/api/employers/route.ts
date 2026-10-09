/**
 * The employer board: employers with current, dated evidence that they hire
 * people with records. Published rows only; job-seeker fields only (no
 * contact or outreach intel). Signed in (client+).
 *
 * Searched and paged on the server (lane 3a Part 2, item 3; Troy: the data
 * stays his): ?q= searches, ?industry= filters, ?page= is 0-based. Each answer
 * is one page of at most 25. There is no size parameter and no export. Pages
 * are counted per account by tier and per network (lib/employer-paging.ts).
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { forgeSessionUser } from "@/lib/session-policy";
import { getClientIp } from "@/lib/auth-rate-limit";
import { getUserTier, incrementIpUsage, incrementUserUsage, listEmployerIndustries, searchPublishedEmployers } from "@crucible/core";
import {
  EMPLOYER_PAGES_ENDPOINT,
  EMPLOYER_PAGES_LIMIT_MESSAGE,
  employerPageAllowed,
  parseEmployerQuery,
} from "@/lib/employer-paging";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(request: Request) {
  // A session still owing its second step is not signed in here.
  const userId = forgeSessionUser(await auth())?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Count first, then answer: a refused page costs nothing to serve. Per
  // account (by tier) and per network, both counted every time.
  const [account, network, tier] = await Promise.all([
    incrementUserUsage(userId, EMPLOYER_PAGES_ENDPOINT),
    incrementIpUsage(getClientIp(request), EMPLOYER_PAGES_ENDPOINT),
    getUserTier(userId),
  ]);
  if (!employerPageAllowed(account, network, tier)) {
    return NextResponse.json({ error: EMPLOYER_PAGES_LIMIT_MESSAGE }, { status: 429 });
  }

  const { q, industry, page } = parseEmployerQuery(new URL(request.url).searchParams);
  const [result, industries] = await Promise.all([
    searchPublishedEmployers({ q, industry, page }),
    page === 0 ? listEmployerIndustries() : Promise.resolve(undefined),
  ]);
  return NextResponse.json(
    { ...result, ...(industries ? { industries } : {}) },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
