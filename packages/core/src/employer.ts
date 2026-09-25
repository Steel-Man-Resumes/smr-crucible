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

/**
 * With DIRECTORY_MARK_ENABLED, the employer list comes from the directory, so it
 * shows exactly the employers that carry the mark on listings: each place with a
 * current mark, or a live posting for one role, plus the quoted evidence, its
 * caveat and the date it was last confirmed. Nothing here is from the old table.
 */
/**
 * The honest caveat a job seeker should read, without the research log: drop
 * bracketed review notes and any sentence about how or when it was researched.
 */
export function publicCaveat(limitations: string | null | undefined): string | null {
  if (!limitations) return null;
  // A bracketed review note can hold a caveat a job seeker needs (a background-
  // check requirement); keep its text, minus the "who reviewed it:" label.
  const text = limitations.replace(/\[([^\]]*)\]/g, (_m, inner: string) => {
    const t = inner.replace(/^[^:]{0,60}\d{4}-\d{2}-\d{2}:\s*/, "").trim();
    return " " + (/[.!?]$/.test(t) ? t : t + ".");
  });
  const internal = /ledger|re-?verified|re-?check|prior|sweep|airtable|found_by|curated|\bCC\b|agent|this session|today|ban.the.box|fair.chance|individualized.assessment/i;
  const kept = text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x && !internal.test(x));
  return kept.length ? kept.join(" ") : null;
}

async function listDirectoryEmployers(opts: { limit?: number; industry?: string }): Promise<PublicEmployer[]> {
  const limit = Math.min(opts.limit ?? 100, 200);
  const params: unknown[] = [];
  let where = `WHERE (p.earns_mark OR p.standing = 'says_yes_for_roles')`;
  if (opts.industry) {
    params.push(opts.industry);
    where += ` AND p.industry = $${params.length}`;
  }
  const rows = await query<{
    place_id: string; canonical_name: string; industry: string | null; careers_url: string | null; website: string | null;
    city: string | null; county: string | null; state: string; standing: string; last_evidence_on: string | null;
    excerpt: string | null; limitations: string | null; role_titles: string | null;
  }>(
    `SELECT p.place_id, p.canonical_name, p.industry, p.careers_url, p.website, p.city, p.county, p.state, p.standing,
            p.last_evidence_on::text AS last_evidence_on,
            ev.excerpt, ev.limitations,
            (SELECT string_agg(DISTINCT r.role_title, '; ') FROM directory_public_evidence_v r
              WHERE r.org_id = p.org_id AND r.place_id = p.place_id AND r.claim_type = 'direct_role_signal') AS role_titles
       FROM directory_public_v p
       LEFT JOIN LATERAL (
         SELECT e.excerpt, e.limitations FROM directory_public_evidence_v e
          WHERE e.org_id = p.org_id AND (e.place_id = p.place_id OR e.place_id IS NULL) AND e.polarity = 'yes'
          ORDER BY e.observed_on DESC NULLS LAST LIMIT 1) ev ON true
       ${where}
      ORDER BY p.earns_mark DESC, p.state, p.canonical_name
      LIMIT ${limit}`,
    params
  );
  return rows.map((r) => ({
    id: r.place_id,
    name: r.canonical_name,
    industry: r.industry,
    location: [r.city ?? r.county, r.state].filter(Boolean).join(", ") || null,
    applyUrl: r.careers_url || r.website,
    roleTypes: r.standing === "says_yes_for_roles" ? r.role_titles : null,
    // Older records hold a researcher's summary, newer ones the employer's exact
    // words; we cannot tell them apart here, so neither is shown as a quote.
    whyGoodFit: r.excerpt ? `What we found: ${r.excerpt}` : null,
    caveats: publicCaveat(r.limitations),
    lastVerified: r.last_evidence_on,
  }));
}

/** Published employers for the board, ranked best-first. */
export async function listPublishedEmployers(opts: { limit?: number; industry?: string } = {}): Promise<PublicEmployer[]> {
  if (directoryMarkEnabled()) return listDirectoryEmployers(opts);
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
 * How long a cached mark list may still be served after the database starts
 * failing. Past this, no marks at all: a stale "yes" has a victim (the 9/23
 * advisory found the old fallback had no limit).
 */
export const MARK_MAX_STALE_MS = 60 * 60 * 1000;

/**
 * The set of normalized names of PUBLISHED verified employers -- the single source
 * of truth for fair-chance flags on live job listings (Codex 12). A listing is
 * flagged fair-chance ONLY when its employer name EXACTLY matches (normalized) a
 * verified employer in this set. Cached ~5 min; on a DB error the last set is
 * served for at most MARK_MAX_STALE_MS, then an empty set -- never a false badge.
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
    if (_verifiedNameCache && now - _verifiedNameCache.at < MARK_MAX_STALE_MS) return _verifiedNameCache.set;
    return new Set();
  }
}

/** True only if this employer name EXACTLY matches a published verified employer. */
export function isVerifiedFairChance(company: string, verified: Set<string>): boolean {
  const key = normalizeEmployerName(company);
  return key.length > 0 && verified.has(key);
}

// ─── The directory mark (migration 061), behind DIRECTORY_MARK_ENABLED ──────
//
// The directory's mark knows WHERE and, for a posting, WHAT ROLE. A yes at the
// Kalispell store is not a yes at the Missoula store, and a posting that
// welcomes records for line cooks says nothing about drivers. So a listing is
// marked only when its employer name matches exactly AND its place matches the
// mark's place AND, for a role mark, its title matches the role. When the
// listing does not say enough to be sure (no state, no city, a county-level
// mark we cannot place), there is no mark. Missing a mark is the safe failure.

export interface DirectoryMark {
  basis: "employer" | "role";
  roleFamily: string | null;
  roleTitle: string | null;
  placeKind: string;
  state: string;
  county: string | null;
  city: string | null;
}

/** What the job search holds: the old name set, or the directory's placed marks. */
export type EmployerMarks =
  | { source: "legacy"; names: Set<string> }
  | { source: "directory"; byKey: Map<string, DirectoryMark[]> };

export interface ListingPlace {
  city?: string | null;
  state?: string | null;
  title?: string | null;
}

export function directoryMarkEnabled(): boolean {
  return process.env.DIRECTORY_MARK_ENABLED === "true";
}

const STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

/** "MT", "mt", "Montana" -> "MT"; anything else -> null. */
export function toStateCode(state: string | null | undefined): string | null {
  const s = (state ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(s)) {
    const code = s.toUpperCase();
    return Object.values(STATE_CODES).includes(code) ? code : null;
  }
  return STATE_CODES[s.toLowerCase()] ?? null;
}

const words = (s: string | null | undefined) => normalizeEmployerName(s ?? "").split(" ").filter(Boolean);

function placeMatches(m: DirectoryMark, state: string, city: string | null): boolean {
  if (m.state !== state) return false;
  if (m.placeKind === "statewide") return true;
  if (m.placeKind === "site") {
    return Boolean(m.city && city && m.city.trim().toLowerCase() === city.trim().toLowerCase());
  }
  // county, service_area, remote: the listing does not carry enough to place it.
  return false;
}

/**
 * The job part of a recorded role title. Research records postings as they
 * appear ("Housekeeper, Billings", "Licensed Addiction Counselor job
 * description"), and requiring the city or the words "job description" in a
 * listing's title meant no role mark ever matched. The place is checked
 * separately, so only the job words count here.
 */
export function roleWords(roleTitle: string | null | undefined): string[] {
  const jobPart = (roleTitle ?? "").split(/[,|(]/)[0].replace(/\b(job )?(description|posting|opening)s?\b/gi, " ");
  return words(jobPart);
}

function roleMatches(m: DirectoryMark, title: string | null | undefined): boolean {
  if (m.basis === "employer") return true;
  const want = roleWords(m.roleTitle);
  if (want.length === 0) return false;
  const have = new Set(words(title));
  return want.every((w) => have.has(w));
}

/** The single decision for a listing's mark, whichever source is switched on. */
export function isMarked(company: string, where: ListingPlace, marks: EmployerMarks): boolean {
  const key = normalizeEmployerName(company);
  if (!key) return false;
  if (marks.source === "legacy") return marks.names.has(key);
  const entries = marks.byKey.get(key);
  if (!entries?.length) return false;
  const state = toStateCode(where.state);
  if (!state) return false;
  const city = where.city?.trim() || null;
  return entries.some((m) => placeMatches(m, state, city) && roleMatches(m, where.title));
}

let _directoryCache: { byKey: Map<string, DirectoryMark[]>; at: number } | null = null;

async function getDirectoryMarks(): Promise<Map<string, DirectoryMark[]>> {
  const now = Date.now();
  if (_directoryCache && now - _directoryCache.at < VERIFIED_NAME_TTL_MS) return _directoryCache.byKey;
  try {
    const rows = await query<{
      name_key: string; basis: "employer" | "role"; role_family: string | null; role_title: string | null;
      place_kind: string; state: string; county: string | null; city: string | null;
    }>(`SELECT name_key, basis, role_family, role_title, place_kind, state, county, city FROM directory_mark_v`);
    const byKey = new Map<string, DirectoryMark[]>();
    for (const r of rows) {
      const list = byKey.get(r.name_key) ?? [];
      list.push({ basis: r.basis, roleFamily: r.role_family, roleTitle: r.role_title, placeKind: r.place_kind,
                  state: r.state, county: r.county, city: r.city });
      byKey.set(r.name_key, list);
    }
    _directoryCache = { byKey, at: now };
    return byKey;
  } catch (err) {
    console.error("getDirectoryMarks failed:", err);
    if (_directoryCache && now - _directoryCache.at < MARK_MAX_STALE_MS) return _directoryCache.byKey;
    return new Map();
  }
}

/** The marks the job search uses: the directory when switched on, else the old table. */
export async function getEmployerMarks(): Promise<EmployerMarks> {
  if (directoryMarkEnabled()) return { source: "directory", byKey: await getDirectoryMarks() };
  return { source: "legacy", names: await getVerifiedEmployerNameSet() };
}

/** Test hook: forget cached marks. */
export function _resetMarkCaches(): void {
  _verifiedNameCache = null;
  _directoryCache = null;
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
