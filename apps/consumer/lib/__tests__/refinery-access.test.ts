/**
 * Refinery seats (B7 gate, migration 093). One test per door, the gate
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
import { CODE_ALPHABET, CODE_REFUSAL, codeAttemptLimits, generateSeatCode, mintCodeChoice } from "../access-code-guard";
import { checkAuthRateLimits, memoryRateLimitStore, setAuthRateLimitStore } from "../auth-rate-limit";
import { ACCOUNT_LS_EXTRA_KEYS, clearForgeBrowserKeys, clearRunSessionStorage } from "../refinery-guards";
import { canSwitchView } from "../useUserTier";
import { nextActionFor } from "../lane-task";
import { SEAT_COPY } from "../seat-copy";

const APP = path.resolve(__dirname, "..", "..");
const REPO = path.resolve(APP, "..", "..");
const read = (...p: string[]) => fs.readFileSync(path.join(APP, ...p), "utf8");
const MIGRATION = fs.readFileSync(path.join(REPO, "packages", "core", "migrations", "093_refinery_access.sql"), "utf8");
const UID = "11111111-2222-4333-8444-555555555555";
/** Source without comments, so an explanation never satisfies or fails a check. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/* ------------------------------------------------------------ the gate -- */

test("gate: open sign-ups pass every path (applying 093 changes nothing)", () => {
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
  assert.match(src, /seatFrom\(rows\[0\]\.seat, token\.email\)/);
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
  const routes = ["forge/save", "forge/load", "forge/generate-docs", "forge/recheck", "forge/resume-assist", "forge/suggest-fix",
    "forge/story-check", "forge/second-check", "forge/email-package", "forge/download", "parse", "analyze", "rush-resume", "assistant",
    "lane-first", "revisions", "revisions/check", "revisions/rebuild", "resume/fit-check"];
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

function deps(gate: { open: boolean; seat: boolean }, email: string | null = null, preAuthRaw = ""): SeatDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    preAuthRaw,
    readGate: async (u) => { calls.push(`gate:${u}`); return gate; },
    readEmail: async (u) => { calls.push(`email:${u}`); return email; },
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
  assert.equal(seatFrom(false, "lead@example.org", raw), true);
  assert.equal(seatFrom(false, " LEAD@example.org ", raw), true);
  assert.equal(seatFrom(false, "lead@example.org.evil", raw), false);
  assert.equal(seatFrom(false, null, raw), false);
  assert.equal(seatFrom(false, "x@example.org", ""), false);
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
  const fn = src.slice(src.indexOf("export async function closeRefinerySignups"), src.indexOf("export async function openRefinerySignups"));
  assert.equal((fn.match(/runAsUser/g) ?? []).length, 1);
  const ins = fn.indexOf("INSERT INTO refinery_seat_legacy (user_id) SELECT id FROM users");
  const upd = fn.indexOf("UPDATE refinery_access_policy SET public_signup_open=false");
  assert.ok(ins > 0 && upd > ins, "snapshot first, then the flip, same statement list");
  assert.match(fn, /throw new Error\("refinery_policy_not_changed"\)/);
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
  const refusals = [...src.matchAll(/error: ([^}]+)\}/g)].map((m) => m[1].trim()).filter((e) => !/Not authenticated/.test(e));
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
  assert.match(existing.slice(offer - 200, offer + 200), /return \{ ok: true, userId, kind: "offered" \}/);
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
    invite: (async (opts: any) => { log.push(`invite:${opts.accessCodeId}:${opts.code}:${opts.email}:${opts.invitedBy}`); return { ok: true, userId: UID, kind: "offered" }; }) as any,
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
