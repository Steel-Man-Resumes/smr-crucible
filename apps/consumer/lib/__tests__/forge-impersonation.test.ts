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
      assert.match(code(read(...f)), /clearForgeBrowserKeysEverywhere\(\);/, f.join("/"));
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
  it("clearing also leaves a mark the other host acts on once", async () => {
    const { clearForgeBrowserKeysEverywhere, applyForgeClearMark, FORGE_CLEAR_SEEN_KEY } = await import("../refinery-guards");
    const here = store({ saved_jobs: "[1]" });
    const doc = { cookie: "", location: { hostname: "refinery.steelmanresumes.com", protocol: "https:" } };
    clearForgeBrowserKeysEverywhere(here, doc, 1_000);
    assert.equal(here.getItem("saved_jobs"), null);
    assert.match(doc.cookie, /^smr_forge_clear=1000; Path=\/; Max-Age=\d+; SameSite=Lax; Domain=\.steelmanresumes\.com; Secure$/);
    assert.equal(here.getItem(FORGE_CLEAR_SEEN_KEY), "1000");
    // The other host: its own storage, the shared cookie.
    const there = store({ [RUN_KEY]: JSON.stringify({ _ownerUserId: "person", resumeText: "x" }), hidden_jobs: "[2]" });
    const otherDoc = { cookie: "a=b; smr_forge_clear=1000", location: { hostname: "forge.steelmanresumes.com", protocol: "https:" } };
    assert.equal(applyForgeClearMark(there, otherDoc), true);
    assert.equal(there.getItem(RUN_KEY), null);
    assert.equal(there.getItem("hidden_jobs"), null);
    // Acted on once: a new run after that is left alone.
    there.setItem(RUN_KEY, JSON.stringify({ _ownerUserId: "admin" }));
    assert.equal(applyForgeClearMark(there, otherDoc), false);
    assert.ok(there.getItem(RUN_KEY));
  });
  it("on localhost and previews the mark is host-only (there is one host)", async () => {
    const { forgeClearCookieAttrs } = await import("../refinery-guards");
    assert.doesNotMatch(forgeClearCookieAttrs("localhost", "http:"), /Domain|Secure/);
    assert.doesNotMatch(forgeClearCookieAttrs("smr-preview.vercel.app", "https:"), /Domain/);
  });
  it("the chrome clears once when the status turns inactive or the countdown runs out", () => {
    const src = code(read("components", "ImpersonationChrome.tsx"));
    assert.match(src, /settle\(!!s\.active && !!s\.mode\)/);
    assert.match(src, /if \(active\) localStorage\.setItem\(IMPERSONATION_SEEN_KEY, "1"\)/);
    assert.match(src, /else seen = seen \|\| localStorage\.getItem\(IMPERSONATION_SEEN_KEY\) === "1"/, "a reload or new page after it ran out still knows");
    assert.match(src, /\} else if \(seen && !cleared\.current\) \{[\s\S]*?clearForgeBrowserKeysEverywhere\(\);/);
    assert.match(src, /if \(runOut\) settle\(false\);/);
  });
  it("both hosts apply a pending mark before reading: the Forge run load and the Refinery keys", () => {
    const ctx = code(read("lib", "forge-context.tsx"));
    assert.ok(ctx.indexOf("applyForgeClearMark();") > 0 && ctx.indexOf("applyForgeClearMark();") < ctx.indexOf('localStorage.getItem("forge_session")'));
    const shell = code(read("app", "(dashboard)", "RefineryShell.tsx"));
    assert.ok(shell.indexOf("applyForgeClearMark();") < shell.indexOf("settleDerivedKeys(uid);"));
    for (const f of [["app", "(dashboard)", "dashboard", "admin", "users", "page.tsx"], ["components", "DevSwitcher.tsx"]]) {
      assert.match(code(read(...f)), /clearForgeBrowserKeysEverywhere\(\);/, f.join("/"));
    }
  });
});
