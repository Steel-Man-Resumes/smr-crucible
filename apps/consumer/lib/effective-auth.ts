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
 */

import { auth } from "@/auth";
import { readImpersonation } from "./impersonation";

export async function effectiveAuth(): Promise<any> {
  const real = await auth();
  if (!real?.user?.id) return real;

  const imp = await readImpersonation();
  if (!imp || imp.adminId !== real.user.id) return real;

  // Only admins can impersonate, ever.
  if ((real.user as any).tier !== "admin") return real;

  try {
    const { getOne } = await import("@crucible/core");
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
