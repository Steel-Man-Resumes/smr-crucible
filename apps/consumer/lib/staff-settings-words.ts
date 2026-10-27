/**
 * Staff words for Settings (staff pass 2026-10-27, lane S2; walk finding T03,
 * L1 report section 2). A staff seat is not a job seeker: no resumes, no
 * Forge, no record check, no "your coach". Pure, so every line is tested.
 */
import { orgRoleLine } from "./org-nav";

/** The chip beside "Signed in as": the role in the organization for staff, never the raw account tier. */
export function accountChipText(opts: { orgRole: "owner" | "org_admin" | "staff" | null | undefined; capabilities: readonly string[]; tier: string | null | undefined }): string {
  const line = orgRoleLine(opts.orgRole, opts.capabilities);
  if (line) return line;
  return opts.tier || "client";
}

const PARTICIPANT_TOOLS = "t.ROY chat, tailoring, interview practice, drafts and fit checks spend from it.";
const PARTICIPANT_SHARED = "shared across t.ROY chat, tailoring, interview practice, drafts and fit checks.";

/** The Usage line for staff: what staff spend the allowance on. Anything else passes through unchanged. */
export function staffUsageLine(line: string): string {
  return line
    .replace(PARTICIPANT_TOOLS, "t.ROY's briefs, notes and drafts spend from it.")
    .replace(PARTICIPANT_SHARED, "shared across everything t.ROY does for you.");
}

export const STAFF_DATA_WORDS = {
  sharing: "We never sell personal information. It goes only to the services that run the app.",
  exportScope: "This is your own account: your settings, saved views, drafts and t.ROY conversations. Case notes, tasks and records about the people you serve belong to your organization and are not in this file.",
  trustLink: { href: "/dashboard/org-security", before: "Want to know how the people you serve are protected?", label: "Read the security statement" },
  setupCard: "Where you land, what Today shows, your columns and your views now live on My setup, with every other way to shape your own work.",
};
