/**
 * GET /api/usage -- Settings -> Usage (TOOL-REVISIONS S5). The same allowance
 * the tools spend from (progressionAllowance, the access-code per-tool count,
 * tool policies), shaped by lib/usage-view.ts. Read as the person.
 */
import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { settingsRefusal } from "@/lib/settings-guard";
import { getOneAsUser, queryAsUser, query } from "@crucible/core";
import { progressionAllowance } from "@/lib/progression-server";
import { buildUsageView } from "@/lib/usage-view";

export const dynamic = "force-dynamic";
const DAY = "date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'";

export async function GET() {
  const session = await auth();
  { const refused = settingsRefusal(session, "preference", "read"); if (refused) return refused; }
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const [allow, expiry, usage, policies, runs] = await Promise.all([
      progressionAllowance(userId),
      getOneAsUser<{ at: string | null }>(userId, "SELECT min(expires_at) AS at FROM progression_grant WHERE user_id=$1 AND kind='bonus' AND expires_at>now()", [userId]),
      // ai_usage is the per-tool daily counter the rate limit increments (not a protected table).
      query<{ endpoint: string; call_count: number }>("SELECT endpoint, call_count FROM ai_usage WHERE user_id = $1 AND usage_date = CURRENT_DATE", [userId]),
      queryAsUser<{ workflow: string; disabled: boolean; daily_calls: number | null }>(userId, "SELECT workflow, disabled, daily_calls FROM ai_tool_policy WHERE disabled OR daily_calls IS NOT NULL", []),
      queryAsUser<{ workflow: string; n: number }>(userId, `SELECT workflow, count(*)::int AS n FROM ai_operation WHERE user_id = $1 AND status <> 'failed' AND created_at >= ${DAY} GROUP BY workflow`, [userId]),
    ]);
    const ran = new Map(runs.map((r) => [r.workflow, Number(r.n)]));
    const view = buildUsageView({
      allowance: { existing: allow.account.existing, base: allow.base, bonus: allow.bonus, used: allow.used, bonusUsed: allow.bonusUsed, blockedReason: allow.blockedReason ?? null },
      bonusExpiresAt: expiry?.at ?? null,
      legacyLimit: allow.account.legacyLimit,
      toolUsage: Object.fromEntries(usage.map((u) => [u.endpoint, Number(u.call_count)])),
      toolPolicies: policies.map((p) => ({ ...p, ran: ran.get(p.workflow) ?? 0 })),
    }, new Date());
    return NextResponse.json(view, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Your allowance could not be read right now. Your saved work is still available." }, { status: 503 });
  }
}
