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
import { OFFER_RELIST_SQL } from "../orgInvite";

const SRC = readFileSync(new URL("../orgInvite.ts", import.meta.url), "utf8");

/** A fake database: the read returns `row`; the windowed UPDATE returns `touched`. */
function fakeDb(row: ResendRow | null, touched: boolean) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const opened: string[] = [];
  return {
    calls,
    opened,
    deps: {
      getOne: async <T,>(sql: string, params: unknown[] = []): Promise<T | null> => {
        calls.push({ sql, params });
        if (/^\s*SELECT/.test(sql)) return row as T | null;
        return (touched ? { ok: true } : null) as T | null;
      },
      openOffer: async (org: string, user: string, actor: string) => { opened.push(`${org}:${user}:${actor}`); },
    },
  };
}
const run = (row: ResendRow | null, touched: boolean, user = "u1") => {
  const f = fakeDb(row, touched);
  return { f, out: touchOrgInviteResend("org", user, { actorUserId: "staff-1", deps: f.deps }) };
};

const offerRow: ResendRow = { email: "a@example.org", name: "Account Name", invited_name: "Typed Name", send_count: 1, pending: false, offer_status: "offered" };
const inviteRow: ResendRow = { email: "b@example.org", name: "Typed Name", invited_name: "Typed Name", send_count: 1, pending: true, offer_status: null };

describe("resend: one window and one message for an offer and an invite (SF-8)", () => {
  it("a too-early resend returns the identical refusal, same shape, for both kinds", async () => {
    const o = fakeDb(offerRow, false);
    const i = fakeDb(inviteRow, false);
    const ro = await touchOrgInviteResend("org", "u1", { deps: o.deps });
    const ri = await touchOrgInviteResend("org", "u2", { deps: i.deps });
    assert.deepEqual(ro, { ok: false, error: RESEND_TOO_SOON });
    assert.deepEqual(ri, ro);
    assert.deepEqual(Object.keys(ri), Object.keys(ro));
  });

  it("both kinds use one windowed UPDATE with the same 24-hour window", async () => {
    const o = fakeDb(offerRow, false);
    const i = fakeDb(inviteRow, false);
    await touchOrgInviteResend("org", "u1", { deps: o.deps });
    await touchOrgInviteResend("org", "u2", { deps: i.deps });
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
    const ro = await touchOrgInviteResend("org", "u1", { deps: fakeDb({ ...offerRow, send_count: 10 }, true).deps });
    const ri = await touchOrgInviteResend("org", "u2", { deps: fakeDb({ ...inviteRow, send_count: 10 }, true).deps });
    assert.deepEqual(ro, { ok: false, error: RESEND_LIMIT_REACHED });
    assert.deepEqual(ri, ro);
  });

  it("an open offer is resent (not 'already joined'), with the typed name and the offer email", async () => {
    const r = await touchOrgInviteResend("org", "u1", { deps: fakeDb(offerRow, true).deps });
    assert.deepEqual(r, { ok: true, email: "a@example.org", name: "Typed Name", offer: true });
    const ri = await touchOrgInviteResend("org", "u2", { deps: fakeDb(inviteRow, true).deps });
    assert.deepEqual(ri, { ok: true, email: "b@example.org", name: "Typed Name", offer: false });
    assert.deepEqual(Object.keys(r), Object.keys(ri));
  });

  it("a joined offer answers like a joined invite", async () => {
    const ro = await touchOrgInviteResend("org", "u1", { deps: fakeDb({ ...offerRow, offer_status: "joined" }, true).deps });
    const ri = await touchOrgInviteResend("org", "u2", { deps: fakeDb({ ...inviteRow, pending: false }, true).deps });
    assert.equal(ro.ok, false);
    assert.deepEqual(ro, ri);
  });
});

describe("the Invited list carries offers, labelled like invites (CRM re-check)", () => {
  it("lists open offers beside never-signed-in invites, with the org's typed name and email", () => {
    assert.match(PENDING_INVITE_LIST_SQL, /oi\.offer_status IN \('offered', 'declined'\) OR \(oi\.offer_status IS NULL AND/);
    assert.match(PENDING_INVITE_LIST_SQL, /WHEN oi\.offer_status IS NOT NULL THEN oi\.invited_name ELSE u\.name END AS name/);
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

describe("a declined or withdrawn offer behaves like an invite nobody answered (boss ruling 2026-10-23)", () => {
  const declined: ResendRow = { ...offerRow, offer_status: "declined" };
  it("a declined offer is listed, and re-adding it gets the listed answer, like an unanswered invite", () => {
    assert.match(SRC, /const LISTED_SQL = `\(oi\.offer_status IN \('offered', 'declined'\) OR \(oi\.offer_status IS NULL AND/);
    assert.match(PENDING_INVITE_LIST_SQL, /\$\{LISTED_SQL\}|offer_status IN \('offered', 'declined'\)/);
    const create = SRC.slice(SRC.indexOf("export async function createOrgInvite"), SRC.indexOf("export async function openListedOffer"));
    assert.match(create, /AND \$\{LISTED_SQL\}`/, "the re-add check uses the same list predicate");
  });
  it("resending a declined offer too early is refused with the one message; it never says 'declined'", async () => {
    const { f, out } = run(declined, false);
    assert.deepEqual(await out, { ok: false, error: RESEND_TOO_SOON });
    assert.deepEqual(f.opened, [], "no new offer inside the window");
    const staffText = [...SRC.matchAll(/error: "([^"]*)"/g), ...SRC.matchAll(/^(?:export )?const [A-Z_]+ = "([^"]*)";/gm)].map((m) => m[1]);
    assert.ok(staffText.length >= 8);
    for (const t of staffText) assert.doesNotMatch(t, /declin/i, "no staff text mentions a decline");
  });
  it("after the window a declined offer is asked again: offer email, a pending offer re-opened by the sender", async () => {
    const { f, out } = run(declined, true);
    assert.deepEqual(await out, { ok: true, email: "a@example.org", name: "Typed Name", offer: true });
    assert.deepEqual(f.opened, ["org:u1:staff-1"]);
    const upd = f.calls.find((c) => /UPDATE org_invite/.test(c.sql))!;
    assert.match(upd.sql, /offer_status = CASE WHEN oi\.offer_status = 'declined' THEN 'offered'/);
  });
  it("an open offer resend also makes sure the offer is pending; an invite resend opens none", async () => {
    const o = run(offerRow, true); await o.out;
    assert.deepEqual(o.f.opened, ["org:u1:staff-1"]);
    const i = run(inviteRow, true, "u2"); await i.out;
    assert.deepEqual(i.f.opened, []);
  });
  it("re-adding a withdrawn offer relists at once with the typed name and sends only after the window", () => {
    assert.match(OFFER_RELIST_SQL, /offer_status = 'offered'/);
    assert.match(OFFER_RELIST_SQL, /invited_name = EXCLUDED\.invited_name/);
    assert.match(OFFER_RELIST_SQL, /invited_at = NOW\(\), send_count = 1/);
    assert.match(OFFER_RELIST_SQL, /last_sent_at = CASE WHEN org_invite\.last_sent_at <= now\(\) - make_interval\(hours => \$6\)\s*THEN NOW\(\) ELSE org_invite\.last_sent_at END/);
    assert.match(OFFER_RELIST_SQL, /RETURNING \(last_sent_at = now\(\)\) AS sent/);
    const open = SRC.slice(SRC.indexOf("export async function openListedOffer"), SRC.indexOf("/** Who sent this organization"));
    assert.match(open, /createSeatOffer\(\{[^}]*windowHours: 0 \}\)/, "an earlier answer does not block a new offer, only an open one");
    assert.match(open, /OFFER_WINDOW_HOURS,\s*\]\)/);
    const create = SRC.slice(SRC.indexOf("export async function createOrgInvite"), SRC.indexOf("export async function openListedOffer"));
    assert.match(create, /const sent = await openListedOffer\([\s\S]*return \{ ok: true, userId, kind: "offered", notify: sent \}/);
  });
  it("Remove takes a declined offer off the list like an open one", () => {
    const revoke = SRC.slice(SRC.indexOf("export async function revokeOrgInvite"));
    assert.match(revoke, /row\.offer_status === "offered" \|\| row\.offer_status === "declined"/);
    assert.match(revoke, /SET offer_status = 'withdrawn'[\s\S]*offer_status IN \('offered', 'declined'\)/);
  });
});
