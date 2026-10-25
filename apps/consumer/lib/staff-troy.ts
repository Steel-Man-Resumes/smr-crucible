/**
 * Staff t.ROY launch contract (CRM wave 2026-10-25, BUILD-PLAN section 1).
 *
 * STUB. Lane C4 owns this file and replaces it whole at merge with the real
 * launcher (the docked staff panel with the named skill and person preselected).
 * Until then the call does nothing, so Today's "Prep me" can ship wired to the
 * final signature. Keep the signature exactly as the plan states it.
 */
/**
 * False in this stub: every staff t.ROY button ("Prep me", the empty-state
 * offer) stays hidden, so the shell can ship or be filmed before C4. C4's real
 * file exports true.
 */
export const STAFF_TROY_READY: boolean = false;

export type StaffTroySkill = "staff-prep-me" | "staff-check-in" | "staff-what-changed" | "staff-find-help" | "staff-outcome-note";

export function openStaffTroy(_opts: { clientId?: string; skill: StaffTroySkill }): void {
  // no-op until C4 merges
}
