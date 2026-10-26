/**
 * House lane L2, developer view-as: the org routes answer as the person being
 * viewed, read-only, and NO view-as session can write through any
 * /api/org/* or /api/partner/* route. Two layers are proven here:
 *   1. the edge: viewModeBlocks refuses every non-read method on every one of
 *      those routes during a blue view (middleware.ts uses it);
 *   2. the route: every write handler reaches the org guard (or the partner
 *      console's own refusal) before it reads a body or writes anything, and
 *      the guard refuses every non-read method under ANY view-as, assist
 *      included (orgRouteIdentity).
 * Route modules cannot be imported under node:test (next-auth), so layer 2 is
 * the pure rule plus a source audit of every handler.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  orgRouteIdentity,
  partnerOrgWriteRefusal,
  viewAsExportRefusal,
  viewModeBlocks,
  isReadMethod,
  VIEW_MODE_READ_POSTS,
  VIEW_AS_REFUSAL,
  ORG_READ_ONLY_REFUSAL,
} from "../view-as";
import { accessLogAction } from "../access-log-words";

const CONSUMER = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(CONSUMER, ...p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
const ADMIN = "00000000-0000-4000-8000-0000000000aa";
const STAFF = "00000000-0000-4000-8000-0000000000bb";

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (name === "route.ts") out.push(p);
  }
  return out;
}
const API = join(CONSUMER, "app", "api");
const ORG_ROUTES = [...routeFiles(join(API, "org")), ...routeFiles(join(API, "partner"))];
const urlPath = (file: string) =>
  "/api/" + relative(API, file).replace(/\\/g, "/").replace(/\/route\.ts$/, "").replace(/\[[^\]]+\]/g, "00000000-0000-4000-8000-000000000001");

/** Each exported handler: its method and its body (up to the next export). */
function handlers(src: string): Array<{ method: string; body: string }> {
  const re = /export (?:async function|const) (GET|HEAD|POST|PUT|PATCH|DELETE)\b/g;
  const marks: Array<{ method: string; at: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) marks.push({ method: m[1], at: m.index });
  return marks.map((h, i) => ({ method: h.method, body: src.slice(h.at, marks[i + 1]?.at ?? src.length) }));
}

describe("orgRouteIdentity: who an org route acts as", () => {
  const real = { user: { id: ADMIN, tier: "admin" } };
  const viewing = (mode: "view" | "assist") => ({ user: { id: STAFF, tier: "partner" }, impersonation: { mode, adminId: ADMIN, sid: "s" } });

  it("signed out is 401", () => {
    assert.deepEqual(orgRouteIdentity(null, "GET"), { ok: false, status: 401, error: "Not signed in." });
  });
  it("not viewing: the real person, reads and writes, platform powers available", () => {
    for (const method of ["GET", "POST", "DELETE"]) {
      assert.deepEqual(orgRouteIdentity(real, method), { ok: true, userId: ADMIN, viewing: false, mayUsePlatformPowers: true });
    }
  });
  it("viewing: reads are served AS THE VIEWED PERSON, with no platform powers (defect B2)", () => {
    for (const mode of ["view", "assist"] as const) {
      for (const method of ["GET", "HEAD", "get"]) {
        assert.deepEqual(orgRouteIdentity(viewing(mode), method), { ok: true, userId: STAFF, viewing: true, mayUsePlatformPowers: false });
      }
    }
  });
  it("viewing: every write is refused, in view AND assist mode", () => {
    for (const mode of ["view", "assist"] as const) {
      for (const method of [...WRITE_METHODS, "OPTIONS"]) {
        assert.deepEqual(orgRouteIdentity(viewing(mode), method), { ok: false, status: 403, error: VIEW_AS_REFUSAL });
      }
    }
  });
  it("viewing: a route that did not pass its request is treated as a write (fails closed)", () => {
    assert.equal(orgRouteIdentity(viewing("view"), null).ok, false);
    assert.equal(orgRouteIdentity(viewing("view"), undefined).ok, false);
    assert.equal(isReadMethod(""), false);
  });
});

describe("the org guard uses those rules", () => {
  const guard = code(read("lib", "org-guard.ts"));
  const fn = guard.slice(guard.indexOf("export async function requireOrgCapability"), guard.indexOf("export async function requirePlatformAdmin"));
  it("resolves through effectiveAuth and refuses before any lookup", () => {
    assert.match(fn, /const session = await effectiveAuth\(\);\s+const who = orgRouteIdentity\(session, opts\.request\?\.method \?\? null\);\s+if \(!who\.ok\) return fail\(who\.status, who\.error\);/);
    assert.doesNotMatch(fn, /await auth\(\)/, "the real session is never the member during view-as");
  });
  it("never uses the admin's powers or orgId override while viewing", () => {
    assert.match(fn, /const isPlatformAdmin = who\.mayUsePlatformPowers && tier === "admin" && adminSecondFactorOk\(/);
    assert.match(fn, /orgId: who\.viewing \? undefined : opts\.orgId,/);
  });
  it("platform-admin routes still read the REAL session and still need two-step", () => {
    const admin = guard.slice(guard.indexOf("export async function requirePlatformAdmin"));
    assert.match(admin, /const session = await auth\(\);/);
    assert.match(admin, /isPlatformAdmin\(userId\)/);
    assert.match(admin, /adminSecondFactorOk\(session\?\.user as any\)/);
  });
  it("effectiveAuth still demands the signed cookie, the admin named in it, two-step and a platform_admin row", () => {
    const eff = code(read("lib", "effective-auth.ts"));
    assert.match(eff, /if \(!imp \|\| imp\.adminId !== real\.user\.id\) return real;/);
    assert.match(eff, /if \(!adminSecondFactorOk\(real\.user as any\)\) return real;/);
    assert.match(eff, /if \(!\(await isPlatformAdmin\(real\.user\.id\)\)\) return real;/);
    const imp = code(read("lib", "impersonation.ts"));
    assert.match(imp, /view: 60,/);
    assert.match(imp, /assist: 30,/);
  });
});

describe("no view-as session can write through any /api/org/* or /api/partner/* route", () => {
  it("there are org and partner routes to check", () => {
    assert.ok(ORG_ROUTES.length >= 13, `found ${ORG_ROUTES.length}`);
  });

  it("layer 1, the edge: a blue view refuses every write method on every one of them", () => {
    for (const file of ORG_ROUTES) {
      const path = urlPath(file);
      for (const method of WRITE_METHODS) assert.equal(viewModeBlocks(method, path), true, `${method} ${path}`);
      assert.equal(viewModeBlocks("GET", path), false, `GET ${path}`);
    }
  });

  it("layer 2, the route: every write handler is guarded before it reads a body or writes", () => {
    let writes = 0;
    for (const file of ORG_ROUTES) {
      const src = code(readFileSync(file, "utf8"));
      const gate = src.match(/async function gate\(request: Request\) \{[\s\S]*?\n\}/)?.[0] ?? "";
      const gateGuarded = /requireOrgCapability\("[a-z_.]+", \{ request \}\)/.test(gate);
      for (const h of handlers(src)) {
        if (!WRITE_METHODS.includes(h.method)) continue;
        writes++;
        const where = `${relative(API, file)} ${h.method}`;
        const body = h.body.replace(/await props\.params;?/g, "");
        const firstAwait = body.indexOf("await ");
        const readsBody = Math.min(...[body.indexOf("request.json("), body.indexOf("request.formData("), Infinity].filter((i) => i >= 0));
        if (/partner[\\/]org[\\/]route\.ts$/.test(file)) {
          // The partner console: its own refusal (view-as or ?codeId) comes
          // right after the read-only context lookup, before the body.
          const refusal = body.indexOf("partnerOrgWriteRefusal({ viewing: ctx.viewing, codeId: selectedOrgId })");
          assert.ok(body.slice(firstAwait).startsWith("await resolveContext(request)"), where);
          assert.ok(refusal > 0 && refusal < readsBody, `${where}: refusal before the body`);
          continue;
        }
        const viaGuard = body.slice(firstAwait).match(/^await requireOrgCapability\("[a-z_.]+", \{ request \}\)/);
        const viaGate = body.slice(firstAwait).startsWith("await gate(request)") && gateGuarded;
        assert.ok(viaGuard || viaGate, `${where}: the first await must be the org guard`);
        assert.ok(firstAwait < readsBody, `${where}: guard before the body`);
      }
    }
    assert.ok(writes >= 10, `write handlers checked: ${writes}`);
  });

  it("every org guard call passes its request (so a GET can be served while viewing)", () => {
    for (const file of ORG_ROUTES) {
      const src = code(readFileSync(file, "utf8"));
      for (const call of src.match(/requireOrgCapability\([^)]*\)/g) ?? []) {
        assert.match(call, /request \}\)$/, `${relative(API, file)}: ${call}`);
      }
    }
  });

  it("the partner console refuses writes for view-as and for the admin ?codeId view (defect H1)", () => {
    assert.equal(partnerOrgWriteRefusal({ viewing: true, codeId: null }), VIEW_AS_REFUSAL);
    assert.equal(partnerOrgWriteRefusal({ viewing: false, codeId: "00000000-0000-4000-8000-000000000009" }), ORG_READ_ONLY_REFUSAL);
    assert.equal(partnerOrgWriteRefusal({ viewing: false, codeId: undefined }), null);
    const src = code(read("app", "api", "partner", "org", "route.ts"));
    assert.match(src, /const adminPowers = !viewing && tier === "admin"/);
    assert.match(src, /canManage: managesStaff && !readOnly,/);
    assert.match(src, /canAssign: canAssign && !readOnly,/);
    assert.match(src, /canInvite: can\("org\.participant\.invite", true\) && !readOnly,/);
  });

  it("exports are refused while viewing", () => {
    assert.equal(viewAsExportRefusal(true, "csv"), "Downloads are off while you view as someone.");
    assert.equal(viewAsExportRefusal(true, null), null);
    assert.equal(viewAsExportRefusal(false, "csv"), null);
    assert.match(code(read("app", "api", "org", "insights", "route.ts")), /viewAsExportRefusal\(!!guard\.viewing, format\)/);
    assert.match(code(read("app", "api", "partner", "cohort", "route.ts")), /viewAsExportRefusal\(/);
  });
});

describe("the edge rule and its read-only POST allow-list", () => {
  it("the allow-list is empty on purpose; adding a path needs its own proof", () => {
    assert.deepEqual([...VIEW_MODE_READ_POSTS], []);
  });
  it("sign-in plumbing and ending the view itself are never blocked; reads never are", () => {
    assert.equal(viewModeBlocks("POST", "/api/auth/session-ping"), false);
    assert.equal(viewModeBlocks("DELETE", "/api/dev/impersonate"), false);
    assert.equal(viewModeBlocks("OPTIONS", "/api/org/tasks"), false);
    assert.equal(viewModeBlocks("GET", "/api/org/tasks"), false);
    assert.equal(viewModeBlocks("POST", "/dashboard/today"), false, "only /api is the edge's business");
    for (const p of ["/api/paths", "/api/next-step-why", "/api/revisions/check", "/api/assistant", "/api/access-code/redeem"]) {
      assert.equal(viewModeBlocks("POST", p), true, p);
    }
  });
  it("middleware uses the shared rule and words", () => {
    const mw = code(read("middleware.ts"));
    assert.match(mw, /if \(token && viewModeBlocks\(req\.method, req\.nextUrl\.pathname\)\)/);
    assert.match(mw, /if \(payload\.mode === "view"\) \{\s+return NextResponse\.json\(\{ error: VIEW_AS_REFUSAL, reason: "view_only" \}, \{ status: 403 \}\);/);
  });
  it("refusal words are plain (no em dashes, no jargon)", () => {
    for (const w of [VIEW_AS_REFUSAL, ORG_READ_ONLY_REFUSAL]) assert.doesNotMatch(w, /—|--/);
  });
});

describe("an admin's look is recorded as the admin, never as the staff member", () => {
  it("the guard tags the actor with the viewing admin; core logs use it", () => {
    const guard = code(read("lib", "org-guard.ts"));
    assert.match(guard, /const viewedBy = who\.viewing \? \(session\?\.impersonation\?\.adminId \?\? null\) : null;/);
    assert.match(guard, /actor: viewedBy \? \{ \.\.\.actor, viewedBy \} : actor,/);
    const core = readFileSync(join(CONSUMER, "..", "..", "packages", "core", "src", "orgClientView.ts"), "utf8");
    assert.match(core, /run\(sql\)\(SHARED_OPEN_LOG_SQL, \[\.\.\.p, via \?\? null, actor\.viewedBy \?\? null\]\)/);
    assert.match(core, /\(COALESCE\(\$7::uuid, \$4::uuid\)\)::text/);
  });
  it("the participant reads it plainly", () => {
    const label = (s: string) => (s === "applications" ? "Your job applications" : s);
    assert.equal(accessLogAction("opened", "applications", label, "admin view"), "opened your job applications while checking a staff member's view for Steel Man Resumes");
    assert.match(accessLogAction("queue", "applications", label, "admin view"), /while checking a staff member's work list for Steel Man Resumes$/);
    assert.equal(accessLogAction("queue", "applications", label, null), "had your interview and follow-up dates on their daily work list");
  });
});
