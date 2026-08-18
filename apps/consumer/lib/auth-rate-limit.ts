/**
 * In-memory sliding window rate limiter for auth endpoints.
 * Separate from withRateLimit.ts (which is DB-based and requires auth).
 * This protects unauthenticated endpoints like magic link and password login.
 *
 * Resets on cold start (Vercel serverless), which is acceptable --
 * the goal is stopping sustained bot abuse, not perfect persistence.
 */

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

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

// 5 magic link requests per IP per hour, 3 per email per hour
export const AUTH_LIMITS = {
  magicLinkPerIp: { maxRequests: 5, windowMs: 3_600_000 } as RateLimitConfig,
  magicLinkPerEmail: { maxRequests: 3, windowMs: 3_600_000 } as RateLimitConfig,
  passwordPerIp: { maxRequests: 10, windowMs: 900_000 } as RateLimitConfig, // 10/15min
  // Registration: deliberately generous per-IP -- a classroom or conference
  // room signs up behind one NAT, and real people must never be choked.
  // 120/hr/IP passes any human burst; sustained bot floods do not look human.
  registerPerIp: { maxRequests: 120, windowMs: 3_600_000 } as RateLimitConfig,
  registerPerEmail: { maxRequests: 6, windowMs: 3_600_000 } as RateLimitConfig,
  // Mini Forge kiosk session creation. A facility tablet room signs many people
  // up behind one NAT IP, so this is deliberately generous -- enough to clear a
  // busy kiosk day, low enough that a bot minting thousands of sessions is cut
  // off. Best-effort (in-memory); the real spend ceiling is the DB-backed
  // rolling-24h cap in mini-forge-budget (assertMiniForgeBudget).
  miniForgeSessionPerIp: { maxRequests: 40, windowMs: 3_600_000 } as RateLimitConfig,
};

export function checkAuthRateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; resetIn: number } {
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
