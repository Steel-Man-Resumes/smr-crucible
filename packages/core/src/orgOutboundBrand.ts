/**
 * Outbound branding: the database half (migration 107, org_profile.branding).
 *
 * Reads run with the user id set (runAsUser), so 103's select policy decides
 * who may read the row: staff, members, the owner, a platform admin. A reader
 * who cannot see the row, a missing row, or a database without 107 all get
 * the safe default, co_brand. The write is the SECURITY DEFINER setter
 * smr_set_org_branding, which refuses anyone who is not a platform admin; a
 * guard trigger refuses every other path.
 */
import { runAsUser } from "./db";
import { orgOutboundBrand, resolveOrgBranding, isOrgBranding, type OrgBranding, type OutboundBrand } from "./orgOutboundBrandShared";

export * from "./orgOutboundBrandShared";

/**
 * The exact statements, exported for the isolation script and tests.
 * read ($1 org): the branding and the organization's own display name, from
 * org_profile only (103's select policy: staff, members, the owner, a
 * platform admin). The organization's code name comes from the caller, which
 * already holds it (the org guard's actor.orgName).
 * set ($1 org, $2 branding).
 */
export const ORG_OUTBOUND_BRAND_SQL = {
  read: `SELECT display_name, branding FROM org_profile WHERE access_code_id = $1::uuid`,
  set: `SELECT public.smr_set_org_branding($1::uuid, $2) AS branding`,
} as const;

type Raw = (s: string, p?: unknown[]) => unknown;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isMissing(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const message = String((err as { message?: string })?.message ?? "");
  return code === "42703" || code === "42883" || code === "42P01"
    || /column "branding"|smr_set_org_branding|relation "org_profile" does not exist/.test(message);
}

/**
 * The outbound brand of an organization, as this user may read it. The name
 * is the organization's own display name when it set one, else `fallbackName`
 * (the organization's name the caller already holds).
 * Never throws: any failure is the co-brand default with the name given.
 */
export async function getOrgOutboundBrand(userId: string, orgId: string, fallbackName?: string | null): Promise<OutboundBrand> {
  if (!UUID.test(orgId) || !UUID.test(userId)) return orgOutboundBrand({ name: fallbackName ?? null });
  try {
    const out = await runAsUser<[Array<{ display_name: string | null; branding: string | null }>]>(userId, (c) => [
      (c as unknown as Raw)(ORG_OUTBOUND_BRAND_SQL.read, [orgId]),
    ]);
    const row = out[0]?.[0];
    return orgOutboundBrand({ name: row?.display_name || fallbackName || null, branding: resolveOrgBranding(row?.branding) });
  } catch (err) {
    if (!isMissing(err)) console.error("[orgOutboundBrand] read failed:", String((err as { message?: string })?.message ?? err));
    return orgOutboundBrand({ name: fallbackName ?? null });
  }
}

export type OrgBrandingWrite = { ok: true; branding: OrgBranding } | { ok: false; reason: "not_admin" | "not_migrated" | "bad_value" | "failed" };

/** Platform admins only: the database refuses everyone else. */
export async function setOrgOutboundBranding(adminUserId: string, orgId: string, branding: unknown): Promise<OrgBrandingWrite> {
  if (!isOrgBranding(branding) || !UUID.test(orgId) || !UUID.test(adminUserId)) return { ok: false, reason: "bad_value" };
  try {
    const out = await runAsUser<[Array<{ branding: string }>]>(adminUserId, (c) => [
      (c as unknown as Raw)(ORG_OUTBOUND_BRAND_SQL.set, [orgId, branding]),
    ]);
    const got = out[0]?.[0]?.branding;
    return got === branding ? { ok: true, branding } : { ok: false, reason: "failed" };
  } catch (err) {
    if (isMissing(err)) return { ok: false, reason: "not_migrated" };
    const code = (err as { code?: string })?.code;
    const message = String((err as { message?: string })?.message ?? "");
    if (code === "42501" || /only a platform admin/.test(message)) return { ok: false, reason: "not_admin" };
    console.error("[orgOutboundBrand] set failed:", message);
    return { ok: false, reason: "failed" };
  }
}
