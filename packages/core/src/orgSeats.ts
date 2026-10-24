/**
 * Seat ledger reads. The math lives in orgSeatsShared.ts; this file only
 * gathers the inputs.
 *
 * access_code is not row-level protected (it is the organization's own row and
 * holds no participant content), so it is read plainly. Membership rows and
 * pending invites are counted inside the organization's scope, because
 * access_code_redemption is protected and an unscoped count reads zero.
 */
import { getOne, runScoped } from "./db";
import { computeSeatLedger, type SeatLedger } from "./orgSeatsShared";

export async function getOrgSeatLedger(orgId: string, actorUserId = ""): Promise<SeatLedger | null> {
  const ac = await getOne<{ max_redemptions: number | null; times_redeemed: number; max_staff: number | null }>(
    `SELECT max_redemptions, times_redeemed, max_staff FROM access_code WHERE id = $1`,
    [orgId]
  );
  if (!ac) return null;
  const [rows] = await runScoped<[{ active: number; invited: number; offers: number; staff: number }[]]>(
    { orgId, userId: actorUserId, role: "org_admin" },
    (sql) => [
      (sql as unknown as (s: string, p: unknown[]) => unknown)(
        `SELECT
           (SELECT COUNT(*)::int FROM access_code_redemption r WHERE r.access_code_id = $1::uuid) AS active,
           (SELECT COUNT(*)::int FROM org_invite oi JOIN users u ON u.id = oi.user_id
             WHERE oi.access_code_id = $1::uuid
               AND u."emailVerified" IS NULL AND u.password_hash IS NULL
               AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a."userId" = u.id)
               AND EXISTS (SELECT 1 FROM access_code_redemption r WHERE r.access_code_id = $1::uuid AND r.user_id = oi.user_id)) AS invited,
           (SELECT COUNT(*)::int FROM org_invite oi
             WHERE oi.access_code_id = $1::uuid AND oi.offer_status IN ('offered', 'declined')) AS offers,
           (SELECT COUNT(*)::int FROM org_staff os WHERE os.access_code_id = $1::uuid) AS staff`,
        [orgId]
      ),
    ]
  );
  return computeSeatLedger({
    maxRedemptions: ac.max_redemptions,
    timesRedeemed: ac.times_redeemed,
    activeMembers: rows?.[0]?.active ?? 0,
    pendingInvites: rows?.[0]?.invited ?? 0,
    openOffers: rows?.[0]?.offers ?? 0,
    staffCount: rows?.[0]?.staff ?? 0,
    maxStaff: ac.max_staff,
  });
}

/** Many organizations at once, for the platform-admin directory. */
export function seatLedgerFromCounts(
  ac: { max_redemptions: number | null; times_redeemed: number; max_staff?: number | null },
  counts: { joined: number; invited?: number; offers?: number; staff?: number }
): SeatLedger {
  return computeSeatLedger({
    maxRedemptions: ac.max_redemptions,
    timesRedeemed: ac.times_redeemed,
    activeMembers: counts.joined,
    pendingInvites: counts.invited ?? 0,
    openOffers: counts.offers ?? 0,
    staffCount: counts.staff ?? null,
    maxStaff: ac.max_staff ?? null,
  });
}
