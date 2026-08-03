/**
 * Developer impersonation core (server-only).
 *
 * A signed short-lived JWT cookie carries { sid, adminId, targetId, mode }.
 * - mode "view":  read-only. Writes are rejected at the middleware edge.
 * - mode "assist": full act-as; requires a break-glass reason; 30-minute cap.
 * Every session is audited in impersonation_session (migration 024).
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const IMPERSONATE_COOKIE = "smr_impersonate";

export interface ImpersonationClaims {
  sid: string;
  adminId: string;
  targetId: string;
  mode: "view" | "assist";
}

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET not set");
  return new TextEncoder().encode(s);
}

export const IMPERSONATION_MINUTES: Record<"view" | "assist", number> = {
  view: 60,
  assist: 30,
};

export async function mintImpersonationToken(
  claims: ImpersonationClaims
): Promise<string> {
  const minutes = IMPERSONATION_MINUTES[claims.mode];
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${minutes}m`)
    .sign(secret());
}

export async function verifyImpersonationToken(
  token: string
): Promise<(ImpersonationClaims & { exp?: number }) | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (
      typeof payload.sid === "string" &&
      typeof payload.adminId === "string" &&
      typeof payload.targetId === "string" &&
      (payload.mode === "view" || payload.mode === "assist")
    ) {
      return {
        sid: payload.sid,
        adminId: payload.adminId,
        targetId: payload.targetId,
        mode: payload.mode,
        exp: payload.exp,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Read + verify the impersonation cookie in a server context. */
export async function readImpersonation(): Promise<
  (ImpersonationClaims & { exp?: number }) | null
> {
  const store = await cookies();
  const token = store.get(IMPERSONATE_COOKIE)?.value;
  if (!token) return null;
  return verifyImpersonationToken(token);
}
