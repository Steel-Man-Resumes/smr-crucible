/**
 * Security review 3a round 2: M1, M2 and the LOW items. (H1 is in
 * upload-safety.test.ts and extract-worker.test.ts.)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { emailCallbackNeedsButton } from "../sign-in-link";
import {
  REFINERY_PAGE_PREFIXES,
  TERMS_EXEMPT_API,
  termsCurrent,
  termsExemptApi,
  termsGateVerdict,
} from "../session-policy";
import { FORGE_SIGN_IN_PAGES } from "../forge-access";
import { TERMS_RECHECK_SECONDS, TERMS_VERSION, acceptanceMethod, termsNeedsReread } from "../terms";
import { forgeRunView, mayUseRunFor, stampOwnerOnWrite } from "../forge-import";
import { readOwnForgeSession } from "../forge-carry";
import { codeSeats, decideSignedInCall, planForgeLimit } from "../forge-rate-limit";

const root = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ------------------------------------------------------------- M1 -------- */

describe("M1: the email callback is reached only by a same-origin GET", () => {
  const P = "/api/auth/callback/resend";
  for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    it(`${method}`, () => {
      for (const site of ["same-origin", "same-site", "cross-site", "none", null, "SAME-ORIGIN"]) {
        const expected = !(method === "GET" && site === "same-origin");
        assert.equal(emailCallbackNeedsButton(P, method, site), expected, `${method} ${site}`);
      }
    });
  }

  it("other callbacks are untouched (OAuth has its own state check)", () => {
    assert.equal(emailCallbackNeedsButton("/api/auth/callback/google", "POST", "cross-site"), false);
  });

  it("the button page shows the full address, with a way out", () => {
    const page = read("app/(auth)/login/finish/page.tsx");
    assert.match(page, /This link signs you in as/);
    assert.match(page, /Not you\? Don&apos;t continue\./);
    assert.doesNotMatch(code(page), /maskEmail\(/);
    assert.match(read("middleware.ts"), /NextResponse\.redirect\(interstitialUrlFor\(req\.nextUrl\.toString\(\)\), 303\)/);
  });
});

/* ------------------------------------------------------------- M2 -------- */

function apiRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "route.ts") out.push(p);
    }
  };
  walk(join(root, "app", "api"));
  return out;
}
const routePath = (file: string) =>
  "/" + relative(join(root, "app"), file).split(sep).slice(0, -1).join("/").replace(/\[[^\]]+\]/g, "x");

const AI_OR_PERSONAL = /callAI\(|streamText|generateText|@ai-sdk|from "ai"|openai|anthropic|withRateLimit\(|queryAsUser|getOneAsUser|persistForgeSession|saveForgeSession|vault|consumer_profile|criminalRecord|effectiveAuth|forgeUserId\(/i;

describe("M2: once the wall is up, terms gate the Refinery and every AI or personal-data API", () => {
  it("every API route that calls an AI or takes personal or record data is gated", () => {
    const routes = apiRoutes();
    assert.ok(routes.length > 100);
    let checked = 0;
    for (const f of routes) {
      const path = routePath(f);
      if (!AI_OR_PERSONAL.test(readFileSync(f, "utf8"))) continue;
      checked++;
      if (termsExemptApi(path)) {
        // Exempt only for a stated reason: data rights, sign-in, or the signed-out checker tools.
        assert.ok(
          /^\/api\/(auth\/|user\/(export-data|export-vault|delete-data)$|check\/extract$|resume\/layout$|org-listing$|health\/|cron\/)/.test(path),
          `${path} is exempt but calls an AI or takes personal data`
        );
        continue;
      }
      assert.equal(termsGateVerdict(path, true, false), "api", path);
    }
    assert.ok(checked > 60, String(checked));
  });

  it("named routes are gated: disclosure guide, interview practice, the tailor, t.ROY signed in, the save", () => {
    for (const p of [
      "/api/disclosure-guide",
      "/api/interview-practice",
      "/api/resume-generate",
      "/api/resume-generate-full",
      "/api/resume-fine-tune",
      "/api/fit-check",
      "/api/intake/followups",
      "/api/fetch-job-posting",
      "/api/next-step-why",
      "/api/assistant",
      "/api/coach",
      "/api/vault",
      "/api/forge/save",
      "/api/parse",
    ]) {
      assert.equal(termsGateVerdict(p, true, false), "api", p);
    }
  });

  it("the exempt list is exact", () => {
    assert.deepEqual(Object.keys(TERMS_EXEMPT_API).sort(), [
      "/api/auth/",
      "/api/check/extract",
      "/api/cron/",
      "/api/health/",
      "/api/org-listing",
      "/api/resume/layout",
      "/api/user/delete-data",
      "/api/user/export-data",
      "/api/user/export-vault",
    ]);
    assert.equal(termsGateVerdict("/api/auth/accept-terms", true, false), "pass");
  });

  it("Refinery pages and Forge screens go to the terms page; the matcher's Refinery pages are all covered", () => {
    for (const p of ["/dashboard", "/dashboard/disclosure", "/dashboard/settings", "/interview/x", ...FORGE_SIGN_IN_PAGES]) {
      assert.equal(termsGateVerdict(p, true, false), "page", p);
    }
    const mw = read("middleware.ts");
    const pages = Array.from(mw.matchAll(/"(\/[a-z-]+)\/:path\*"/g)).map((m) => m[1]).filter((p) => p !== "/api");
    for (const p of pages) assert.ok((REFINERY_PAGE_PREFIXES as readonly string[]).includes(p), p);
    assert.equal(termsGateVerdict("/dashboard", false, false), "pass", "wall down: unchanged");
  });

  it("auth.ts gates on current terms (claim true AND current version)", () => {
    assert.match(read("auth.ts"), /termsGateVerdict\(path, wallUp, termsCurrent\(session\.user as any, TERMS_VERSION\)\)/);
  });
});

/* ------------------------------------------------------------- LOW ------- */

describe("L1: nothing reads a run before its owner is settled", () => {
  const RUN = { readinessStage: "action", resumeText: "PERSON A", forgeOutput: { a: 1 }, startedAt: "t" };
  it("signed in: only this account's run (or an empty one) is visible", () => {
    const me = { status: "authenticated" as const, userId: "b" };
    assert.deepEqual(forgeRunView(RUN, me).visible, {});
    assert.equal(forgeRunView(RUN, me).mayUse, false);
    assert.deepEqual(forgeRunView({ ...RUN, _ownerUserId: "a" }, me).visible, {});
    assert.equal(forgeRunView({ ...RUN, _ownerUserId: "b" }, me).mayUse, true);
    assert.equal(forgeRunView({ audience: "client" }, me).mayUse, true);
  });

  it("while the sign-in is loading, a run with answers is hidden", () => {
    assert.deepEqual(forgeRunView(RUN, { status: "loading" }).visible, {});
    assert.deepEqual(forgeRunView({ ...RUN, _ownerUserId: "a" }, { status: "unauthenticated" }).visible, {});
    assert.equal(forgeRunView(RUN, { status: "unauthenticated" }).mayUse, true, "the Forge before the wall: the browser's own run");
  });

  it("a run started here while signed in is marked on its first write; a foreign one is not", () => {
    assert.equal(stampOwnerOnWrite({}, { readinessStage: "action" }, "b")._ownerUserId, "b");
    assert.equal(stampOwnerOnWrite({ _ownerUserId: "b" }, { _ownerUserId: "b", goals: ["x"] }, "b")._ownerUserId, "b");
    assert.equal(stampOwnerOnWrite(RUN, { ...RUN, goals: ["x"] }, "b")._ownerUserId, undefined);
    assert.equal(stampOwnerOnWrite({}, { isDemo: true, readinessStage: "action" }, "b")._ownerUserId, undefined);
  });

  it("before the build or the documents, the STORED run must be this account's (readOwnForgeSession)", () => {
    const store = (v: unknown) => ({ getItem: () => (v === undefined ? null : JSON.stringify(v)) });
    const me = { status: "authenticated" as const, userId: "b" };
    assert.equal(mayUseRunFor(me, { mayUse: true }, (u) => readOwnForgeSession(u, store(RUN))), false);
    assert.equal(mayUseRunFor(me, { mayUse: true }, (u) => readOwnForgeSession(u, store({ ...RUN, _ownerUserId: "b" }))), true);
    assert.equal(mayUseRunFor({ status: "loading" }, { mayUse: true }, () => RUN), false);
    assert.equal(mayUseRunFor({ status: "unauthenticated" }, { mayUse: true }, () => null), true);
  });

  it("the pages use it: the documents call, the build call, and only ForgeImport reads the raw run", () => {
    assert.match(read("app/(forge)/output/page.tsx"), /if \(!hasStarted\.current && runIsMine\(\)\) generateDocs\(\);/);
    assert.match(read("app/(forge)/processing/page.tsx"), /if \(!runIsMine\(\)\) return;/);
    assert.match(read("lib/forge-context.tsx"), /readOwnForgeSession\(uid\)/);
    const forgeDir = join(root, "app", "(forge)");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : /\.tsx?$/.test(n) ? [join(d, n)] : []));
    for (const f of [...walk(forgeDir), ...walk(join(root, "components"))]) {
      if (f.endsWith("ForgeImport.tsx")) continue;
      assert.doesNotMatch(readFileSync(f, "utf8"), /rawSession/, f);
    }
    assert.match(read("app/(forge)/ForgeShell.tsx"), /isForgeSignInPage\(pathname\) && authStatus === "loading"/);
  });

  it("the Refinery uses the hotfix's accessor module, unchanged in name", () => {
    assert.match(read("app/(dashboard)/dashboard/page.tsx"), /readOwnForgeSession\(/);
    assert.match(read("app/(dashboard)/RefineryShell.tsx"), /forgeSyncDecision\(stored, uid\)/);
  });
});

describe("L2: refused calls cost the person nothing; unlimited tiers never use a code pool", () => {
  function ctr() {
    const a = new Map<string, number>();
    const b = new Map<string, number>();
    return {
      a,
      c: {
        account: async (u: string, e: string) => (a.set(u + e, (a.get(u + e) ?? 0) + 1), a.get(u + e)!),
        refundAccount: async (u: string, e: string) => void a.set(u + e, Math.max(0, (a.get(u + e) ?? 0) - 1)),
        bucket: async (k: string, e: string) => (b.set(k + e, (b.get(k + e) ?? 0) + 1), b.get(k + e)!),
      },
    };
  }
  const call = (c: any, user: string, tier: number, ip: string, codeArg: any) =>
    decideSignedInCall({ plan: planForgeLimit({ userId: user, needsSession: true, perPerson: 5, tierLimit: tier }) as any, endpoint: "analyze", perPerson: 5, ip, code: codeArg }, c);

  it("a patron refused by a full library keeps their own allowance for home", async () => {
    const { a, c } = ctr();
    for (let u = 0; u < 10; u++) for (let i = 0; i < 5; i++) await call(c, "farm" + u, 30, "lib", null);
    for (let i = 0; i < 5; i++) assert.equal(await call(c, "patron", 30, "lib", null), "network");
    assert.equal(a.get("patronanalyze"), 0);
    assert.equal(await call(c, "patron", 30, "home", null), "ok");
  });

  it("an unlimited account carrying an org's code never draws from that org's pool", async () => {
    const { c } = ctr();
    const code = { code: "ORG", seats: codeSeats(50) };
    for (let i = 0; i < 300; i++) await call(c, "unlimited", 0, "net-a", code);
    assert.equal(await call(c, "member", 30, "net-b", code), "ok");
  });
});

describe("L3: terms are re-read at least daily and on a version change", () => {
  const now = 1_800_000_000;
  it("re-read rules", () => {
    assert.equal(termsNeedsReread({ trigger: "update", terms: true, termsVersion: TERMS_VERSION, termsAt: now, now }), true);
    assert.equal(termsNeedsReread({ terms: undefined, termsVersion: undefined, termsAt: undefined, now }), true);
    assert.equal(termsNeedsReread({ terms: true, termsVersion: "older", termsAt: now, now }), true);
    assert.equal(termsNeedsReread({ terms: true, termsVersion: TERMS_VERSION, termsAt: now - TERMS_RECHECK_SECONDS - 1, now }), true);
    assert.equal(termsNeedsReread({ terms: true, termsVersion: TERMS_VERSION, termsAt: now - 60, now }), false);
  });
  it("the gate needs true AND the current version", () => {
    assert.equal(termsCurrent({ terms: true, termsVersion: TERMS_VERSION }, TERMS_VERSION), true);
    assert.equal(termsCurrent({ terms: true, termsVersion: "older" }, TERMS_VERSION), false);
    assert.equal(termsCurrent({ terms: true }, TERMS_VERSION), false);
    assert.equal(termsCurrent({ terms: false, termsVersion: TERMS_VERSION }, TERMS_VERSION), false);
  });
});

describe("L4: the ledger records how the person accepted", () => {
  it("only the page's two methods are accepted from the client; sign-in method kept in context", () => {
    assert.equal(acceptanceMethod("terms_page"), "terms_page");
    assert.equal(acceptanceMethod("email_form_checkbox"), "email_form_checkbox");
    assert.equal(acceptanceMethod("registration"), null);
    assert.equal(acceptanceMethod("google"), null);
    const route = read("app/api/auth/accept-terms/route.ts");
    assert.match(route, /const method = acceptanceMethod\(body\.source\);/);
    assert.match(route, /signed_in_with: signedInWith/);
    const page = read("app/(auth)/login/terms/page.tsx");
    assert.match(page, /accept\("terms_page"\)/);
    assert.match(page, /accept\("email_form_checkbox"\)/);
    assert.match(read("app/api/auth/register/route.ts"), /TERMS_VERSION, "registration"/);
  });
});

describe("L5: the 409 is a backstop and says so", () => {
  it("comment", () => {
    assert.match(read("app/api/forge/save/route.ts"), /BACKSTOP ONLY/);
  });
});
