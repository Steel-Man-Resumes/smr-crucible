/**
 * Staff t.ROY launch contract (CRM wave 2026-10-25, BUILD-PLAN section 1).
 *
 * STUB. Lane C4 owns this file and replaces it whole at merge with the real
 * launcher (the docked staff panel with the named skill and person preselected).
 * Until then the call does nothing, so Today's "Prep me" can ship wired to the
 * final signature. Keep the signature exactly as the plan states it.
 */
export type StaffTroySkill = "staff-prep-me" | "staff-check-in" | "staff-what-changed" | "staff-find-help" | "staff-outcome-note";

export function openStaffTroy(_opts: { clientId?: string; skill: StaffTroySkill }): void {
  // no-op until C4 merges
}
