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

export interface RateLimitResult {
  allowed: boolean;
  resetIn: number;
}

// 5 magic link requests per IP per hour, 3 per email per hour
export const AUTH_LIMITS = {
  magicLinkPerIp: { maxRequests: 5, windowMs: 3_600_000 } as RateLimitConfig,
  magicLinkPerEmail: { maxRequests: 3, windowMs: 3_600_000 } as RateLimitConfig,
  passwordPerIp: { maxRequests: 10, windowMs: 900_000 } as RateLimitConfig, // 10/15min
  // Brute-force ceiling on one account; a real person retyping a password fits well inside it.
  passwordPerEmail: { maxRequests: 10, windowMs: 900_000 } as RateLimitConfig, // 10/15min
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
  return { allowed: true, resetIn: config.windowMs };
}

/** Where counters are kept. */
export interface RateLimitStore {
  hit(key: string, config: RateLimitConfig): Promise<RateLimitResult>;
}

export const memoryRateLimitStore: RateLimitStore = {
  async hit(key, config) {
    return checkMemoryRateLimit(key, config);
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
    return slidingWindowDecision({
      prev: Number(row.prev) || 0,
      cur: Number(row.cur) || 1,
      now,
      config,
    });
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

/** Check several limits in order; the first refusal wins. Each one counts the attempt. */
export async function checkAuthRateLimits(
  checks: { key: string; config: RateLimitConfig }[]
): Promise<RateLimitResult> {
  for (const c of checks) {
    const r = await checkAuthRateLimit(c.key, c.config);
    if (!r.allowed) return r;
  }
  return { allowed: true, resetIn: 0 };
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
