/**
 * Seat truth for an organization. Pure, so the browser and the server say the
 * same numbers, and so the math can be tested without a database.
 *
 * FOUR NUMBERS, AND THEY ARE NOT THE SAME THING.
 *   total    the cap the organization bought (access_code.max_redemptions);
 *            null means no cap.
 *   claimed  seats ever spent (access_code.times_redeemed). This is the number
 *            smr_redeem_code checks against the cap (migration 048), so it is
 *            the only number that predicts whether the next invite will work.
 *            Seats are durable (Troy, 2026-06-10): it does not go down when a
 *            person leaves. The one refund is a pending invite removed before
 *            the person ever signed in.
 *   active   people who are members right now (access_code_redemption rows),
 *            including invites that have not been opened yet.
 *   free     total minus claimed. Never total minus active: that showed a free
 *            seat after someone left, and the next invite was then refused.
 */

export interface SeatLedger {
  /** null = no cap set. */
  seatsTotal: number | null;
  seatsClaimed: number;
  seatsActive: number;
  /** null when there is no cap. Never negative. */
  seatsFree: number | null;
  /** Invited, never signed in. Inside seatsActive, shown on its own. */
  seatsInvited: number;
}

function wholeOrZero(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function computeSeatLedger(input: {
  maxRedemptions: number | null | undefined;
  timesRedeemed: number | null | undefined;
  activeMembers: number | null | undefined;
  pendingInvites?: number | null;
}): SeatLedger {
  const capRaw = input.maxRedemptions;
  // 0 or a missing cap both mean "no cap": smr_redeem_code treats a falsy
  // max_redemptions as unlimited, so the screen must too.
  const seatsTotal = capRaw === null || capRaw === undefined || !(Number(capRaw) > 0) ? null : Math.floor(Number(capRaw));
  const seatsActive = wholeOrZero(input.activeMembers);
  // claimed can never be below active: every current member spent a seat. If
  // the counter disagrees (rows written before the counter existed), the
  // larger number is the honest one for "can I invite someone".
  const seatsClaimed = Math.max(wholeOrZero(input.timesRedeemed), seatsActive);
  const seatsInvited = Math.min(wholeOrZero(input.pendingInvites), seatsActive);
  const seatsFree = seatsTotal === null ? null : Math.max(0, seatsTotal - seatsClaimed);
  return { seatsTotal, seatsClaimed, seatsActive, seatsFree, seatsInvited };
}

/** One plain line for a header or a table cell. */
export function seatLedgerLine(l: SeatLedger): string {
  if (l.seatsTotal === null) {
    return `No seat limit. ${l.seatsClaimed} claimed, ${l.seatsActive} active now.`;
  }
  return `${l.seatsClaimed} of ${l.seatsTotal} seats claimed, ${l.seatsActive} active now, ${l.seatsFree} free.`;
}

/** Why claimed can be larger than active, for a help line under the numbers. */
export const SEAT_LEDGER_HELP =
  "A seat is claimed when someone joins or is invited. It stays claimed if they leave later, so free seats are the total minus claimed. Removing an invite nobody has opened gives the seat back.";
