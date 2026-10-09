/**
 * Impersonation and the Forge (security review 3a Part 2 r1, M3), and the
 * premium notes from the same review. Fake storage only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clearForgeBrowserKeys, DERIVED_KEYS, DERIVED_OWNER_KEY, settleDerivedKeys } from "../refinery-guards";
import { forgeRunOwner } from "../forge-carry";
import { premiumAccessLine } from "../premium";

const CONSUMER = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(CONSUMER, ...p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function store(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const RUN_KEY = ["forge", "session"].join("_");
const SYNCED_KEY = ["forge", "last", "synced", "run"].join("_");

describe("M3: impersonation never moves a Forge run between accounts", () => {
  it("clearing removes the run, its synced mark and every derived key", () => {
    const s = store({ [RUN_KEY]: JSON.stringify({ _ownerUserId: "admin" }), [SYNCED_KEY]: "x", [DERIVED_OWNER_KEY]: "admin", ...Object.fromEntries(DERIVED_KEYS.map((k) => [k, "1"])), unrelated: "keep" });
    clearForgeBrowserKeys(s);
    assert.deepEqual([...s.m.keys()], ["unrelated"]);
  });

  it("clearing runs when an impersonation starts (both start points) and when it ends", () => {
    for (const f of [["app", "(dashboard)", "dashboard", "admin", "users", "page.tsx"], ["components", "DevSwitcher.tsx"], ["components", "ImpersonationChrome.tsx"]]) {
      assert.match(code(read(...f)), /clearForgeBrowserKeysEverywhere\((adminId|clearAdminId)\);/, f.join("/"));
    }
  });

  it("ForgeImport does nothing until it knows no one is being impersonated", () => {
    const src = code(read("components", "forge", "ForgeImport.tsx"));
    assert.match(src, /const impersonating = useImpersonating\(!!user\)/);
    assert.match(src, /if \(!user \|\| impersonating !== false \|\| busy\.current/, "save");
    assert.equal(src.match(/if \(impersonating !== false\) return;/g)?.length, 2, "the import effect and the load effect");
    assert.match(src, /if \(!user \|\| impersonating !== false\) return null;/, "no prompt");
  });

  it("the from=refinery load stamps only this session's own saved run", () => {
    const src = code(read("components", "forge", "ForgeImport.tsx"));
    const checkAt = src.indexOf("if (j?.userId !== user.id) return;");
    const stampAt = src.indexOf("afterSave(saved, user.id");
    assert.ok(checkAt > 0 && checkAt < stampAt);
    assert.match(code(read("app", "api", "forge", "load", "route.ts")), /NextResponse\.json\(\{ data: profile, userId \}\)/);
  });

  it("the save route refuses while an admin is viewing as someone", () => {
    const src = code(read("app", "api", "forge", "save", "route.ts"));
    assert.match(src, /const real = await realAuth\(\);\s+if \(real\?\.user\?\.id !== userId\)/);
  });

  it("the impersonation check treats unknown as 'do nothing'", () => {
    const src = code(read("components", "forge", "useImpersonating.ts"));
    assert.match(src, /fetch\("\/api\/dev\/impersonate"\)/);
    assert.match(src, /j\.active === true : null/);
  });

  it("the derived-key rule still reads only the owner mark, now through forge-carry", () => {
    const s = store({ [RUN_KEY]: JSON.stringify({ _ownerUserId: "someone-else", resumeText: "x" }), saved_jobs: "[1]" });
    assert.equal(forgeRunOwner(s), "someone-else");
    assert.equal(settleDerivedKeys("me", s), "cleared");
    assert.equal(s.getItem("saved_jobs"), null);
    assert.doesNotMatch(read("lib", "refinery-guards.ts"), new RegExp(RUN_KEY));
  });
});

describe("premium notes", () => {
  it("the person sees where access comes from, never the grant reason", () => {
    assert.equal(premiumAccessLine({ orgMember: true, orgName: "Sample Reentry Center", grantEndsAt: null }), "Access from Sample Reentry Center.");
    assert.equal(premiumAccessLine({ orgMember: true, orgName: null, grantEndsAt: null }), "Access from your organization.");
    assert.match(premiumAccessLine({ orgMember: false, grantEndsAt: "2026-12-01T12:00:00Z" }), /^Access from SMR until December 1, 2026\.$/);
    assert.equal(premiumAccessLine({ orgMember: false, grantEndsAt: null }), "Access from SMR.");
    for (const f of [["components", "premium", "PremiumToolsSection.tsx"], ["components", "premium", "PremiumGate.tsx"]]) {
      assert.doesNotMatch(code(read(...f)), /\.reason\b/, f.join("/"));
    }
  });
  it("the admin form says the person can see the reason in their export", () => {
    assert.match(read("app", "(dashboard)", "dashboard", "admin", "premium", "page.tsx"), /The person can see this reason if they download their data\./);
  });
  it("the premium status cache belongs to one signed-in user", () => {
    const src = code(read("components", "premium", "PremiumGate.tsx"));
    assert.match(src, /if \(sharedFor !== userId\) \{\s+shared = null;/);
    assert.match(src, /if \(!userId\) \{\s+resetPremiumCache\(\);/);
  });
});

describe("r2 N3: impersonation ending any way clears the keys, on both hosts as far as the browser allows", () => {
  const ADMIN_ID = "00000000-0000-4000-8000-0000000000ad";
  const OTHER_ID = "00000000-0000-4000-8000-0000000000aa";
  const NOW = 1_800_000_000_000;

  it("clearing also leaves a mark, for this admin, that the other host acts on once", async () => {
    const { clearForgeBrowserKeysEverywhere, applyForgeClearMark, FORGE_CLEAR_SEEN_KEY } = await import("../refinery-guards");
    const here = store({ saved_jobs: "[1]" });
    const doc = { cookie: "", location: { hostname: "refinery.steelmanresumes.com", protocol: "https:" } };
    clearForgeBrowserKeysEverywhere(ADMIN_ID, here, doc, NOW);
    assert.equal(here.getItem("saved_jobs"), null);
    assert.match(doc.cookie, new RegExp(`^smr_forge_clear=${NOW}\\.${ADMIN_ID}; Path=/; Max-Age=\\d+; SameSite=Lax; Domain=\\.steelmanresumes\\.com; Secure$`));
    assert.equal(here.getItem(FORGE_CLEAR_SEEN_KEY), String(NOW));
    // The other host: its own storage, the shared cookie, the same admin signed in.
    const there = store({ [RUN_KEY]: JSON.stringify({ _ownerUserId: "person", resumeText: "x" }), hidden_jobs: "[2]" });
    const otherDoc = { cookie: `a=b; smr_forge_clear=${NOW}.${ADMIN_ID}`, location: { hostname: "forge.steelmanresumes.com", protocol: "https:" } };
    assert.equal(applyForgeClearMark(ADMIN_ID, there, otherDoc, NOW + 1000), true);
    assert.equal(there.getItem(RUN_KEY), null);
    assert.equal(there.getItem("hidden_jobs"), null);
    there.setItem(RUN_KEY, JSON.stringify({ _ownerUserId: ADMIN_ID }));
    assert.equal(applyForgeClearMark(ADMIN_ID, there, otherDoc, NOW + 2000), false, "acted on once");
    assert.ok(there.getItem(RUN_KEY));
  });

  it("r3 R3-2: a mark never touches a signed-out visitor, someone else, or comes from the future", async () => {
    const { applyForgeClearMark, FORGE_CLEAR_SEEN_KEY } = await import("../refinery-guards");
    const run = () => store({ [RUN_KEY]: JSON.stringify({ resumeText: "my only copy" }) });
    const doc = (v: string) => ({ cookie: `smr_forge_clear=${v}` });
    let s1 = run();
    assert.equal(applyForgeClearMark(null, s1, doc(`${NOW}.${ADMIN_ID}`), NOW), false, "signed out");
    assert.ok(s1.getItem(RUN_KEY));
    assert.equal(applyForgeClearMark(OTHER_ID, s1, doc(`${NOW}.${ADMIN_ID}`), NOW), false, "a mark for another account");
    assert.equal(applyForgeClearMark(ADMIN_ID, s1, doc("1"), NOW), false, "the old bare format (any host could write it)");
    assert.equal(applyForgeClearMark(ADMIN_ID, s1, doc(`${NOW + 60 * 60 * 1000}.${ADMIN_ID}`), NOW), false, "from the future");
    assert.ok(s1.getItem(RUN_KEY));
    // A far-future "seen" cannot switch the clear off, and none is ever stored.
    s1 = run();
    s1.setItem(FORGE_CLEAR_SEEN_KEY, "9999999999999999");
    assert.equal(applyForgeClearMark(ADMIN_ID, s1, doc(`${NOW - 1000}.${ADMIN_ID}`), NOW), true);
    assert.ok(Number(s1.getItem(FORGE_CLEAR_SEEN_KEY)) <= NOW);
    // A mark a little ahead (clock skew) counts, but "seen" stays at now.
    s1 = run();
    assert.equal(applyForgeClearMark(ADMIN_ID, s1, doc(`${NOW + 60_000}.${ADMIN_ID}`), NOW), true);
    assert.equal(s1.getItem(FORGE_CLEAR_SEEN_KEY), String(NOW));
  });

  it("r3 R3-2: the Forge applies the mark only for the signed-in account, never in loadSession", () => {
    const ctx = code(read("lib", "forge-context.tsx"));
    assert.match(ctx, /if \(auth\.status === "authenticated" && clearCheckedFor\.current !== auth\.userId\) \{/);
    assert.match(ctx, /applyForgeClearMark\(auth\.userId\)/);
    const load = ctx.slice(ctx.indexOf("export function loadSession"), ctx.indexOf("export function loadSession") + 600);
    assert.doesNotMatch(load, /applyForgeClearMark/);
  });

  it("r3 I4: the impersonation flag belongs to one admin, and goes at sign-out", async () => {
    const { impersonationSeenFor, IMPERSONATION_SEEN_KEY } = await import("../refinery-guards");
    const s1 = store({ [IMPERSONATION_SEEN_KEY]: ADMIN_ID });
    assert.equal(impersonationSeenFor(ADMIN_ID, s1), true);
    assert.equal(impersonationSeenFor(OTHER_ID, s1), false, "another person signed in: not theirs");
    assert.equal(s1.getItem(IMPERSONATION_SEEN_KEY), null, "and the stale flag is dropped");
    const s2 = store({ [IMPERSONATION_SEEN_KEY]: "1" });
    assert.equal(impersonationSeenFor(ADMIN_ID, s2), false, "the old bare flag is dropped too");
    assert.match(code(read("app", "(dashboard)", "RefineryShell.tsx")), /DERIVED_OWNER_KEY,\s+IMPERSONATION_SEEN_KEY,\s*\];/);
    assert.match(code(read("components", "forge", "ForgeAccountBar.tsx")), /localStorage\.removeItem\(IMPERSONATION_SEEN_KEY\)/);
    assert.match(code(read("components", "ImpersonationChrome.tsx")), /localStorage\.setItem\(IMPERSONATION_SEEN_KEY, adminId\)/);
  });

  it("on localhost and previews the mark is host-only (there is one host)", async () => {
    const { forgeClearCookieAttrs } = await import("../refinery-guards");
    assert.doesNotMatch(forgeClearCookieAttrs("localhost", "http:"), /Domain|Secure/);
    assert.doesNotMatch(forgeClearCookieAttrs("smr-preview.vercel.app", "https:"), /Domain/);
  });
  it("the chrome clears once when the status turns inactive or the countdown runs out", () => {
    const src = code(read("components", "ImpersonationChrome.tsx"));
    assert.match(src, /settle\(!!s\.active && !!s\.mode\)/);
    assert.match(src, /else seen = seen \|\| impersonationSeenFor\(adminId\)/, "a reload or new page after it ran out still knows");
    assert.match(src, /\} else if \(seen && !cleared\.current\) \{[\s\S]*?clearForgeBrowserKeysEverywhere\(adminId\);/);
    assert.match(src, /if \(runOut\) settle\(false\);/);
  });
  it("the Refinery applies a pending mark for its signed-in account before settling keys; both start points pass the admin id", () => {
    const shell = code(read("app", "(dashboard)", "RefineryShell.tsx"));
    assert.ok(shell.indexOf("applyForgeClearMark(uid);") > 0 && shell.indexOf("applyForgeClearMark(uid);") < shell.indexOf("settleDerivedKeys(uid);"));
    assert.match(code(read("app", "(dashboard)", "dashboard", "admin", "users", "page.tsx")), /clearForgeBrowserKeysEverywhere\(adminId\);/);
    assert.match(code(read("components", "DevSwitcher.tsx")), /clearForgeBrowserKeysEverywhere\(clearAdminId\);/);
  });
});
