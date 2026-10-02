/**
 * Pre-hijack fix (F3), tested as the claims:
 *  - the first inbox proof on an unproven account with a password or two-step
 *    wipes them, signs out every session and marks it proven, in one transaction;
 *  - an unproven account with nothing to wipe is just marked proven;
 *  - a proven account is never touched;
 *  - a reset keeps the owner's new password but still removes two-step;
 *  - before migration 068 runs, nothing happens.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyInboxProof, inboxProofAction } from "../email-proof";

function fakePool(row: Record<string, unknown> | null, opts: { missingColumn?: boolean } = {}) {
  const calls: string[] = [];
  const client = {
    async query(text: string) {
      const t = text.replace(/\s+/g, " ").trim();
      calls.push(t);
      if (t.startsWith("SELECT id, email_proven_at")) {
        if (opts.missingColumn) throw Object.assign(new Error("column does not exist"), { code: "42703" });
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (t.startsWith("UPDATE users SET")) return { rows: [{ id: "u1" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return { pool: { connect: async () => client }, calls };
}

describe("inboxProofAction", () => {
  it("wipes an unproven account that has a password or two-step", () => {
    assert.equal(inboxProofAction({ provenAt: null, hasPassword: true, twoFactor: false }, { clearPassword: true }), "wipe");
    assert.equal(inboxProofAction({ provenAt: null, hasPassword: false, twoFactor: true }, { clearPassword: true }), "wipe");
  });
  it("only marks proven when there is nothing to wipe", () => {
    assert.equal(inboxProofAction({ provenAt: null, hasPassword: false, twoFactor: false }, { clearPassword: true }), "prove");
    // A reset just set the owner's own password: nothing else to remove.
    assert.equal(inboxProofAction({ provenAt: null, hasPassword: true, twoFactor: false }, { clearPassword: false }), "prove");
  });
  it("never touches a proven account", () => {
    assert.equal(inboxProofAction({ provenAt: new Date(), hasPassword: true, twoFactor: true }, { clearPassword: true }), "none");
  });
});

describe("applyInboxProof", () => {
  it("wipes in one transaction: password, two-step, sessions, then proven", async () => {
    const { pool, calls } = fakePool({ id: "u1", email_proven_at: null, has_password: true, two_factor_enabled: true });
    assert.equal(await applyInboxProof(pool as any, "a@example.org", { clearPassword: true, revokeSessions: true }), "wiped");
    const i = (re: RegExp) => calls.findIndex((c) => re.test(c));
    assert.ok(i(/^BEGIN$/) > 0);
    assert.ok(i(/password_hash = NULL, two_factor_enabled = false, email_proven_at = now\(\)/) > i(/^BEGIN$/));
    assert.ok(i(/DELETE FROM user_two_factor/) > 0);
    assert.ok(i(/UPDATE user_session SET revoked_at/) > 0);
    assert.ok(i(/'credentials_cleared'/) > 0);
    assert.ok(i(/^COMMIT$/) > i(/'credentials_cleared'/));
  });

  it("on a reset keeps the new password but removes two-step", async () => {
    const { pool, calls } = fakePool({ id: "u1", email_proven_at: null, has_password: true, two_factor_enabled: true });
    assert.equal(await applyInboxProof(pool as any, "a@example.org", { clearPassword: false, revokeSessions: false }), "wiped");
    assert.ok(calls.some((c) => /SET two_factor_enabled = false, email_proven_at = now\(\)/.test(c)));
    assert.ok(!calls.some((c) => /password_hash = NULL/.test(c)));
    assert.ok(!calls.some((c) => /user_session/.test(c)));
  });

  it("marks a credential-free unproven account proven without a wipe", async () => {
    const { pool, calls } = fakePool({ id: "u1", email_proven_at: null, has_password: false, two_factor_enabled: false });
    assert.equal(await applyInboxProof(pool as any, "a@example.org", { clearPassword: true, revokeSessions: true }), "proven");
    assert.ok(!calls.some((c) => /BEGIN|DELETE/.test(c)));
  });

  it("does nothing for a proven account, a new address, or before migration 068", async () => {
    assert.equal(
      await applyInboxProof(fakePool({ id: "u1", email_proven_at: new Date(), has_password: true, two_factor_enabled: true }).pool as any, "a@example.org", { clearPassword: true, revokeSessions: true }),
      "none"
    );
    assert.equal(await applyInboxProof(fakePool(null).pool as any, "new@example.org", { clearPassword: true, revokeSessions: true }), "none");
    assert.equal(
      await applyInboxProof(fakePool(null, { missingColumn: true }).pool as any, "a@example.org", { clearPassword: true, revokeSessions: true }),
      "unavailable"
    );
  });
});
