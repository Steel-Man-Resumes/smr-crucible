/**
 * Required sharing: the organization's side (set the policy, see who has
 * acknowledged) and the participant's side (see it, acknowledge it).
 *
 * Every write is a database function that looks the actor up for itself
 * (migration 054). This file adds no authority; it translates outcomes.
 */
import { query, queryAsUser, runAsUser, runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { REQUIRABLE_SCOPES, POLICY_AUDIENCES, SHARING_TEXT_VERSION, type PolicyAudience, type SharingScope } from "./sharingScopes";

const scopeOf = (a: OrgActor): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });

export interface SharingPolicy {
  id: string;
  versionNo: number;
  scopes: SharingScope[];
  audience: PolicyAudience;
  purpose: string;
  coversExisting: boolean;
  effectiveAt: string;
}
type PolicyRow = { id: string; version_no: number; scopes: string[]; audience: string; purpose: string; covers_existing: boolean; effective_at: string };
const toPolicy = (r: PolicyRow): SharingPolicy => ({
  id: r.id, versionNo: r.version_no, scopes: r.scopes as SharingScope[], audience: r.audience as PolicyAudience,
  purpose: r.purpose, coversExisting: r.covers_existing, effectiveAt: r.effective_at,
});

export interface OrgPolicyState {
  /** Can this organization use required sharing at all? (legal review gate, set by a human) */
  available: boolean;
  canEdit: boolean;
  policy: SharingPolicy | null;
  /** Members and where each stands. Named, because the owner has to be able to follow up. */
  members: { userId: string; name: string | null; status: "acknowledged" | "awaiting" | "stopped"; stoppedScopes: string[] }[];
}

export async function getOrgPolicyState(actor: OrgActor): Promise<OrgPolicyState | null> {
  if (actor.viaPlatformAdmin || !actor.capabilities.has("org.staff.manage")) return null;
  const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
  const [flag, pol, members] = await runScoped<[
    { required_sharing_enabled: boolean; is_owner: boolean }[], PolicyRow[],
    { user_id: string; name: string | null; acked: boolean; stopped: string[] | null }[],
  ]>(scopeOf(actor), (sql) => [
    run(sql)(`SELECT required_sharing_enabled, (partner_user_id = $2::uuid) AS is_owner FROM access_code WHERE id = $1::uuid`, [actor.orgId, actor.userId]),
    run(sql)(`SELECT id, version_no, scopes, audience, purpose, covers_existing, effective_at FROM org_sharing_policy_version
               WHERE access_code_id = $1::uuid AND retired_at IS NULL`, [actor.orgId]),
    run(sql)(
      `SELECT r.user_id, u.name,
              EXISTS (SELECT 1 FROM sharing_ack a JOIN org_sharing_policy_version v ON v.id = a.policy_version_id
                       WHERE a.user_id = r.user_id AND a.ended_at IS NULL AND v.access_code_id = $1::uuid AND v.retired_at IS NULL) AS acked,
              (SELECT array_agg(DISTINCT g.scope) FROM sharing_grant g JOIN org_sharing_policy_version v ON v.id = g.policy_version_id
                WHERE g.user_id = r.user_id AND v.access_code_id = $1::uuid AND v.retired_at IS NULL
                  AND g.revoked_reason = 'participant_stopped_required'
                  AND NOT EXISTS (SELECT 1 FROM sharing_grant g2 WHERE g2.user_id = g.user_id AND g2.access_code_id = g.access_code_id
                                   AND g2.scope = g.scope AND g2.revoked_at IS NULL)) AS stopped
         FROM access_code_redemption r JOIN users u ON u.id = r.user_id
        WHERE r.access_code_id = $1::uuid ORDER BY u.name`, [actor.orgId]),
  ]);
  const policy = pol[0] ? toPolicy(pol[0]) : null;
  return {
    available: !!flag[0]?.required_sharing_enabled,
    canEdit: !!flag[0]?.is_owner,
    policy,
    members: policy ? members.map((m) => ({
      userId: m.user_id, name: m.name, stoppedScopes: m.stopped ?? [],
      status: !m.acked ? "awaiting" : (m.stopped?.length ?? 0) > 0 ? "stopped" : "acknowledged",
    })) : [],
  };
}

const POLICY_ERRORS: Record<string, string> = {
  refused: "You do not have access to that.",
  owner_only: "Only the organization's owner can set what the program requires.",
  not_enabled: "Required sharing is not available for your organization yet. Contact us and we will walk through it with you.",
  invalid: "Choose at least one item, who may see it, and give participants a real reason (at least a sentence).",
};

/** Pass scopes: [] to stop requiring anything. Always creates a new version; never edits one. */
export async function setOrgSharingPolicy(actor: OrgActor, input: { scopes: string[]; audience: string; purpose: string; coversExisting: boolean }):
  Promise<{ ok: true } | { ok: false; error: string }> {
  const scopes = Array.from(new Set(input.scopes)).filter((s) => (REQUIRABLE_SCOPES as readonly string[]).includes(s));
  if (scopes.length !== new Set(input.scopes).size) return { ok: false, error: "One of those items can never be required." };
  if (scopes.length > 0 && !(POLICY_AUDIENCES as readonly string[]).includes(input.audience)) return { ok: false, error: POLICY_ERRORS.invalid };
  const [rows] = await runScoped<[{ r: string }[]]>(scopeOf(actor), (sql) => [
    sql`SELECT smr_set_sharing_policy(${scopes}::text[], ${input.audience || "assigned_staff"}, ${input.purpose ?? ""}, ${!!input.coversExisting}, ${SHARING_TEXT_VERSION}) AS r`,
  ]);
  const r = rows[0]?.r ?? "refused";
  return r === "ok" ? { ok: true } : { ok: false, error: POLICY_ERRORS[r] ?? POLICY_ERRORS.refused };
}

/* ------------------------------------------------------------ the participant -- */

export interface MyPolicy extends SharingPolicy {
  orgId: string;
  orgName: string;
  acknowledged: boolean;
}

/** The current requirement of every org this person belongs to, and whether they have acknowledged it. */
export async function getMyPolicies(userId: string): Promise<MyPolicy[]> {
  const rows = await queryAsUser<PolicyRow & { access_code_id: string; org_name: string; acked: boolean }>(
    userId,
    `SELECT v.id, v.version_no, v.scopes, v.audience, v.purpose, v.covers_existing, v.effective_at, v.access_code_id, ac.partner_name AS org_name,
            EXISTS (SELECT 1 FROM sharing_ack a WHERE a.user_id = $1 AND a.policy_version_id = v.id AND a.ended_at IS NULL) AS acked
       FROM org_sharing_policy_version v JOIN access_code ac ON ac.id = v.access_code_id
       JOIN access_code_redemption r ON r.access_code_id = v.access_code_id AND r.user_id = $1
      WHERE v.retired_at IS NULL`,
    [userId]
  );
  return rows.map((r) => ({ ...toPolicy(r), orgId: r.access_code_id, orgName: r.org_name, acknowledged: r.acked }));
}

export async function acknowledgePolicy(userId: string, versionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [rows] = await runAsUser<[{ r: string }[]]>(userId, (sql) => [sql`SELECT smr_acknowledge_policy(${versionId}::uuid) AS r`]);
  const r = rows[0]?.r;
  if (r === "ok") return { ok: true };
  return { ok: false, error: r === "not_current" ? "The program changed what it requires. Please read the new version." : "That could not be recorded." };
}

/** Before joining: what the program behind this code requires, if anything. */
export async function getPolicyForCode(code: string): Promise<(Omit<SharingPolicy, "versionNo" | "effectiveAt"> & { orgName: string }) | null> {
  const rows = await query<{ id: string; org_name: string; scopes: string[]; audience: string; purpose: string; covers_existing: boolean }>(
    `SELECT id, org_name, scopes, audience, purpose, covers_existing FROM smr_policy_for_code($1)`,
    [code.trim().toUpperCase()]
  );
  const r = rows[0];
  return r ? { id: r.id, orgName: r.org_name, scopes: r.scopes as SharingScope[], audience: r.audience as PolicyAudience, purpose: r.purpose, coversExisting: r.covers_existing } : null;
}
