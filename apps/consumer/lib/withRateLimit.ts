/**
 * Rate limit wrapper for API route handlers.
 * Two modes: "user" (authenticated, per-user) and "ip" (Forge, per-IP).
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  checkUserRateLimit,
  checkIpRateLimit,
  incrementUserUsage,
  incrementIpUsage,
} from "@crucible/core";

interface RateLimitOptions {
  mode: "user" | "ip";
  endpoint: string;
}

const RATE_LIMIT_MESSAGE =
  "You've used all your free AI calls for today. Come back tomorrow, or enter a partner code in Settings for more.";

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

      const result = await checkUserRateLimit(userId, opts.endpoint);

      if (!result.allowed) {
        return NextResponse.json(
          { error: RATE_LIMIT_MESSAGE },
          { status: 429 }
        );
      }

      await incrementUserUsage(userId, opts.endpoint);
      return handler(request);
    }

    // IP mode
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || "unknown";

    const result = await checkIpRateLimit(ip, opts.endpoint);

    if (!result.allowed) {
      return NextResponse.json(
        { error: RATE_LIMIT_MESSAGE },
        { status: 429 }
      );
    }

    await incrementIpUsage(ip, opts.endpoint);
    return handler(request);
  };
}
