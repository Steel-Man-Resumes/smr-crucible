import { NextRequest, NextResponse } from "next/server";
import { handlers } from "@/auth";
import {
  checkAuthRateLimit,
  getClientIp,
  isValidEmail,
  AUTH_LIMITS,
} from "@/lib/auth-rate-limit";

export const { GET } = handlers;

/**
 * Wrap NextAuth POST handler with rate limiting and email validation.
 * Magic link requests burn a Resend send per attempt -- bots were
 * hammering this endpoint with garbage addresses (Mar 2026).
 */
export async function POST(request: NextRequest) {
  if (
    process.env.NODE_ENV === "development" &&
    request.nextUrl.pathname.includes("/dev-login")
  ) {
    return handlers.POST!(request);
  }

  const ip = getClientIp(request);

  // Clone the request so we can read the body without consuming it
  const cloned = request.clone();

  try {
    const body = await cloned.text();
    const params = new URLSearchParams(body);
    const email = params.get("email")?.toLowerCase().trim();
    const csrfToken = params.get("csrfToken");

    // Only rate-limit sign-in actions (not signout, callback, etc.)
    // Magic link and password sign-in both POST with an email field
    if (email) {
      // Email format validation -- reject garbage before burning a send
      if (!isValidEmail(email)) {
        return NextResponse.json(
          { error: "Please enter a valid email address." },
          { status: 400 }
        );
      }

      // Rate limit by IP
      const ipCheck = checkAuthRateLimit(
        `auth:ip:${ip}`,
        AUTH_LIMITS.magicLinkPerIp
      );
      if (!ipCheck.allowed) {
        return NextResponse.json(
          { error: "Too many sign-in attempts. Please try again later." },
          {
            status: 429,
            headers: {
              "Retry-After": Math.ceil(ipCheck.resetIn / 1000).toString(),
            },
          }
        );
      }

      // Rate limit by email (prevents spamming a single address)
      const emailCheck = checkAuthRateLimit(
        `auth:email:${email}`,
        AUTH_LIMITS.magicLinkPerEmail
      );
      if (!emailCheck.allowed) {
        return NextResponse.json(
          { error: "Too many sign-in attempts for this email. Please try again later." },
          {
            status: 429,
            headers: {
              "Retry-After": Math.ceil(emailCheck.resetIn / 1000).toString(),
            },
          }
        );
      }
    }
  } catch {
    // If body parsing fails, let NextAuth handle it (might be a callback)
  }

  return handlers.POST!(request);
}
