/**
 * Mini Forge PIN guards (security review 3a Part 2 r1: M1, L3, L4). Pure
 * rules with fake counters, plus the order of checks in the two pages.
 * Fictional ids only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalImportCode,
  canonicalTabletId,
  countPinTry,
  ipFromHeaders,
  MINI_FORGE_LOCK_AFTER,
  MINI_FORGE_MESSAGES,
  MINI_FORGE_TRIES,
  planStateBlock,
  validPin,
  type TryCounters,
} from "../mini-forge-guard";

const CONSUMER = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(CONSUMER, ...p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0fa1b2c3d4";

function counters(): TryCounters & { keys: Map<string, number> } {
  const keys = new Map<string, number>();
  const bump = async (k: string) => {
    const n = (keys.get(k) ?? 0) + 1;
    keys.set(k, n);
    return n;
  };
  return { keys, bucket: (k, e) => bump(`${e}|${k}`), account: (u, e) => bump(`acct:${e}|${u}`) };
}

describe("one plan, one spelling (M1)", () => {
  it("only the canonical lower-case hyphenated id is accepted", () => {
    assert.equal(canonicalTabletId(ID), ID);
    for (const v of [ID.toUpperCase(), ID.replace(/-/g, ""), `{${ID}}`, ID.replace("0a1b", "0A1B"), ` ${ID}`, `${ID} `, "0a1b2c3d4e5f-4a6b-8c7d-9e0fa1b2c3d4", null, undefined, 42]) {
      assert.equal(canonicalTabletId(v), null, String(v));
    }
  });
  it("codes are upper-cased and must use the generator's letters", () => {
    assert.equal(canonicalImportCode(" a7b3km "), "A7B3KM");
    for (const v of ["A7B3K", "A7B3KMX", "A7B3K0", "A7B3KI", "A7 3KM", 7]) assert.equal(canonicalImportCode(v), null, String(v));
    assert.ok(validPin("0042"));
    for (const v of ["42", "00421", "abcd", 1234]) assert.equal(validPin(v), false, String(v));
  });
});

describe("try limits (M1, L3)", () => {
  it("the 6th try on one plan is refused, whatever else changes", async () => {
    const c = counters();
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      // A different network and account each time: the plan's own count still holds.
      results.push((await countPinTry(c, { plan: ID, ip: `203.0.113.${i}`, userId: `u${i}` })).allowed);
    }
    assert.deepEqual(results, [true, true, true, true, true, false]);
    assert.equal(MINI_FORGE_TRIES.perPlan, 5);
  });
  it("one network is held across many plans, and one account too", async () => {
    const c = counters();
    let lastNet = true;
    for (let i = 0; i < MINI_FORGE_TRIES.perNetwork + 1; i++) {
      lastNet = (await countPinTry(c, { plan: `plan-${i}`, ip: "203.0.113.9", userId: null })).allowed;
    }
    assert.equal(lastNet, false, "the network floor");
    const d = counters();
    let lastAcct = true;
    for (let i = 0; i < MINI_FORGE_TRIES.perAccount + 1; i++) {
      lastAcct = (await countPinTry(d, { plan: `plan-${i}`, ip: `198.51.100.${i}`, userId: "u1" })).allowed;
    }
    assert.equal(lastAcct, false, "the account limit");
  });
  it("every counter is bumped on every try (no short-circuit to split tries across)", async () => {
    const c = counters();
    await countPinTry(c, { plan: ID, ip: "203.0.113.1", userId: "u1" });
    assert.equal(c.keys.size, 3);
  });
  it("the client IP follows the same rule as the auth limits", () => {
    const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
    assert.equal(ipFromHeaders(h({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "1.1.1.1" })), "203.0.113.5");
    assert.equal(ipFromHeaders(h({ "x-forwarded-for": "1.1.1.1, 203.0.113.6" })), "203.0.113.6");
    assert.equal(ipFromHeaders(h({})), "unknown");
  });
});

describe("answers never depend on the PIN (L3) and a plan loads once (L4)", () => {
  it("plan state is decided before the PIN", () => {
    const ok = { pin_failures: 0 };
    assert.equal(planStateBlock(null, { needReady: true }), "not_found");
    assert.equal(planStateBlock({ ...ok, imported_at: new Date(), imported_by: "u2", locked_at: new Date() }, { needReady: true, me: "u1" }), "imported");
    assert.equal(planStateBlock({ ...ok, locked_at: new Date(), forge_output: {} }, { needReady: true }), "locked");
    assert.equal(planStateBlock({ ...ok, forge_output: null }, { needReady: true }), "not_ready");
    assert.equal(planStateBlock({ ...ok, forge_output: { x: 1 } }, { needReady: true }), null);
  });

  it("the same account finishes its own interrupted import; any other account cannot (r2 N2)", () => {
    const claimed = { pin_failures: 0, forge_output: { x: 1 }, imported_at: new Date(), imported_by: "u1" };
    assert.equal(planStateBlock(claimed, { needReady: true, me: "u1" }), null);
    assert.equal(planStateBlock(claimed, { needReady: true, me: "u2" }), "imported");
    assert.equal(planStateBlock(claimed, { needReady: true, me: null }), "imported", "signed out: not yours to finish");
    const lib = code(read("lib", "tablet-session.ts"));
    assert.match(lib, /WHERE id = \$1 AND \(imported_at IS NULL OR imported_by = \$2\)/);
  });

  it("before 078 (no lock columns on the row): 'unavailable', never an error (r2 deploy order)", () => {
    assert.equal(planStateBlock({ forge_output: { x: 1 } }, { needReady: true }), "unavailable");
    assert.match(MINI_FORGE_MESSAGES.unavailable, /isn't available right now/);
    const page = code(read("app", "(mini-forge)", "mini-forge", "import-confirm", "page.tsx"));
    assert.match(page, /before078Friendly\(\(\) => recordPinFailure\(/);
    assert.match(page, /before078Friendly\(\(\) => markImported\(/);
    assert.match(page, /if \(tabletColumnsMissing\(e\)\) redirect\("\/mini-forge\/import-confirm\?error=unavailable"\)/);
  });

  it("an admin unlock records who and when, and releases only a stuck claim (r2 N2, I2)", () => {
    const lib = code(read("lib", "tablet-session.ts"));
    assert.match(lib, /unlocked_at = now\(\), unlocked_by = \$2/);
    assert.match(lib, /t\.imported_at < now\(\) - make_interval\(mins => \$3::int\)/);
    assert.match(lib, /NOT EXISTS \(SELECT 1 FROM forge_session fs WHERE fs\.session_id = 'mini-forge-' \|\| t\.id::text\)/);
    assert.match(code(read("app", "api", "admin", "mini-forge-unlock", "route.ts")), /clearPinLock\(code, guard\.userId\)/);
  });

  it("one message for no such code and a wrong PIN; a lock says who can clear it", () => {
    assert.match(MINI_FORGE_MESSAGES.not_found, /code and PIN/);
    assert.match(MINI_FORGE_MESSAGES.locked, /Ask the staff/);
    assert.equal(MINI_FORGE_LOCK_AFTER, 5);
  });

  it("the import page: counted first, plan state next, PIN last, one failure answer", () => {
    const page = code(read("app", "(mini-forge)", "mini-forge", "import", "page.tsx"));
    const countAt = page.indexOf("countPinTry(");
    const lookAt = page.indexOf("getTabletSessionByCodeOnly(");
    const stateAt = page.indexOf("planStateBlock(");
    const pinAt = page.indexOf("verifyPin(");
    assert.ok(countAt > 0 && countAt < lookAt && lookAt < stateAt && stateAt < pinAt, "count, look up, state, PIN");
    assert.match(page, /recordPinFailure\(tabletSession!\.id, MINI_FORGE_LOCK_AFTER\)/);
    assert.match(page, /redirect\("\/mini-forge\/import\?error=not_found"\);/);
    assert.doesNotMatch(page, /already_claimed|wrong_pin|getTabletSessionByCode\(/);
  });

  it("the confirm step: canonical id, counter on the database's id, lock, single use", () => {
    const page = code(read("app", "(mini-forge)", "mini-forge", "import-confirm", "page.tsx"));
    assert.match(page, /const id = canonicalTabletId\(jar\.get\(TABLET_COOKIE\)\?\.value\)/);
    assert.match(page, /plan: tablet\.id/);
    assert.doesNotMatch(page, /mf-pin:\$\{id\}/);
    const countAt = page.indexOf("countPinTry(");
    const stateAt = page.indexOf("planStateBlock(");
    const pinAt = page.indexOf("verifyPin(");
    const markAt = page.indexOf("markImported(");
    const saveAt = page.indexOf("saveForgeSession(");
    assert.ok(countAt < stateAt && stateAt < pinAt && pinAt < markAt && markAt < saveAt);
    assert.match(page, /recordPinFailure\(tablet\.id, MINI_FORGE_LOCK_AFTER\)/);
    assert.match(page, /unmarkImported\(tablet\.id, me\.id\)/);
  });

  it("the database helpers: canonical reads, an atomic single-use mark, a lock at the limit", () => {
    const lib = code(read("lib", "tablet-session.ts"));
    assert.match(lib, /if \(!canonicalTabletId\(id\)\) return null;/);
    assert.match(lib, /WHERE id = \$1 AND \(imported_at IS NULL OR imported_by = \$2\)\s+RETURNING id/);
    assert.match(lib, /locked_at = CASE WHEN pin_failures \+ 1 >= \$2/);
    assert.doesNotMatch(lib, /export async function getTabletSessionByCode\(/, "the PIN-first lookup is gone");
  });

  it("an admin can clear a lock; nobody else", () => {
    const route = code(read("app", "api", "admin", "mini-forge-unlock", "route.ts"));
    assert.match(route, /requirePlatformAdmin\(\)/);
    assert.match(route, /isSameOriginJsonPost\(request\.headers\)/);
    assert.match(route, /clearPinLock\(code, guard\.userId\)/);
  });
});
