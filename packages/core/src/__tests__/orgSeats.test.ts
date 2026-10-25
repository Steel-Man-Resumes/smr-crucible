/**
 * Seat ledger math. The case that motivated it: two seats, two people join,
 * one leaves. The console used to show 1/2 (members now) and offer a seat that
 * smr_redeem_code would then refuse, because the cap is checked against
 * times_redeemed, which does not go down (Troy, 2026-06-10).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeSeatLedger, seatLedgerLine, staffLedgerLine } from "../orgSeatsShared";

describe("seat ledger", () => {
  it("free is total minus claimed, not total minus active", () => {
    const l = computeSeatLedger({ maxRedemptions: 2, timesRedeemed: 2, activeMembers: 1 });
    assert.deepEqual(l, { seatsTotal: 2, seatsClaimed: 2, seatsActive: 1, seatsFree: 0, seatsInvited: 0, offersOpen: 0, staffCount: null, staffTotal: null });
  });

  it("a fresh organization has every seat free", () => {
    const l = computeSeatLedger({ maxRedemptions: 10, timesRedeemed: 0, activeMembers: 0 });
    assert.equal(l.seatsFree, 10);
    assert.equal(l.seatsClaimed, 0);
  });

  it("NULL means no cap; 0 is a real cap with no seats, as smr_redeem_code checks times_redeemed >= max_redemptions", () => {
    for (const cap of [null, undefined]) {
      const l = computeSeatLedger({ maxRedemptions: cap, timesRedeemed: 4, activeMembers: 3 });
      assert.equal(l.seatsTotal, null);
      assert.equal(l.seatsFree, null);
      assert.equal(l.seatsClaimed, 4);
    }
    const zero = computeSeatLedger({ maxRedemptions: 0, timesRedeemed: 0, activeMembers: 0 });
    assert.equal(zero.seatsTotal, 0);
    assert.equal(zero.seatsFree, 0);
    assert.equal(seatLedgerLine(zero), "0 of 0 seats claimed, 0 active now, 0 free.");
  });

  it("free never goes negative when claimed is above the cap (cap lowered later)", () => {
    const l = computeSeatLedger({ maxRedemptions: 3, timesRedeemed: 5, activeMembers: 5 });
    assert.equal(l.seatsFree, 0);
  });

  it("claimed is never below active, even if the counter is behind", () => {
    const l = computeSeatLedger({ maxRedemptions: 10, timesRedeemed: 1, activeMembers: 4 });
    assert.equal(l.seatsClaimed, 4);
    assert.equal(l.seatsFree, 6);
  });

  it("pending invites are inside active and cannot exceed it", () => {
    const l = computeSeatLedger({ maxRedemptions: 5, timesRedeemed: 3, activeMembers: 2, pendingInvites: 9 });
    assert.equal(l.seatsInvited, 2);
  });

  it("garbage inputs read as zero, never NaN", () => {
    const l = computeSeatLedger({ maxRedemptions: 5, timesRedeemed: Number.NaN, activeMembers: -3 });
    assert.deepEqual(l, { seatsTotal: 5, seatsClaimed: 0, seatsActive: 0, seatsFree: 5, seatsInvited: 0, offersOpen: 0, staffCount: null, staffTotal: null });
  });

  it("the line says claimed and active plainly", () => {
    assert.equal(
      seatLedgerLine(computeSeatLedger({ maxRedemptions: 10, timesRedeemed: 3, activeMembers: 2 })),
      "3 of 10 seats claimed, 2 active now, 7 free."
    );
    assert.equal(
      seatLedgerLine(computeSeatLedger({ maxRedemptions: null, timesRedeemed: 3, activeMembers: 2 })),
      "No seat limit. 3 claimed, 2 active now."
    );
  });

  it("staff places read N of M, and stay silent when not read", () => {
    assert.equal(staffLedgerLine(computeSeatLedger({ maxRedemptions: 5, timesRedeemed: 1, activeMembers: 1, staffCount: 3, maxStaff: 10 })), "3 of 10 staff");
    assert.equal(staffLedgerLine(computeSeatLedger({ maxRedemptions: 5, timesRedeemed: 1, activeMembers: 1 })), null);
  });
});

describe("open offers are counted beside the invited number, never inside it", () => {
  it("the ledger line says how many offers are open and that they hold no seat", () => {
    const l = computeSeatLedger({ maxRedemptions: 10, timesRedeemed: 3, activeMembers: 3, pendingInvites: 1, openOffers: 2 });
    assert.equal(l.seatsInvited, 1);
    assert.equal(l.offersOpen, 2);
    assert.equal(l.seatsClaimed, 3, "offers spend nothing");
    assert.equal(seatLedgerLine(l), "3 of 10 seats claimed, 3 active now, 7 free. 2 offers open, holding no seat until accepted.");
    assert.equal(seatLedgerLine(computeSeatLedger({ maxRedemptions: null, timesRedeemed: 0, activeMembers: 0, openOffers: 1 })),
      "No seat limit. 0 claimed, 0 active now. 1 offer open, holding no seat until accepted.");
    assert.doesNotMatch(seatLedgerLine(computeSeatLedger({ maxRedemptions: 5, timesRedeemed: 0, activeMembers: 0 })), /offer/);
  });
  it("Insights and both ledger reads count offers the way the Invited list shows them", async () => {
    const { readFileSync } = await import("node:fs");
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
    for (const f of ["../orgSeats.ts", "../orgInsights.ts", "../../../../apps/consumer/app/api/dev/orgs/route.ts"]) {
      assert.match(src(f), /oi\.offer_status IN \('offered', 'declined'\)/, f);
    }
    assert.match(src("../orgInsights.ts"), /oi\.offer_status IS NULL AND u\."emailVerified" IS NULL/, "the invited number excludes offers");
    const page = src("../../../../apps/consumer/components/org/InsightsReport.tsx");
    assert.match(page, /New invites only, and \$\{d\.people\.offersOpen\}/);
    assert.match(src("../../../../apps/consumer/lib/org-insights-report.ts"), /"Offers open", i\.people\.offersOpen/);
  });
});
