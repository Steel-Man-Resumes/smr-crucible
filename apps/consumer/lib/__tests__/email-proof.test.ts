/**
 * Pre-hijack fix (F3, confirm-or-remove design), tested as the claims:
 *  - an email-link or Google sign-in on a never-proven account ASKS, it never
 *    removes anything by itself;
 *  - two-step on: the code page with "I didn't set up two-step"; a password and
 *    no two-step: "Enter your password to keep it"; neither: just proven;
 *  - a proven account is never asked and never touched;
 *  - "I didn't set this" removes password and two-step, signs out every OTHER
 *    session, and marks the address proven, in one transaction, and does
 *    nothing on an account proven in the meantime;
 *  - before migration 068 runs, nothing happens.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMAIL_PROOF_NEEDED,
  claimForInboxProof,
  isEmailProven,
  markEmailProven,
  readProofState,
  wipeUnprovenCredentials,
} from "../email-proof";
import type { Db } from "../session-registry";

function fakeClient(opts: { updateRows?: number; missingColumn?: boolean; row?: Record<string, unknown> | null } = {}) {
  const calls: { text: string; params: unknown[] }[] = [];
  const db: Db = {
    async query(text: string, params: unknown[] = []) {
      const t = text.replace(/\s+/g, " ").trim();
      calls.push({ text: t, params });
      if (opts.missingColumn && /email_proven_at/.test(t)) {
        throw Object.assign(new Error("column does not exist"), { code: "42703" });
      }
      if (t.startsWith("SELECT email_proven_at")) {
        const row = opts.row === undefined ? null : opts.row;
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (t.startsWith("UPDATE users SET password_hash = NULL")) {
        const n = opts.updateRows ?? 1;
        return { rows: n ? [{ id: "u1" }] : [], rowCount: n };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  return { db, calls };
}

describe("claimForInboxProof", () => {
  it("asks for the code (with the extra option) on a never-proven two-step account", () => {
    assert.equal(claimForInboxProof({ provenAt: null, hasPassword: true, twoFactor: true }), "2fa");
    assert.equal(claimForInboxProof({ provenAt: null, hasPassword: false, twoFactor: true }), "2fa");
  });
  it("asks for the password on a never-proven account with a password and no two-step", () => {
    assert.equal(claimForInboxProof({ provenAt: null, hasPassword: true, twoFactor: false }), "password");
  });
  it("just marks proven when there is nothing to ask about", () => {
    assert.equal(claimForInboxProof({ provenAt: null, hasPassword: false, twoFactor: false }), "prove");
  });
  it("never asks on a proven account", () => {
    assert.equal(claimForInboxProof({ provenAt: new Date(), hasPassword: true, twoFactor: true }), "none");
  });
});

describe("readProofState / markEmailProven before migration 068", () => {
  it("reports unavailable and changes nothing", async () => {
    const { db } = fakeClient({ missingColumn: true });
    assert.equal(await readProofState(db, "u1"), null);
    await markEmailProven(db, "u1"); // does not throw
  });
  it("reads the state when the column exists", async () => {
    const { db } = fakeClient({ row: { email_proven_at: null, has_password: true, two_factor_enabled: false } });
    assert.deepEqual(await readProofState(db, "u1"), { provenAt: null, hasPassword: true, twoFactor: false });
  });
});

describe("wipeUnprovenCredentials (\"I didn't set this\")", () => {
  it("removes password and two-step, signs out every other session, marks proven, in one transaction", async () => {
    const { db, calls } = fakeClient();
    assert.equal(await wipeUnprovenCredentials(db, { userId: "u1", keepSid: "mine", userAgent: "ua" }), "wiped");
    const i = (re: RegExp) => calls.findIndex((c) => re.test(c.text));
    assert.equal(i(/^BEGIN$/), 0);
    assert.ok(i(/password_hash = NULL, two_factor_enabled = false, email_proven_at = now\(\) WHERE id = \$1 AND email_proven_at IS NULL/) > 0);
    assert.ok(i(/DELETE FROM user_two_factor/) > 0);
    // Google (OAuth) links set up by whoever set the password go too.
    const oauth = calls.find((c) => /^DELETE FROM accounts WHERE "userId" = \$1$/.test(c.text));
    assert.deepEqual(oauth?.params, ["u1"]);
    const revoke = calls.find((c) => /UPDATE user_session SET revoked_at/.test(c.text));
    assert.deepEqual(revoke?.params, ["u1", "mine"]); // the caller's own session is kept
    assert.ok(i(/'credentials_cleared'/) > 0);
    assert.equal(calls[calls.length - 1].text, "COMMIT");
  });

  it("changes nothing on an account proven in the meantime", async () => {
    const { db, calls } = fakeClient({ updateRows: 0 });
    assert.equal(await wipeUnprovenCredentials(db, { userId: "u1", keepSid: "mine" }), "already-proven");
    assert.ok(!calls.some((c) => /DELETE|user_session/.test(c.text))); // no OAuth rows removed either
    assert.equal(calls[calls.length - 1].text, "ROLLBACK");
  });
});

describe("two-step needs a proven email (S1)", () => {
  function db(row: { email_proven_at: unknown } | null, missingColumn = false): Db {
    return {
      async query() {
        if (missingColumn) throw Object.assign(new Error("column does not exist"), { code: "42703" });
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      },
    };
  }
  it("blocks turning two-step on until the address is proven", async () => {
    assert.equal(await isEmailProven(db({ email_proven_at: null }), "u1"), false);
    assert.equal(await isEmailProven(db({ email_proven_at: new Date() }), "u1"), true);
  });
  it("blocks nothing before migration 068 runs", async () => {
    assert.equal(await isEmailProven(db(null, true), "u1"), true);
  });
  it("tells the settings page why, in plain words", () => {
    assert.equal(EMAIL_PROOF_NEEDED.needsEmailProof, true);
    assert.ok(!/\u2014| -- /.test(EMAIL_PROOF_NEEDED.error));
  });
});
