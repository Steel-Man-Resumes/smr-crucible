/**
 * Tailor and tracker copy that must say only what is known (demo-fix L4,
 * 2026-10-28; walkthrough W09, W10, W13). Pure and client-safe.
 */

import { STEP_COPY } from "./progression-policy";
import { ASK_TROY_ACTION, ASK_TROY_HINT } from "./refinery-nav";

// ---- W13: the tracker says what the Tailor says --------------------------------

export type TailoredStatus = "finished" | "draft" | "unknown";

/** The newest revision's status, read the same way the Tailor's Check and finish line reads it. */
export function revisionStatusOf(body: unknown): TailoredStatus {
  // A failed read (null body, e.g. a 403 for staff viewing as the person) is not a draft: say nothing untrue.
  if (!body || typeof body !== "object") return "unknown";
  const rev = body && typeof body === "object" ? (body as { revision?: { status?: unknown } | null }).revision : null;
  return rev && rev.status === "finished" ? "finished" : "draft";
}

export const TRACKER_FINISHED_LINE = "Your tailored resume is finished. Apply when you are:";
export const TRACKER_UNKNOWN_LINE = "Apply when you are:";
export const TRACKER_DRAFT_LINE = "Your tailored resume is still a draft. Check and finish it before you send it.";

/** The tracker's line over the apply ladder. Null while the status is still being read. */
export function trackerReadinessLine(status: TailoredStatus | null): string | null {
  if (status === "finished") return TRACKER_FINISHED_LINE;
  if (status === "draft") return TRACKER_DRAFT_LINE;
  if (status === "unknown") return TRACKER_UNKNOWN_LINE;
  return null;
}

// ---- W10: a missing link is a missing link, not a fact about the employer -----

export const NO_LINK_SAVED_LINE =
  "No application link was saved for this job. t.ROY can draft an email you can send with your resume and cover letter, and show you how to find the employer's address.";

// ---- W09: the Tailor button never fails silently ------------------------------

export interface TailorStartNotice {
  kind: "locked" | "error";
  heading: string;
  body: string;
  /** locked: the button label that opens the existing early-access request. */
  action?: string;
  /** locked: the line under that button. */
  hint?: string;
}

/**
 * What to show at the Tailor button when a run could not start. `code` is the
 * server's error code (progression_locked from lib/progression-server.ts
 * checkProgressionTool); anything else shows the server's own message.
 */
export function tailorStartNotice(code: string | null | undefined, message: string | null | undefined): TailorStartNotice {
  if (code === "progression_locked") {
    return {
      kind: "locked",
      heading: "Tailoring is not open on your account yet.",
      body: `${STEP_COPY.tailor.reason} Nothing was used up.`,
      action: ASK_TROY_ACTION,
      hint: ASK_TROY_HINT,
    };
  }
  // Server codes ("approved_source_rejected") are not words for a person: show the plain line instead.
  const m = typeof message === "string" ? message.trim() : "";
  const text = m && !/^[a-z0-9]+(_[a-z0-9]+)+$/.test(m) ? m : "We could not tailor your resume just now. Try again.";
  return { kind: "error", heading: "Your resume was not tailored.", body: text };
}

// ---- W13: Check and finish always answers the click ----------------------------

export const CHECK_OPENING_LINE = "Opening the check for this resume.";
export const CHECK_SLOW_LINE = "This is taking longer than it should.";
export const CHECK_SLOW_LINK = "Open the check page";
/** How long the link waits for the page to change before offering a direct load. */
export const CHECK_SLOW_MS = 6000;
