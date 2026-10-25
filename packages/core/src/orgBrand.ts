/**
 * Organization brand: the database half (migration 099, table org_brand).
 *
 * org_brand is row-level protected (RLS_PROTECTED_TABLES). Every statement
 * here runs with the user id set (runAsUser) or the org scope set (runScoped),
 * never on a bare connection, and the policies plus the guard trigger in 099
 * decide the rest: members read, the owner sets the logo, a platform admin
 * sets the tier. The route checks (org.settings.manage) are the friendly
 * first answer; the database is the control.
 *
 * Bytes travel as hex in and base64 out, so the driver never has to agree on
 * how to encode bytea.
 */
import { runAsUser, runScoped, type OrgScope } from "./db";
import { DEFAULT_ORG_BRAND, isOrgBrandTier, type OrgBrand, type OrgBrandTier } from "./orgBrandShared";

export * from "./orgBrandShared";

/**
 * The exact statements, exported so the pglite test
 * (apps/consumer/lib/__tests__/org-brand-pglite.test.ts) runs these strings
 * against the real schema as a non-superuser role.
 * setLogo ($1 org, $2 hex bytes, $3 mime, $4 sha256, $5 byte count);
 * removeLogo ($1 org); readLogo ($1 org); readBrand ($1 org); setTier ($1 org, $2 tier).
 */
export const ORG_BRAND_SQL = {
  setLogo: `INSERT INTO org_brand (access_code_id, logo, logo_mime, logo_sha256, logo_bytes)
     VALUES ($1::uuid, decode($2, 'hex'), $3, $4, $5::int)
     ON CONFLICT (access_code_id) DO UPDATE
       SET logo = EXCLUDED.logo, logo_mime = EXCLUDED.logo_mime,
           logo_sha256 = EXCLUDED.logo_sha256, logo_bytes = EXCLUDED.logo_bytes
     RETURNING access_code_id`,
  removeLogo: `UPDATE org_brand
       SET logo = NULL, logo_mime = NULL, logo_sha256 = NULL, logo_bytes = NULL
     WHERE access_code_id = $1::uuid AND logo IS NOT NULL
     RETURNING access_code_id`,
  readLogo: `SELECT encode(logo, 'base64') AS logo_b64, logo_mime, logo_sha256
       FROM org_brand WHERE access_code_id = $1::uuid AND logo IS NOT NULL`,
  readBrand: `SELECT (logo IS NOT NULL) AS has_logo, tier
       FROM org_brand WHERE access_code_id = $1::uuid`,
  setTier: `INSERT INTO org_brand (access_code_id, tier) VALUES ($1::uuid, $2)
     ON CONFLICT (access_code_id) DO UPDATE SET tier = EXCLUDED.tier
     RETURNING access_code_id, tier`,
  /** $1 participant. Their most recently joined organization on the co-brand or full tier. */
  participantCoBrand: `SELECT ac.id, ac.partner_name, (b.logo IS NOT NULL) AS has_logo
       FROM access_code_redemption r
       JOIN access_code ac ON ac.id = r.access_code_id AND ac.is_active = true
       JOIN org_brand b ON b.access_code_id = ac.id AND b.tier IN ('cobrand', 'full')
      WHERE r.user_id = $1::uuid
      ORDER BY r.redeemed_at DESC
      LIMIT 1`,
} as const;

type Raw = (s: string, p?: unknown[]) => unknown;

function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const message = String((err as { message?: string })?.message ?? "");
  return code === "42P01" || /relation "org_brand" does not exist/.test(message);
}

/**
 * The brand as this user may see it. A user who cannot read the row (not a
 * member) gets the default, which renders the monogram: never an error that
 * tells them whether the organization has a logo.
 */
export async function getOrgBrand(userId: string, orgId: string): Promise<OrgBrand> {
  try {
    const out = await runAsUser<[Array<{ has_logo: boolean; tier: string }>]>(userId, (c) => [
      (c as unknown as Raw)(ORG_BRAND_SQL.readBrand, [orgId]),
    ]);
    const row = out[0]?.[0];
    if (!row) return { ...DEFAULT_ORG_BRAND };
    return { hasLogo: !!row.has_logo, tier: isOrgBrandTier(row.tier) ? row.tier : "standard" };
  } catch (err) {
    // Not migrated yet (099 waits for Troy): every org shows its monogram.
    if (isMissingTable(err)) return { ...DEFAULT_ORG_BRAND };
    throw err;
  }
}

/** The logo bytes for a member of that organization, or null (no logo, or not theirs to see). */
export async function readOrgLogo(userId: string, orgId: string): Promise<{ bytes: Buffer; mime: string; sha256: string } | null> {
  try {
    const out = await runAsUser<[Array<{ logo_b64: string; logo_mime: string; logo_sha256: string }>]>(userId, (c) => [
      (c as unknown as Raw)(ORG_BRAND_SQL.readLogo, [orgId]),
    ]);
    const row = out[0]?.[0];
    if (!row?.logo_b64) return null;
    return { bytes: Buffer.from(row.logo_b64, "base64"), mime: row.logo_mime, sha256: row.logo_sha256 };
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

export type OrgBrandWrite = { ok: true } | { ok: false; reason: "not_owner" | "not_migrated" | "failed" };

function scopeFor(actor: { orgId: string; userId: string; role: OrgScope["role"] }): OrgScope {
  return { orgId: actor.orgId, userId: actor.userId, role: actor.role };
}

/** Set the logo. The database refuses anyone but the organization's owner. */
export async function setOrgLogo(
  actor: { orgId: string; userId: string; role: OrgScope["role"] },
  logo: { bytes: Uint8Array; mime: string; sha256: string }
): Promise<OrgBrandWrite> {
  try {
    const out = await runScoped<[Array<{ access_code_id: string }>]>(scopeFor(actor), (c) => [
      (c as unknown as Raw)(ORG_BRAND_SQL.setLogo, [actor.orgId, Buffer.from(logo.bytes).toString("hex"), logo.mime, logo.sha256, logo.bytes.length]),
    ]);
    return out[0]?.length ? { ok: true } : { ok: false, reason: "not_owner" };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "not_migrated" };
    const code = (err as { code?: string })?.code;
    const message = String((err as { message?: string })?.message ?? "");
    if (code === "42501" || /row-level security|only the organization owner/.test(message)) return { ok: false, reason: "not_owner" };
    console.error("[orgBrand] set logo failed:", message);
    return { ok: false, reason: "failed" };
  }
}

/** Remove the logo (the row and its tier stay). Removing when there is none is a success. */
export async function removeOrgLogo(actor: { orgId: string; userId: string; role: OrgScope["role"] }): Promise<OrgBrandWrite> {
  try {
    await runScoped(scopeFor(actor), (c) => [(c as unknown as Raw)(ORG_BRAND_SQL.removeLogo, [actor.orgId])]);
    // Zero rows means no logo, or not the owner. Read back to tell them apart.
    const brand = await getOrgBrand(actor.userId, actor.orgId);
    return brand.hasLogo ? { ok: false, reason: "not_owner" } : { ok: true };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "not_migrated" };
    const message = String((err as { message?: string })?.message ?? "");
    if (/only the organization owner|row-level security/.test(message)) return { ok: false, reason: "not_owner" };
    console.error("[orgBrand] remove logo failed:", message);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Set the branding tier. Platform admin only: the guard trigger checks the
 * platform_admin table for app.user_id, so an owner calling this is refused by
 * the database. The caller (admin orgs route) has already checked the admin
 * second factor.
 */
export async function setOrgBrandTier(adminUserId: string, orgId: string, tier: OrgBrandTier): Promise<OrgBrandWrite> {
  if (!isOrgBrandTier(tier)) return { ok: false, reason: "failed" };
  try {
    const out = await runAsUser<[Array<{ tier: string }>]>(adminUserId, (c) => [
      (c as unknown as Raw)(ORG_BRAND_SQL.setTier, [orgId, tier]),
    ]);
    return out[0]?.[0]?.tier === tier ? { ok: true } : { ok: false, reason: "failed" };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "not_migrated" };
    const message = String((err as { message?: string })?.message ?? "");
    if (/only a platform admin|row-level security/.test(message)) return { ok: false, reason: "not_owner" };
    console.error("[orgBrand] set tier failed:", message);
    return { ok: false, reason: "failed" };
  }
}

/**
 * The organization a PARTICIPANT sees next to Steel Man in their top bar:
 * only when that organization is on the co-brand (or full) tier, only an
 * organization they joined with its code, the one they joined most recently.
 * A solo participant gets null, and the top bar shows nothing.
 */
export async function getParticipantCoBrand(userId: string): Promise<{ orgId: string; name: string; hasLogo: boolean } | null> {
  try {
    const out = await runAsUser<[Array<{ id: string; partner_name: string; has_logo: boolean }>]>(userId, (c) => [
      (c as unknown as Raw)(
ORG_BRAND_SQL.participantCoBrand, [userId]
      ),
    ]);
    const row = out[0]?.[0];
    return row ? { orgId: row.id, name: row.partner_name, hasLogo: !!row.has_logo } : null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}
