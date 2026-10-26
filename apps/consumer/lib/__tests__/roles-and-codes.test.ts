/**
 * House lane L2, roles and codes: the workspace decision, the stored-code
 * rule, the tier rule, and migration 101's refusals (source checks here; the
 * real SQL runs in roles-and-codes-pglite.test.ts and the isolation suite).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkspace } from "../workspace";
import { pendingCodeAction, PENDING_ACCESS_CODE_KEY } from "../pending-access-code";
import { tierFromRoles } from "@crucible/core/src/userTier";
import { REDEEM_ERRORS, REDEEM_SHOWN_REFUSALS } from "@crucible/core/src/accessCode";
import { inviteRedeemError } from "@crucible/core/src/orgInvite";

const CONSUMER = join(__dirname, "..", "..");
const ROOT = join(CONSUMER, "..", "..");
const read = (...p: string[]) => readFileSync(join(CONSUMER, ...p), "utf8");
const readRoot = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const U = "00000000-0000-4000-8000-000000000001";

describe("resolveWorkspace: the staff view comes from the org role, never the tier", () => {
  it("a platform admin with no org role gets the admin workspace", () => {
    assert.equal(resolveWorkspace({ userId: U, tier: "admin" }, { orgRole: null }), "admin");
    assert.equal(resolveWorkspace({ userId: U, isPlatformAdmin: true, tier: "client" }, {}), "admin");
  });
  it("a platform admin who also owns an org still gets the admin workspace (My organization lives inside it)", () => {
    assert.equal(resolveWorkspace({ userId: U, tier: "admin" }, { orgRole: "owner" }), "admin");
    assert.equal(resolveWorkspace({ userId: U, tier: "admin" }, { orgRole: "staff" }), "admin");
  });
  it("an owner whose cached tier is client gets the staff workspace (defect H4)", () => {
    assert.equal(resolveWorkspace({ userId: U, tier: "client" }, { orgRole: "owner" }), "staff");
  });
  it("staff with tier partner get the staff workspace; so do org admins on any tier", () => {
    assert.equal(resolveWorkspace({ userId: U, tier: "partner" }, { orgRole: "staff" }), "staff");
    assert.equal(resolveWorkspace({ userId: U, tier: "observer" }, { orgRole: "org_admin" }), "staff");
  });
  it("a participant who joined with a partner-tier code is a participant, not staff (defect H3)", () => {
    assert.equal(resolveWorkspace({ userId: U, tier: "partner" }, { orgRole: null, participantOf: ["org-a"] }), "participant");
  });
  it("staff in one org and participant in another: staff (their org role decides)", () => {
    assert.equal(resolveWorkspace({ userId: U, tier: "partner" }, { orgRole: "staff", participantOf: ["org-b"] }), "staff");
    assert.equal(resolveWorkspace({ userId: U, tier: "client" }, { orgRole: "staff", participantOf: ["org-b"] }), "staff");
  });
  it("a job seeker with no org is a participant; signed out is none", () => {
    assert.equal(resolveWorkspace({ userId: U, tier: "client" }, {}), "participant");
    assert.equal(resolveWorkspace({ userId: null, tier: "admin" }, { orgRole: "owner" }), "none");
    assert.equal(resolveWorkspace(null, null), "none");
  });
  it("during view-as the admin's powers never apply: the viewed person's workspace is used", () => {
    assert.equal(resolveWorkspace({ userId: U, tier: "partner", impersonating: { mode: "view" } }, { orgRole: "staff" }), "staff");
    assert.equal(resolveWorkspace({ userId: U, tier: "client", impersonating: { mode: "view" } }, {}), "participant");
    assert.equal(resolveWorkspace({ userId: U, tier: "admin", impersonating: { mode: "view" } }, {}), "participant");
  });
  it("an unknown role string never makes staff", () => {
    assert.equal(resolveWorkspace({ userId: U, tier: "partner" }, { orgRole: "volunteer" as never }), "participant");
  });
  it("/api/user/role resolves the org for every tier and sends the workspace; the landing uses it", () => {
    const route = code(read("app", "api", "user", "role", "route.ts"));
    assert.match(route, /const org = await getOrgContext\(userId\)\.catch\(\(\) => null\);/);
    assert.doesNotMatch(route, /tier === "partner" \|\| tier === "admin"\s*\?\s*await getOrgContext/);
    assert.match(route, /const workspace = resolveWorkspace\(/);
    assert.match(route, /workspace,/);
    const landing = code(read("app", "(dashboard)", "dashboard", "page.tsx"));
    assert.match(landing, /if \(workspace === "staff"\)/);
    assert.ok(landing.indexOf('if (workspace === "staff")') < landing.indexOf('if (tier === "partner")'), "staff first, then partner-without-org");
  });
});

describe("tier: partner is never derived from a code again", () => {
  it("partner only for someone who owns or works in an active organization", () => {
    assert.equal(tierFromRoles({ holdsStaffRole: true }), "partner");
    assert.equal(tierFromRoles({ holdsStaffRole: false }), "client");
  });
  it("syncUserTierFromCodes reads roles, not code tiers", () => {
    const src = code(readRoot("packages", "core", "src", "userTier.ts"));
    const sync = src.slice(src.indexOf("export async function syncUserTierFromCodes"), src.indexOf("export function tierFromRoles"));
    assert.doesNotMatch(sync, /ac\.tier|access_code_redemption|'partner' THEN|"unlimited"/);
    assert.match(sync, /ac\.partner_user_id = \$1 AND ac\.is_active = true/);
    assert.match(sync, /FROM org_staff os/);
    assert.match(sync, /getOneAsUser/);
  });
});

describe("a stored code is dropped for admin sessions (defect H5)", () => {
  const role = (tier: string, extra: Record<string, unknown> = {}) => ({ tier, ...extra });
  it("waits until the role is known, and when there is no code", () => {
    assert.equal(pendingCodeAction(null, "admin", "SAMPLE1"), "wait");
    assert.equal(pendingCodeAction(role("client"), "client", null), "wait");
    assert.equal(pendingCodeAction(role("client"), "client", "  "), "wait");
  });
  it("a platform admin's stored code is dropped, never redeemed", () => {
    assert.equal(pendingCodeAction(role("admin"), "admin", "SAMPLE1"), "drop");
    assert.equal(pendingCodeAction(role("client", { workspace: "admin" }), "client", "SAMPLE1"), "drop");
  });
  it("any view-as or assist session drops it, whoever is being viewed", () => {
    assert.equal(pendingCodeAction(role("client", { impersonating: { mode: "view" } }), "admin", "SAMPLE1"), "drop");
    assert.equal(pendingCodeAction(role("client", { impersonating: { mode: "assist" } }), "admin", "SAMPLE1"), "drop");
  });
  it("everyone else redeems it (the route and migration 101 still refuse staff)", () => {
    assert.equal(pendingCodeAction(role("client"), "client", "SAMPLE1"), "redeem");
    assert.equal(pendingCodeAction(role("partner", { workspace: "staff" }), "partner", "SAMPLE1"), "redeem");
  });
  it("the hook removes the code before acting and only redeems on 'redeem'", () => {
    const hook = code(read("lib", "use-pending-access-code.ts"));
    assert.equal(PENDING_ACCESS_CODE_KEY, "pending_access_code");
    const decide = hook.indexOf("pendingCodeAction(role, realTier, code)");
    const remove = hook.indexOf("removeStored();", decide);
    const drop = hook.indexOf('if (action === "drop" || !code) return;', remove);
    const post = hook.indexOf('fetch("/api/access-code/redeem"', drop);
    assert.ok(decide > 0 && remove > decide && drop > remove && post > drop, "decide, remove, drop, then redeem");
    assert.match(hook, /if \(action === "wait"\) return;/);
  });
});

describe("codes refuse platform admins and the org's own staff (migration 101)", () => {
  const MIG = readRoot("packages", "core", "migrations", "101_roles_and_codes.sql");
  const M096 = readRoot("packages", "core", "migrations", "096_refinery_access.sql");
  const fn = (src: string) => {
    const start = src.indexOf("CREATE OR REPLACE FUNCTION public.smr_redeem_code");
    return src.slice(start, src.indexOf("$$;", start) + 3);
  };
  const lines = (body: string) => body.split("\n").map((l) => l.replace(/--.*$/, "").trim()).filter(Boolean);

  it("has the house header, a lock timeout, a BYPASSRLS guard and an after-guard; changes no data", () => {
    assert.match(MIG, /^-- 101_roles_and_codes\.sql\n/);
    assert.match(MIG, /SET LOCAL lock_timeout = '5s';/);
    assert.match(MIG, /rolbypassrls OR rolsuper/);
    assert.match(MIG, /101 after-guard/);
    const sqlOnly = MIG.replace(/--.*$/gm, "");
    const outsideFn = sqlOnly.replace(fn(sqlOnly), "");
    assert.doesNotMatch(outsideFn, /\b(INSERT INTO|UPDATE public\.|UPDATE users|DELETE FROM)\b/i, "no data changes outside the function");
  });
  it("refuses admins before the code is read, and staff/owner after it is found and open", () => {
    const body = fn(MIG);
    const admin = body.indexOf("RETURN 'platform_admin'");
    const lookup = body.indexOf("SELECT * INTO v_code");
    const expired = body.indexOf("RETURN 'expired'");
    const staff = body.indexOf("RETURN 'org_staff'");
    const member = body.indexOf("RETURN 'already_member'");
    assert.ok(admin > 0 && admin < lookup, "admin before lookup: the same answer for every code");
    assert.ok(expired < staff && staff < member, "staff after open checks, before membership rules");
    assert.match(body, /v_code\.partner_user_id = p_user/);
    assert.match(body, /FROM public\.org_staff os\s+WHERE os\.user_id = p_user AND os\.access_code_id = v_code\.id/);
    assert.match(body, /SECURITY DEFINER SET search_path = pg_catalog, public/);
  });
  it("every other line of the function is 096's, in the same order", () => {
    const added = new Set([
      "IF EXISTS (SELECT 1 FROM public.platform_admin pa WHERE pa.user_id = p_user) THEN",
      "RETURN 'platform_admin';",
      "IF v_code.partner_user_id = p_user",
      "OR EXISTS (SELECT 1 FROM public.org_staff os",
      "WHERE os.user_id = p_user AND os.access_code_id = v_code.id) THEN",
      "RETURN 'org_staff';",
    ]);
    const now = lines(fn(MIG));
    const removedAdded: string[] = [];
    let skipEndIf = 0;
    for (const l of now) {
      if (added.has(l)) { if (l.startsWith("RETURN")) skipEndIf++; continue; }
      if (l === "END IF;" && skipEndIf > 0) { skipEndIf--; continue; }
      removedAdded.push(l);
    }
    assert.deepEqual(removedAdded, lines(fn(M096)));
  });
  it("checks the function OWNER for BYPASSRLS, and the dry run and re-tier refuse to run without it (fix round 1)", () => {
    assert.match(MIG, /JOIN pg_roles r ON r\.oid = p\.proowner[\s\S]*?\(r\.rolbypassrls OR r\.rolsuper\)/);
    const DRY = readRoot("packages", "core", "migrations", "dry-run", "101_roles_and_codes.sql");
    const afterBegin = DRY.slice(DRY.indexOf("\nBEGIN READ ONLY;"));
    assert.ok(afterBegin.indexOf("rolbypassrls OR rolsuper") < afterBegin.indexOf("-- 1. platform admins"), "dry-run guard before any read");
    const upd = DRY.slice(DRY.indexOf("-- BEGIN;"));
    assert.ok(upd.indexOf("re-tier needs a role with BYPASSRLS") > 0 && upd.indexOf("re-tier needs a role with BYPASSRLS") < upd.indexOf("WITH r AS"), "re-tier guard before the UPDATE");
  });
  it("re-asserts PUBLIC revoke and the smr_app grant", () => {
    assert.match(MIG, /REVOKE ALL ON FUNCTION public\.smr_redeem_code\(uuid, text\) FROM PUBLIC;/);
    assert.match(MIG, /REVOKE ALL ON FUNCTION public\.smr_redeem_code\(uuid, text\) FROM smr_app;\s+GRANT EXECUTE ON FUNCTION public\.smr_redeem_code\(uuid, text\) TO smr_app;/);
  });
  it("the app says the two refusals plainly and nothing else", () => {
    assert.deepEqual([...REDEEM_SHOWN_REFUSALS].sort(), ["org_staff", "platform_admin"]);
    for (const k of ["platform_admin", "org_staff"] as const) {
      assert.ok(REDEEM_ERRORS[k].length > 20);
      assert.doesNotMatch(REDEEM_ERRORS[k], /—|--|felon|offender/i);
    }
    const route = code(read("app", "api", "access-code", "redeem", "route.ts"));
    assert.match(route, /if \(REDEEM_SHOWN_REFUSALS\.has\(result\.outcome\)\) \{\s+return NextResponse\.json\(\{ error: result\.error, reason: result\.outcome \}, \{ status: 409 \}\);/);
    assert.match(route, /return NextResponse\.json\(\{ error: CODE_REFUSAL \}, \{ status: 400 \}\);/, "every other refusal unchanged");
  });
  it("an offer to an admin or the org's own staff is answered in plain words and stays unspent", () => {
    const offer = code(read("app", "api", "seat", "offer", "route.ts"));
    assert.match(offer, /platform_admin: \{ status: 409,/);
    assert.match(offer, /org_staff: \{ status: 409,/);
    const core = code(readRoot("packages", "core", "src", "refineryAccess.ts"));
    assert.match(core, /const OFFER_OUTCOMES: readonly OfferOutcome\[\] = \[[^\]]*"platform_admin", "org_staff"\]/);
  });
  it("staff adding a participant who is on their own staff are told so about that person", () => {
    assert.match(inviteRedeemError("org_staff"), /That person is on your organization's staff/);
    assert.equal(inviteRedeemError("platform_admin"), "That address cannot be added as a participant.");
    assert.equal(inviteRedeemError("full", "This code's seats are all taken."), "This code's seats are all taken.");
    assert.equal(inviteRedeemError("weird"), "Could not claim a seat.");
  });
});
