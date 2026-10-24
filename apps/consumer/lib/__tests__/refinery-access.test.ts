/**
 * Refinery seats (B7 gate, migration 096). One test per door, the gate
 * function, AI admission, Troy's approve path, and the hardening around codes.
 * Database calls are injected (lib/refinery-access-server.ts deps), so these
 * run without Neon. What only a real database can prove is listed in the B7
 * report and belongs to scripts/verify-org-isolation.mjs.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  FORGE_AI_WORKFLOWS,
  LIMITS_LINE,
  SEAT_EXEMPT_API,
  SEAT_GATED_FROM_FORGE,
  SEAT_PAGE,
  SEAT_REQUIRED_MESSAGE,
  seatAdmissionVerdict,
  seatAwareHref,
  seatClaimPasses,
  seatExemptApi,
  seatFrom,
  seatGateVerdict,
  seatNeedsReread,
  seatlessSession,
  SEAT_RECHECK_NO_SEAT_SECONDS,
  SEAT_RECHECK_SECONDS,
} from "../refinery-access";
import { TERMS_EXEMPT_API } from "../session-policy";
import { AI_WORKFLOWS } from "../ai-operation-policy";
import { parsePartnerPreAuth, isPartnerPreAuthorized } from "../partner-pre-auth";
import {
  HOUSE_ORG_MISSING,
  SeatDecisionError,
  SeatRequestError,
  decideSeatRequest,
  readSeat,
  refinerySeatAdmission,
  seatRequestSummary,
  type DecideSeatDeps,
  type SeatDeps,
} from "../refinery-access-server";
import { CODE_REFUSAL, codeAttemptLimits, mintCodeChoice } from "../access-code-guard";
import { ORG_CODE_ALPHABET as CODE_ALPHABET, generateOrgCode as generateSeatCode, seatsFull } from "@crucible/core/src/orgCode";
import { checkAuthRateLimits, memoryRateLimitStore, setAuthRateLimitStore } from "../auth-rate-limit";
import { ACCOUNT_LS_EXTRA_KEYS, clearForgeBrowserKeys, clearRunSessionStorage } from "../refinery-guards";
import { canSwitchView } from "../useUserTier";
import { nextActionFor } from "../lane-task";
import { SEAT_COPY } from "../seat-copy";

const APP = path.resolve(__dirname, "..", "..");
const REPO = path.resolve(APP, "..", "..");
const read = (...p: string[]) => fs.readFileSync(path.join(APP, ...p), "utf8");
const MIGRATION = fs.readFileSync(path.join(REPO, "packages", "core", "migrations", "096_refinery_access.sql"), "utf8");
const UID = "11111111-2222-4333-8444-555555555555";
/** Source without comments, so an explanation never satisfies or fails a check. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/* ------------------------------------------------------------ the gate -- */

test("gate: open sign-ups pass every path (applying 096 changes nothing)", () => {
  for (const p of ["/dashboard", "/dashboard/jobs", "/api/coach", "/api/applications", "/start"]) {
    assert.equal(seatGateVerdict(p, true, false), "pass", p);
  }
});

test("gate: a claim never read passes at the edge; AI admission is the backstop", () => {
  assert.equal(seatGateVerdict("/dashboard/jobs", null, false), "pass");
  assert.equal(seatGateVerdict("/api/coach", undefined, undefined), "pass");
  assert.equal(seatClaimPasses(undefined, false), true);
});

test("gate: closed with a seat passes", () => {
  assert.equal(seatGateVerdict("/dashboard/jobs", false, true), "pass");
  assert.equal(seatGateVerdict("/api/coach", false, true), "pass");
});

test("gate: closed without a seat: Refinery pages go to the seat page, Refinery APIs are refused", () => {
  for (const p of ["/dashboard", "/dashboard/jobs", "/dashboard/vault", "/dashboard/application-tailor", "/jobs", "/interview/x"]) {
    assert.equal(seatGateVerdict(p, false, false), "page", p);
  }
  for (const p of ["/api/coach", "/api/applications", "/api/interview-practice", "/api/disclosure-guide", "/api/vault/documents", "/api/progression", "/api/job-search", "/api/user/set-tier"]) {
    assert.equal(seatGateVerdict(p, false, false), "api", p);
  }
  // Only `true` is a seat: a truthy string or 1 from anywhere else is not.
  assert.equal(seatGateVerdict("/api/coach", false, "true"), "api");
  assert.equal(seatGateVerdict("/api/coach", false, 1), "api");
});

test("gate: closed without a seat keeps the Forge, settings and data rights", () => {
  for (const p of ["/start", "/resume", "/output", "/rush", "/check", "/seat", "/login", "/dashboard/settings", "/dashboard/security"]) {
    assert.equal(seatGateVerdict(p, false, false), "pass", p);
  }
  for (const p of [
    "/api/forge/save", "/api/forge/load", "/api/forge/generate-docs", "/api/forge/email-package/auto", "/api/parse", "/api/analyze",
    "/api/rush-resume", "/api/assistant", "/api/auth/session", "/api/auth/accept-terms", "/api/user/export-data", "/api/user/delete-data",
    "/api/user/export-vault", "/api/access-code/redeem", "/api/access-code/leave", "/api/seat", "/api/seat/request", "/api/seat/offer",
    "/api/revisions", "/api/lane-focus", "/api/user/2fa/setup", "/api/health/version", "/api/cron/sync-tracking",
  ]) {
    assert.equal(seatGateVerdict(p, false, false), "pass", p);
  }
});

test("gate: the exempt list is a superset of the terms list and never edits it", () => {
  for (const k of Object.keys(TERMS_EXEMPT_API)) {
    assert.ok(seatExemptApi(k.endsWith("/") ? k + "x" : k), k);
  }
  for (const [k, why] of Object.entries(SEAT_EXEMPT_API)) {
    assert.ok(k.startsWith("/api/") && why.length > 10, k);
    assert.ok(!k.startsWith("/api/admin") && !k.startsWith("/api/org") && !k.startsWith("/api/partner") && !k.startsWith("/api/coach"), k);
  }
});

test("gate: wired in authorized() after revocation, the second-step hold and terms; claim only from the database", () => {
  const src = read("auth.ts");
  const at = (s: string) => { const i = src.indexOf(s); assert.ok(i > 0, s); return i; };
  const seat = at("seatGateVerdict(path");
  assert.ok(seat > at("isSessionRevoked(sid"));
  assert.ok(seat > at("pendingSessionTreatment(path"));
  assert.ok(seat > at("termsGateVerdict(path"));
  assert.ok(seat < at("isAdminPowerPath(path)"));
  // The claim is read from the definer functions, after the Google last check.
  const read1 = at("public.smr_has_refinery_seat(${token.sub}::uuid)");
  assert.ok(read1 > at("throw new GoogleLinkRefused()"));
  assert.match(src, /seatFrom\(rows\[0\]\.seat, token\.email, proven\)/);
  assert.match(src, /SELECT email_proof_source IS NOT NULL AS proven FROM users/);
  // SF-7 (review 2): the proof is its own query, inside its own try, after the seat read, so a
  // missing column can only make the pre-auth part false; the seat query names no proof column.
  const seatQuery = src.slice(src.indexOf("public.smr_refinery_signup_open() AS open"), src.indexOf("public.smr_refinery_signup_open() AS open") + 200);
  assert.doesNotMatch(seatQuery, /email_pro/);
  const proofBlock = src.slice(src.indexOf("if (!rows[0].seat && isPartnerPreAuthorized(token.email))"), src.indexOf("(token as any).seatOpen = rows[0].open;"));
  assert.match(proofBlock, /try \{[\s\S]*email_proof_source[\s\S]*\} catch \{\s*proven = false;/);
  // The signIn callback does not mention seats at all (S2).
  const signIn = src.slice(src.indexOf("async signIn("), src.indexOf("async authorized("));
  assert.doesNotMatch(signIn, /seat/i);
});

test("gate: re-read on sign-in and update, hourly while seatless, daily otherwise", () => {
  const now = 10_000_000;
  assert.equal(seatNeedsReread({ trigger: "update", seatOpen: true, seat: true, seatAt: now, now }), true);
  assert.equal(seatNeedsReread({ trigger: "signIn", seatOpen: true, seat: true, seatAt: now, now }), true);
  assert.equal(seatNeedsReread({ seatOpen: undefined, seat: undefined, seatAt: undefined, now }), true);
  assert.equal(seatNeedsReread({ seatOpen: true, seat: false, seatAt: now - 100, now }), false);
  assert.equal(seatNeedsReread({ seatOpen: false, seat: false, seatAt: now - SEAT_RECHECK_NO_SEAT_SECONDS - 1, now }), true);
  assert.equal(seatNeedsReread({ seatOpen: false, seat: true, seatAt: now - SEAT_RECHECK_NO_SEAT_SECONDS - 1, now }), false);
  assert.equal(seatNeedsReread({ seatOpen: false, seat: true, seatAt: now - SEAT_RECHECK_SECONDS - 1, now }), true);
});

/* ------------------------------------------- Forge routes stay reachable -- */

/** Every "/api/..." literal reachable from the Forge pages' import graph. */
function forgeApiLiterals(): Map<string, string> {
  const exts = [".ts", ".tsx", "/index.ts", "/index.tsx"];
  const resolve = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = path.join(APP, spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
    else return null;
    if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
    for (const e of exts) if (fs.existsSync(base + e)) return base + e;
    return null;
  };
  const queue: string[] = [];
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f.name)) queue.push(p);
    }
  };
  walk(path.join(APP, "app", "(forge)"));
  queue.push(path.join(APP, "app", "(auth)", "seat", "page.tsx"));
  // The partner landing a seatless signed-in visitor can open (review 1, N-7).
  queue.push(path.join(APP, "app", "access", "page.tsx"));
  // The lists themselves name routes they do not call.
  const lists = new Set(["session-policy.ts", "forge-access.ts", "refinery-access.ts"].map((f) => path.join(APP, "lib", f)));
  const seen = new Set<string>();
  const found = new Map<string, string>();
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const r = resolve(f, m[1] || m[2]);
      if (r && !r.includes(`${path.sep}app${path.sep}api${path.sep}`)) queue.push(r);
    }
    if (lists.has(f)) continue;
    for (const m of src.matchAll(/["'`](\/api\/[A-Za-z0-9_\-\/]*)/g)) found.set(m[1], path.relative(APP, f));
  }
  return found;
}

test("Forge: every API route a Forge page can call is decided (exempt, or gated on purpose)", () => {
  const found = forgeApiLiterals();
  assert.ok(found.size > 20, "the import graph walk found the Forge's calls");
  const undecided: string[] = [];
  for (const [lit, from] of found) {
    const probe = lit.endsWith("/") ? lit + "x" : lit;
    if (seatExemptApi(probe)) continue;
    if (Object.prototype.hasOwnProperty.call(SEAT_GATED_FROM_FORGE, lit)) continue;
    undecided.push(`${lit} (${from})`);
  }
  assert.deepEqual(undecided, [], "add each to SEAT_EXEMPT_API or SEAT_GATED_FROM_FORGE with a reason");
  // The gated-on-purpose list really is gated.
  for (const p of Object.keys(SEAT_GATED_FROM_FORGE)) assert.equal(seatExemptApi(p), false, p);
});

test("Forge: exempt routes run only Forge AI workflows (a seatless account is never refused there)", () => {
  for (const w of FORGE_AI_WORKFLOWS) assert.ok((AI_WORKFLOWS as readonly string[]).includes(w), w);
  // Every route under /api/forge/ (the exemption is a prefix, review 1 N-8), found on disk.
  const forgeRoutes: string[] = [];
  const walkRoutes = (dir: string, rel: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.isDirectory()) walkRoutes(path.join(dir, f.name), `${rel}/${f.name}`);
      else if (f.name === "route.ts") forgeRoutes.push(rel);
    }
  };
  walkRoutes(path.join(APP, "app", "api", "forge"), "forge");
  assert.ok(forgeRoutes.length >= 10, `found ${forgeRoutes.length} forge routes`);
  const routes = [...forgeRoutes, "parse", "analyze", "rush-resume", "assistant",
    "lane-first", "revisions", "revisions/check", "revisions/rebuild", "resume/fit-check", "access-name"];
  for (const r of routes) {
    const file = path.join(APP, "app", "api", r, "route.ts");
    if (!fs.existsSync(file)) continue;
    for (const m of fs.readFileSync(file, "utf8").matchAll(/endpoint:\s*["']([a-z-]+)["']/g)) {
      const w = m[1];
      assert.ok(!(AI_WORKFLOWS as readonly string[]).includes(w) || FORGE_AI_WORKFLOWS.has(w), `${r} runs ${w}`);
    }
  }
  for (const w of ["coach", "resume", "resume-full", "interview", "disclosure", "quick-apply", "fit-check", "follow-up"]) {
    assert.equal(FORGE_AI_WORKFLOWS.has(w), false, w);
  }
});

/* --------------------------------------------------------- AI admission -- */

function deps(gate: { open: boolean; seat: boolean }, email: string | null = null, preAuthRaw = "", proven = true): SeatDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    preAuthRaw,
    readGate: async (u) => { calls.push(`gate:${u}`); return gate; },
    readEmail: async (u) => { calls.push(`email:${u}`); return { email, proven }; },
  };
}

test("AI admission: a seatless account is refused Refinery AI with 403 seat_required", async () => {
  const res = await refinerySeatAdmission(UID, "coach", deps({ open: false, seat: false }));
  assert.ok(res);
  assert.equal(res!.status, 403);
  const body = await res!.json();
  assert.equal(body.code, "seat_required");
  assert.equal(body.error, SEAT_REQUIRED_MESSAGE);
});

test("AI admission: seat, open sign-ups and Forge workflows pass; Forge never reads the database", async () => {
  assert.equal(await refinerySeatAdmission(UID, "coach", deps({ open: false, seat: true })), null);
  assert.equal(await refinerySeatAdmission(UID, "disclosure", deps({ open: true, seat: false })), null);
  const d = deps({ open: false, seat: false });
  assert.equal(await refinerySeatAdmission(UID, "generate-docs", d), null);
  assert.equal(await refinerySeatAdmission(UID, "assistant", d), null);
  assert.deepEqual(d.calls, []);
});

test("AI admission: a database error propagates so admission fails closed (503)", async () => {
  const broken: SeatDeps = { readGate: async () => { throw new Error("down"); }, readEmail: async () => null };
  await assert.rejects(() => refinerySeatAdmission(UID, "coach", broken), /down/);
  const src = read("lib", "ai-operation-server.ts");
  const i = src.indexOf("refinerySeatAdmission(input.userId, input.endpoint)");
  assert.ok(i > src.indexOf("try {") && i < src.indexOf("readToolPolicy(input.userId"), "inside the try, before the policy read");
});

test("AI admission: the verdict reads nothing but workflow, switch and seat", () => {
  assert.equal(seatAdmissionVerdict({ workflow: "coach", open: false, seat: false }), "refuse");
  assert.equal(seatAdmissionVerdict({ workflow: "coach", open: false, seat: true }), "pass");
  assert.equal(seatAdmissionVerdict({ workflow: "parse", open: false, seat: false }), "pass");
});

/* ------------------------------------------------------------ the doors -- */

test("door PARTNER_PRE_AUTH: a listed address is a seat; unlisted, blank and look-alikes are not", async () => {
  const raw = "Lead@Example.org:CODE1, other@example.org";
  assert.deepEqual(parsePartnerPreAuth(raw).emails, ["lead@example.org", "other@example.org"]);
  assert.equal(seatFrom(false, "lead@example.org", true, raw), true);
  assert.equal(seatFrom(false, " LEAD@example.org ", true, raw), true);
  assert.equal(seatFrom(false, "lead@example.org.evil", true, raw), false);
  assert.equal(seatFrom(false, null, true, raw), false);
  assert.equal(seatFrom(false, "x@example.org", true, ""), false);
  // SF-4: a listed address nobody proved (a password sign-up) is not a seat.
  assert.equal(seatFrom(false, "lead@example.org", false, raw), false);
  assert.deepEqual(await readSeat(UID, deps({ open: false, seat: false }, "lead@example.org", raw, false)), { open: false, seat: false });
  assert.equal(isPartnerPreAuthorized("lead@example.org", undefined), false);
  const d = deps({ open: false, seat: false }, "other@example.org", raw);
  assert.deepEqual(await readSeat(UID, d), { open: false, seat: true });
  // The email is read only when it can change the answer.
  const open = deps({ open: true, seat: false }, "other@example.org", raw);
  await readSeat(UID, open);
  assert.deepEqual(open.calls, [`gate:${UID}`]);
});

test("door rule: the seat function reads only admin, org, live membership and the grandfather list", () => {
  const body = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.smr_has_refinery_seat"), MIGRATION.indexOf("FUNCTION public.smr_accept_seat_offer"));
  for (const t of ["platform_admin", "partner_user_id", "org_staff", "access_code_redemption", "refinery_seat_legacy", "is_active", "expires_at"]) {
    assert.ok(body.includes(t), t);
  }
  const code = body.replace(/--[^\n]*/g, "");
  for (const never of ["tier", "progression", "premium", "current_setting"]) assert.doesNotMatch(code, new RegExp(never), never);
  assert.match(code, /SECURITY DEFINER SET search_path = pg_catalog, public/);
  assert.match(MIGRATION, /REVOKE ALL ON FUNCTION public\.smr_has_refinery_seat\(uuid\) FROM PUBLIC/);
  // Gate is off when applied.
  assert.match(MIGRATION, /public_signup_open boolean NOT NULL DEFAULT true/);
  assert.match(MIGRATION, /INSERT INTO refinery_access_policy \(id\) VALUES \(true\)/);
});

test("doors register, email link and Google: none of them writes a seat", () => {
  const files = [read("app", "api", "auth", "register", "route.ts"), read("auth.ts")];
  for (const src of files) {
    assert.doesNotMatch(src, /refinery_seat_legacy|org_seat_offer|INSERT INTO platform_admin/);
  }
  // Only the close action writes the grandfather list.
  const writers: string[] = [];
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) { if (f.name !== "node_modules" && f.name !== "__tests__" && f.name !== ".next") walk(p); }
      else if (/\.tsx?$/.test(f.name) && /INSERT INTO refinery_seat_legacy/.test(fs.readFileSync(p, "utf8"))) writers.push(path.relative(APP, p));
    }
  };
  walk(path.join(APP, "app")); walk(path.join(APP, "lib")); walk(path.join(APP, "components"));
  assert.deepEqual(writers, [path.join("lib", "refinery-access-server.ts")]);
});

test("door grandfather snapshot: the list and the switch change in ONE transaction", () => {
  const src = read("lib", "refinery-access-server.ts");
  const fn = src.slice(src.indexOf("export async function closeRefinerySignups"), src.indexOf("export async function removeLegacySeat"));
  assert.equal((fn.match(/await run\(/g) ?? []).length, 1, "one transaction");
  const order = ["CLOSE_STATEMENTS.lock", "CLOSE_STATEMENTS.snapshot", "CLOSE_STATEMENTS.flip"].map((k) => fn.indexOf(k));
  assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], "lock, snapshot, flip");
});

test("door access code: tries are rate limited per account and per connection", async () => {
  setAuthRateLimitStore(memoryRateLimitStore);
  try {
    const user = `u-${Date.now()}`;
    let allowed = 0;
    for (let i = 0; i < 25; i++) if ((await checkAuthRateLimits(codeAttemptLimits(`ip-${user}`, user))).allowed) allowed++;
    assert.equal(allowed, 20);
    // Another account behind the same connection still has the per-IP budget left, up to 60.
    let other = 0;
    for (let i = 0; i < 50; i++) if ((await checkAuthRateLimits(codeAttemptLimits(`ip-${user}`, `${user}-b-${i}`))).allowed) other++;
    assert.equal(other, 40);
  } finally {
    setAuthRateLimitStore(null);
  }
});

test("door access code: one neutral refusal, whatever the reason", () => {
  const src = read("app", "api", "access-code", "redeem", "route.ts");
  assert.ok(src.indexOf("checkAuthRateLimits(codeAttemptLimits(") < src.indexOf("redeemAccessCode(userId"), "limit before the try");
  const refusals = [...src.matchAll(/error: ([^}]+)\}/g)].map((m) => m[1].trim()).filter((e) => !/Not authenticated|Request not allowed/.test(e));
  assert.ok(refusals.length >= 3);
  for (const r of refusals) assert.equal(r, "CODE_REFUSAL");
  assert.doesNotMatch(src, /result\.error|outcome/);
  assert.doesNotMatch(CODE_REFUSAL, /expired|full|exist|taken|active/i);
  // The "what does it require" check shares the budget.
  assert.match(read("app", "api", "access-code", "policy", "route.ts"), /checkAuthRateLimits\(codeAttemptLimits\(/);
});

test("door mint: random 12-character codes by default; a chosen code needs a confirm", () => {
  const a = generateSeatCode();
  assert.equal(a.length, 12);
  assert.ok([...a].every((c) => CODE_ALPHABET.includes(c)));
  assert.doesNotMatch(CODE_ALPHABET, /[01OIL]/);
  assert.notEqual(generateSeatCode(), generateSeatCode());
  const r = mintCodeChoice({});
  assert.ok(r.ok && !r.chosen && r.code.length === 12);
  assert.equal(mintCodeChoice({ code: "MYCODE" }).ok, false);
  const c = mintCodeChoice({ code: "MYCODE", confirmChosenCode: true });
  assert.ok(c.ok && c.chosen && c.code === "MYCODE");
  assert.equal(mintCodeChoice({ code: "my code", confirmChosenCode: true }).ok, false);
  assert.equal(mintCodeChoice({ code: "MYCODE", confirmChosenCode: "yes" }).ok, false);
  assert.match(read("app", "api", "admin", "access-code", "mint", "route.ts"), /mintCodeChoice\(body\)/);
});

test("door org code shown only to holders of org.seats.view", () => {
  assert.match(read("app", "api", "partner", "org", "route.ts"), /code: seesSeats \? org\.code : null/);
});

test("door org invite of an existing account: an offer first, the seat is spent on accept", () => {
  const core = fs.readFileSync(path.join(REPO, "packages", "core", "src", "orgInvite.ts"), "utf8");
  const existing = core.slice(core.indexOf("if (existing) {"), core.indexOf("} else {", core.indexOf("if (existing) {")));
  const offer = existing.indexOf("createSeatOffer(");
  const redeem = existing.indexOf("redeemAccessCode(");
  assert.ok(offer > 0 && redeem > offer, "an account that signed in gets an offer before any redemption path");
  assert.ok(existing.slice(0, offer).includes("if (!pending)"));
  assert.match(existing.slice(offer, offer + 1400), /return \{ ok: true, userId, kind: "offered", notify: fresh \}/);
  // The accept function spends the seat through the one membership path.
  const accept = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.smr_accept_seat_offer"), MIGRATION.indexOf("FUNCTION public.smr_decline_seat_offer"));
  assert.match(accept, /o\.user_id = p_user AND o\.status = 'pending' FOR UPDATE/);
  assert.match(accept, /public\.smr_redeem_code\(p_user, v_code\)/);
  // The invite route: no auto-assignment and the neutral notice for an offer.
  const route = read("app", "api", "partner", "org", "route.ts");
  assert.match(route, /org\.role === "staff" && created\.kind === "invited"/);
  assert.match(route, /buildOfferEmail\(/);
  assert.doesNotMatch(route, /buildAddedEmail\(/);
});

/* ------------------------------------------------- Troy's approve path -- */

function decideDeps(over: Partial<DecideSeatDeps> = {}) {
  const log: string[] = [];
  const d: DecideSeatDeps = {
    readPolicy: async () => ({ house_code_id: "house-id" }),
    readHouse: async () => ({ id: "house-id", code: "HOUSECODE", partner_name: "House Org", is_active: true }),
    readUser: async () => ({ email: "person@example.org", name: "Pat" }),
    invite: (async (opts: any) => { log.push(`invite:${opts.accessCodeId}:${opts.code}:${opts.email}:${opts.invitedBy}`); return { ok: true, userId: UID, kind: "offered", notify: true }; }) as any,
    markDecided: async (_a, id, status) => { log.push(`mark:${id}:${status}`); return status; },
    notify: async (kind, to, org) => { log.push(`notify:${kind}:${to.email}:${org}`); },
    ...over,
  };
  return { d, log };
}
const REQ = { id: "req-1", user_id: UID, kind: "seat", status: "pending" };

test("approve: a seat from the house organization through the invite path, state before email", async () => {
  const { d, log } = decideDeps();
  const out = await decideSeatRequest("admin-1", REQ, "approve", "Welcome in", "https://x.test", d);
  assert.deepEqual(out, { status: "approved" });
  assert.deepEqual(log, ["invite:house-id:HOUSECODE:person@example.org:admin-1", "mark:req-1:approved", "notify:offered:person@example.org:House Org"]);
});

test("approve with no house organization: a clear admin error, nothing invited or marked", async () => {
  const { d, log } = decideDeps({ readPolicy: async () => ({ house_code_id: null }) });
  await assert.rejects(() => decideSeatRequest("admin-1", REQ, "approve", "ok", "", d), (e: unknown) => e instanceof SeatDecisionError && e.message === HOUSE_ORG_MISSING);
  assert.deepEqual(log, []);
});

test("approve when the pool is full: the invite's error shows and the request stays open", async () => {
  const { d, log } = decideDeps({ invite: (async () => ({ ok: false, error: "This code's seats are all taken." })) as any });
  await assert.rejects(() => decideSeatRequest("admin-1", REQ, "approve", "ok", "", d), /seats are all taken/);
  assert.deepEqual(log, []);
});

test("approve when the email fails: approved, and the failure is reported", async () => {
  const { d } = decideDeps({ notify: async () => { throw new Error("smtp"); } });
  assert.deepEqual(await decideSeatRequest("admin-1", REQ, "approve", "ok", "", d), { status: "approved", emailFailed: true });
});

test("deny and question never invite; decided requests are left alone; other kinds are refused", async () => {
  for (const [decision, status] of [["deny", "denied"], ["question", "question"]] as const) {
    const { d, log } = decideDeps();
    assert.deepEqual(await decideSeatRequest("admin-1", REQ, decision, "note", "", d), { status });
    assert.deepEqual(log, [`mark:req-1:${status}`]);
  }
  const { d, log } = decideDeps();
  assert.deepEqual(await decideSeatRequest("admin-1", { ...REQ, status: "approved" }, "approve", "x", "", d), { status: "approved" });
  assert.deepEqual(log, []);
  await assert.rejects(() => decideSeatRequest("admin-1", { ...REQ, kind: "ai_bonus" }, "approve", "x", "", d), /not_a_seat_request/);
});

test("approve: progression-server sends seat requests down the seat path before any grant insert", () => {
  const src = read("lib", "progression-server.ts");
  const fn = src.slice(src.indexOf("export async function decideAccessRequest"));
  const branch = fn.indexOf("if(r.kind==='seat')");
  assert.ok(branch > 0 && branch < fn.indexOf("INSERT INTO progression_grant"));
  // A self-service request cannot be filed as 'seat' through the progression route.
  assert.match(src, /\['unlock','ai_bonus','feedback','bug'\]\.includes\(String\(kind\)\)/);
});

test("seat request: validated summary, account email only, no second address", () => {
  const ok = seatRequestSummary({ idempotencyKey: "abcdefgh12", note: "I finished the Forge", referredBy: "a friend" });
  assert.match(ok.summary, /Refinery seat request/);
  assert.match(ok.summary, /account email/);
  assert.throws(() => seatRequestSummary({ idempotencyKey: "short" }), SeatRequestError);
  assert.throws(() => seatRequestSummary({ idempotencyKey: "abcdefgh12", note: "hi" }), SeatRequestError);
  assert.throws(() => seatRequestSummary({ idempotencyKey: "abcdefgh12", referredBy: "x".repeat(201) }), SeatRequestError);
  assert.doesNotThrow(() => seatRequestSummary({ idempotencyKey: "abcdefgh12" }));
  assert.match(MIGRATION, /CHECK \(kind IN \('unlock','ai_bonus','feedback','bug','seat'\)\)/);
});

/* ------------------------------------------------ admin view_as removal -- */

test("admin soft preview is gone; partners keep their client view", () => {
  assert.equal(canSwitchView("admin"), false);
  assert.equal(canSwitchView("partner"), true);
  assert.equal(canSwitchView("client"), false);
  const dev = code(read("components", "DevSwitcher.tsx"));
  assert.doesNotMatch(dev, /Me: Job Seeker|setSelfView|getViewAs/);
  assert.match(dev, /clearForgeBrowserKeysEverywhere\(clearAdminId\)/);
  assert.doesNotMatch(read("components", "admin", "AdminHome.tsx"), /enterView|setViewAs/);
  assert.doesNotMatch(read("app", "(dashboard)", "dashboard", "settings", "page.tsx"), /admin_test_mode|Test as Client/);
});

test("impersonation start and end clear the account keys and this tab's run keys", () => {
  const store = new Map<string, string>();
  const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const sess = new Map<string, string>([["rush_result", "x"], ["rush_target", "y"], ["resume_target_job", "z"], ["forge-record-choice:run1", "c"], ["keep", "k"]]);
  const ss = { get length() { return sess.size; }, key: (i: number) => [...sess.keys()][i] ?? null, removeItem: (k: string) => void sess.delete(k) };
  for (const k of [...ACCOUNT_LS_EXTRA_KEYS, "forge_session", "active_baseline_id", "smr_impersonation_seen"]) store.set(k, "v");
  clearForgeBrowserKeys(ls, ss);
  for (const k of [...ACCOUNT_LS_EXTRA_KEYS, "forge_session", "active_baseline_id"]) assert.equal(store.has(k), false, k);
  assert.equal(store.has("smr_impersonation_seen"), true, "the seen flag is how the chrome notices an end");
  assert.deepEqual([...sess.keys()], ["keep"]);
  clearRunSessionStorage(null);
  // RefineryShell's sign-out list is covered (nothing it clears survives an impersonation switch).
  const shell = read("app", "(dashboard)", "RefineryShell.tsx");
  const list = shell.slice(shell.indexOf("const PERSONAL_LS_KEYS = ["), shell.indexOf("];", shell.indexOf("const PERSONAL_LS_KEYS = [")));
  for (const m of list.matchAll(/"([a-z_]+)"/g)) {
    store.set(m[1], "v");
  }
  clearForgeBrowserKeys(ls, null);
  for (const m of list.matchAll(/"([a-z_]+)"/g)) assert.equal(store.has(m[1]), false, m[1]);
});

/* -------------------------------------------------------- page and copy -- */

test("Forge links into the Refinery go to the seat page for a seatless account only", () => {
  assert.equal(seatAwareHref("/dashboard/jobs", false), "/dashboard/jobs");
  assert.equal(seatAwareHref("/dashboard/jobs", true), `${SEAT_PAGE}?callbackUrl=${encodeURIComponent("/dashboard/jobs")}`);
  assert.equal(seatAwareHref("/dashboard/settings", true), "/dashboard/settings");
  assert.equal(seatAwareHref("/resume", true), "/resume");
  assert.equal(seatAwareHref("/login?from=forge", true), "/login?from=forge");
  assert.deepEqual(nextActionFor(null, { signedIn: true, finished: true, seatless: true }), { label: "Download your resume", href: "#finish-download" });
  assert.match(nextActionFor("job", { signedIn: true, finished: true, seatless: true }).href, /^\/seat\?callbackUrl=/);
  assert.equal(nextActionFor(null, { signedIn: true, finished: true }).href, "/dashboard/vault");
  assert.equal(seatlessSession({ seatOpen: false, seat: false }), true);
  assert.equal(seatlessSession({ seatOpen: null, seat: false }), false);
  assert.equal(seatlessSession({ seatOpen: false, seat: true }), false);
});

test("copy: plain words, no dashes, no price, and the email line only from a real row", () => {
  const all = [LIMITS_LINE, SEAT_REQUIRED_MESSAGE, CODE_REFUSAL, ...Object.values(SEAT_COPY).filter((v) => typeof v === "string"), SEAT_COPY.offerLead("Org")];
  for (const line of all) {
    assert.doesNotMatch(line as string, /—|–| -- |\$|price|free trial|unlimited/i, line as string);
  }
  const page = code(read("app", "(auth)", "seat", "page.tsx"));
  assert.match(page, /state\.packageEmailed \? \(\s*<p[^>]*>\{C\.emailed\}/);
  assert.doesNotMatch(page, /\/api\/forge\/save|ForgeImport/);
  assert.match(read("app", "api", "seat", "route.ts"), /FROM forge_package_email_sent WHERE user_id=\$1/);
});

/* ------------------------------------------------- security review 1 -- */

import { assistantSeatSurface } from "../assistant-seat";
import { buildAssistantTools } from "../tools/assistant-tools";
import { ALREADY_CLOSED, CLOSE_STATEMENTS, closeRefinerySignups } from "../refinery-access-server";
import { attributeFromCookie, type CookieAttributionDeps } from "../code-attribution";
import { CODE_SHAPE } from "../access-code-guard";
import { buildInviteEmail, buildOfferEmail } from "../org-invite-email";

const ACCOUNT_TOOLS = ["search_jobs", "save_job", "add_follow_up_reminder", "search_verified_employers", "search_verified_resources",
  "save_resource_list", "get_my_progress", "request_tool_access", "get_my_live_status", "read_saved_resources"];

function surface(gate: { open: boolean; seat: boolean } | null, extra: { platformOwner?: boolean; staff?: boolean } = {}) {
  return assistantSeatSurface({
    userId: UID, platformOwner: !!extra.platformOwner, staff: !!extra.staff, gate,
    toolOptions: { userId: UID, surface: "refinery" }, enhancedConsent: true,
  });
}

test("BL-1: a seatless signed-in caller of /api/assistant gets the Forge chat: no account tools, no memory", () => {
  for (const gate of [{ open: false, seat: false }, null]) {
    const out = surface(gate);
    assert.equal(out.scope, "forge");
    assert.equal(out.enhancedConsent, false, "memory is neither read nor written");
    const tools = Object.keys(buildAssistantTools(out.toolOptions));
    for (const t of ACCOUNT_TOOLS) assert.ok(!tools.includes(t), `${t} offered with gate ${JSON.stringify(gate)}`);
    assert.deepEqual(tools.sort(), ["highlight_element", "take_me_there"]);
  }
});

test("BL-1: a seat, open sign-ups, admins and staff keep the account chat", () => {
  for (const out of [surface({ open: false, seat: true }), surface({ open: true, seat: false }), surface(null, { platformOwner: true }), surface(null, { staff: true })]) {
    assert.equal(out.scope, "account");
    assert.equal(out.enhancedConsent, true);
  }
  const tools = Object.keys(buildAssistantTools(surface({ open: false, seat: true }).toolOptions));
  for (const t of ["search_jobs", "save_job", "add_follow_up_reminder"]) assert.ok(tools.includes(t), t);
});

test("BL-1: the route takes its tools, memory, selected work and rehearsal override from the seat surface", () => {
  const src = code(read("app", "api", "assistant", "route.ts"));
  const at = (x: string) => { const i = src.indexOf(x); assert.ok(i > 0, x); return i; };
  const decided = at("assistantSeatSurface(");
  assert.ok(decided < at("const memorySection"), "before memory");
  assert.ok(decided < at("buildAssistantTools(toolOptions)"), "before the tools are built");
  assert.ok(decided < at("const allowRoleplayOverride"), "before the rehearsal override");
  assert.match(src, /readSeat\(userId\)\.catch\(\(\) => null\)/, "a failed read is null, and null is the Forge chat");
  assert.match(src, /toolOptions = seatSurface\.toolOptions;/);
  assert.match(src, /enhancedConsent = seatSurface\.enhancedConsent;/);
  assert.match(src, /if \(userId && seatScope === "account" && !platformOwner/);
  assert.match(src, /!!userId &&\s*seatScope === "account" &&/);
});

/** A model of the policy row and the three close statements, keyed on the guards the SQL carries. */
function closeModel(users: string[]) {
  const st = { open: true, cutoff: null as number | null, legacy: new Set<string>(), users: new Set(users), clock: 1 };
  const run = async (_u: string, build: (sql: any) => unknown[]) => {
    const calls: [string, unknown[]][] = [];
    build((q: string, p: unknown[] = []) => { calls.push([q, p]); return null; });
    assert.deepEqual(calls.map((c) => c[0]), [CLOSE_STATEMENTS.lock, CLOSE_STATEMENTS.snapshot, CLOSE_STATEMENTS.flip]);
    const out: unknown[][] = [[{ id: true }]];
    if (st.open && st.cutoff === null) for (const u of st.users) st.legacy.add(u); // snapshot guard
    out.push([]);
    if (st.open) { st.open = false; st.cutoff = st.cutoff ?? st.clock++; out.push([{ id: true }]); } else out.push([]);
    return out;
  };
  return { st, run };
}

test("BL-2: the close statements grandfather only on the first close and only while open", () => {
  assert.match(CLOSE_STATEMENTS.lock, /FOR UPDATE/);
  assert.match(CLOSE_STATEMENTS.snapshot, /p\.public_signup_open AND p\.legacy_cutoff IS NULL/);
  assert.match(CLOSE_STATEMENTS.flip, /WHERE id AND public_signup_open RETURNING id/);
  assert.match(CLOSE_STATEMENTS.flip, /legacy_cutoff=COALESCE\(legacy_cutoff, now\(\)\)/);
  assert.match(MIGRATION, /legacy_cutoff timestamptz/);
  assert.match(MIGRATION, /GRANT SELECT, INSERT, DELETE ON refinery_seat_legacy TO smr_app/);
});

test("BL-2: closing twice changes nothing the second time and says so", async () => {
  const m = closeModel(["a", "b"]);
  await closeRefinerySignups("admin", m.run as any);
  await assert.rejects(() => closeRefinerySignups("admin", m.run as any), (e: unknown) => e instanceof SeatDecisionError && e.message === ALREADY_CLOSED);
  assert.deepEqual([...m.st.legacy].sort(), ["a", "b"]);
});

test("BL-2: open then close again does not grandfather accounts made in between", async () => {
  const m = closeModel(["a"]);
  await closeRefinerySignups("admin", m.run as any);
  const cutoff = m.st.cutoff;
  m.st.users.add("stranger-while-closed");
  m.st.open = true; // the admin "open" action
  m.st.users.add("stranger-while-open");
  await closeRefinerySignups("admin", m.run as any);
  assert.deepEqual([...m.st.legacy], ["a"]);
  assert.equal(m.st.cutoff, cutoff, "the cutoff never moves");
  const route = read("app", "api", "admin", "refinery-access", "route.ts");
  assert.match(route, /action === "unlegacy"/, "an admin can take a row off the list");
});

test("BL-3: the redeem route takes only the minted shape; hub-style and lowercase codes get the neutral refusal", () => {
  for (const bad of ["ABCD-REFINERY", "abcd1234", "ABC", "A".repeat(21), "AB CD", "ABCD'--"]) assert.equal(CODE_SHAPE.test(bad), false, bad);
  assert.equal(CODE_SHAPE.test("K7Q2M9X4P3RT"), true);
  const src = code(read("app", "api", "access-code", "redeem", "route.ts"));
  const shape = src.indexOf("if (!CODE_SHAPE.test(code))");
  assert.ok(shape > 0 && shape < src.indexOf("redeemAccessCode(userId"), "shape checked before the database");
  assert.match(src.slice(shape, shape + 120), /CODE_REFUSAL/);
  assert.ok(src.indexOf("isSameOriginJsonPost(request.headers)") < src.indexOf("await auth()"), "same-origin first (N-5)");
});

function cookieDeps(over: Partial<CookieAttributionDeps> = {}) {
  const log: string[] = [];
  const d: CookieAttributionDeps = {
    hasMembership: async () => { log.push("member?"); return false; },
    spendTry: async () => { log.push("spend"); return true; },
    attribute: async (_u, c) => { log.push(`attr:${c}`); return true; },
    ...over,
  };
  return { d, log };
}

test("SF-1: a cookie code is a try: refused when the budget is spent, free for members, hub shapes never tried", async () => {
  const spent = cookieDeps({ spendTry: async () => false });
  assert.equal(await attributeFromCookie("ip", UID, "GUESS1", spent.d), false);
  assert.ok(!spent.log.some((l) => l.startsWith("attr")));
  const member = cookieDeps({ hasMembership: async () => true });
  assert.equal(await attributeFromCookie("ip", UID, "GUESS1", member.d), false);
  assert.deepEqual(member.log, []);
  const hub = cookieDeps();
  assert.equal(await attributeFromCookie("ip", UID, "WAUK-REFINERY", hub.d), false);
  assert.deepEqual(hub.log, []);
  const ok = cookieDeps();
  assert.equal(await attributeFromCookie("ip", UID, " guess1 ", ok.d), true);
  assert.deepEqual(ok.log, ["member?", "spend", "attr:GUESS1"]);
  assert.equal(await attributeFromCookie("ip", UID, "GUESS1", cookieDeps({ attribute: async () => { throw new Error("db"); } }).d), false);
});

test("SF-1: withRateLimit and registration bind cookie codes only through the budget", () => {
  for (const f of [["lib", "withRateLimit.ts"], ["app", "api", "auth", "register", "route.ts"]]) {
    const src = code(read(...f));
    assert.doesNotMatch(src, /ensureUserAttribution\(/, f.join("/"));
    assert.match(src, /attributeFromCookie\(/, f.join("/"));
  }
});

test("SF-2: one staff reply whatever the address was, no kind in it, and one offer email per person per org per day", () => {
  const route = code(read("app", "api", "partner", "org", "route.ts"));
  const invite = route.slice(route.indexOf('body.action === "invite"'), route.indexOf('body.action === "resend_invite"'));
  assert.match(invite, /return NextResponse\.json\(\{ ok: true, message: INVITE_NEUTRAL_MESSAGE \}\);/);
  assert.doesNotMatch(invite, /kind: created\.kind|already has an account|emailFailed/);
  assert.match(invite, /if \(created\.notify\) \{/);
  const offerSql = fs.readFileSync(path.join(REPO, "packages", "core", "src", "refineryAccess.ts"), "utf8");
  assert.match(offerSql, /o\.status = 'pending'\s*OR o\.created_at > now\(\) - make_interval\(hours => \$4::int\)\s*OR o\.decided_at > now\(\)/);
  assert.match(offerSql, /OFFER_WINDOW_HOURS = 24/);
  assert.match(offerSql, /OFFER_INSERT_SQL, \[\s*opts\.accessCodeId,\s*opts\.userId,\s*opts\.offeredBy,\s*OFFER_WINDOW_HOURS,/);
});

test("SF-2: a seat approval asked already today sends no second email", async () => {
  const { d, log } = decideDeps({ invite: (async () => ({ ok: true, userId: UID, kind: "offered", notify: false })) as any });
  assert.deepEqual(await decideSeatRequest("admin-1", REQ, "approve", "ok", "", d), { status: "approved" });
  assert.ok(!log.some((l) => l.startsWith("notify")));
});

test("SF-3: names and organization names are escaped in the email HTML and left as typed in the text", () => {
  const name = `<a/href=https://example.test>Sign&#32;in</a>"x`;
  const org = `Org <b>"&'`;
  for (const m of [
    buildOfferEmail({ inviteeName: name, inviterName: "<i>Staff</i>", orgName: org, origin: "https://x.test" }),
    buildInviteEmail({ inviteeName: name, inviterName: null, orgName: org, url: "https://x.test/l?a=1&b=2", origin: "https://x.test" }),
  ]) {
    assert.doesNotMatch(m.html, /<a\/href|<b>|<i>/);
    assert.match(m.html, /&lt;a\/href=https:\/\/example\.test&gt;Sign&amp;#32;in&lt;\/a&gt;&quot;x/);
    assert.match(m.html, /Org &lt;b&gt;&quot;&amp;&#39;/);
    assert.match(m.text, /<a\/href=https:\/\/example\.test>Sign&#32;in<\/a>"x/);
  }
});

test("SF-5: leaving and coming back takes back the old seat; it never spends a second one", () => {
  const redeem = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.smr_redeem_code"), MIGRATION.indexOf("FUNCTION public.smr_leave_all_orgs"));
  const back = redeem.indexOf("FROM public.access_code_departure d");
  assert.ok(back > 0 && back < redeem.indexOf("v_code.times_redeemed >= v_code.max_redemptions"), "before the capacity check");
  const branch = redeem.slice(back, redeem.indexOf("END IF;", back));
  assert.doesNotMatch(branch, /times_redeemed/);
  assert.ok(redeem.indexOf("already_member") < back, "an active member is still 'already_member'");
  for (const fn of ["smr_leave_org", "smr_leave_all_orgs"]) {
    const body = MIGRATION.slice(MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`));
    assert.match(body.slice(0, 1200), /INSERT INTO public\.access_code_departure/, fn);
  }
  assert.ok(fs.readFileSync(path.join(REPO, "packages", "core", "src", "rlsHealth.ts"), "utf8").includes('"access_code_departure"'));
});

test("N-4 and SF8: accepting re-checks the other-org rule, and offers are in the org's own invite record", () => {
  const accept = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.smr_accept_seat_offer"), MIGRATION.indexOf("FUNCTION public.smr_decline_seat_offer"));
  assert.ok(accept.indexOf("RETURN 'other_org'") > 0 && accept.indexOf("RETURN 'other_org'") < accept.indexOf("smr_redeem_code("));
  assert.match(accept, /SET offer_status = 'joined'/);
  assert.match(MIGRATION, /ALTER TABLE org_invite ADD COLUMN IF NOT EXISTS offer_status/);
  assert.match(fs.readFileSync(path.join(REPO, "packages", "core", "src", "orgInvite.ts"), "utf8"), /invited_name, invited_email, offer_status\)\s*VALUES \(\$1, \$2, \$3, \$4, \$5, 'offered'\)/);
  assert.match(read("app", "api", "seat", "offer", "route.ts"), /other_org:/);
});

test("N-11 and N-10: the policy row is admin-read only; the constraint swap is safe to re-run", () => {
  const read1 = MIGRATION.slice(MIGRATION.indexOf("CREATE POLICY refinery_access_policy_read"), MIGRATION.indexOf("CREATE POLICY refinery_access_policy_admin"));
  assert.match(read1, /platform_admin/);
  assert.match(MIGRATION, /DROP CONSTRAINT IF EXISTS progression_request_kind_check/);
});

/* ------------------------------------------------- security review 2 -- */

import { COOKIE_CODE_LIMITS, cookieAttemptLimits } from "../access-code-guard";

test("SF-7: readSeat's proof read fails closed and uses the real proof, not 068's backfill", () => {
  const src = code(read("lib", "refinery-access-server.ts"));
  assert.match(src, /SELECT email_proof_source IS NOT NULL AS proven FROM users WHERE id = \$1/);
  assert.match(src, /\.then\(\(r\) => r\?\.proven === true, \(\) => false\)/);
  assert.doesNotMatch(src, /email_proven_at/);
});

test("N-13: a stale cookie code has its own small budget and one try per code per hour", async () => {
  const lim = cookieAttemptLimits("ip", UID, "OLDCODE1");
  assert.deepEqual(lim.map((l) => l.key), [`code:cookie:user:${UID}:OLDCODE1`, `code:cookie:user:${UID}`, "code:try:ip:ip"]);
  assert.equal(COOKIE_CODE_LIMITS.perUserCode.maxRequests, 1);
  assert.ok(!lim.some((l) => l.key === `code:try:user:${UID}`), "never the typed-code budget");
  setAuthRateLimitStore(memoryRateLimitStore);
  try {
    const u = `c-${Date.now()}`;
    assert.equal((await checkAuthRateLimits(cookieAttemptLimits("ip-c", u, "OLDCODE1"))).allowed, true);
    assert.equal((await checkAuthRateLimits(cookieAttemptLimits("ip-c", u, "OLDCODE1"))).allowed, false, "same code again within the hour: no try");
    assert.equal((await checkAuthRateLimits(codeAttemptLimits("ip-c2", u))).allowed, true, "the person's typed tries are untouched");
  } finally { setAuthRateLimitStore(null); }
});

test("N-15: the org email sender logs no recipient address", () => {
  const src = code(read("lib", "org-invite-email.ts"));
  const send = src.slice(src.indexOf("export async function sendOrgEmail"));
  for (const m of send.matchAll(/console\.(log|error|info|warn)\(([^;]*)\);/g)) assert.doesNotMatch(m[2], /\$\{to\}|\bto\b,/, m[0]);
});

test("addendum: offers have their own resend (once a day, offer email) and withdraw; ordinary invite paths skip them", () => {
  const core = fs.readFileSync(path.join(REPO, "packages", "core", "src", "orgInvite.ts"), "utf8");
  const resend = core.slice(core.indexOf("export async function touchOrgInviteResend"), core.indexOf("export async function revokeOrgInvite"));
  const offerBranch = resend.indexOf('if (row.offer_status === "offered")');
  assert.ok(offerBranch > 0 && offerBranch < resend.indexOf("if (!row.pending)"), "before the 'already joined' answer");
  assert.match(resend, /last_sent_at <= now\(\) - make_interval\(hours => \$3\)/);
  assert.match(resend, /offer: true/);
  const revoke = core.slice(core.indexOf("export async function revokeOrgInvite"));
  const wBranch = revoke.indexOf('if (row.offer_status === "offered")');
  assert.ok(wBranch > 0 && wBranch < revoke.indexOf("if (!row.pending)"));
  assert.match(revoke, /smr_withdraw_seat_offer\(/);
  const route = code(read("app", "api", "partner", "org", "route.ts"));
  assert.match(route, /if \(touched\.offer\) \{[\s\S]*buildOfferEmail\(/);
  assert.match(route, /Invite removed\. Any seat it held is free again\./);
  assert.match(MIGRATION, /CHECK \(status IN \('pending','accepted','declined','withdrawn'\)\)/);
  const w = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.smr_withdraw_seat_offer"));
  assert.match(w.slice(0, 900), /requires an organization scope/);
});

test("addendum: one code generator, in core, 31 characters with no L; 0 seats means full everywhere", () => {
  assert.equal(CODE_ALPHABET.length, 31);
  assert.doesNotMatch(CODE_ALPHABET, /[01OIL]/);
  // Unbiased: a byte stream of 255s is all dropped, so the generator keeps reading.
  let calls = 0;
  const code12 = generateSeatCode(12, (n) => { calls++; return Buffer.alloc(n, calls === 1 ? 255 : 7); });
  assert.equal(code12, CODE_ALPHABET[7].repeat(12));
  assert.equal(calls, 2);
  assert.equal(fs.existsSync(path.join(APP, "lib", "access-code-guard.ts")) && /randomInt|CODE_ALPHABET =/.test(read("lib", "access-code-guard.ts")), false, "no app copy");
  assert.equal(seatsFull(null, 99), false);
  assert.equal(seatsFull(0, 0), true, "0 is a cap of zero, as in smr_redeem_code");
  assert.equal(seatsFull(5, 4), false);
  assert.equal(seatsFull(5, 5), true);
  assert.match(fs.readFileSync(path.join(REPO, "packages", "core", "src", "accessCode.ts"), "utf8"), /if \(seatsFull\(ac\.max_redemptions, ac\.times_redeemed\)\)/);
  assert.match(read("app", "api", "admin", "access-code", "mint", "route.ts"), /seatsRaw >= 1/);
});

test("BL-4: both leave functions keep the live sharing revocation (054), scoped right", () => {
  const all = MIGRATION.slice(MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.smr_leave_all_orgs"), MIGRATION.indexOf("REVOKE ALL ON FUNCTION public.smr_redeem_code"));
  for (const t of ["UPDATE public.sharing_grant SET revoked_at = now(), revoked_reason = 'left_organization' WHERE user_id = p_user AND revoked_at IS NULL",
    "UPDATE public.sharing_request SET status = 'cancelled' WHERE user_id = p_user AND status = 'pending'",
    "UPDATE public.sharing_ack SET ended_at = now() WHERE user_id = p_user AND ended_at IS NULL"]) assert.ok(all.includes(t), t);
  const one = MIGRATION.slice(MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.smr_leave_org"), MIGRATION.indexOf("-- smr_redeem_code (048), redefined"));
  for (const t of ["sharing_grant", "sharing_request", "sharing_ack"]) assert.match(one, new RegExp(`UPDATE public\\.${t} SET[\\s\\S]*?access_code_id = p_org`), t);
});
