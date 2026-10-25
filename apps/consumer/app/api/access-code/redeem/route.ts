import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { settingsRefusal } from "@/lib/settings-guard";
import { redeemAccessCode } from "@crucible/core";
import { checkAuthRateLimits, getClientIp } from "@/lib/auth-rate-limit";
import { CODE_REFUSAL, CODE_SHAPE, codeAttemptLimits } from "@/lib/access-code-guard";
import { isSameOriginJsonPost } from "@/lib/same-origin";

/**
 * Join an organization with its code. A code is a seat key, so tries are
 * limited per account and per connection, and every refusal is the same
 * message (lib/access-code-guard.ts): this route never says whether a code
 * exists, is full, expired or closed.
 */
export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) {
    return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  }
  const session = await auth();
  { const refused = settingsRefusal(session, "consent", "write"); if (refused) return refused; }
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limit = await checkAuthRateLimits(codeAttemptLimits(getClientIp(request), userId));
  if (!limit.allowed) {
    return NextResponse.json({ error: CODE_REFUSAL }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  // Only the shape the mint route makes. Anything else (the hub codes contain
  // "-") gets the same answer as a wrong code, and never reaches the database.
  if (!CODE_SHAPE.test(code)) {
    return NextResponse.json({ error: CODE_REFUSAL }, { status: 400 });
  }

  const result = await redeemAccessCode(userId, code);

  if (!result.success) {
    return NextResponse.json({ error: CODE_REFUSAL }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
