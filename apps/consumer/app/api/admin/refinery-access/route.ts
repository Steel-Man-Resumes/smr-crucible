/**
 * Platform admin: the Refinery sign-up switch, the house organization, and
 * usage per seat. Under /api/admin/, so the edge requires a second factor on
 * this sign-in (auth.ts) and requirePlatformAdmin checks platform_admin again.
 *
 * GET                 the switch, the house pool, and the organizations to pick from
 * GET ?usage=<orgId>  usage per seat for one organization
 * POST {action:"close"}            close public sign-ups (grandfathers every account now)
 * POST {action:"open"}             reopen (the rollback)
 * POST {action:"house", codeId}    set the house organization (codeId null clears it)
 * POST {action:"unlegacy", email}  take one account off the grandfather list
 */
import { query } from "@crucible/core";
import { requirePlatformAdmin } from "@/lib/org-guard";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { getSeatUsage } from "@/lib/ai-cost-report";
import {
  SeatDecisionError,
  closeRefinerySignups,
  openRefinerySignups,
  readAdminRefineryPolicy,
  removeLegacySeat,
  setHouseOrg,
} from "@/lib/refinery-access-server";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const g = await requirePlatformAdmin();
  if (!g.ok) return g.response;
  const usage = new URL(request.url).searchParams.get("usage");
  try {
    if (usage) return Response.json(await getSeatUsage(g.userId, usage), { headers: NO_STORE });
    const [policy, orgs] = await Promise.all([
      readAdminRefineryPolicy(g.userId),
      query<{ id: string; partner_name: string; times_redeemed: number; max_redemptions: number | null }>(
        "SELECT id, partner_name, times_redeemed, max_redemptions FROM access_code WHERE is_active ORDER BY partner_name LIMIT 200"
      ),
    ]);
    return Response.json({ policy, orgs }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "Refinery access could not be read. Check that migration 096 is applied." }, { status: 503, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return Response.json({ error: "Request not allowed." }, { status: 403 });
  const g = await requirePlatformAdmin();
  if (!g.ok) return g.response;
  const body = await request.json().catch(() => null);
  try {
    if (body?.action === "close") await closeRefinerySignups(g.userId);
    else if (body?.action === "open") await openRefinerySignups(g.userId);
    else if (body?.action === "house") await setHouseOrg(g.userId, typeof body.codeId === "string" && body.codeId ? body.codeId : null);
    else if (body?.action === "unlegacy") {
      const removed = await removeLegacySeat(g.userId, String(body.email ?? ""));
      if (!removed) return Response.json({ error: "That account is not on the grandfather list." }, { status: 404 });
    } else return Response.json({ error: "Unknown action." }, { status: 400 });
    return Response.json({ ok: true, policy: await readAdminRefineryPolicy(g.userId) });
  } catch (error) {
    if (error instanceof SeatDecisionError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: "That did not save. Nothing changed." }, { status: 503 });
  }
}
