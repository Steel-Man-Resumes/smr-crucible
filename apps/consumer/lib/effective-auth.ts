/**
 * effectiveAuth() -- auth() with developer impersonation resolved.
 *
 * When the real session belongs to a platform admin AND a valid impersonation
 * cookie is present (minted by /api/dev/impersonate), the returned session is
 * shaped as the TARGET user, so every route that reads "the current user"
 * serves the target's data. Anyone who is not the admin named in the token
 * gets their own session untouched -- a stolen/stale cookie does nothing.
 *
 * Read-only enforcement for "view" mode happens in middleware (writes to
 * /api/* are rejected at the edge before any route runs).
 *
 * PRIVILEGE IS RE-VERIFIED ON EVERY USE, NOT JUST AT ISSUE (fixed 2026-09-19).
 * This used to read `tier` off the session token. The token is minted at
 * sign-in and carries whatever was true then, so revoking someone's admin
 * access did NOT end an impersonation session they already held -- they kept
 * reading another person's data until the cookie expired, up to an hour later.
 * Issuing the cookie was already checked against the database; consuming it was
 * not, and consuming it is the part that reads somebody's file.
 *
 * It also fails CLOSED. If the privilege check cannot run, impersonation does
 * not happen and the admin sees their own account. A verification outage must
 * degrade toward less access, never toward more.
 */

import { auth } from "@/auth";
import { readImpersonation } from "./impersonation";

export async function effectiveAuth(): Promise<any> {
  const real = await auth();
  if (!real?.user?.id) return real;

  const imp = await readImpersonation();
  if (!imp || imp.adminId !== real.user.id) return real;

  try {
    const { getOne, getUserTier } = await import("@crucible/core");

    // Only admins can impersonate, ever -- checked against the database, for
    // the REAL user, on every single request that carries the cookie.
    const liveTier = await getUserTier(real.user.id);
    if (liveTier !== "admin") return real;

    const target = await getOne<{
      id: string;
      name: string | null;
      email: string | null;
      tier: string;
    }>(`SELECT id, name, email, tier FROM users WHERE id = $1`, [imp.targetId]);
    if (!target) return real;

    return {
      ...real,
      user: {
        ...real.user,
        id: target.id,
        name: target.name,
        email: target.email,
        tier: target.tier,
      },
      impersonation: {
        sid: imp.sid,
        mode: imp.mode,
        adminId: imp.adminId,
      },
    };
  } catch {
    return real;
  }
}
