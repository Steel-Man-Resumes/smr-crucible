"use client";
/**
 * <StaffRewardsAdmin> (integration 2026-10-28, S6 wiring 3): on Team & access, for the owner and org
 * admins only, the program's own reward choices and the recognition notes they ask staff about. Each
 * staff member still turns their own Wins on; a note is used only after its person says yes.
 */
import { useEffectiveRole } from "@/components/RoleProvider";
import { STAFF_FEATURES } from "@/lib/staff-features";
import { ProgramRewardsSettings } from "@/components/org/rewards/ProgramRewardsSettings";
import { RecognitionNotes } from "@/components/org/rewards/RecognitionNotes";

export function StaffRewardsAdmin() {
  const role = useEffectiveRole();
  if (!STAFF_FEATURES.rewards || !role || role.impersonating) return null;
  if (role.orgRole !== "owner" && role.orgRole !== "org_admin") return null;
  return (
    <div className="max-w-5xl mx-auto px-4 pb-10 space-y-6" data-testid="staff-rewards-admin">
      <ProgramRewardsSettings />
      <RecognitionNotes />
    </div>
  );
}
