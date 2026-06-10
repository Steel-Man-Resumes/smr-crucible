/**
 * Rate limit wrapper for API route handlers.
 * Two modes: "user" (authenticated, per-user) and "ip" (Forge, per-IP).
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
  FORGE_IP_LIMITS,
} from "@crucible/core";
import type { UserTier } from "@crucible/core";

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
  mode: "user" | "ip";
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
