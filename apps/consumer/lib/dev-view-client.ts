/**
 * Browser side of developer view-as: start and end, shared by the DEV menu,
 * the banner and the impersonation frame, so each one ends a view the same
 * way (cookie cleared and audited by the route, this browser's keys for the
 * viewed person cleared, back to the page the view started from).
 */

import { clearForgeBrowserKeysEverywhere } from "@/lib/refinery-guards";
import { DEV_VIEW_RETURN_KEY, safeReturnPath } from "@/lib/dev-mode";

export async function startViewAs(targetUserId: string, adminId: string | null): Promise<boolean> {
  try {
    const here = window.location.pathname + window.location.search;
    try { sessionStorage.setItem(DEV_VIEW_RETURN_KEY, safeReturnPath(here)); } catch { /* storage off: Exit goes to /dashboard */ }
    const res = await fetch("/api/dev/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId, mode: "view" }),
    });
    if (!res.ok) return false;
    // Clear this browser's Forge and Refinery keys first (M3).
    clearForgeBrowserKeysEverywhere(adminId);
    // Their real landing, inside the blue read-only frame.
    window.location.assign("/dashboard");
    return true;
  } catch {
    return false;
  }
}

/**
 * End the current view. `to` "start" returns to the page the view began on;
 * "admin" goes to the admin's own home.
 */
export async function endViewAs(adminId: string | null, opts: { notify?: boolean; to?: "start" | "admin" } = {}): Promise<void> {
  let back = "/dashboard";
  if (opts.to !== "admin") {
    try { back = safeReturnPath(sessionStorage.getItem(DEV_VIEW_RETURN_KEY)); } catch { /* default */ }
  }
  try {
    await fetch("/api/dev/impersonate", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notify: !!opts.notify }),
    });
  } finally {
    try { sessionStorage.removeItem(DEV_VIEW_RETURN_KEY); } catch { /* ignore */ }
    // Whatever the person's session left in this browser goes with it (M3).
    clearForgeBrowserKeysEverywhere(adminId);
    window.location.href = back;
  }
}
