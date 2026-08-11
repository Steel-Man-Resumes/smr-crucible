/**
 * The PURE, client-safe half of the support-request / Help & Feedback module
 * (Phase 8). Category + status constants and validators, the DISPLAY status
 * mapping, the sensitive-topic classifier, and the digest formatter. No db
 * import, so client components can import these via
 * `@crucible/core/src/supportRequestShared` without dragging server-only code
 * into the browser bundle. The db-backed helpers live in ./supportRequest and
 * re-export everything here.
 *
 * Everything here is deterministic and never throws.
 */

// ── Categories ───────────────────────────────────────────────────────────────

/** The five Help-center modes. Also the category CHECK values in migration 040. */
export const SUPPORT_CATEGORIES = [
  "bug",
  "confusing",
  "help",
  "idea",
  "message",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export function isValidSupportCategory(value: unknown): value is SupportCategory {
  return (
    typeof value === "string" &&
    (SUPPORT_CATEGORIES as readonly string[]).includes(value)
  );
}

/** Human labels for each mode, plain 6th-grade wording. */
export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  bug: "Report a bug",
  confusing: "Something is confusing",
  help: "Ask for help",
  idea: "Share an idea",
  message: "Message for Troy",
};

// ── Status superset + display mapping ────────────────────────────────────────

/** Every value the status column may hold (migration 040 superset). */
export const SUPPORT_STATUSES = [
  "new",
  "received",
  "seen",
  "read",
  "fixed",
  "replied",
  "closed",
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export function isValidSupportStatus(value: unknown): value is SupportStatus {
  return (
    typeof value === "string" &&
    (SUPPORT_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * DISPLAY mapping so legacy rows and new rows read consistently WITHOUT
 * rewriting any stored value. Legacy 'new' shows as "received", legacy 'read'
 * shows as "seen"; everything else displays as itself.
 */
export const DISPLAY_SUPPORT_STATUS: Record<SupportStatus, string> = {
  new: "received",
  received: "received",
  seen: "seen",
  read: "seen",
  fixed: "fixed",
  replied: "replied",
  closed: "closed",
};

export function displaySupportStatus(status: string): string {
  return DISPLAY_SUPPORT_STATUS[status as SupportStatus] ?? status;
}

// ── Sensitive-topic classifier ───────────────────────────────────────────────

/**
 * Words that mean "a person must handle this" -- security, account access, and
 * legal questions. These are NEVER answered from a help article; they always
 * become a human ticket. Kept deliberately broad: a false "sensitive" only
 * routes to a human (safe), a false "general" could answer something risky
 * from a canned article (not safe), so we bias toward sensitive.
 */
const SENSITIVE_TOPIC_TERMS = [
  // account access / auth
  "password",
  "log in",
  "login",
  "sign in",
  "signin",
  "locked out",
  "can't get in",
  "cant get in",
  "hacked",
  "2fa",
  "two-factor",
  "two factor",
  "verification code",
  "reset my",
  "account",
  "delete my account",
  "email change",
  // security / privacy
  "security",
  "breach",
  "stolen",
  "fraud",
  "unauthorized",
  "privacy",
  "my data",
  "personal information",
  "ssn",
  "social security",
  // legal
  "legal",
  "lawyer",
  "attorney",
  "sue",
  "lawsuit",
  "court",
  "subpoena",
  "expunge",
  "expungement",
  "record sealed",
  "immigration",
  "discriminat",
];

/**
 * Classify a free-text help question. "sensitive" -> must become a human
 * ticket; "general" -> a help article may answer it.
 */
export function classifySupportTopic(text: string): "sensitive" | "general" {
  const hay = (text || "").toLowerCase();
  for (const term of SENSITIVE_TOPIC_TERMS) {
    if (hay.includes(term)) return "sensitive";
  }
  return "general";
}

// ── On-demand digest formatter ───────────────────────────────────────────────

export interface SupportDigestRow {
  status: string;
  category: string | null;
  created_at: string | Date;
}

/**
 * Format a plain-text digest from a set of rows. PURE (no DB, no network) so it
 * is unit-testable: pass rows, get deterministic text. buildSupportDigest() in
 * ./supportRequest reads the rows then hands them here.
 *
 * "Open" = anything not yet closed or replied.
 */
export function buildSupportDigestText(
  rows: SupportDigestRow[],
  now: Date = new Date()
): string {
  const total = rows.length;
  const byStatus: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let oldestOpen: Date | null = null;

  for (const r of rows) {
    const display = displaySupportStatus(r.status);
    byStatus[display] = (byStatus[display] ?? 0) + 1;
    const cat = r.category ?? "uncategorized";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;

    const isOpen = display !== "closed" && display !== "replied";
    if (isOpen) {
      const created =
        r.created_at instanceof Date ? r.created_at : new Date(r.created_at);
      if (!Number.isNaN(created.getTime())) {
        if (!oldestOpen || created < oldestOpen) oldestOpen = created;
      }
    }
  }

  const lines: string[] = [];
  lines.push(`Support digest -- ${total} total request${total === 1 ? "" : "s"}`);

  lines.push("");
  lines.push("By status:");
  const statusOrder = ["received", "seen", "fixed", "replied", "closed"];
  for (const s of statusOrder) {
    if (byStatus[s]) lines.push(`  ${s}: ${byStatus[s]}`);
  }

  lines.push("");
  lines.push("By category:");
  for (const c of [...SUPPORT_CATEGORIES, "uncategorized"]) {
    if (byCategory[c]) lines.push(`  ${c}: ${byCategory[c]}`);
  }

  lines.push("");
  if (oldestOpen) {
    const days = Math.floor(
      (now.getTime() - (oldestOpen as Date).getTime()) / 86400000
    );
    lines.push(
      `Oldest open request: ${days} day${days === 1 ? "" : "s"} old (${(oldestOpen as Date)
        .toISOString()
        .slice(0, 10)}).`
    );
  } else {
    lines.push("No open requests. Inbox is clear.");
  }

  return lines.join("\n");
}
