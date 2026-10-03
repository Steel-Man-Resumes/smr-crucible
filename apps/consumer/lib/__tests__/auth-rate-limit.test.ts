/**
 * Sign-in rate limits, tested as the claim rather than as the code.
 *
 * The claim: one person switching between several password accounts from one
 * connection is never refused, a password guesser still is, and the magic-link
 * limits (which protect the email sender) are exactly what they were.
 *
 * Every check below goes through signInRateLimits -- the same function the
 * sign-in route calls -- so the keys and limits under test are the real ones.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_LIMITS,
  checkAuthRateLimit,
  checkMemoryRateLimit,
  hashRateLimitKey,
  refundMemoryRateLimit,
  signInResponseFailed,
  setAuthRateLimitStore,
  slidingWindowDecision,
  windowStartFor,
  precheckRateLimits,
  stepUpRateLimits,
  signInEmailFromBody,
  signInPostRequiresEmail,
  signInRateLimits,
} from "../auth-rate-limit";

const PASSWORD_PATH = "/api/auth/callback/password-login";
const MAGIC_LINK_PATH = "/api/auth/signin/resend";

const realNow = Date.now;
let clock = 0;

/**
 * What the route does for one sign-in POST: IP check, then email check. Uses
 * the in-memory limiter (the fallback store) so the limits themselves are
 * tested without a database.
 */
function attempt(pathname: string, ip: string, email: string): boolean {
  const limits = signInRateLimits(pathname, ip, email);
  if (!checkMemoryRateLimit(limits.ip.key, limits.ip.config).allowed) return false;
  return checkMemoryRateLimit(limits.email.key, limits.email.config).allowed;
}

let run = 0;
/** A fresh IP per test so the module-level store never leaks between tests. */
const freshIp = () => `203.0.113.${++run}`;

beforeEach(() => {
  clock = realNow();
  Date.now = () => clock;
});
afterEach(() => {
  Date.now = realNow;
});

describe("password sign-ins", () => {
  it("allows 8 sign-ins across five accounts from one IP inside a minute", () => {
    const ip = freshIp();
    const results: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      clock += 7_000; // 8 sign-ins in 56 seconds
      results.push(attempt(PASSWORD_PATH, ip, `person${i % 5}-${ip}@example.org`));
    }
    assert.deepEqual(results, Array(8).fill(true));
  });

  it("allows the 30th and refuses the 31st from one IP within 15 minutes", () => {
    const ip = freshIp();
    const results: boolean[] = [];
    for (let i = 0; i < 31; i++) {
      clock += 20_000; // all 31 inside 15 minutes
      results.push(attempt(PASSWORD_PATH, ip, `person${i}-${ip}@example.org`));
    }
    assert.deepEqual(results, [...Array(30).fill(true), false]);
  });

  it("lets the same IP back in once the 15-minute window has passed", () => {
    const ip = freshIp();
    for (let i = 0; i < 31; i++) attempt(PASSWORD_PATH, ip, `p${i}-${ip}@example.org`);
    clock += AUTH_LIMITS.passwordPerIp.windowMs + 1;
    assert.equal(attempt(PASSWORD_PATH, ip, `again-${ip}@example.org`), true);
  });

  it("lets a lab of 25 people behind one IP all sign in through the login form (precheck, then sign-in)", () => {
    const ip = freshIp();
    const results: boolean[] = [];
    for (let i = 0; i < 25; i++) {
      clock += 15_000;
      const email = `learner${i}-${ip}@example.org`;
      const pre = precheckRateLimits(ip, email);
      const preOk =
        checkMemoryRateLimit(pre.ip.key, pre.ip.config).allowed &&
        checkMemoryRateLimit(pre.email.key, pre.email.config).allowed;
      results.push(preOk && attempt(PASSWORD_PATH, ip, email));
    }
    assert.deepEqual(results, Array(25).fill(true));
  });

  it("the precheck never spends the password per-IP budget, but shares the per-email one", () => {
    const pre = precheckRateLimits("198.51.100.20", "a@example.org");
    const pw = signInRateLimits(PASSWORD_PATH, "198.51.100.20", "a@example.org");
    assert.notEqual(pre.ip.key, pw.ip.key);
    assert.equal(pre.email.key, pw.email.key);
    assert.ok(pre.ip.config.maxRequests >= pw.ip.config.maxRequests);
  });

  it("refuses the 11th guess at one account even when every guess comes from a new IP", () => {
    const email = `target-${freshIp()}@example.org`;
    const results: boolean[] = [];
    for (let i = 0; i < 11; i++) results.push(attempt(PASSWORD_PATH, freshIp(), email));
    assert.deepEqual(results, [...Array(10).fill(true), false]);
  });
});

describe("email-link requests (R2 S3: 30 per IP, 5 per email, per hour)", () => {
  it("keeps the original keys with the new hourly limits", () => {
    const limits = signInRateLimits(MAGIC_LINK_PATH, "198.51.100.7", "a@example.org");
    assert.equal(limits.ip.key, "auth:ip:198.51.100.7");
    assert.equal(limits.email.key, "auth:email:a@example.org");
    assert.deepEqual(limits.ip.config, { maxRequests: 30, windowMs: 3_600_000 });
    assert.deepEqual(limits.email.config, { maxRequests: 5, windowMs: 3_600_000 });
  });

  it("refuses the 31st request from one IP within the hour", () => {
    const ip = freshIp();
    const results: boolean[] = [];
    for (let i = 0; i < 31; i++) {
      clock += 60_000;
      results.push(attempt(MAGIC_LINK_PATH, ip, `link${i}-${ip}@example.org`));
    }
    assert.deepEqual(results, [...Array(30).fill(true), false]);
  });

  it("refuses the 6th request for one email within the hour", () => {
    const email = `inbox-${freshIp()}@example.org`;
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) results.push(attempt(MAGIC_LINK_PATH, freshIp(), email));
    assert.deepEqual(results, [true, true, true, true, true, false]);
  });

  it("treats any email-bearing POST that is not the password callback as a magic link", () => {
    const limits = signInRateLimits("/api/auth/signin/anything-else", "198.51.100.8", "b@example.org");
    assert.equal(limits.ip.config, AUTH_LIMITS.magicLinkPerIp);
  });
});

describe("the two kinds do not share a bucket", () => {
  it("ten password sign-ins leave the full magic-link allowance, and the reverse", () => {
    const ip = freshIp();
    const email = `both-${ip}@example.org`;

    // Exhaust the magic-link allowance for this email (5) from this IP.
    for (let i = 0; i < 5; i++) assert.equal(attempt(MAGIC_LINK_PATH, ip, email), true);
    assert.equal(attempt(MAGIC_LINK_PATH, ip, email), false);

    // Password sign-in for the same person from the same IP is untouched
    // (10 failures per email per 15 minutes is the binding limit here).
    for (let i = 0; i < 10; i++) assert.equal(attempt(PASSWORD_PATH, ip, email), true);
    assert.equal(attempt(PASSWORD_PATH, ip, email), false);

    // And spending the password allowance did not add to the magic-link count:
    // a different email from this IP still has magic-link requests left.
    assert.equal(attempt(MAGIC_LINK_PATH, ip, `other-${ip}@example.org`), true);
  });
});

/**
 * What the sign-in route does for one password POST under R2 S3: count on
 * both keys, run the sign-in, hand both counts back if it succeeded.
 */
function passwordSignIn(ip: string, email: string, succeeds: boolean): boolean {
  const limits = signInRateLimits(PASSWORD_PATH, ip, email);
  const a = checkMemoryRateLimit(limits.ip.key, limits.ip.config);
  if (!a.allowed) return false;
  const b = checkMemoryRateLimit(limits.email.key, limits.email.config);
  if (!b.allowed) {
    refundMemoryRateLimit(a.ticket as any);
    return false;
  }
  if (succeeds) {
    refundMemoryRateLimit(a.ticket as any);
    refundMemoryRateLimit(b.ticket as any);
  }
  return true;
}

describe("password limits count failed attempts only (R2 S3)", () => {
  it("never refuses successful sign-ins, however many come from one IP", () => {
    const ip = freshIp();
    const results: boolean[] = [];
    for (let i = 0; i < 100; i++) {
      clock += 1_000;
      results.push(passwordSignIn(ip, `learner${i}-${ip}@example.org`, true));
    }
    assert.deepEqual(results, Array(100).fill(true));
  });

  it("refuses the 31st failure from one IP within 15 minutes", () => {
    const ip = freshIp();
    const results: boolean[] = [];
    for (let i = 0; i < 31; i++) results.push(passwordSignIn(ip, `p${i}-${ip}@example.org`, false));
    assert.deepEqual(results, [...Array(30).fill(true), false]);
  });

  it("refuses the 11th failure on one account, from any number of IPs", () => {
    const email = `target-${freshIp()}@example.org`;
    const results: boolean[] = [];
    for (let i = 0; i < 11; i++) results.push(passwordSignIn(freshIp(), email, false));
    assert.deepEqual(results, [...Array(10).fill(true), false]);
  });

  it("a success in between does not use up the allowance", () => {
    const email = `mixed-${freshIp()}@example.org`;
    for (let i = 0; i < 9; i++) assert.equal(passwordSignIn(freshIp(), email, false), true);
    for (let i = 0; i < 5; i++) assert.equal(passwordSignIn(freshIp(), email, true), true);
    assert.equal(passwordSignIn(freshIp(), email, false), true); // 10th failure
    assert.equal(passwordSignIn(freshIp(), email, false), false); // 11th refused
  });
});

describe("signInResponseFailed", () => {
  it("reads a failed credentials sign-in (JSON url or redirect with error=)", async () => {
    assert.equal(await signInResponseFailed(Response.json({ url: "https://x.example/login?error=CredentialsSignin&code=credentials" })), true);
    assert.equal(
      await signInResponseFailed(new Response(null, { status: 302, headers: { location: "/login?error=CredentialsSignin" } })),
      true
    );
  });
  it("reads a successful one", async () => {
    assert.equal(await signInResponseFailed(Response.json({ url: "https://x.example/dashboard" })), false);
    assert.equal(await signInResponseFailed(new Response(null, { status: 302, headers: { location: "/dashboard" } })), false);
  });
  it("counts anything unreadable as a failure", async () => {
    assert.equal(await signInResponseFailed(new Response("oops", { status: 500 })), true);
    assert.equal(await signInResponseFailed(new Response("not json", { status: 200 })), true);
  });
});

describe("the limiter reads the email the way Auth.js does (F4)", () => {
  const FORM = "application/x-www-form-urlencoded";
  const JSON_CT = "application/json";

  it("reads a JSON body, which used to skip every limit", () => {
    assert.deepEqual(
      signInEmailFromBody(JSON_CT, JSON.stringify({ email: " Victim@Example.org ", password: "x", csrfToken: "t" })),
      { kind: "email", email: "victim@example.org" }
    );
    assert.deepEqual(
      signInEmailFromBody("application/json; charset=utf-8", JSON.stringify({ email: "a@example.org" })),
      { kind: "email", email: "a@example.org" }
    );
  });

  it("refuses a form that repeats the email field (Auth.js keeps the last one)", () => {
    assert.deepEqual(
      signInEmailFromBody(FORM, "email=decoy%40example.org&email=victim%40example.org&password=x"),
      { kind: "invalid" }
    );
  });

  it("reads a single form email", () => {
    assert.deepEqual(
      signInEmailFromBody(FORM, "email=Person%40Example.org&password=x"),
      { kind: "email", email: "person@example.org" }
    );
  });

  it("refuses a JSON email that is not a string, and unparseable JSON", () => {
    assert.deepEqual(signInEmailFromBody(JSON_CT, JSON.stringify({ email: ["a@example.org", "b@example.org"] })), { kind: "invalid" });
    assert.deepEqual(signInEmailFromBody(JSON_CT, JSON.stringify({ email: { x: 1 } })), { kind: "invalid" });
    assert.deepEqual(signInEmailFromBody(JSON_CT, "{not json"), { kind: "invalid" });
  });

  it("finds no email when there is none, or when Auth.js would read no body", () => {
    assert.deepEqual(signInEmailFromBody(JSON_CT, JSON.stringify({ csrfToken: "t", data: {} })), { kind: "none" });
    assert.deepEqual(signInEmailFromBody(FORM, "csrfToken=t"), { kind: "none" });
    assert.deepEqual(signInEmailFromBody(FORM, "email="), { kind: "none" });
    assert.deepEqual(signInEmailFromBody("text/plain", "email=a%40example.org"), { kind: "none" });
    assert.deepEqual(signInEmailFromBody(null, "email=a%40example.org"), { kind: "none" });
  });

  it("requires an email on the password callback and the magic-link request only", () => {
    assert.equal(signInPostRequiresEmail("/api/auth/callback/password-login"), true);
    assert.equal(signInPostRequiresEmail("/api/auth/callback/password-login/"), true);
    assert.equal(signInPostRequiresEmail("/api/auth/signin/resend"), true);
    assert.equal(signInPostRequiresEmail("/api/auth/signout"), false);
    assert.equal(signInPostRequiresEmail("/api/auth/session"), false);
    assert.equal(signInPostRequiresEmail("/api/auth/signin/google"), false);
  });
});

describe("durable store (F7)", () => {
  const cfg = { maxRequests: 10, windowMs: 900_000 };

  it("allows up to the limit inside one window and refuses past it", () => {
    const start = windowStartFor(Date.parse("2026-10-03T12:00:00Z"), cfg.windowMs);
    assert.equal(slidingWindowDecision({ prev: 0, cur: 10, now: start + 1000, config: cfg }).allowed, true);
    assert.equal(slidingWindowDecision({ prev: 0, cur: 11, now: start + 1000, config: cfg }).allowed, false);
  });

  it("counts the previous window for the part that still overlaps, so a boundary is no free reset", () => {
    const start = windowStartFor(Date.parse("2026-10-03T12:00:00Z"), cfg.windowMs);
    // Ten attempts just before the boundary, one just after: 10*~1 + 1 > 10.
    assert.equal(slidingWindowDecision({ prev: 10, cur: 1, now: start + 1000, config: cfg }).allowed, false);
    // Halfway through the next window half of them have aged out.
    assert.equal(slidingWindowDecision({ prev: 10, cur: 5, now: start + cfg.windowMs / 2, config: cfg }).allowed, true);
    assert.equal(slidingWindowDecision({ prev: 10, cur: 6, now: start + cfg.windowMs / 2, config: cfg }).allowed, false);
  });

  it("stores an HMAC, never the raw email or IP", () => {
    const h = hashRateLimitKey("auth:pw:email:person@example.org", cfg.windowMs, "secret-a");
    assert.match(h, /^h1:[0-9a-f]{40}$/);
    assert.ok(!h.includes("example.org"));
    assert.notEqual(h, hashRateLimitKey("auth:pw:email:person@example.org", cfg.windowMs, "secret-b"));
    assert.notEqual(h, hashRateLimitKey("auth:pw:email:person@example.org", 3_600_000, "secret-a"));
  });

  it("uses the active store, and falls back to in-memory (not unlimited) when it fails", async () => {
    try {
      setAuthRateLimitStore({ hit: async () => ({ allowed: false, resetIn: 5000 }), refund: async () => {} });
      assert.equal((await checkAuthRateLimit("k-store", cfg)).allowed, false);

      setAuthRateLimitStore({ hit: async () => { throw new Error("db down"); }, refund: async () => {} });
      const key = `k-fallback-${freshIp()}`;
      const small = { maxRequests: 2, windowMs: 60_000 };
      const results: boolean[] = [];
      for (let i = 0; i < 3; i++) results.push((await checkAuthRateLimit(key, small)).allowed);
      assert.deepEqual(results, [true, true, false]);
    } finally {
      setAuthRateLimitStore(null);
    }
  });
});

describe("step-up counters (review 3)", () => {
  it("are keyed by user and IP, never by email", () => {
    const limits = stepUpRateLimits("198.51.100.30", "user-123");
    assert.deepEqual(limits.map((l) => l.key), ["auth:stepup:user:user-123", "auth:stepup:ip:198.51.100.30"]);
    for (const l of limits) assert.ok(!l.key.includes("@"));
    assert.ok(!limits.some((l) => l.key.startsWith("auth:pw:")));
  });

  it("refuse the 6th code attempt for one user in 15 minutes, even from new IPs", () => {
    const user = `u-${freshIp()}`;
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const [perUser, perIp] = stepUpRateLimits(freshIp(), user);
      results.push(
        checkMemoryRateLimit(perUser.key, perUser.config).allowed &&
          checkMemoryRateLimit(perIp.key, perIp.config).allowed
      );
    }
    assert.deepEqual(results, [true, true, true, true, true, false]);
  });

  it("are untouched when someone burns the password counter for that person's email", () => {
    const ip = freshIp();
    const email = `target-${ip}@example.org`;
    for (let i = 0; i < 12; i++) attempt(PASSWORD_PATH, freshIp(), email); // attacker exhausts per-email
    assert.equal(attempt(PASSWORD_PATH, freshIp(), email), false);
    const [perUser, perIp] = stepUpRateLimits(ip, `owner-of-${email}`);
    assert.equal(checkMemoryRateLimit(perUser.key, perUser.config).allowed, true);
    assert.equal(checkMemoryRateLimit(perIp.key, perIp.config).allowed, true);
  });
});
