/**
 * Premium tools in the app: the switch, the plain words, and the server gate.
 * The rules themselves live in packages/core/src/premium.ts (migration 078).
 *
 * Individuals never pay. A locked tool says plainly why and how to get it:
 * "Ask your organization" or "Ask SMR for access". It never shows a price,
 * and asking sends no email (Troy sees the request in admin).
 *
 * Client-safe: no server imports here. The server gate, checkPremium, lives in
 * lib/premium-server.ts (importing @crucible/core from a file the browser also
 * loads pulls Node-only modules into the client bundle).
 */

export const PREMIUM_TOOL_IDS = ["resources", "interview_coaching", "one_click_apply"] as const;
export type PremiumToolId = (typeof PREMIUM_TOOL_IDS)[number];

/**
 * Deployment switch, read on the server only. OFF BY DEFAULT (CC ruling
 * 2026-10-08): the gate locks premium tools only when PREMIUM_GATE is set to
 * "on". Unset, "off" or anything else: every premium tool stays open to every
 * signed-in person, as before. Why: turning the gate on is an owner decision
 * on a date of its own, and usage numbers are recorded before any wall goes
 * up, so a deploy must never lock tools by accident. The locked card, "Ask SMR
 * for access" and the admin grants all work once it is on (grants and
 * requests can be made while it is off, and take effect when it goes on).
 */
export const PREMIUM_GATE_ENV = "PREMIUM_GATE";

export function premiumGateOn(raw: string | undefined | null = typeof process !== "undefined" ? process.env.PREMIUM_GATE : undefined): boolean {
  return (raw ?? "").trim().toLowerCase() === "on";
}

/** The names people see. */
export const PREMIUM_TOOL_LABELS: Record<PremiumToolId, string> = {
  resources: "Local resources",
  interview_coaching: "Interview coaching",
  one_click_apply: "One-click apply",
};

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

/** The status the app reads (GET /api/user/premium). */
export interface PremiumStatus {
  gate: boolean;
  open: PremiumToolId[];
  orgMember: boolean;
  /** The sponsoring organization's name, or null. */
  orgName?: string | null;
  grantEndsAt: string | null;
  openRequest: { tool: PremiumToolId; createdAt: string } | null;
}

export function toolIsOpen(status: PremiumStatus | null, tool: PremiumToolId): boolean | null {
  if (!status) return null;
  return !status.gate || status.open.includes(tool);
}
