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
    const sql = readFileSync(join(__dirname, "..", "..", "migrations", "078_premium_access.sql"), "utf8");
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
