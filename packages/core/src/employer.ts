/**
 * Employer directory -- verified fair-chance employers imported from the SMR
 * Employers Airtable. Only `published` rows are shown to job seekers. Outreach /
 * verification fields (contact, evidence, follow-up) are admin-side only.
 */

import { query, getOne } from "./db";

export interface Employer {
  id: string;
  name: string;
  employer_type: string | null;
  industry: string | null;
  primary_city: string | null;
  county: string | null;
  wi_region: string | null;
  website: string | null;
  careers_url: string | null;
  role_types: string | null;
  evidence_summary: string | null;
  caveats: string | null;
  board_fit: string | null;
  confidence_tier: string | null;
  last_verified: string | null;
  published: boolean;
}

/** Job-seeker-facing fields only (no contact/outreach intel). */
export interface PublicEmployer {
  id: string;
  name: string;
  industry: string | null;
  location: string | null;
  applyUrl: string | null;
  roleTypes: string | null;
  whyGoodFit: string | null;
  caveats: string | null;
  lastVerified: string | null;
}

function locationOf(e: { primary_city: string | null; county: string | null; wi_region: string | null }): string | null {
  return e.primary_city || e.wi_region || e.county || null;
}

/** Published employers for the fair-chance board, ranked best-first. */
export async function listPublishedEmployers(opts: { limit?: number; industry?: string } = {}): Promise<PublicEmployer[]> {
  const params: unknown[] = [];
  let where = `WHERE published = true`;
  if (opts.industry) {
    params.push(opts.industry);
    where += ` AND industry = $${params.length}`;
  }
  const limit = Math.min(opts.limit ?? 100, 200);
  // Dedupe by name (the source Airtable has some employers entered twice): keep
  // the best-ranked record per name, then order the board best-first.
  const rows = await query<Employer>(
    `SELECT * FROM (
       SELECT DISTINCT ON (lower(name))
              id, name, industry, primary_city, county, wi_region, website, careers_url,
              role_types, evidence_summary, caveats, last_verified, rank, confidence_score
         FROM employer ${where}
         ORDER BY lower(name), rank ASC NULLS LAST, confidence_score DESC NULLS LAST
     ) d
     ORDER BY d.rank ASC NULLS LAST, d.confidence_score DESC NULLS LAST
     LIMIT ${limit}`,
    params
  );
  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    industry: e.industry,
    location: locationOf(e),
    applyUrl: e.careers_url || e.website,
    roleTypes: e.role_types,
    whyGoodFit: e.evidence_summary,
    caveats: e.caveats,
    lastVerified: e.last_verified,
  }));
}

/**
 * Normalize an employer name into a key for EXACT fair-chance matching. Codex 12:
 * the old substring match flagged "Targeted Staffing" as fair-chance because the
 * lowercased name contains "target". Matching is now full-string equality on this
 * normalized key -- never a substring, never an AI guess. Punctuation is dropped,
 * whitespace collapsed, and common legal suffixes removed so a live listing for
 * "Roehl Transport" resolves to the same key as the table's "Roehl Transport, Inc."
 */
export function normalizeEmployerName(name: string): string {
  let s = (name || "").toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  // Strip trailing legal suffixes, repeatedly (e.g. "iea l l c" -> "iea").
  const SUFFIX = /\s(incorporated|inc|llc|l l c|corporation|corp|company|co|ltd|limited|plc|lp|llp)$/;
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(SUFFIX, "");
  }
  return s;
}

// Cache the verified-name set briefly so a job search doesn't hit the DB per call.
let _verifiedNameCache: { set: Set<string>; at: number } | null = null;
const VERIFIED_NAME_TTL_MS = 5 * 60 * 1000;

/**
 * The set of normalized names of PUBLISHED verified employers -- the single source
 * of truth for fair-chance flags on live job listings (Codex 12). A listing is
 * flagged fair-chance ONLY when its employer name EXACTLY matches (normalized) a
 * verified employer in this set. Cached ~5 min; fail-safe to the last-known set
 * (or empty) on a DB error, so a transient failure never produces a false badge.
 */
export async function getVerifiedEmployerNameSet(): Promise<Set<string>> {
  const now = Date.now();
  if (_verifiedNameCache && now - _verifiedNameCache.at < VERIFIED_NAME_TTL_MS) {
    return _verifiedNameCache.set;
  }
  try {
    const rows = await query<{ name: string }>(`SELECT name FROM employer WHERE published = true`);
    const set = new Set<string>();
    for (const r of rows) {
      const key = normalizeEmployerName(r.name);
      if (key) set.add(key);
    }
    _verifiedNameCache = { set, at: now };
    return set;
  } catch (err) {
    console.error("getVerifiedEmployerNameSet failed:", err);
    return _verifiedNameCache?.set ?? new Set();
  }
}

/** True only if this employer name EXACTLY matches a published verified employer. */
export function isVerifiedFairChance(company: string, verified: Set<string>): boolean {
  const key = normalizeEmployerName(company);
  return key.length > 0 && verified.has(key);
}

export interface EmployerStats {
  total: number;
  published: number;
  byBoardFit: Record<string, number>;
}

export async function getEmployerStats(): Promise<EmployerStats> {
  const total = await getOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM employer`);
  const pub = await getOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM employer WHERE published = true`);
  const fits = await query<{ board_fit: string | null; n: string }>(
    `SELECT board_fit, COUNT(*)::text AS n FROM employer GROUP BY board_fit`
  );
  const byBoardFit: Record<string, number> = {};
  for (const f of fits) byBoardFit[f.board_fit || "(unset)"] = Number(f.n);
  return { total: Number(total?.n ?? 0), published: Number(pub?.n ?? 0), byBoardFit };
}

/** Upsert one employer (idempotent on source + source_record_id). */
export async function upsertEmployer(
  e: Partial<Employer> & { name: string; source?: string; source_record_id?: string | null; published?: boolean } & Record<string, unknown>
): Promise<void> {
  const cols = [
    "source", "source_record_id", "name", "employer_type", "industry", "primary_city",
    "county", "wi_region", "address", "phone", "email", "contact_person", "website",
    "careers_url", "linkedin", "role_types", "evidence_summary", "evidence_type", "caveats",
    "confidence_tier", "confidence_score", "rank", "board_fit", "publish_recommendation",
    "verification_status", "follow_up_priority", "suggested_outreach_ask", "tags", "status",
    "last_verified", "published",
  ];
  const vals = cols.map((c) => (e as Record<string, unknown>)[c] ?? (c === "source" ? "airtable" : c === "published" ? false : null));
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const updates = cols
    .filter((c) => c !== "source" && c !== "source_record_id")
    .map((c) => `${c} = EXCLUDED.${c}`)
    .concat("updated_at = now()")
    .join(", ");
  await query(
    `INSERT INTO employer (${cols.join(", ")}) VALUES (${placeholders.join(", ")})
     ON CONFLICT (source, source_record_id) DO UPDATE SET ${updates}`,
    vals
  );
}
