/**
 * Mini Forge PIN guards (security review 3a Part 2 r1: M1, L3, L4).
 *
 * A Mini Forge plan is opened with a 6-character code and a 4-digit PIN, at
 * /mini-forge/import, and the signed-in person enters the PIN again at
 * /mini-forge/import-confirm. A 4-digit PIN has 10,000 values, so every PIN
 * try is limited four ways, and all four are checked BEFORE the PIN is:
 *   - per plan, keyed on the id the DATABASE returns (or the canonical
 *     upper-case code), never on a spelling the browser sent: Postgres reads
 *     one UUID from many spellings, and each spelling was a fresh counter;
 *   - per network (IP floor), and per account when someone is signed in;
 *   - on the plan row itself: after MINI_FORGE_LOCK_AFTER wrong PINs in
 *     total the plan locks, until Troy or staff clear it (admin).
 * A plan that was loaded into an account is single-use (imported_at).
 *
 * The answers a guesser sees never depend on whether a PIN was right except
 * for success itself: "not found" and "wrong PIN" are one message, and the
 * plan-state answers (locked, already loaded, not ready) are given before
 * the PIN is looked at.
 *
 * Pure apart from the injected counter, so every rule is unit tested.
 */

/** The only tablet id spelling accepted: lower-case, hyphenated, as Postgres prints it. */
export const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function canonicalTabletId(raw: unknown): string | null {
  return typeof raw === "string" && CANONICAL_UUID.test(raw) ? raw : null;
}

/** Import codes: 6 characters from the generator's alphabet, upper-case. */
export const IMPORT_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

export function canonicalImportCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase();
  return IMPORT_CODE.test(c) ? c : null;
}

export function validPin(raw: unknown): raw is string {
  return typeof raw === "string" && /^\d{4}$/.test(raw);
}

/** Wrong PINs, in total, before a plan locks. */
export const MINI_FORGE_LOCK_AFTER = 5;

/** Daily try limits (every try counts, right or wrong). */
export const MINI_FORGE_TRIES = {
  perPlan: 5,
  perNetwork: 20,
  perAccount: 10,
} as const;

export const MINI_FORGE_PIN_ENDPOINT = "mini-forge-pin";

export interface TryCounters {
  /** Durable daily per-key counter (packages/core incrementIpUsage). Returns the new count. */
  bucket: (key: string, endpoint: string) => Promise<number>;
  /** Durable daily per-account counter (packages/core incrementUserUsage). */
  account: (userId: string, endpoint: string) => Promise<number>;
}

/**
 * Count one PIN try against every limit. `plan` is the database id (confirm
 * step) or the canonical code (import step). Every counter is incremented
 * (no short-circuit), so splitting tries across limits gains nothing.
 */
export async function countPinTry(
  c: TryCounters,
  t: { plan: string; ip: string; userId?: string | null }
): Promise<{ allowed: boolean }> {
  const [plan, net, acct] = await Promise.all([
    c.bucket(`mf-plan:${t.plan}`, MINI_FORGE_PIN_ENDPOINT),
    c.bucket(`mf-net:${t.ip || "unknown"}`, MINI_FORGE_PIN_ENDPOINT),
    t.userId ? c.account(t.userId, MINI_FORGE_PIN_ENDPOINT) : Promise.resolve(0),
  ]);
  return {
    allowed:
      plan <= MINI_FORGE_TRIES.perPlan && net <= MINI_FORGE_TRIES.perNetwork && acct <= MINI_FORGE_TRIES.perAccount,
  };
}

export interface PlanState {
  locked_at?: unknown;
  imported_at?: unknown;
  processing_status?: unknown;
  forge_output?: unknown;
}

/**
 * What the plan's own state says, before any PIN is checked. null: go on to
 * the PIN. The answer depends only on the plan, never on the PIN typed.
 */
export function planStateBlock(p: PlanState | null, opts: { needReady: boolean }): "not_found" | "locked" | "imported" | "not_ready" | null {
  if (!p) return "not_found";
  if (p.imported_at) return "imported";
  if (p.locked_at) return "locked";
  if (opts.needReady && !p.forge_output) return "not_ready";
  return null;
}

/** The person-facing lines. "not_found" also covers a wrong PIN: one message for both. */
export const MINI_FORGE_MESSAGES: Record<string, string> = {
  invalid_code: "Enter a 6-letter code (like A7B3KM).",
  invalid_pin: "Enter the 4-digit PIN you made on the tablet.",
  not_found: "We couldn't open a plan with that code and PIN. Check both and try again.",
  too_many: "Too many tries for now. Try again tomorrow.",
  locked: "This plan is locked after too many wrong PINs. Ask the staff where you made it, or contact Steel Man Resumes, to open it again.",
  imported: "This plan was already loaded into an account.",
  not_ready: "Your career plan is still being prepared. Check back soon.",
  unavailable: "Loading Mini Forge plans isn't available right now. Try again later.",
};

/** The client IP from request headers, the same rule as lib/auth-rate-limit getClientIp. */
export function ipFromHeaders(h: { get(name: string): string | null }): string {
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const last = fwd.split(",").pop()?.trim();
    if (last) return last;
  }
  return "unknown";
}
