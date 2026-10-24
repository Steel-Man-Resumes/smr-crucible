/**
 * Invites and offers share the Invited list, so every answer staff can see
 * must be the same for both (security review 3, SF-8 and N-21; CRM re-check).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  touchOrgInviteResend,
  inviteActionAllowed,
  PENDING_INVITE_LIST_SQL,
  RESEND_TOO_SOON,
  RESEND_WINDOW_HOURS,
  RESEND_LIMIT_REACHED,
  ALREADY_INVITED,
  type ResendRow,
} from "../orgInvite";
import { OFFER_WINDOW_HOURS } from "../refineryAccess";

const SRC = readFileSync(new URL("../orgInvite.ts", import.meta.url), "utf8");

/** A fake database: the read returns `row`; the windowed UPDATE returns `touched`. */
function fakeDb(row: ResendRow | null, touched: boolean) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    deps: {
      getOne: async <T,>(sql: string, params: unknown[] = []): Promise<T | null> => {
        calls.push({ sql, params });
        if (/^\s*SELECT/.test(sql)) return row as T | null;
        return (touched ? { ok: true } : null) as T | null;
      },
    },
  };
}

const offerRow: ResendRow = { email: "a@example.org", name: "Account Name", invited_name: "Typed Name", send_count: 1, pending: false, offer_status: "offered" };
const inviteRow: ResendRow = { email: "b@example.org", name: "Typed Name", invited_name: "Typed Name", send_count: 1, pending: true, offer_status: null };

describe("resend: one window and one message for an offer and an invite (SF-8)", () => {
  it("a too-early resend returns the identical refusal, same shape, for both kinds", async () => {
    const o = fakeDb(offerRow, false);
    const i = fakeDb(inviteRow, false);
    const ro = await touchOrgInviteResend("org", "u1", o.deps);
    const ri = await touchOrgInviteResend("org", "u2", i.deps);
    assert.deepEqual(ro, { ok: false, error: RESEND_TOO_SOON });
    assert.deepEqual(ri, ro);
    assert.deepEqual(Object.keys(ri), Object.keys(ro));
  });

  it("both kinds use one windowed UPDATE with the same 24-hour window", async () => {
    const o = fakeDb(offerRow, false);
    const i = fakeDb(inviteRow, false);
    await touchOrgInviteResend("org", "u1", o.deps);
    await touchOrgInviteResend("org", "u2", i.deps);
    assert.equal(RESEND_WINDOW_HOURS, 24);
    assert.equal(RESEND_WINDOW_HOURS, OFFER_WINDOW_HOURS);
    const uo = o.calls.find((c) => /UPDATE org_invite/.test(c.sql))!;
    const ui = i.calls.find((c) => /UPDATE org_invite/.test(c.sql))!;
    assert.equal(uo.sql, ui.sql, "one statement for both kinds");
    assert.deepEqual(uo.params.slice(2), [24]);
    assert.deepEqual(ui.params.slice(2), [24]);
    assert.match(uo.sql, /last_sent_at <= now\(\) - make_interval\(hours => \$3\)/);
    assert.doesNotMatch(SRC, /60_000|Give it a minute/, "no one-minute invite window left");
  });

  it("the resend limit reads the same for both kinds", async () => {
    const ro = await touchOrgInviteResend("org", "u1", fakeDb({ ...offerRow, send_count: 10 }, true).deps);
    const ri = await touchOrgInviteResend("org", "u2", fakeDb({ ...inviteRow, send_count: 10 }, true).deps);
    assert.deepEqual(ro, { ok: false, error: RESEND_LIMIT_REACHED });
    assert.deepEqual(ri, ro);
  });

  it("an open offer is resent (not 'already joined'), with the typed name and the offer email", async () => {
    const r = await touchOrgInviteResend("org", "u1", fakeDb(offerRow, true).deps);
    assert.deepEqual(r, { ok: true, email: "a@example.org", name: "Typed Name", offer: true });
    const ri = await touchOrgInviteResend("org", "u2", fakeDb(inviteRow, true).deps);
    assert.deepEqual(ri, { ok: true, email: "b@example.org", name: "Typed Name", offer: false });
    assert.deepEqual(Object.keys(r), Object.keys(ri));
  });

  it("a joined offer answers like a joined invite", async () => {
    const ro = await touchOrgInviteResend("org", "u1", fakeDb({ ...offerRow, offer_status: "joined" }, true).deps);
    const ri = await touchOrgInviteResend("org", "u2", fakeDb({ ...inviteRow, pending: false }, true).deps);
    assert.equal(ro.ok, false);
    assert.deepEqual(ro, ri);
  });
});

describe("the Invited list carries offers, labelled like invites (CRM re-check)", () => {
  it("lists open offers beside never-signed-in invites, with the org's typed name and email", () => {
    assert.match(PENDING_INVITE_LIST_SQL, /oi\.offer_status = 'offered' OR \(oi\.offer_status IS NULL AND/);
    assert.match(PENDING_INVITE_LIST_SQL, /WHEN oi\.offer_status = 'offered' THEN oi\.invited_name ELSE u\.name END AS name/);
    assert.match(PENDING_INVITE_LIST_SQL, /COALESCE\(oi\.invited_email, u\.email\)/);
    assert.doesNotMatch(PENDING_INVITE_LIST_SQL, /offer_status AS|AS kind|AS offer/, "no kind column in the list");
    const fn = SRC.slice(SRC.indexOf("export async function getOrgPendingInvites"), SRC.indexOf("export async function createOrgInvite"));
    assert.match(fn, /PENDING_INVITE_LIST_SQL/);
    assert.doesNotMatch(fn, /offer/i, "the row shape has no offer field");
  });

  it("offer rows are handled before the 'already joined' answer on resend and remove", () => {
    const revoke = SRC.slice(SRC.indexOf("export async function revokeOrgInvite"));
    assert.ok(revoke.indexOf('row.offer_status === "offered"') < revoke.indexOf("if (!row.pending)"));
    assert.match(revoke, /smr_withdraw_seat_offer\(/);
    const resend = SRC.slice(SRC.indexOf("export async function touchOrgInviteResend"), SRC.indexOf("export async function revokeOrgInvite"));
    assert.ok(resend.indexOf('row.offer_status === "offered"') < resend.indexOf("if (!row.pending)"));
  });

  it("re-adding a listed person gets one answer, invite or offer, before the membership check", () => {
    const create = SRC.slice(SRC.indexOf("export async function createOrgInvite"), SRC.indexOf("export async function getOrgInviteSender"));
    const listed = create.indexOf("ALREADY_INVITED");
    assert.ok(listed > 0 && listed < create.indexOf("smr_invite_binding"));
    assert.doesNotMatch(ALREADY_INVITED, /account|offer/i);
  });
});

describe("offer resend and withdraw pass the same capability check as invites (N-21)", () => {
  const caps = (...c: string[]) => new Set(c);
  it("needs Invite participants", () => {
    assert.equal(inviteActionAllowed({ capabilities: caps("org.client.view_all"), actorUserId: "s", invitedBy: "s" }), false);
  });
  it("caseload-only staff act only on what they sent, offer or invite alike", () => {
    const c = caps("org.participant.invite");
    assert.equal(inviteActionAllowed({ capabilities: c, actorUserId: "s", invitedBy: "s" }), true);
    assert.equal(inviteActionAllowed({ capabilities: c, actorUserId: "s", invitedBy: "other" }), false);
    assert.equal(inviteActionAllowed({ capabilities: c, actorUserId: "s", invitedBy: null }), false);
    assert.equal(inviteActionAllowed({ capabilities: c, actorUserId: "s", invitedBy: undefined }), false);
  });
  it("whole-org viewers act on any listed row", () => {
    assert.equal(inviteActionAllowed({ capabilities: caps("org.participant.invite", "org.client.view_all"), actorUserId: "a", invitedBy: "other" }), true);
  });
  it("an offer row records who sent it, so the sender check has something to read", () => {
    assert.match(SRC, /INSERT INTO org_invite \(access_code_id, user_id, invited_by, invited_name, invited_email, offer_status\)/);
    // The sender lookup does not skip offer rows.
    const sender = SRC.slice(SRC.indexOf("export async function getOrgInviteSender"), SRC.indexOf("export function inviteActionAllowed"));
    assert.doesNotMatch(sender, /offer_status/);
  });
});
