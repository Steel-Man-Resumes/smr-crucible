/**
 * Rate limit wrapper for API route handlers.
 * Three modes: "user" (authenticated, per-user), "ip" (per-IP), and "forge"
 * (the Forge's routes: per-account when signed in with per-IP as the floor,
 * per-IP when signed out; see lib/forge-rate-limit.ts).
 *
 * Security features:
 * - Atomic increment-then-check (no TOCTOU race condition)
 * - Optional tier gating via requiredTier
 * - Trusted IP extraction (x-real-ip on Vercel, last x-forwarded-for as fallback)
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getUserDailyLimit,
  getUserTier,
  incrementUserUsage,
  incrementIpUsage,
  validateAccessCode,
  logPartnerUsage,
  ensureUserAttribution,
  FORGE_IP_LIMITS,
} from "@crucible/core";
import type { UserTier } from "@crucible/core";
import { forgeApiNeedsSession, forgeUserId } from "./session-policy";
import { FORGE_SIGN_IN_REQUIRED_MESSAGE, forgeWallState } from "./forge-access";
import { overLimit, planForgeLimit } from "./forge-rate-limit";
import {
  LIVE_TEST_BUCKET,
  LIVE_TEST_DAILY_LIMIT,
  LIVE_TEST_HEADER,
  liveTestKeyAllowed,
} from "./live-test-key";

/**
 * Tier ranking — lower number = higher privilege.
 * "client" and "default" are equivalent (rank 3).
 */
const TIER_RANK: Record<string, number> = {
  admin: 0,
  unlimited: 1,
  partner: 2,
  client: 3,
  default: 3,
  observer: 4,
};

interface RateLimitOptions {
  mode: "user" | "ip" | "forge";
  endpoint: string;
  /** Minimum tier required to access this endpoint. */
  requiredTier?: UserTier;
}

const RATE_LIMIT_MESSAGE =
  "You've used all your free AI calls for today. Come back tomorrow, or enter a partner code in Settings for more.";

/**
 * Extract the client IP from request headers.
 * On Vercel, x-real-ip is set by the edge and cannot be spoofed by the client.
 * Falls back to the LAST value in x-forwarded-for (closest proxy, harder to spoof).
 */
function getClientIp(request: Request): string {
  // Vercel sets x-real-ip at the edge — most trustworthy
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  // Fallback: last entry in x-forwarded-for (closest proxy to server)
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    const last = parts[parts.length - 1]?.trim();
    if (last) return last;
  }

  return "unknown";
}

export function withRateLimit(
  handler: (request: Request) => Promise<Response>,
  opts: RateLimitOptions
) {
  return async function rateLimitedHandler(request: Request): Promise<Response> {
    if (opts.mode === "user") {
      const session = await auth();
      const userId = session?.user?.id;

      if (!userId) {
        return NextResponse.json(
          { error: "Please sign in to use this feature." },
          { status: 401 }
        );
      }

      // Tier gate: check if user has sufficient privileges
      if (opts.requiredTier) {
        const userTier = await getUserTier(userId);
        const userRank = TIER_RANK[userTier] ?? 4;
        const requiredRank = TIER_RANK[opts.requiredTier] ?? 4;

        if (userRank > requiredRank) {
          return NextResponse.json(
            { error: "This tool requires a higher access tier. Enter a partner code in Settings to upgrade." },
            { status: 403 }
          );
        }
      }

      // Atomic: increment first, then check if over limit
      const limit = await getUserDailyLimit(userId);
      const newCount = await incrementUserUsage(userId, opts.endpoint);

      // limit 0 means unlimited (admin/unlimited tier)
      if (limit !== 0 && newCount > limit) {
        return NextResponse.json(
          { error: RATE_LIMIT_MESSAGE },
          { status: 429 }
        );
      }

      // Partner tracking (fire-and-forget, never blocks the response): a signed-in
      // user carrying an org's code gets bound to that org on first tool use
      // (first code wins) and the call is logged to the funder/compliance ledger.
      const authedCode = getAccessCodeCookie(request);
      if (authedCode) {
        void ensureUserAttribution(userId, authedCode).catch(() => {});
        void logPartnerUsage({ code: authedCode, userId, endpoint: opts.endpoint });
      }

      return handler(request);
    }

    // The Forge, signed in: count per account, with per-IP as the floor.
    if (opts.mode === "forge") {
      const path = new URL(request.url).pathname;
      const userId = forgeUserId(await auth().catch(() => null)) ?? null;
      const perPerson = FORGE_IP_LIMITS[opts.endpoint] ?? 10;
      const plan = planForgeLimit({
        userId,
        needsSession: forgeApiNeedsSession(path, forgeWallState() === "up"),
        perPerson,
        tierLimit: userId ? await getUserDailyLimit(userId) : perPerson,
      });
      if (plan.kind === "refuse") {
        return NextResponse.json(
          { error: FORGE_SIGN_IN_REQUIRED_MESSAGE, signInRequired: true },
          { status: 401 }
        );
      }
      if (plan.kind === "account") {
        // The floor first: it is the one a farm of accounts on one machine hits.
        // Its own counter, so signed-in use never spends the signed-out
        // allowance of the same network (the free checker, for one).
        const ipCount = await incrementIpUsage(getClientIp(request), `signed-in:${opts.endpoint}`);
        if (overLimit(ipCount, plan.ipCeiling)) {
          return NextResponse.json(
            {
              error:
                "This network has used today's limit for this tool. Try again tomorrow, or from another connection.",
            },
            { status: 429 }
          );
        }
        const count = await incrementUserUsage(plan.userId, opts.endpoint);
        if (overLimit(count, plan.perAccount)) {
          return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
        }
        const authedCode = getAccessCodeCookie(request);
        if (authedCode) {
          void ensureUserAttribution(plan.userId, authedCode).catch(() => {});
          void logPartnerUsage({ code: authedCode, userId: plan.userId, endpoint: opts.endpoint });
        }
        return handler(request);
      }
      // Signed out on an open route: the per-IP rules below, unchanged.
    }

    // Live test calls from the team draw from their own bounded bucket, never
    // from a job seeker's IP allowance. See lib/live-test-key.ts.
    if (liveTestKeyAllowed(request.headers.get(LIVE_TEST_HEADER), process.env.FORGE_TEST_KEY)) {
      const testCount = await incrementIpUsage(LIVE_TEST_BUCKET, opts.endpoint);
      if (testCount > LIVE_TEST_DAILY_LIMIT) {
        return NextResponse.json(
          { error: "Live test limit reached for today on this endpoint." },
          { status: 429 }
        );
      }
      console.info(`[live-test] ${opts.endpoint} call ${testCount}/${LIVE_TEST_DAILY_LIMIT}`);
      return handler(request);
    }

    // IP mode -- with cohort-code awareness (seats v1, 2026-06-10).
    //
    // Classrooms, program labs, and libraries share ONE NAT IP, so the per-IP
    // bucket 429'd the 6th person mid-Forge. A session that entered via
    // /access?code=X carries the code in a cookie; a VALID code switches the
    // bucket to a per-code pool sized by its seats. The code is org-shared by
    // design, so the pool is shared and bounded -- a leaked code grants a
    // bounded pool, never unlimited calls.
    const code = getAccessCodeCookie(request);
    if (code) {
      try {
        const v = await validateAccessCode(code);
        if (v.valid && v.accessCode) {
          const baseLimit = FORGE_IP_LIMITS[opts.endpoint] ?? 10;
          // Pool = per-person limit x seats (default 10 seats, capped at 50).
          const seats = Math.min(Math.max(v.accessCode.max_redemptions ?? 10, 1), 50);
          const codeLimit = baseLimit * seats;
          const codeCount = await incrementIpUsage(`code:${v.accessCode.code}`, opts.endpoint);
          if (codeCount > codeLimit) {
            return NextResponse.json(
              {
                error:
                  "Your organization's group has used today's shared AI calls for this tool. Try again tomorrow, or ask your coordinator to raise the code's limit.",
              },
              { status: 429 }
            );
          }
          // Anonymous front-door Forge use, attributed to the org from day one.
          void logPartnerUsage({ code: v.accessCode.code, endpoint: opts.endpoint });
          return handler(request);
        }
      } catch {
        // Validation hiccup -> fall through to the normal IP bucket. Never let
        // the code path make rate limiting fail open OR closed unexpectedly.
      }
    }

    const ip = getClientIp(request);
    const limit = FORGE_IP_LIMITS[opts.endpoint] ?? 10;

    // Atomic: increment first, then check if over limit
    const newCount = await incrementIpUsage(ip, opts.endpoint);

    if (newCount > limit) {
      return NextResponse.json(
        { error: RATE_LIMIT_MESSAGE },
        { status: 429 }
      );
    }

    return handler(request);
  };
}

/** Read the cohort access code from the request cookie (set by /access).
 *  Strict shape check -- this value reaches a DB query parameterized, but we
 *  still refuse anything that isn't a plausible code. */
function getAccessCodeCookie(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)smr_access_code=([A-Za-z0-9]{4,20})(?:;|$)/);
  return match ? match[1].toUpperCase() : null;
}
