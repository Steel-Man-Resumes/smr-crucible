/**
 * Mini Forge import-complete.
 * Reached after successful sign-in following a mini-forge import.
 *
 * Reads the mf_session cookie (set by /mini-forge/import before auth),
 * copies forge_output from tablet_session → consumer_profile via saveForgeSession,
 * clears the cookie, redirects to /dashboard?welcome=mini-forge.
 *
 * A Route Handler, not a page (fix 2026-10-02). This step has to delete the
 * mf_session cookie, and Next.js only lets a Server Action or a Route Handler
 * change cookies. The old page.tsx called cookies().delete() during render,
 * which throws in a Server Component. Clearing the cookie on the redirect
 * response works the same on Next 14 and Next 15 (no cookies() call at all).
 */

import { NextResponse, type NextRequest } from "next/server";
import { auth, isSessionRevoked } from "@/auth";
import { getTabletSessionForImport, TABLET_COOKIE } from "@/lib/tablet-session";
import { saveForgeSession } from "@crucible/core";
import { sessionPending } from "@/lib/session-policy";
import { nonEmptyList } from "@/lib/mini-forge-import";

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

/**
 * Postgres needs a timestamp it can parse. The Neon driver hands created_at
 * back as a Date, and Date#toString() ("Fri Oct 02 2026 20:46:37 GMT+0000
 * (Coordinated Universal Time)") is rejected with 22007. ISO 8601 is what the
 * other saveForgeSession caller sends (lib/forge-persist.ts passes the
 * client's ISO startedAt). Unparseable -> undefined -> saveForgeSession uses now.
 */
function toIsoTimestamp(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
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

  const intake = (tabletSession.forge_intake ?? {}) as Record<string, unknown>;
  const output = tabletSession.forge_output as Record<string, unknown>;

  // Seed the Refinery profile with Mini Forge data.
  // Uses the same saveForgeSession contract as the full Forge.
  // If this throws, the cookie is left in place so a reload can retry.
  await saveForgeSession(session.user.id, `mini-forge-${tabletSession.id}`, {
    readinessStage: intake.readiness_stage as string | undefined,
    goals: nonEmptyList(intake.goals),
    challenges: nonEmptyList(intake.challenges),
    preferences: intake.work_type
      ? { work_type: intake.work_type as string }
      : undefined,
    forgeOutput: output,
    pagesVisited: ["mini-forge-intake"],
    startedAt: toIsoTimestamp(tabletSession.created_at),
  });

  // Clear the mini-forge cookie now that import is done.
  return go(request, "/dashboard?welcome=mini-forge", true);
}
