import { NextRequest, NextResponse } from "next/server";
import { handlers } from "@/auth";
import {
  checkAuthRateLimit,
  getClientIp,
  isValidEmail,
  signInEmailFromBody,
  signInPostRequiresEmail,
  signInRateLimits,
} from "@/lib/auth-rate-limit";

export const { GET } = handlers;

const INVALID_EMAIL = () =>
  NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });

/**
 * Wrap NextAuth POST handler with rate limiting and email validation.
 * Magic link requests burn a Resend send per attempt -- bots were
 * hammering this endpoint with garbage addresses (Mar 2026).
 *
 * The email is read from the body exactly the way Auth.js will read it (see
 * signInEmailFromBody). A JSON body, or a form with the email field repeated,
 * used to slip past every limit here while Auth.js still acted on it.
 */
export async function POST(request: NextRequest) {
  if (
    process.env.NODE_ENV === "development" &&
    request.nextUrl.pathname.includes("/dev-login")
  ) {
    return handlers.POST!(request);
  }

  const pathname = request.nextUrl.pathname;
  const ip = getClientIp(request);

  // Clone the request so we can read the body without consuming it
  let body = "";
  try {
    body = await request.clone().text();
  } catch {
    body = "";
  }
  const parsed = signInEmailFromBody(request.headers.get("content-type"), body);

  if (parsed.kind === "invalid") return INVALID_EMAIL();

  if (parsed.kind === "none") {
    // The password callback and the magic-link request always carry an email.
    // Without one there is nothing to limit against, so refuse instead of
    // letting the request through unthrottled.
    if (signInPostRequiresEmail(pathname)) return INVALID_EMAIL();
    // Everything else (signout, session update, an OAuth start) has no email.
    return handlers.POST!(request);
  }

  const email = parsed.email;

  // Email format validation -- reject garbage before burning a send
  if (!isValidEmail(email)) return INVALID_EMAIL();

  // Magic link and password sign-in are limited separately: a magic link burns
  // an email send (strict hourly limits), a password sign-in does not
  // (brute-force limits).
  const limits = signInRateLimits(pathname, ip, email);

  // Rate limit by IP
  const ipCheck = await checkAuthRateLimit(limits.ip.key, limits.ip.config);
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
  const emailCheck = await checkAuthRateLimit(limits.email.key, limits.email.config);
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

  return handlers.POST!(request);
}
