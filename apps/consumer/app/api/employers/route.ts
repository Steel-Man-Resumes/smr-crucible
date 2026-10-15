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
import { getUserTier, incrementIpUsage, incrementUserUsage, searchVerifiedEmployers, getVerifiedEmployer, requestDirectoryCoverage } from "@crucible/core";
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
  const state = new URL(request.url).searchParams.get("state")?.toUpperCase();
  const selectedId=new URL(request.url).searchParams.get("employerId");
  const selected=selectedId ? await getVerifiedEmployer(selectedId) : null;
  const result = selected ? {...selected,data:selected.data?[selected.data]:[]} : await searchVerifiedEmployers({ q: q || undefined, industry: industry || undefined, state, page });
  if (result.status !== "ok") return NextResponse.json({ error: result.error }, {status:503, headers:{"Cache-Control":"private, no-store"}});
  const employers = result.data.map(e => ({...e, whyGoodFit:e.evidence ? `What we found: ${e.evidence}` : null,lastVerified:e.checkedAt}));
  if(state && /^[A-Z]{2}$/.test(state) && result.data.length===0 && page===0 && !selectedId) {
    // Only the explicitly selected state, never a guessed place from job text.
    await requestDirectoryCoverage(userId,{state,place:state,category:"employers",reason:"low_coverage"}).catch(()=>null);
  }
  const industries = [...new Set(employers.map(e=>e.industry).filter(Boolean))];
  return NextResponse.json(
    { employers, page, pageSize:25, hasMore:employers.length === 25 && page < 39, industries, contractVersion:result.contractVersion, asOf:result.asOf },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
