/**
 * Premium tools by entitlement (migration 078). The rules are pure, so they
 * are proven here with no database. The row-level security itself is proven
 * against the migration in PGlite (lane 3a Part 2 probe, outside the repo).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PREMIUM_TOOLS,
  checkGrantInput,
  grantIsLive,
  grantTools,
  isPremiumTool,
  resolvePremiumAccess,
} from "../premium";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const DAY = 86_400_000;
const ALL = [...PREMIUM_TOOLS];

describe("who gets the premium tools", () => {
  it("nobody by default", () => {
    const a = resolvePremiumAccess({ isAdmin: false, orgMember: false, grants: [], now: NOW });
    assert.deepEqual(a.open, []);
    assert.equal(a.openRequest, null);
  });

  it("a member of a sponsoring organization gets all three", () => {
    const a = resolvePremiumAccess({ isAdmin: false, orgMember: true, grants: [], now: NOW });
    assert.deepEqual(a.open, ALL);
    assert.equal(a.via.interview_coaching, "organization");
  });

  it("a platform admin gets all three", () => {
    assert.deepEqual(resolvePremiumAccess({ isAdmin: true, orgMember: false, grants: [], now: NOW }).open, ALL);
  });

  it("a grant opens exactly the tools it names, until it ends", () => {
    const g = { tools: ["interview_coaching"], ends_at: new Date(NOW + DAY).toISOString(), revoked_at: null };
    const a = resolvePremiumAccess({ isAdmin: false, orgMember: false, grants: [g], now: NOW });
    assert.deepEqual(a.open, ["interview_coaching"]);
    assert.equal(a.via.interview_coaching, "grant");
    assert.equal(a.grantEndsAt, new Date(NOW + DAY).toISOString());
    const later = resolvePremiumAccess({ isAdmin: false, orgMember: false, grants: [g], now: NOW + 2 * DAY });
    assert.deepEqual(later.open, [], "past its end date it opens nothing");
  });

  it("a revoked grant opens nothing", () => {
    const g = { tools: ALL, ends_at: null, revoked_at: new Date(NOW - 1000).toISOString() };
    assert.deepEqual(resolvePremiumAccess({ isAdmin: false, orgMember: false, grants: [g], now: NOW }).open, []);
  });

  it("a grant with no end date lasts until revoked", () => {
    assert.equal(grantIsLive({ tools: ALL, ends_at: null }, NOW + 3650 * DAY), true);
  });

  it("a tool name off the allowlist opens nothing, wherever it came from", () => {
    const g = { tools: ["paid_tier", "admin", "interview_coaching"], ends_at: null };
    assert.deepEqual(grantTools(g), ["interview_coaching"]);
    assert.deepEqual(grantTools({ tools: "interview_coaching", ends_at: null }), [], "not an array: nothing");
    assert.equal(isPremiumTool("one_click_apply"), true);
    assert.equal(isPremiumTool("__proto__"), false);
  });

  it("an open request is reported only for a real tool", () => {
    const at = new Date(NOW).toISOString();
    assert.deepEqual(
      resolvePremiumAccess({ isAdmin: false, orgMember: false, grants: [], openRequest: { tool: "resources", created_at: at }, now: NOW }).openRequest,
      { tool: "resources", createdAt: at }
    );
    assert.equal(
      resolvePremiumAccess({ isAdmin: false, orgMember: false, grants: [], openRequest: { tool: "x", created_at: at }, now: NOW }).openRequest,
      null
    );
  });
});

describe("the admin grant form", () => {
  const person = "00000000-0000-4000-8000-0000000000aa";

  it("needs a person, a tool and a reason", () => {
    assert.equal(checkGrantInput({ tools: ALL, reason: "Case manager asked" }, NOW).ok, false);
    assert.equal(checkGrantInput({ userId: person, tools: [], reason: "Case manager asked" }, NOW).ok, false);
    assert.equal(checkGrantInput({ userId: person, tools: ALL, reason: " " }, NOW).ok, false);
  });

  it("the end date is optional and must be ahead", () => {
    const ok = checkGrantInput({ userId: person, tools: ["resources"], reason: "Case manager asked" }, NOW);
    assert.ok(ok.ok && ok.value.endsAt === null);
    assert.equal(checkGrantInput({ userId: person, tools: ALL, reason: "Asked", endsAt: "2026-10-01" }, NOW).ok, false);
    assert.equal(checkGrantInput({ userId: person, tools: ALL, reason: "Asked", endsAt: "soon" }, NOW).ok, false);
    const dated = checkGrantInput({ userId: person, tools: ALL, reason: "Asked", endsAt: "2026-12-31" }, NOW);
    assert.ok(dated.ok && dated.value.endsAt === "2026-12-31T00:00:00.000Z");
  });

  it("unknown tool names are dropped, not stored", () => {
    const r = checkGrantInput({ userId: person, tools: ["resources", "everything"], reason: "Asked" }, NOW);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.value.tools, ["resources"]);
  });
});

describe("the migration and the code agree on the allowlist", () => {
  it("078's CHECKs name exactly PREMIUM_TOOLS", () => {
    const sql = readFileSync(join(__dirname, "..", "..", "migrations", "078_premium_and_package_email.sql"), "utf8");
    const lists = sql.match(/ARRAY\['resources', 'interview_coaching', 'one_click_apply'\]/g) ?? [];
    assert.ok(lists.length >= 2, "the default and the CHECK");
    assert.match(sql, /tool IN \('resources', 'interview_coaching', 'one_click_apply'\)/);
    assert.deepEqual(ALL, ["resources", "interview_coaching", "one_click_apply"]);
  });

  it("no price, no email: the module never mentions either", () => {
    const src = readFileSync(join(__dirname, "..", "premium.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /price|dollar|\$\d+\.\d\d|resend|sendEmail|fetch\(/i);
  });
});

describe("078 part 2: one automatic package email per finished version", () => {
  const sql = readFileSync(join(__dirname, "..", "..", "migrations", "078_premium_and_package_email.sql"), "utf8");
  it("the sent table is owner-only, forced, and never updated", () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS forge_package_email_sent/);
    assert.match(sql, /PRIMARY KEY \(user_id, version\)/);
    assert.match(sql, /version ~ '\^\[0-9a-f\]\{64\}\$'/);
    assert.match(sql, /ALTER TABLE forge_package_email_sent FORCE ROW LEVEL SECURITY/);
    for (const verb of ["SELECT", "INSERT", "DELETE"]) {
      assert.match(sql, new RegExp(`forge_package_email_sent_${verb.toLowerCase()} ON forge_package_email_sent FOR ${verb}`));
    }
    assert.doesNotMatch(sql, /forge_package_email_sent FOR UPDATE/);
    assert.match(sql, /GRANT SELECT, INSERT, DELETE ON forge_package_email_sent TO smr_app/);
    assert.match(sql, /DROP TABLE IF EXISTS forge_package_email_sent/, "rollback names it");
  });
  it("the switch defaults on and is additive", () => {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS forge_package_email BOOLEAN NOT NULL DEFAULT true/);
  });
});

describe("078 parts 3 and 4 (security review 3a Part 2 r1: M2, M1, L4)", () => {
  const sql = readFileSync(join(__dirname, "..", "..", "migrations", "078_premium_and_package_email.sql"), "utf8");
  it("proof source: add-only, known values, real proofs after 068 kept, backfill left NULL", () => {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS email_proof_source TEXT/);
    assert.match(sql, /IN \('email_link', 'google', 'password_reset', 'recorded'\)/);
    assert.match(sql, /email_proven_at > backfill_at \+ interval '1 minute'/);
    assert.match(sql, /column_name = 'applied_at'/, "works when _migrations has no applied_at");
  });
  it("tablet plans: a lock count, a lock, and single use, all add-only with one-line rollbacks", () => {
    for (const c of ["pin_failures INTEGER NOT NULL DEFAULT 0", "locked_at TIMESTAMPTZ", "imported_at TIMESTAMPTZ", "imported_by UUID REFERENCES users\\(id\\) ON DELETE SET NULL"]) {
      assert.match(sql, new RegExp(`ALTER TABLE tablet_session ADD COLUMN IF NOT EXISTS ${c}`));
    }
    for (const c of ["pin_failures", "locked_at", "imported_at", "imported_by", "unlocked_at", "unlocked_by"]) {
      assert.match(sql, new RegExp(`^--   ALTER TABLE tablet_session DROP COLUMN IF EXISTS ${c};$`, "m"));
    }
    assert.match(sql, /^--   ALTER TABLE users DROP COLUMN IF EXISTS email_proof_source;$/m);
  });
});

describe("the person sees the sponsoring organization, not a reason", () => {
  it("orgName only when the access comes from an organization", () => {
    const a = resolvePremiumAccess({ isAdmin: false, orgMember: true, orgName: " Sample Reentry Center ", grants: [], now: NOW });
    assert.equal(a.orgName, "Sample Reentry Center");
    assert.equal(resolvePremiumAccess({ isAdmin: false, orgMember: false, orgName: "X", grants: [], now: NOW }).orgName, null);
  });
});

describe("r2 N1: the 'recorded' marking trusts the ledger only at a real backfill instant", () => {
  const sql = readFileSync(join(__dirname, "..", "..", "migrations", "078_premium_and_package_email.sql"), "utf8");
  const pre = readFileSync(join(__dirname, "..", "..", "migrations", "dry-run", "078_proof_source_preflight.sql"), "utf8");
  it("marks only when some account's email_proven_at equals the ledger time", () => {
    assert.match(sql, /IF backfill_at IS NOT NULL\s+AND EXISTS \(SELECT 1 FROM users WHERE email_proven_at = backfill_at\) THEN/);
  });
  it("the preflight is read-only: one SELECT, no writes of any kind", () => {
    const body = pre.replace(/--.*$/gm, "");
    assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|COMMENT|COPY|DO|CALL|SET|LOCK|VACUUM|REFRESH)\b/i);
    assert.match(body, /^\s*SELECT\b/);
    assert.equal(body.split(";").filter((x) => x.trim()).length, 1, "one statement");
    for (const col of ["at_backfill_instant", "ledger_is_backfill_instant", "most_common_instant", "would_mark"]) assert.match(body, new RegExp(`AS ${col}\\b`));
  });
});
