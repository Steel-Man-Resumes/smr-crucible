/**
 * Second-factor check (F10), tested as the claims:
 *  - a TOTP code is accepted once; the same code (same time step) is refused;
 *  - a 6-digit code never runs the bcrypt backup-code loop;
 *  - a backup code is accepted in its printed form, any case, with or without
 *    the dash, and only once.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import {
  generateSecret,
  generateToken,
  isTotpFormat,
  matchTotpStep,
  normalizeBackupCode,
} from "../two-factor";
import { verifySecondFactor } from "../second-factor";
import type { Db } from "../session-registry";

/** In-memory user_two_factor row with the same UPDATE semantics the code relies on. */
function fakeTwoFactorDb(row: { secret: string; backup_codes: string[]; last_totp_step: number | null }) {
  let selects = 0;
  const db: Db = {
    async query(text: string, params: any[] = []) {
      if (/^\s*SELECT secret/.test(text)) {
        selects++;
        return { rows: [{ ...row, secret_iv: "x", secret_tag: null, secret_key_version: null }], rowCount: 1 };
      }
      if (/SET last_totp_step/.test(text)) {
        const step = params[1] as number;
        if (row.last_totp_step === null || row.last_totp_step < step) {
          row.last_totp_step = step;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (/SET backup_codes/.test(text)) {
        if (JSON.stringify(row.backup_codes) !== params[1]) return { rows: [], rowCount: 0 };
        row.backup_codes = JSON.parse(params[2]);
        return { rows: [], rowCount: 1 };
      }
      throw new Error("unexpected query: " + text);
    },
  };
  return { db, row, selectCount: () => selects };
}

describe("code shapes", () => {
  it("tells a TOTP code from a backup code", () => {
    assert.equal(isTotpFormat("123456"), true);
    assert.equal(isTotpFormat("123 456"), true);
    assert.equal(isTotpFormat("1234567"), false);
    assert.equal(normalizeBackupCode("ab12c-3d4e5"), "ab12c-3d4e5");
    assert.equal(normalizeBackupCode("AB12C3D4E5"), "ab12c-3d4e5");
    assert.equal(normalizeBackupCode(" ab12c - 3d4e5 "), "ab12c-3d4e5");
    assert.equal(normalizeBackupCode("123456"), null);
    assert.equal(normalizeBackupCode("zzzzz-zzzzz"), null);
  });

  it("reports the matched time step, within one step of drift", () => {
    const secret = generateSecret();
    const t = Date.parse("2026-10-03T12:00:10Z");
    const step = Math.floor(t / 1000 / 30);
    assert.equal(matchTotpStep(generateToken(secret, t), secret, t), step);
    assert.equal(matchTotpStep(generateToken(secret, t - 30_000), secret, t), step - 1);
    assert.equal(matchTotpStep(generateToken(secret, t - 90_000), secret, t), null);
  });
});

describe("verifySecondFactor", () => {
  it("accepts a TOTP code once and refuses it the second time (replay)", async () => {
    const secret = generateSecret();
    const now = Date.parse("2026-10-03T12:00:10Z");
    const { db } = fakeTwoFactorDb({ secret, backup_codes: [], last_totp_step: null });
    // secret_iv "x" with no tag: resolveTotpSecret treats the row as legacy plaintext.
    const code = generateToken(secret, now);
    assert.deepEqual(await verifySecondFactor(db, "u1", code, now), { ok: true, method: "totp" });
    assert.deepEqual(await verifySecondFactor(db, "u1", code, now + 5_000), { ok: false, reason: "replay" });
    // An older code (previous step, still inside the drift window) is refused too.
    assert.deepEqual(
      await verifySecondFactor(db, "u1", generateToken(secret, now - 30_000), now),
      { ok: false, reason: "replay" }
    );
    // The next step's code is fine.
    assert.deepEqual(
      await verifySecondFactor(db, "u1", generateToken(secret, now + 30_000), now + 30_000),
      { ok: true, method: "totp" }
    );
  });

  it("never checks backup codes for a 6-digit code", async () => {
    const secret = generateSecret();
    const { db } = fakeTwoFactorDb({ secret, backup_codes: ["not-a-bcrypt-hash"], last_totp_step: null });
    // If the backup loop ran, bcrypt.compare against a malformed hash would be reached;
    // a mismatch here (not a throw, not ok) shows only the TOTP path ran.
    assert.deepEqual(await verifySecondFactor(db, "u1", "000000"), { ok: false, reason: "mismatch" });
  });

  it("refuses input shaped like neither, without reading the database", async () => {
    const noDb: Db = { query: async () => { throw new Error("should not query"); } };
    assert.deepEqual(await verifySecondFactor(noDb, "u1", "hello"), { ok: false, reason: "format" });
    assert.deepEqual(await verifySecondFactor(noDb, "u1", ""), { ok: false, reason: "format" });
  });

  it("accepts a backup code in any case and without the dash, once", async () => {
    const secret = generateSecret();
    const hashes = [await bcrypt.hash("ab12c-3d4e5", 4), await bcrypt.hash("99999-00000", 4)];
    const { db, row } = fakeTwoFactorDb({ secret, backup_codes: hashes, last_totp_step: null });
    assert.deepEqual(await verifySecondFactor(db, "u1", "AB12C3D4E5"), { ok: true, method: "backup" });
    assert.equal(row.backup_codes.length, 1);
    assert.deepEqual(await verifySecondFactor(db, "u1", "ab12c-3d4e5"), { ok: false, reason: "mismatch" });
  });
});
