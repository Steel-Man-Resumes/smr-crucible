/**
 * Server-side session registry (F5). Writes the user_session row at sign-in,
 * sends the new-device email from the same place, and revokes a user's other
 * sessions after a credential change.
 *
 * Runs in Node route handlers and inside the Auth.js sign-in callbacks (which
 * run in the /api/auth/[...nextauth] route, Node runtime). auth.ts imports it
 * dynamically, only on the sign-in path, so the Edge middleware never runs it.
 * Its imports are fetch-only and Edge-safe regardless.
 */
import { after } from "next/server";
import { deviceLabel, buildNewDeviceEmail, sendSecurityEmail } from "@/lib/security-email";
import { SESSIONS_REVOKED_EVENT } from "@/lib/session-policy";

/** The slice of a pg Pool / PoolClient this module needs. */
export interface Db {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
}

export interface RequestContext {
  userAgent: string | null;
  ip: string | null;
  location: string | null;
  origin: string | null;
}

const EMPTY_CONTEXT: RequestContext = { userAgent: null, ip: null, location: null, origin: null };

/** Device and place of a request, read from its headers. */
export function contextFromHeaders(h: { get(name: string): string | null }): RequestContext {
  const userAgent = h.get("user-agent") || null;
  const realIp = h.get("x-real-ip")?.trim();
  const forwarded = h.get("x-forwarded-for")?.split(",").pop()?.trim();
  const ip = realIp || forwarded || null;
  const city = h.get("x-vercel-ip-city");
  const country = h.get("x-vercel-ip-country");
  let cityText = city;
  try {
    // Vercel URL-encodes the city ("San%20Francisco").
    if (city) cityText = decodeURIComponent(city);
  } catch {
    cityText = city;
  }
  const location = [cityText, country].filter(Boolean).join(", ") || null;
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || "https";
  const origin = host ? `${proto}://${host}` : null;
  return { userAgent, ip, location, origin };
}

/**
 * Headers of the request being handled. Inside the Auth.js callbacks there is
 * no Request object, but they run inside the route handler's request scope, so
 * next/headers can read it. Outside a request scope this returns empty values.
 */
export async function currentRequestContext(): Promise<RequestContext> {
  try {
    const { headers } = await import("next/headers");
    return contextFromHeaders(await headers());
  } catch {
    return EMPTY_CONTEXT;
  }
}

/**
 * Run work after the response is sent (Next 15 `after`), so a slow email
 * provider never delays a sign-in or leaks timing. Outside a request scope
 * (tests, scripts) the work runs inline instead.
 */
export function runAfterResponse(task: () => Promise<unknown>): void {
  const guarded = () =>
    task().catch((err: any) => console.error("[auth] background task failed:", err?.message || err));
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

/**
 * Register a session at sign-in. Must succeed: a token is only issued once its
 * row exists, which is what lets the middleware treat a missing row as revoked.
 */
export async function registerSession(
  db: Db,
  input: { sid: string; userId: string; ctx: RequestContext }
): Promise<void> {
  await db.query(
    `INSERT INTO user_session (jti, user_id, user_agent, ip, approx_location, created_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, now(), now())
     ON CONFLICT (jti) DO NOTHING`,
    [input.sid, input.userId, input.ctx.userAgent, input.ctx.ip, input.ctx.location]
  );
}

/**
 * New-device sign-in alert. Fingerprints the device by its User-Agent. The
 * first time a device is seen for a user it is recorded; if the user already
 * had a DIFFERENT device on record, they get an email. Same rule the old
 * client-triggered /api/auth/signin-alert used, now run at sign-in itself so a
 * session that never loads the dashboard still triggers it.
 */
export async function alertIfNewDevice(
  db: Db,
  input: { userId: string; email: string | null; name: string | null; ctx: RequestContext }
): Promise<{ alerted: boolean }> {
  const ua = input.ctx.userAgent;
  if (!ua) return { alerted: false }; // can't fingerprint

  const seen = await db.query(
    `SELECT 1 FROM user_login_event
      WHERE user_id = $1 AND event = 'sign_in' AND user_agent = $2 LIMIT 1`,
    [input.userId, ua]
  );
  if ((seen.rowCount ?? 0) > 0) return { alerted: false };

  const others = await db.query(
    `SELECT COUNT(*)::int AS n FROM user_login_event
      WHERE user_id = $1 AND event = 'sign_in'`,
    [input.userId]
  );
  const hadOthers = (others.rows[0]?.n ?? 0) > 0;

  await db.query(
    `INSERT INTO user_login_event (user_id, event, ip, user_agent, approx_location)
     VALUES ($1, 'sign_in', $2, $3, $4)`,
    [input.userId, input.ctx.ip, ua, input.ctx.location]
  );

  if (!hadOthers || !input.email) return { alerted: false };
  await sendSecurityEmail(
    input.email,
    buildNewDeviceEmail({
      name: input.name,
      device: deviceLabel(ua),
      location: input.ctx.location,
      whenISO: new Date().toISOString(),
      origin: input.ctx.origin || "https://refinery.steelmanresumes.com",
    })
  );
  return { alerted: true };
}

/**
 * Everything a sign-in records: the session row (awaited, must succeed), then
 * the device fingerprint and new-device email after the response.
 */
export async function recordSignIn(
  db: Db,
  input: { sid: string; userId: string; email: string | null; name: string | null }
): Promise<void> {
  const ctx = await currentRequestContext();
  await registerSession(db, { sid: input.sid, userId: input.userId, ctx });
  runAfterResponse(() =>
    alertIfNewDevice(db, { userId: input.userId, email: input.email, name: input.name, ctx })
  );
}

/**
 * Revoke every session of a user except `keepSid` (the caller's own, when
 * there is one). Used after a password reset, a password set or change, and
 * turning two-step verification on or off.
 *
 * The kept session is upserted first, so an older session that never
 * registered a row survives its own sweep. The `sessions_revoked` event is
 * what ends older tokens that have no row at all (see revocationVerdict), so
 * it is written in the same call, not best-effort.
 */
export async function revokeUserSessions(
  db: Db,
  input: { userId: string; keepSid?: string | null; userAgent?: string | null }
): Promise<number> {
  const keep = input.keepSid || null;
  if (keep) {
    await db.query(
      `INSERT INTO user_session (jti, user_id, created_at, last_seen_at)
       VALUES ($1, $2, now(), now())
       ON CONFLICT (jti) DO NOTHING`,
      [keep, input.userId]
    );
  }
  const res = await db.query(
    `UPDATE user_session SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR jti <> $2::text)`,
    [input.userId, keep]
  );
  await db.query(
    `INSERT INTO user_login_event (user_id, event, user_agent) VALUES ($1, $2, $3)`,
    [input.userId, SESSIONS_REVOKED_EVENT, input.userAgent ?? null]
  );
  return res.rowCount ?? 0;
}
