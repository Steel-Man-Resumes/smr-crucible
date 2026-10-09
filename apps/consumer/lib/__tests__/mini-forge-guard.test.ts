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
// Network values below (net-a, client-a, proxy-b): Fictional tokens, not
// addresses: the public-repo guard keeps IP literals out of this repo.

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
      results.push((await countPinTry(c, { plan: ID, ip: `net-${i}`, userId: `u${i}` })).allowed);
    }
    assert.deepEqual(results, [true, true, true, true, true, false]);
    assert.equal(MINI_FORGE_TRIES.perPlan, 5);
  });
  it("one network is held across many plans, and one account too", async () => {
    const c = counters();
    let lastNet = true;
    for (let i = 0; i < MINI_FORGE_TRIES.perNetwork + 1; i++) {
      lastNet = (await countPinTry(c, { plan: `plan-${i}`, ip: "net-a", userId: null })).allowed;
    }
    assert.equal(lastNet, false, "the network floor");
    const d = counters();
    let lastAcct = true;
    for (let i = 0; i < MINI_FORGE_TRIES.perAccount + 1; i++) {
      lastAcct = (await countPinTry(d, { plan: `plan-${i}`, ip: `net-b-${i}`, userId: "u1" })).allowed;
    }
    assert.equal(lastAcct, false, "the account limit");
  });
  it("every counter is bumped on every try (no short-circuit to split tries across)", async () => {
    const c = counters();
    await countPinTry(c, { plan: ID, ip: "net-a", userId: "u1" });
    assert.equal(c.keys.size, 3);
  });
  it("the client IP follows the same rule as the auth limits (header shape and order)", () => {
    const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
    // x-real-ip wins when present (trimmed); otherwise the LAST x-forwarded-for
    // hop, the one closest to our edge, as lib/auth-rate-limit getClientIp does.
    assert.equal(ipFromHeaders(h({ "x-real-ip": " client-a ", "x-forwarded-for": "client-b" })), "client-a");
    assert.equal(ipFromHeaders(h({ "x-forwarded-for": "client-a, proxy-b" })), "proxy-b");
    assert.equal(ipFromHeaders(h({ "x-forwarded-for": "  proxy-b  " })), "proxy-b");
    assert.equal(ipFromHeaders(h({ "x-real-ip": "", "x-forwarded-for": "client-a" })), "client-a", "an empty x-real-ip falls through");
    assert.equal(ipFromHeaders(h({ "x-forwarded-for": "client-a, " })), "unknown", "an empty last hop is not a client");
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
    assert.match(lib, /WHERE t\.id = prev\.id AND \(t\.imported_at IS NULL OR t\.imported_by = \$2\)/);
  });

  it("before 079 (no lock columns on the row): 'unavailable', never an error (r2 deploy order)", () => {
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
    assert.match(lib, /WHERE t\.id = prev\.id AND \(t\.imported_at IS NULL OR t\.imported_by = \$2\)\s+RETURNING/);
    assert.match(lib, /locked_at = CASE WHEN pin_failures \+ 1 >= \$2/);
    assert.doesNotMatch(lib, /export async function getTabletSessionByCode\(/, "the PIN-first lookup is gone");
  });

  it("r3 R3-1: a saved import is final; release and give-back run only before the save", () => {
    const lib = code(read("lib", "tablet-session.ts"));
    assert.match(lib, /SET import_saved_at = now\(\), imported_by = \$2, imported_at = COALESCE\(imported_at, now\(\)\)\s+WHERE id = \$1 AND \(imported_by = \$2 OR imported_by IS NULL\)/, "r4 I-c: a give-back that raced in is undone");
    assert.match(lib, /WHERE id = \$1 AND imported_by = \$2 AND import_saved_at IS NULL/, "give-back");
    assert.match(lib, /AND t\.imported_by IS NOT NULL\s+AND t\.import_saved_at IS NULL/, "admin release");
    assert.match(lib, /RETURNING \(prev\.imported_at IS NULL\) AS fresh/, "markImported says whether its claim is fresh");
    const page = code(read("app", "(mini-forge)", "mini-forge", "import-confirm", "page.tsx"));
    assert.match(page, /if \(claim\.fresh\) await unmarkImported\(tablet\.id, me\.id\)/);
    const saveAt = page.indexOf("saveForgeSession(");
    const finalAt = page.indexOf("markImportSaved(tablet.id, me.id)");
    assert.ok(saveAt > 0 && finalAt > saveAt, "marked saved right after the save");
  });

  it("r3 R3-1: deleting data or the account expires and empties the plans that person loaded", () => {
    const lib = code(read("lib", "tablet-session.ts"));
    assert.match(lib, /SET expires_at = now\(\), forge_output = NULL, forge_intake = '\{\}'::jsonb\s+WHERE imported_by = \$1/);
    const del = code(read("app", "api", "user", "delete-data", "route.ts"));
    const expireAt = del.indexOf("expireImportedPlans(userId)");
    const accountAt = del.indexOf('DELETE FROM users WHERE id = $1');
    assert.ok(expireAt > 0 && expireAt < accountAt, "before the account row goes (imported_by would turn NULL)");
  });

  it("r3 I3: loading a saved plan again asks first, and keeping the changes is the default", () => {
    const page = code(read("app", "(mini-forge)", "mini-forge", "import-confirm", "page.tsx"));
    assert.match(page, /const reload = tablet\.imported_by === me\.id && !!tablet\.import_saved_at;/);
    assert.match(page, /if \(reload && formData\.get\("replace"\) !== "yes"\) redirect\("\/mini-forge\/import-confirm\?ask=replace"\)/);
    const askAt = page.indexOf('redirect("/mini-forge/import-confirm?ask=replace")');
    assert.ok(askAt < page.indexOf("markImported(tablet.id, me.id)"), "asked before anything is claimed or saved");
    assert.match(page, /Load the tablet plan again\? This replaces your changes\./);
    assert.match(page, /\{askReplace && <input type="hidden" name="replace" value="yes" \/>\}/);
    assert.match(page, /askReplace \? "Keep my changes"/);
  });

  it("an admin can clear a lock; nobody else", () => {
    const route = code(read("app", "api", "admin", "mini-forge-unlock", "route.ts"));
    assert.match(route, /requirePlatformAdmin\(\)/);
    assert.match(route, /isSameOriginJsonPost\(request\.headers\)/);
    assert.match(route, /clearPinLock\(code, guard\.userId\)/);
  });
});
