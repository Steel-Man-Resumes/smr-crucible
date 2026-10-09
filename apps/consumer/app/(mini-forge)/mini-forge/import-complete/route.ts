/**
 * Mini Forge import-complete.
 * Reached after sign-in following a mini-forge import.
 *
 * It NEVER saves anything (shared-computer review, Mini Forge path 5). The
 * mf_session cookie follows the BROWSER: if one person entered a code and PIN
 * and walked away, the next person to sign in from that tab would have had the
 * first person's plan saved into their account. So a signed-in person is sent
 * to /mini-forge/import-confirm, which asks for the tablet PIN again and names
 * the account. Only the person who made the PIN can say yes.
 *
 * A Route Handler, not a page: it may clear the cookie on a redirect.
 */

import { NextResponse, type NextRequest } from "next/server";
import { auth, isSessionRevoked } from "@/auth";
import { getTabletSessionForImport, TABLET_COOKIE } from "@/lib/tablet-session";
import { sessionPending } from "@/lib/session-policy";

// Reads the session and a cookie, writes to the DB: never static, never cached.
export const dynamic = "force-dynamic";

function go(request: NextRequest, path: string, clearCookie: boolean) {
  const res = NextResponse.redirect(new URL(path, request.url));
  if (clearCookie) {
    // Same attributes the import page set it with, so the browser replaces it.
    res.cookies.set(TABLET_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
  }
  return res;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return go(
      request,
      "/login?from=mini-forge&callbackUrl=" +
        encodeURIComponent("/mini-forge/import-complete"),
      false
    );
  }

  // This route is outside the middleware matcher, so it makes the same
  // revocation check itself: a session signed out from the device list does
  // not get to write here. The cookie is kept for after a fresh sign-in.
  const u = session.user as any;
  if (u.sid && (await isSessionRevoked(u.sid, u.id, u.sit))) {
    return go(
      request,
      "/login?from=mini-forge&callbackUrl=" + encodeURIComponent("/mini-forge/import-complete"),
      false
    );
  }

  // A session that still owes its two-step code or the first-proof choice
  // (F1/F3) must finish that before anything is written to the account. The
  // cookie is kept, so the import runs when they come back here.
  if (sessionPending(session.user as any)) {
    return go(
      request,
      "/login/verify?callbackUrl=" + encodeURIComponent("/mini-forge/import-complete"),
      false
    );
  }

  const tabletSessionId = request.cookies.get(TABLET_COOKIE)?.value;

  if (!tabletSessionId) {
    // No cookie -- user may have already completed the import or came here directly.
    return go(request, "/dashboard", false);
  }

  const tabletSession = await getTabletSessionForImport(tabletSessionId);

  if (!tabletSession || !tabletSession.forge_output) {
    // Session expired, not found, or AI never finished -- skip seeding.
    return go(request, "/dashboard", true);
  }

  // The person confirms with the tablet PIN before anything is saved.
  return go(request, "/mini-forge/import-confirm", false);
}
