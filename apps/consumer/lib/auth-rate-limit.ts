/**
 * Rate limiter for the auth endpoints (sign-in, magic link, reset, register,
 * the two-step check, and the password re-checks before export/delete).
 * Separate from withRateLimit.ts (daily AI-usage counters).
 *
 * DURABLE (F7, 2026-10-02). Counters live in Postgres (auth_rate_limit,
 * migration 066), shared by every serverless instance. The old in-memory Map
 * reset on every cold start and was not shared between concurrent instances,
 * so an attacker spreading requests across instances got a fresh allowance on
 * each one.
 *
 * Shape: a sliding window approximated from two fixed windows (the current
 * one, plus the previous one weighted by how much of it still overlaps). Each
 * hit is one atomic upsert-increment. Keys are stored only as an HMAC (the raw
 * key holds an email or IP address).
 *
 * On any database error the check falls back to the in-memory limiter for
 * that request: never unlimited, never everyone locked out.
 *
 * Swappable: everything goes through checkAuthRateLimit -> the active
 * RateLimitStore. setAuthRateLimitStore() replaces it (tests use the memory
 * store; an Upstash/Redis store would plug in the same way).
 */
import { createHmac } from "crypto";
import { neon } from "@neondatabase/serverless";
import { serverHashSecret } from "@crucible/core/dist/serverHashSecret";

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Clean stale entries every 60s
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;

  const cutoff = now - 3_600_000; // 1 hour
  store.forEach((entry: RateLimitEntry, key: string) => {
    entry.timestamps = entry.timestamps.filter((t: number) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  });
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

/**
 * One counted attempt, so it can be handed back (refunded) when the attempt
 * turns out to be a success: the password limits count FAILED attempts only.
 * Counting first and refunding on success (instead of checking, then counting
 * failures afterwards) keeps the limit atomic under a burst of parallel tries.
 */
export type RateLimitTicket =
  | { store: "memory"; key: string; at: number }
  | { store: "postgres"; hashedKey: string; windowStart: number };

export interface RateLimitResult {
  allowed: boolean;
  resetIn: number;
  /** Present when this attempt was counted (allowed). */
  ticket?: RateLimitTicket;
}

// Email links (sign-in and reset): 30 per IP per hour, 5 per email per hour.
// Per IP fits a lab or library sending links from one address; per email
// keeps any one inbox from being flooded.
export const AUTH_LIMITS = {
  magicLinkPerIp: { maxRequests: 30, windowMs: 3_600_000 } as RateLimitConfig,
  magicLinkPerEmail: { maxRequests: 5, windowMs: 3_600_000 } as RateLimitConfig,
  // Password sign-ins per IP. A program computer lab, a library or a
  // workforce center puts a whole room behind one address, and these counters
  // are shared by every instance, so this has to fit a room signing in at once.
  // The per-email limit below is the brute-force guard on any one account.
  // FAILED password sign-ins only: a successful sign-in hands its count back.
  passwordPerIp: { maxRequests: 30, windowMs: 900_000 } as RateLimitConfig, // 30 failures/15min
  // The login form's precheck has its OWN per-IP counter, so one sign-in
  // (precheck, then the real sign-in) spends the per-IP password budget once.
  precheckPerIp: { maxRequests: 60, windowMs: 900_000 } as RateLimitConfig, // 60/15min
  // Brute-force ceiling on one account; a real person retyping a password fits well inside it.
  passwordPerEmail: { maxRequests: 10, windowMs: 900_000 } as RateLimitConfig, // 10 failures/15min
  // Registration: deliberately generous per-IP -- a classroom or conference
  // room signs up behind one NAT, and real people must never be choked.
  // 120/hr/IP passes any human burst; sustained bot floods do not look human.
  registerPerIp: { maxRequests: 120, windowMs: 3_600_000 } as RateLimitConfig,
  registerPerEmail: { maxRequests: 6, windowMs: 3_600_000 } as RateLimitConfig,
  // Mini Forge kiosk session creation. A facility tablet room signs many people
  // up behind one NAT IP, so this is deliberately generous -- enough to clear a
  // busy kiosk day, low enough that a bot minting thousands of sessions is cut
  // off. Durable (auth_rate_limit table); the real spend ceiling is the DB-backed
  // rolling-24h cap in mini-forge-budget (assertMiniForgeBudget).
  miniForgeSessionPerIp: { maxRequests: 40, windowMs: 3_600_000 } as RateLimitConfig,
  // Password/code re-checks inside a session (2FA off, export, delete).
  reauthPerUser: { maxRequests: 10, windowMs: 900_000 } as RateLimitConfig, // 10/15min
  reauthPerIp: { maxRequests: 30, windowMs: 900_000 } as RateLimitConfig, // 30/15min
  // Second step after an email link or Google sign-in. Keyed by the signed-in
  // user, which only a session holder can spend: keyed by email, anyone who
  // knows the address could burn it with wrong passwords and lock the person
  // out of every sign-in method. Failures only: a correct code is handed back.
  stepUpPerUser: { maxRequests: 5, windowMs: 900_000 } as RateLimitConfig, // 5/15min
  stepUpPerIp: { maxRequests: 30, windowMs: 900_000 } as RateLimitConfig, // 30/15min
};

/**
 * In-memory sliding window, per instance. The fallback when the database is
 * unreachable, and the store when there is no database (unit tests).
 */
export function checkMemoryRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  cleanup();

  const now = Date.now();
  const windowStart = now - config.windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  if (entry.timestamps.length >= config.maxRequests) {
    const resetIn = entry.timestamps[0] + config.windowMs - now;
    return { allowed: false, resetIn: Math.max(0, resetIn) };
  }

  entry.timestamps.push(now);
  return { allowed: true, resetIn: config.windowMs, ticket: { store: "memory", key, at: now } };
}

/** Hand back one in-memory count (the attempt succeeded). */
export function refundMemoryRateLimit(ticket: { key: string; at: number }): void {
  const entry = store.get(ticket.key);
  if (!entry) return;
  const i = entry.timestamps.lastIndexOf(ticket.at);
  if (i >= 0) entry.timestamps.splice(i, 1);
}

/** Where counters are kept. */
export interface RateLimitStore {
  hit(key: string, config: RateLimitConfig): Promise<RateLimitResult>;
  refund(ticket: RateLimitTicket): Promise<void>;
}

export const memoryRateLimitStore: RateLimitStore = {
  async hit(key, config) {
    return checkMemoryRateLimit(key, config);
  },
  async refund(ticket) {
    if (ticket.store === "memory") refundMemoryRateLimit(ticket);
  },
};

/** Start of the fixed window containing `now`. */
export function windowStartFor(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

/**
 * Sliding-window decision from two fixed-window counts. `cur` already includes
 * this request. The previous window counts for the share of it that still
 * falls inside a full window ending now.
 */
export function slidingWindowDecision(input: {
  prev: number;
  cur: number;
  now: number;
  config: RateLimitConfig;
}): RateLimitResult {
  const { prev, cur, now, config } = input;
  const start = windowStartFor(now, config.windowMs);
  const overlap = 1 - (now - start) / config.windowMs;
  const estimate = prev * overlap + cur;
  if (estimate <= config.maxRequests) return { allowed: true, resetIn: config.windowMs };
  return { allowed: false, resetIn: Math.max(1000, start + config.windowMs - now) };
}

/**
 * The value stored in auth_rate_limit.key: an HMAC of the raw key (which holds
 * an email or IP address) and its window length, never the key itself.
 */
export function hashRateLimitKey(key: string, windowMs: number, secret: string): string {
  return "h1:" + createHmac("sha256", secret).update(`auth_rate_limit|${windowMs}|${key}`).digest("hex").slice(0, 40);
}

let sqlClient: ReturnType<typeof neon> | null = null;
function sql() {
  // no-store: Next patches fetch; a cached counter read would be wrong.
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL!, { fetchOptions: { cache: "no-store" } });
  return sqlClient;
}

/** Postgres-backed store (auth_rate_limit). One round trip per hit. */
export const postgresRateLimitStore: RateLimitStore = {
  async hit(key, config) {
    const now = Date.now();
    const start = windowStartFor(now, config.windowMs);
    const hashed = hashRateLimitKey(key, config.windowMs, serverHashSecret("count sign-in attempts"));
    // The count is capped at max+1: past the limit the exact number no longer
    // matters, and the cap lets a person back in as the window slides instead
    // of punishing every retry made while blocked.
    const rows = (await sql()(
      `WITH cur AS (
         INSERT INTO auth_rate_limit (key, window_start, count)
         VALUES ($1, $2::timestamptz, 1)
         ON CONFLICT (key, window_start)
         DO UPDATE SET count = LEAST(auth_rate_limit.count + 1, $4::int)
         RETURNING count
       )
       SELECT (SELECT count FROM cur) AS cur,
              COALESCE((SELECT count FROM auth_rate_limit
                         WHERE key = $1 AND window_start = $3::timestamptz), 0) AS prev`,
      [
        hashed,
        new Date(start).toISOString(),
        new Date(start - config.windowMs).toISOString(),
        config.maxRequests + 1,
      ]
    )) as any[];
    const row = rows[0] || {};
    const decision = slidingWindowDecision({
      prev: Number(row.prev) || 0,
      cur: Number(row.cur) || 1,
      now,
      config,
    });
    return decision.allowed
      ? { ...decision, ticket: { store: "postgres", hashedKey: hashed, windowStart: start } }
      : decision;
  },
  async refund(ticket) {
    if (ticket.store !== "postgres") return;
    await sql()(
      `UPDATE auth_rate_limit SET count = GREATEST(count - 1, 0)
        WHERE key = $1 AND window_start = $2::timestamptz`,
      [ticket.hashedKey, new Date(ticket.windowStart).toISOString()]
    );
  },
};

let activeStore: RateLimitStore | null = null;

/** Replace the store (tests, or a future Redis store). null restores the default. */
export function setAuthRateLimitStore(next: RateLimitStore | null): void {
  activeStore = next;
}

function defaultStore(): RateLimitStore {
  return process.env.DATABASE_URL ? postgresRateLimitStore : memoryRateLimitStore;
}

/**
 * Count one attempt against `key` and say whether it is allowed. Durable when
 * a database is configured; falls back to the in-memory limiter on any error.
 */
export async function checkAuthRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const s = activeStore ?? defaultStore();
  if (s === memoryRateLimitStore) return checkMemoryRateLimit(key, config);
  try {
    return await s.hit(key, config);
  } catch (err: any) {
    console.error("[auth-rate-limit] durable store failed, using in-memory:", err?.message || err);
    return checkMemoryRateLimit(key, config);
  }
}

/**
 * Hand back a counted attempt because it succeeded (password and two-step
 * limits count failures only). Best-effort: a failed refund only means one
 * extra count until the window passes.
 */
export async function refundAuthRateLimit(ticket: RateLimitTicket | undefined): Promise<void> {
  if (!ticket) return;
  try {
    if (ticket.store === "memory") refundMemoryRateLimit(ticket);
    else await (activeStore ?? postgresRateLimitStore).refund(ticket);
  } catch (err: any) {
    console.error("[auth-rate-limit] refund failed:", err?.message || err);
  }
}

export async function refundAuthRateLimits(tickets: (RateLimitTicket | undefined)[]): Promise<void> {
  for (const t of tickets) await refundAuthRateLimit(t);
}

/**
 * Check several limits in order; the first refusal wins. Each one counts the
 * attempt; if a later one refuses, the earlier counts are handed back (the
 * attempt never ran). `tickets` lets the caller refund on success.
 */
export async function checkAuthRateLimits(
  checks: { key: string; config: RateLimitConfig }[]
): Promise<RateLimitResult & { tickets: RateLimitTicket[] }> {
  const tickets: RateLimitTicket[] = [];
  for (const c of checks) {
    const r = await checkAuthRateLimit(c.key, c.config);
    if (!r.allowed) {
      await refundAuthRateLimits(tickets);
      return { ...r, tickets: [] };
    }
    if (r.ticket) tickets.push(r.ticket);
  }
  return { allowed: true, resetIn: 0, tickets };
}

/**
 * Did an Auth.js sign-in POST fail? Auth.js answers a credentials sign-in
 * with a redirect (Location) or, for next-auth/react, JSON { url }; a failed
 * one carries `error=` (CredentialsSignin and friends). Anything unreadable
 * counts as a failure, so the limit never leaks.
 */
export async function signInResponseFailed(res: Response): Promise<boolean> {
  if (res.status >= 400) return true;
  let url: string | null = res.headers.get("location");
  if (!url && (res.headers.get("content-type") || "").includes("application/json")) {
    try {
      const body = await res.clone().json();
      url = typeof body?.url === "string" ? body.url : null;
    } catch {
      url = null;
    }
  }
  if (!url) return true;
  try {
    return new URL(url, "http://localhost").searchParams.has("error");
  } catch {
    return true;
  }
}

/** Rows older than this are never read (the longest window is an hour). */
export const AUTH_RATE_LIMIT_RETENTION_HOURS = 24;

/** Delete expired counters. Called by the daily purge cron. */
export async function purgeOldAuthRateLimits(): Promise<number> {
  const rows = (await sql()(
    `DELETE FROM auth_rate_limit
      WHERE window_start < now() - ($1::int * interval '1 hour')
      RETURNING 1`,
    [AUTH_RATE_LIMIT_RETENTION_HOURS]
  )) as any[];
  return rows.length;
}

/**
 * Re-authentication checks inside a signed-in session: the password or code
 * asked for before turning two-step off, exporting, or deleting. Without a
 * limit these were a free password and code oracle for anyone holding a
 * session.
 */
export function reauthRateLimits(ip: string, userId: string) {
  return [
    { key: `auth:reauth:user:${userId}`, config: AUTH_LIMITS.reauthPerUser },
    { key: `auth:reauth:ip:${ip}`, config: AUTH_LIMITS.reauthPerIp },
  ];
}

/**
 * Which limits apply to a sign-in POST that carries an email.
 *
 * A password sign-in sends no email, so it gets the brute-force limits. Every
 * other email-bearing POST (the magic-link request) burns a send, so it keeps
 * the stricter hourly limits. The two kinds use separate counter keys: signing
 * in with a password never spends the magic-link allowance, or the reverse.
 */
export function signInRateLimits(
  pathname: string,
  ip: string,
  email: string
): {
  ip: { key: string; config: RateLimitConfig };
  email: { key: string; config: RateLimitConfig };
} {
  if (pathname.endsWith("/callback/password-login")) {
    return {
      ip: { key: `auth:pw:ip:${ip}`, config: AUTH_LIMITS.passwordPerIp },
      email: { key: `auth:pw:email:${email}`, config: AUTH_LIMITS.passwordPerEmail },
    };
  }
  return {
    ip: { key: `auth:ip:${ip}`, config: AUTH_LIMITS.magicLinkPerIp },
    email: { key: `auth:email:${email}`, config: AUTH_LIMITS.magicLinkPerEmail },
  };
}

/** Limits for the second step (/api/auth/mfa-verify): per user and per IP, never per email. */
export function stepUpRateLimits(ip: string, userId: string) {
  return [
    { key: `auth:stepup:user:${userId}`, config: AUTH_LIMITS.stepUpPerUser },
    { key: `auth:stepup:ip:${ip}`, config: AUTH_LIMITS.stepUpPerIp },
  ];
}

/**
 * Limits for the login form's precheck (email + password, before the real
 * sign-in). Its per-IP counter is its own and looser, so one person signing in
 * spends the password per-IP budget once, not twice; its per-email counter is
 * the password sign-in's own, so the precheck is never a second, separate
 * guessing allowance against one account.
 */
export function precheckRateLimits(ip: string, email: string) {
  return {
    ip: { key: `auth:precheck:ip:${ip}`, config: AUTH_LIMITS.precheckPerIp },
    email: { key: `auth:pw:email:${email}`, config: AUTH_LIMITS.passwordPerEmail },
  };
}

/** Normalize an email the way Auth.js does before it uses it (NFKC, lower, trim). */
export function normalizeSignInEmail(raw: string): string {
  return raw.normalize("NFKC").toLowerCase().trim();
}

/**
 * The email a sign-in POST carries, read EXACTLY the way Auth.js will read it
 * (@auth/core lib/utils/web.js getBody): JSON when the content-type includes
 * application/json, form fields when it includes
 * application/x-www-form-urlencoded, and no body at all otherwise.
 *
 * Why this matters: the limiter used to parse every body as a form and take the
 * FIRST `email`. Auth.js parses JSON too, and for a form it keeps the LAST
 * duplicate. So a JSON body, or `email=decoy&email=victim`, was limited against
 * a different address than the one Auth.js signed in (or no address at all).
 *
 *  - { kind: "email" }   one usable value, normalized like Auth.js does
 *  - { kind: "none" }    no email field (or an empty one)
 *  - { kind: "invalid" } ambiguous or malformed: refuse the request
 */
export type SignInEmail =
  | { kind: "email"; email: string }
  | { kind: "none" }
  | { kind: "invalid" };

export function signInEmailFromBody(
  contentType: string | null,
  body: string
): SignInEmail {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("application/json")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { kind: "invalid" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { kind: "none" };
    }
    const value = (parsed as Record<string, unknown>).email;
    if (value === undefined || value === null || value === "") return { kind: "none" };
    if (typeof value !== "string") return { kind: "invalid" };
    const email = normalizeSignInEmail(value);
    return email ? { kind: "email", email } : { kind: "none" };
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    const values = new URLSearchParams(body).getAll("email");
    if (values.length > 1) return { kind: "invalid" };
    const email = values.length === 1 ? normalizeSignInEmail(values[0]) : "";
    return email ? { kind: "email", email } : { kind: "none" };
  }
  // Auth.js reads no body for any other content-type, so there is no email.
  return { kind: "none" };
}

/**
 * The two sign-in POSTs that must carry an email: the password callback and the
 * magic-link request. A request to either with no usable email is refused
 * outright rather than passed through unlimited.
 */
export function signInPostRequiresEmail(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "");
  return p.endsWith("/callback/password-login") || p.endsWith("/signin/resend");
}

/**
 * Extract client IP from request headers.
 * On Vercel, x-real-ip is set at the edge and cannot be spoofed.
 */
export function getClientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    const last = parts[parts.length - 1]?.trim();
    if (last) return last;
  }

  return "unknown";
}

/**
 * Basic email format validation. Rejects obviously garbage addresses
 * before we burn a Resend send on them.
 */
export function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false;

  // Must have exactly one @, with content on both sides
  const parts = email.split("@");
  if (parts.length !== 2) return false;

  const [local, domain] = parts;
  if (!local || local.length > 64) return false;
  if (!domain || domain.length > 253) return false;

  // Domain must have at least one dot and valid characters
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(domain)) {
    return false;
  }

  // Local part: allow alphanumeric, dots, hyphens, underscores, plus
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) {
    return false;
  }

  return true;
}
