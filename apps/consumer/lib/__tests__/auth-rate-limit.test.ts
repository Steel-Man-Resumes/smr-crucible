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
  signInRateLimits,
} from "../auth-rate-limit";

const PASSWORD_PATH = "/api/auth/callback/password-login";
const MAGIC_LINK_PATH = "/api/auth/signin/resend";

const realNow = Date.now;
let clock = 0;

/** What the route does for one sign-in POST: IP check, then email check. */
function attempt(pathname: string, ip: string, email: string): boolean {
  const limits = signInRateLimits(pathname, ip, email);
  if (!checkAuthRateLimit(limits.ip.key, limits.ip.config).allowed) return false;
  return checkAuthRateLimit(limits.email.key, limits.email.config).allowed;
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

  it("allows the 10th and refuses the 11th from one IP within 15 minutes", () => {
    const ip = freshIp();
    const results: boolean[] = [];
    for (let i = 0; i < 11; i++) {
      clock += 60_000; // one a minute: all 11 inside 15 minutes
      results.push(attempt(PASSWORD_PATH, ip, `person${i}-${ip}@example.org`));
    }
    assert.deepEqual(results, [...Array(10).fill(true), false]);
  });

  it("lets the same IP back in once the 15-minute window has passed", () => {
    const ip = freshIp();
    for (let i = 0; i < 11; i++) attempt(PASSWORD_PATH, ip, `p${i}-${ip}@example.org`);
    clock += AUTH_LIMITS.passwordPerIp.windowMs + 1;
    assert.equal(attempt(PASSWORD_PATH, ip, `again-${ip}@example.org`), true);
  });

  it("refuses the 11th guess at one account even when every guess comes from a new IP", () => {
    const email = `target-${freshIp()}@example.org`;
    const results: boolean[] = [];
    for (let i = 0; i < 11; i++) results.push(attempt(PASSWORD_PATH, freshIp(), email));
    assert.deepEqual(results, [...Array(10).fill(true), false]);
  });
});

describe("magic-link requests are unchanged", () => {
  it("still uses the original keys and the original hourly limits", () => {
    const limits = signInRateLimits(MAGIC_LINK_PATH, "198.51.100.7", "a@example.org");
    assert.equal(limits.ip.key, "auth:ip:198.51.100.7");
    assert.equal(limits.email.key, "auth:email:a@example.org");
    assert.deepEqual(limits.ip.config, { maxRequests: 5, windowMs: 3_600_000 });
    assert.deepEqual(limits.email.config, { maxRequests: 3, windowMs: 3_600_000 });
  });

  it("refuses the 6th request from one IP within the hour", () => {
    const ip = freshIp();
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      clock += 60_000;
      results.push(attempt(MAGIC_LINK_PATH, ip, `link${i}-${ip}@example.org`));
    }
    assert.deepEqual(results, [...Array(5).fill(true), false]);
  });

  it("refuses the 4th request for one email within the hour", () => {
    const email = `inbox-${freshIp()}@example.org`;
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) results.push(attempt(MAGIC_LINK_PATH, freshIp(), email));
    assert.deepEqual(results, [true, true, true, false]);
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

    // Exhaust the magic-link allowance for this email (3) from this IP.
    for (let i = 0; i < 3; i++) assert.equal(attempt(MAGIC_LINK_PATH, ip, email), true);
    assert.equal(attempt(MAGIC_LINK_PATH, ip, email), false);

    // Password sign-in for the same person from the same IP is untouched.
    for (let i = 0; i < 10; i++) assert.equal(attempt(PASSWORD_PATH, ip, email), true);
    assert.equal(attempt(PASSWORD_PATH, ip, email), false);

    // And spending the password allowance did not add to the magic-link count:
    // a different email from this IP still has a magic-link request left (4 of 5 used).
    assert.equal(attempt(MAGIC_LINK_PATH, ip, `other-${ip}@example.org`), true);
  });
});
