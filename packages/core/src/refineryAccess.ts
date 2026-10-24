/**
 * Refinery seats (migration 096): the database half.
 *
 * THE SEAT RULE LIVES IN ONE PLACE, the definer function smr_has_refinery_seat.
 * Nothing here re-implements it. The app adds exactly one rule the database
 * cannot know (an address on the PARTNER_PRE_AUTH list, apps/consumer
 * lib/refinery-access.ts) and reads the answer; it never decides it.
 *
 * Offers: an organization asking an existing account to join. The seat is
 * spent when the person accepts, inside smr_accept_seat_offer, through
 * smr_redeem_code (the one membership path).
 */

import { query, queryAsUser, runAsUser, runScoped } from "./db";
import { syncUserTierFromCodes } from "./userTier";

/** The policy switch and this person's seat, read in one round trip. */
export interface RefineryGate {
  /** True while the Refinery is open to every signed-in account (the default). */
  open: boolean;
  /** smr_has_refinery_seat for this person. */
  seat: boolean;
}

/**
 * Read the switch and the seat. Throws on a database error: callers decide
 * whether that fails open (the page claim keeps its last value) or closed (AI
 * admission refuses). Both functions are definer functions, so no row scope is
 * needed and a missing scope cannot quietly read as "no seat".
 */
export async function readRefineryGate(userId: string): Promise<RefineryGate> {
  const rows = await query<{ open: boolean; seat: boolean }>(
    `SELECT public.smr_refinery_signup_open() AS open, public.smr_has_refinery_seat($1::uuid) AS seat`,
    [userId]
  );
  const row = rows[0];
  if (!row || typeof row.open !== "boolean" || typeof row.seat !== "boolean") {
    throw new Error("refinery_gate_unreadable");
  }
  return { open: row.open, seat: row.seat };
}

/** One offer made to this person, as they see it. */
export interface SeatOffer {
  id: string;
  orgName: string;
  createdAt: string;
}

/** Open offers made to this person (their own rows only, under RLS). */
export async function listMySeatOffers(userId: string): Promise<SeatOffer[]> {
  const rows = await queryAsUser<{ id: string; partner_name: string; created_at: string }>(
    userId,
    `SELECT o.id, ac.partner_name, o.created_at
       FROM org_seat_offer o
       JOIN access_code ac ON ac.id = o.access_code_id
      WHERE o.user_id = $1 AND o.status = 'pending' AND ac.is_active
      ORDER BY o.created_at DESC
      LIMIT 10`,
    [userId]
  );
  return rows.map((r) => ({ id: r.id, orgName: r.partner_name, createdAt: r.created_at }));
}

export type OfferOutcome = "ok" | "already_member" | "other_org" | "not_found" | "inactive" | "expired" | "full";
const OFFER_OUTCOMES: readonly OfferOutcome[] = ["ok", "already_member", "other_org", "not_found", "inactive", "expired", "full"];

function offerOutcome(raw: unknown): OfferOutcome {
  return (OFFER_OUTCOMES as readonly string[]).includes(String(raw)) ? (raw as OfferOutcome) : "not_found";
}

/** Accept an offer made to `userId`. The seat is spent here, or not at all. */
export async function acceptSeatOffer(userId: string, offerId: string): Promise<OfferOutcome> {
  const out = await runAsUser<[{ outcome: string }[]]>(userId, (sql) => [
    sql`SELECT public.smr_accept_seat_offer(${userId}::uuid, ${offerId}::uuid) AS outcome`,
  ]);
  const outcome = offerOutcome(out[0]?.[0]?.outcome);
  if (outcome === "ok") await syncUserTierFromCodes(userId);
  return outcome;
}

/** Decline an offer made to `userId`. Nothing is spent. */
export async function declineSeatOffer(userId: string, offerId: string): Promise<"ok" | "not_found"> {
  const out = await runAsUser<[{ outcome: string }[]]>(userId, (sql) => [
    sql`SELECT public.smr_decline_seat_offer(${userId}::uuid, ${offerId}::uuid) AS outcome`,
  ]);
  return out[0]?.[0]?.outcome === "ok" ? "ok" : "not_found";
}

/**
 * Leave one organization. The seat is not handed back (durable seats, Troy
 * 2026-06-10). Returns whether a membership ended. Tier is re-derived from the
 * codes that remain, the same way a redemption sets it.
 */
export async function leaveOrg(userId: string, orgId: string): Promise<boolean> {
  const out = await runAsUser<[{ n: number }[]]>(userId, (sql) => [
    sql`SELECT public.smr_leave_org(${userId}::uuid, ${orgId}::uuid) AS n`,
  ]);
  const left = Number(out[0]?.[0]?.n ?? 0) > 0;
  if (left) await syncUserTierFromCodes(userId);
  return left;
}

/** One offer per person per organization per day, answered or not (review 1, SF-2). */
export const OFFER_WINDOW_HOURS = 24;

/**
 * Record an organization's offer to an existing account. Scoped to that
 * organization (the insert policy checks app.org_id). Returns true only when
 * a NEW offer was written: not when one is open, and not when one was made or
 * answered in the last OFFER_WINDOW_HOURS. The caller emails only on true, so
 * repeating "Add" neither repeats the email nor tells staff anything new.
 */
export async function createSeatOffer(opts: {
  accessCodeId: string;
  userId: string;
  offeredBy: string;
}): Promise<boolean> {
  const [rows] = await runScoped<[{ id: string }[]]>(
    { orgId: opts.accessCodeId, userId: opts.offeredBy, role: "org_admin" },
    (sql) => [
      sql`INSERT INTO org_seat_offer (access_code_id, user_id, offered_by)
          SELECT ${opts.accessCodeId}::uuid, ${opts.userId}::uuid, ${opts.offeredBy}::uuid
           WHERE NOT EXISTS (
             SELECT 1 FROM org_seat_offer o
              WHERE o.access_code_id = ${opts.accessCodeId}::uuid AND o.user_id = ${opts.userId}::uuid
                AND (o.status = 'pending'
                     OR o.created_at > now() - make_interval(hours => ${OFFER_WINDOW_HOURS})
                     OR o.decided_at > now() - make_interval(hours => ${OFFER_WINDOW_HOURS})))
          ON CONFLICT (access_code_id, user_id) WHERE status = 'pending' DO NOTHING
          RETURNING id`,
    ]
  );
  return (rows?.length ?? 0) > 0;
}
