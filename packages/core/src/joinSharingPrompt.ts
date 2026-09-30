/**
 * Loads what `decideJoinSharingPrompt` needs for one signed-in person.
 * Everything is read AS that person, so row-level security applies.
 */
import { queryAsUser } from "./db";
import { getUserConsents } from "./consent";
import { getMyPolicies } from "./sharingPolicy";
import { decideJoinSharingPrompt, type JoinPromptDecision } from "./joinSharingPromptShared";

export * from "./joinSharingPromptShared";

export async function getJoinSharingPrompt(userId: string): Promise<JoinPromptDecision> {
  const [rows, consents, policies] = await Promise.all([
    // Your own memberships, and your own staff row if you have one: both are
    // readable as yourself. Nothing about anyone else is read here.
    queryAsUser<{ id: string; partner_name: string | null; has_owner: boolean; is_owner: boolean; is_staff: boolean }>(
      userId,
      `SELECT ac.id, ac.partner_name,
              (ac.partner_user_id IS NOT NULL) AS has_owner,
              (ac.partner_user_id = $1::uuid) IS TRUE AS is_owner,
              EXISTS (SELECT 1 FROM org_staff os WHERE os.access_code_id = ac.id AND os.user_id = $1::uuid) AS is_staff
         FROM access_code_redemption acr
         JOIN access_code ac ON ac.id = acr.access_code_id
        WHERE acr.user_id = $1::uuid AND ac.is_active`,
      [userId]
    ),
    getUserConsents(userId),
    getMyPolicies(userId),
  ]);
  const sharing = consents.find((c) => c.consent_layer === "sharing");
  return decideJoinSharingPrompt({
    memberships: rows.map((r) => ({
      orgId: r.id,
      orgName: r.partner_name ?? "",
      hasOwner: !!r.has_owner,
      isOwnOrg: !!r.is_owner || !!r.is_staff,
    })),
    sharingStatus: sharing ? (sharing.status === "granted" ? "granted" : "revoked") : null,
    requiredPolicyOrgIds: policies.map((p) => p.orgId),
  });
}
