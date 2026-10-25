/**
 * openStaffTroy -- STUB for lane C2 (CRM build, 2026-10-25). The t.ROY staff
 * lane (C4) owns this file and replaces it whole at merge. Same signature as
 * the build plan contract. Until then the buttons that call it do nothing.
 */
/** Same name and type as C1's stub: staff t.ROY buttons show only once C4's launcher is merged. */
export const STAFF_TROY_READY: boolean = false;

export type StaffTroySkill = "staff-prep-me" | "staff-check-in" | "staff-what-changed" | "staff-find-help" | "staff-outcome-note";

export function openStaffTroy(_opts: { clientId?: string; skill: StaffTroySkill }): void {
  // No-op until C4 merges.
}
