/**
 * The automatic package email needs a REAL proof of the address (security
 * review 3a Part 2 r1, M2). 068 backfilled email_proven_at on every older
 * account, typed addresses included, so 079 adds users.email_proof_source,
 * written only by a real proof: an email link, a Google sign-in Google
 * verified, or a password reset by email. One test per case.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { markEmailProven, proofSourceFor } from "../email-proof";
import type { Db } from "../session-registry";
import { autoResultLine, UNPROVEN_LINE } from "../email-package-auto-line";

const CONSUMER = join(__dirname, "..", "..");
const ROOT = join(CONSUMER, "..", "..");
const read = (...p: string[]) => readFileSync(join(CONSUMER, ...p), "utf8");

/** A tiny users table: one row, and the two UPDATE shapes markEmailProven sends. */
function usersDb(row: { email_proven_at: Date | null; email_proof_source: string | null }, opts: { sourceColumnMissing?: boolean } = {}) {
  const sent: string[] = [];
  const db: Db = {
    async query(text: string, params: unknown[] = []) {
      const t = text.replace(/\s+/g, " ").trim();
      sent.push(t);
      if (/email_proof_source/.test(t)) {
        if (opts.sourceColumnMissing) throw Object.assign(new Error("column does not exist"), { code: "42703" });
        const source = params[1] as string | null;
        if (row.email_proven_at === null || (source !== null && row.email_proof_source === null)) {
          row.email_proven_at = row.email_proven_at ?? new Date();
          row.email_proof_source = row.email_proof_source ?? source;
        }
        return { rows: [], rowCount: 1 };
      }
      if (/SET email_proven_at = now\(\) WHERE id = \$1 AND email_proven_at IS NULL/.test(t)) {
        if (row.email_proven_at === null) row.email_proven_at = new Date();
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { db, sent, row };
}

const BACKFILLED = () => ({ email_proven_at: new Date("2026-10-04T00:00:00Z"), email_proof_source: null as string | null });

describe("which sign-ins count as proof", () => {
  it("an email link and Google count; a password does not", () => {
    assert.equal(proofSourceFor("resend"), "email_link");
    assert.equal(proofSourceFor("google"), "google");
    assert.equal(proofSourceFor("password-login"), null);
    assert.equal(proofSourceFor(undefined), null);
  });
});

describe("one case each", () => {
  it("backfilled by 068 only: no source, so not proven for the automatic email", () => {
    const sql = readFileSync(join(ROOT, "packages", "core", "src", "packageEmail.ts"), "utf8");
    assert.match(sql, /\(email_proven_at IS NOT NULL AND email_proof_source IS NOT NULL\) AS proven/);
    assert.match(sql, /SELECT email, false AS proven FROM users/, "before 079: nobody is proven for it");
    assert.equal(autoResultLine({ sent: false, reason: "unproven" }), UNPROVEN_LINE);
    assert.equal(UNPROVEN_LINE, "Want it by email? Confirm your address first.");
  });

  it("a magic link on a backfilled account records the proof", async () => {
    const w = usersDb(BACKFILLED());
    await markEmailProven(w.db, "u1", proofSourceFor("resend"));
    assert.equal(w.row.email_proof_source, "email_link");
    assert.equal(w.row.email_proven_at?.toISOString(), "2026-10-04T00:00:00.000Z", "the proof time is never moved");
  });

  it("a verified Google sign-in on a backfilled account records the proof", async () => {
    const w = usersDb(BACKFILLED());
    await markEmailProven(w.db, "u1", proofSourceFor("google"));
    assert.equal(w.row.email_proof_source, "google");
  });

  it("a never-proven account proven by a link gets both the time and the source", async () => {
    const w = usersDb({ email_proven_at: null, email_proof_source: null });
    await markEmailProven(w.db, "u1", "email_link");
    assert.ok(w.row.email_proven_at);
    assert.equal(w.row.email_proof_source, "email_link");
  });

  it("an earlier source is never overwritten", async () => {
    const w = usersDb({ email_proven_at: new Date(), email_proof_source: "google" });
    await markEmailProven(w.db, "u1", "email_link");
    assert.equal(w.row.email_proof_source, "google");
  });

  it("before 079 the source column is missing and the old proof still works", async () => {
    const w = usersDb({ email_proven_at: null, email_proof_source: null }, { sourceColumnMissing: true });
    await markEmailProven(w.db, "u1", "email_link");
    assert.ok(w.row.email_proven_at);
    assert.equal(w.row.email_proof_source, null);
  });

  it("sign-in records the source on an already-proven (possibly backfilled) account too", () => {
    const auth = read("auth.ts");
    assert.match(auth, /if \(owed === "prove" \|\| owed === "none"\) await markEmailProven\(pool, token\.sub, proofSourceFor\(account\?\.provider\)\)/);
    // Google only counts for its own verified address (checked above it in auth.ts).
    assert.match(auth, /account\?\.provider === "resend" \|\| \(account\?\.provider === "google" && googleMatched\)/);
  });

  it("the claim paths record how the inbox was proven", () => {
    assert.match(read("app", "api", "auth", "mfa-verify", "route.ts"), /markEmailProven\(client, userId, proofSourceFor\(\(session\?\.user as any\)\?\.via\)\)/);
    assert.equal(read("app", "api", "auth", "claim-password", "route.ts").match(/markEmailProven\(client, userId, proofSourceFor\(via\)\)/g)?.length, 2);
    assert.match(read("app", "api", "auth", "claim-reset", "route.ts"), /if \(outcome === "wiped"\) await markEmailProven\(client, userId, proofSourceFor/);
  });

  it("a password reset by email records 'password_reset'", () => {
    assert.match(read("app", "api", "auth", "reset-password", "confirm", "route.ts"), /SET email_proof_source = 'password_reset'\s+WHERE id = \$1 AND email_proven_at IS NOT NULL AND email_proof_source IS NULL/);
  });

  it("the finish page offers the existing proof flow, a sign-in link to the account's own address", () => {
    const line = read("components", "forge", "finish", "FinishedEmailLine.tsx");
    assert.match(line, /signIn\("resend", \{ email: accountEmail, redirect: false, callbackUrl: "\/output" \}\)/);
    assert.match(line, /data-testid="finished-email-confirm"/);
  });

  it("079 adds the column add-only and keeps real proofs made between 068 and 079", () => {
    const sql = readFileSync(join(ROOT, "packages", "core", "migrations", "079_premium_and_package_email.sql"), "utf8");
    assert.match(sql, /ADD COLUMN IF NOT EXISTS email_proof_source TEXT/);
    assert.match(sql, /email_proven_at > backfill_at \+ interval '1 minute'/);
    assert.match(sql, /WHERE filename = '068_email_proven\.sql'/);
  });
});
