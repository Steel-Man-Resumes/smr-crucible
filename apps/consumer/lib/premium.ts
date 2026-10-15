/**
 * Premium tools in the app: the switch, the split, the plain words.
 * The rules themselves live in packages/core/src/premium.ts (migration 079).
 *
 * Individuals never pay. A locked tool says plainly why and how to get it:
 * "Ask your organization" or "Ask SMR for access". It never shows a price,
 * and asking sends no email (Troy sees the request in admin).
 *
 * Client-safe: no server imports here. The server gate, checkPremium, lives in
 * lib/premium-server.ts (importing @crucible/core from a file the browser also
 * loads pulls Node-only modules into the client bundle).
 */

/**
 * The tool names migration 079 knows (grants and requests can name any of
 * them). Which of them the gate actually locks is SPONSORED_TOOL_IDS below.
 */
export const PREMIUM_TOOL_IDS = ["resources", "interview_coaching", "one_click_apply"] as const;
export type PremiumToolId = (typeof PREMIUM_TOOL_IDS)[number];

/**
 * THE SPLIT (Troy 2026-10-10, Codex review section D).
 *
 * Free with an account: the resume, basic support search ("resources") and
 * text interview practice, up to TEXT_PRACTICE_SESSIONS_PER_DAY a day.
 *
 * Sponsored (an organization's code, or Troy's grant): voice interview
 * coaching ("interview_coaching": the voice token, which every voice call
 * needs) and one-click apply ("one_click_apply"). With a sponsor, text
 * practice has no daily allowance either (the ordinary daily AI limit still
 * applies to everyone).
 *
 * "resources" stays a known name so old grants and requests still read, but
 * the gate never locks it.
 */
export const SPONSORED_TOOL_IDS = ["interview_coaching", "one_click_apply"] as const;
export type SponsoredToolId = (typeof SPONSORED_TOOL_IDS)[number];

export function isSponsoredTool(tool: string): tool is SponsoredToolId {
  return (SPONSORED_TOOL_IDS as readonly string[]).includes(tool);
}

/**
 * Text interview practice sessions a day for a person with an account and no
 * sponsor, while the gate is on. One session is one practice interview: it
 * is counted when the person sends their first answer.
 */
export const TEXT_PRACTICE_SESSIONS_PER_DAY = 5;

/**
 * Deployment switch, read on the server only. OFF BY DEFAULT (CC ruling
 * 2026-10-08): the gate locks premium tools only when PREMIUM_GATE is set to
 * "on". Unset, "off" or anything else: every premium tool stays open to every
 * signed-in person, as before. Why: turning the gate on is an owner decision
 * on a date of its own, and usage numbers are recorded before any wall goes
 * up, so a deploy must never lock tools by accident. The locked card, "Ask SMR
 * for access" and the admin grants all work once it is on (grants and
 * requests can be made while it is off, and take effect when it goes on).
 * The text practice allowance applies only while the gate is on, too. A
 * value that is neither "on" nor "off" fails the release check
 * (lib/release-check.mjs) instead of quietly reading as off.
 */
export const PREMIUM_GATE_ENV = "PREMIUM_GATE";

export function premiumGateOn(raw: string | undefined | null = typeof process !== "undefined" ? process.env.PREMIUM_GATE : undefined): boolean {
  return (raw ?? "").trim().toLowerCase() === "on";
}

/** The names people see. */
export const PREMIUM_TOOL_LABELS: Record<PremiumToolId, string> = {
  resources: "Support search",
  interview_coaching: "Voice interview coaching",
  one_click_apply: "One-click apply",
};

/** What comes with an account, and what a sponsor adds. Shown before a locked tool, never a price. */
export const PREMIUM_INCLUDED_LINE =
  `With your account, your resume, support search and text interview practice (${TEXT_PRACTICE_SESSIONS_PER_DAY} a day) are yours to use. ` +
  "Voice interview coaching and one-click apply open through an organization that works with Steel Man Resumes, or SMR can open them for you.";

/** The words when the daily text practice allowance is used up. */
export function textPracticeAllowanceMessage(limit: number = TEXT_PRACTICE_SESSIONS_PER_DAY): string {
  return `That's your ${limit} practice interviews for today. More open tomorrow. If an organization works with you, its code in Settings removes the daily limit.`;
}

/** One line under the text practice button while the allowance applies. */
export function textPracticeAllowanceLine(limit: number = TEXT_PRACTICE_SESSIONS_PER_DAY): string {
  return `Text practice: ${limit} interviews a day with your account.`;
}

/** One line for a locked tool, wherever it shows. No price, ever. */
export function premiumLockedLine(tool: PremiumToolId): string {
  return `${PREMIUM_TOOL_LABELS[tool]} opens through an organization that works with Steel Man Resumes, or SMR can open it for you.`;
}

export const PREMIUM_NEVER_PAY_LINE = "You never pay for it.";
export const PREMIUM_ASK_ORG_HEADING = "Ask your organization";
export const PREMIUM_ASK_ORG_LINE =
  "If a program, reentry center or case manager works with you, ask them for their SMR code. Then enter it in Settings.";
export const PREMIUM_ASK_SMR_HEADING = "Ask SMR for access";
export const PREMIUM_ASK_SMR_LINE = "Tell us a little about your search if you want. It's optional.";
export const PREMIUM_ASK_SENT_LINE = "Your request is in. When it's approved, this tool opens here.";

/**
 * Where a person's open tools come from, in their own words. Never the
 * admin's grant reason: that is Troy's note (it is still in the person's own
 * data export, because it is their data).
 */
export function premiumAccessLine(status: { orgMember: boolean; orgName?: string | null; grantEndsAt: string | null }): string {
  if (status.orgMember) return `Access from ${status.orgName?.trim() || "your organization"}.`;
  if (status.grantEndsAt) {
    const d = new Date(status.grantEndsAt);
    if (!Number.isNaN(d.getTime())) {
      return `Access from SMR until ${d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`;
    }
  }
  return "Access from SMR.";
}

/** What the server sends when a locked tool is called. */
export function premiumLockedMessage(tool: PremiumToolId): string {
  return `${PREMIUM_TOOL_LABELS[tool]} isn't open for you yet. Ask your organization, or ask SMR for access.`;
}

/**
 * The gate is on but the tool list can't be read (migration 079 missing, A8).
 * The tool stays shut until it can; this says so plainly. Nothing the person
 * did is spent or thrown away by this refusal.
 */
export function premiumUnavailableMessage(tool: PremiumToolId): string {
  return `${PREMIUM_TOOL_LABELS[tool]} isn't available right now. The problem is on our side, and your account is fine. Try again later.`;
}

/** The status the app reads (GET /api/user/premium). */
export interface PremiumStatus {
  gate: boolean;
  open: PremiumToolId[];
  orgMember: boolean;
  /** The sponsoring organization's name, or null. */
  orgName?: string | null;
  grantEndsAt: string | null;
  openRequest: { tool: PremiumToolId; createdAt: string } | null;
  /** The gate is on but the tool list can't be read: sponsored tools are shut for now (A8). */
  unavailable?: boolean;
}

export function toolIsOpen(status: PremiumStatus | null, tool: PremiumToolId): boolean | null {
  if (!status) return null;
  if (!isSponsoredTool(tool)) return true;
  if (!status.gate) return true;
  if (status.unavailable) return false;
  return status.open.includes(tool);
}
