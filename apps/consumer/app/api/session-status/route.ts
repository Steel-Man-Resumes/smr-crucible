/**
 * Session Status — lightweight endpoint for cross-domain auth detection.
 * The marketing site (steelmanresumes.com) calls this to check if the user
 * is logged in on the Refinery (refinery.steelmanresumes.com).
 *
 * Returns { authenticated: boolean, name?: string } with CORS headers
 * for steelmanresumes.com. No sensitive data exposed.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";

const ALLOWED_ORIGINS = [
  "https://www.steelmanresumes.com",
  "https://steelmanresumes.com",
];

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "600",
  };

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    const session = await auth();

    if (session?.user) {
      return NextResponse.json(
        { authenticated: true, name: session.user.name || null },
        { headers }
      );
    }

    return NextResponse.json({ authenticated: false }, { headers });
  } catch {
    return NextResponse.json({ authenticated: false }, { headers });
  }
}
