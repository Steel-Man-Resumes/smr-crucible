/**
 * Staff search and the duplicate check (migration 105, lane L5).
 *
 * WHAT A SEARCH CAN MATCH is exactly what the person page would show, never
 * more: a name or email is searchable only where the client header would show
 * it (the account's own, with progress sharing on; otherwise what this
 * organization typed on the invite), plus the organization's own records about
 * the person (phone and other names in participant_contact, a program id on an
 * enrollment). Searching an account email of someone who shares nothing finds
 * nothing, so search is never an oracle for who has an account.
 *
 * Case-insensitive and forgiving: pg_trgm similarity when the database has it
 * (nameScoreSql), a contains and word-start match when it does not.
 * Reach-filtered in SQL: "mine" is my assigned people, "all" is everyone I may
 * see. Built to answer under 500 ms at 10,000 members (the pglite test times it).
 */
import { runScoped } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { scopeOf, run, reachParams, inReach, UUID_RE } from "./orgWorkflowSql";
import { normalizeSearch, phoneDigits, searchable, duplicateReasons, type DuplicateReason } from "./orgWorkflowShared";
import { query } from "./db";

const canSearch = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.client.view_content");

/** Escape LIKE wildcards in user text. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

/* ------------------------------------------ what this database has (asked, not assumed) -- */

export interface SearchEnv {
  /** Migration 103's enrollment table with a program participant id. */
  enrollment: boolean;
  /** The schema pg_trgm lives in, or null when the database does not have it. */
  trgm: string | null;
}
let envKnown: { at: number; env: SearchEnv } | null = null;
/** Asked once a minute: a later migration or extension may arrive while the app runs. */
export async function getSearchEnv(): Promise<SearchEnv> {
  if (envKnown && Date.now() - envKnown.at < 60_000) return envKnown.env;
  try {
    const [r] = await query<{ enrollment: boolean; trgm: string | null }>(
      `SELECT (to_regclass('public.enrollment') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_attribute
               WHERE attrelid = to_regclass('public.enrollment') AND attname = 'program_participant_id' AND NOT attisdropped)) AS enrollment,
              (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm') AS trgm`);
    envKnown = { at: Date.now(), env: { enrollment: !!r?.enrollment, trgm: r?.trgm && /^[a-z_][a-z0-9_]*$/.test(r.trgm) ? r.trgm : null } };
  } catch { envKnown = { at: Date.now(), env: { enrollment: false, trgm: null } }; }
  return envKnown.env;
}

/**
 * How well a lowercased name column matches the query, 0..1, as one inline
 * expression (no function call per row: that is what keeps 10,000 rows fast).
 * $q is the normalized query; $words the LIKE patterns, one per query word,
 * for "every word starts a word of the name".
 */
export function nameScoreSql(col: string, q: string, words: string, trgm: string | null): string {
  const prefix = `((' ' || ${col}) LIKE ALL (${words}))`;
  const fuzzy = trgm
    ? `GREATEST(${trgm}.similarity(${col}, ${q}), ${trgm}.word_similarity(${q}, ${col}))`
    : `0::real`;
  return `(CASE WHEN ${col} IS NULL THEN 0::real WHEN strpos(${col}, ${q}) > 0 THEN 1::real
               WHEN ${prefix} THEN GREATEST(0.8::real, ${fuzzy}) ELSE ${fuzzy} END)`;
}

/** The LIKE patterns for word starts: "dan whit" matches "% dan%" and "% whit%" against ' ' || name. */
export function wordPatterns(norm: string): string[] {
  return norm.split(" ").filter(Boolean).slice(0, 6).map((w) => `% ${likeEscape(w)}%`);
}

/**
 * The people of the org with what staff may match on. $1 org. The progress
 * view is joined once (it lists only this org's sharers), not per row, and
 * names are lowercased once per row.
 */
function whoCte(env: SearchEnv, members: string) {
  return `who AS MATERIALIZED (
    SELECT m.user_id,
           CASE WHEN pc.user_id IS NOT NULL THEN u.name  ELSE oi.invited_name  END AS name,
           CASE WHEN pc.user_id IS NOT NULL THEN lower(u.email) ELSE lower(oi.invited_email) END AS email,
           c.phone, c.phone_digits, c.aliases,
           ${env.enrollment ? "lower(en.program_ids)" : "NULL::text"} AS program_ids
      FROM ${members} m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN (SELECT spc.user_id FROM staff_progress_counts spc) pc ON pc.user_id = m.user_id
      LEFT JOIN org_invite oi ON oi.user_id = m.user_id AND oi.access_code_id = $1::uuid
      LEFT JOIN participant_contact c ON c.access_code_id = $1::uuid AND c.participant_user_id = m.user_id
      ${env.enrollment ? `LEFT JOIN (SELECT e.participant_user_id, string_agg(e.program_participant_id, ' ') AS program_ids FROM enrollment e
                  WHERE e.access_code_id = $1::uuid AND e.program_participant_id IS NOT NULL GROUP BY e.participant_user_id) en
             ON en.participant_user_id = m.user_id` : ""}
  )`;
}

/**
 * $1 org, $2 sees all, $3 actor, $4 normalized query, $5 LIKE-escaped query,
 * $6 phone digits ('' when too short), $7 'mine' | 'all', $8 limit, $9 word patterns.
 */
export function searchSql(env: SearchEnv): string {
  const name = nameScoreSql("lower(w.name)", "$4", "$9::text[]", env.trgm);
  const alias = nameScoreSql("lower(al)", "$4", "$9::text[]", env.trgm);
  return `WITH members AS (
      SELECT DISTINCT r.user_id FROM access_code_redemption r
       WHERE r.access_code_id = $1::uuid
         AND (($7::text = 'all' AND $2::boolean) OR EXISTS (SELECT 1 FROM client_staff_assignment ra
               WHERE ra.access_code_id = $1::uuid AND ra.client_user_id = r.user_id AND ra.staff_user_id = $3::uuid))
    ), ${whoCte(env, "members")},
    scored AS MATERIALIZED (
      SELECT w.user_id, w.name, w.email, w.phone,
             ${name} AS name_score,
             CASE WHEN cardinality(w.aliases) > 0 THEN (SELECT max(${alias}) FROM unnest(w.aliases) al) * 0.95 ELSE 0 END AS alias_score,
             CASE WHEN w.email = $4 THEN 1 WHEN w.email LIKE '%' || $5 || '%' ESCAPE '\\' THEN 0.9 ELSE 0 END AS email_score,
             CASE WHEN $6 <> '' AND w.phone_digits LIKE '%' || $6 || '%' THEN 0.9 ELSE 0 END AS phone_score,
             CASE WHEN w.program_ids LIKE '%' || $5 || '%' ESCAPE '\\' THEN 0.95 ELSE 0 END AS program_score
        FROM who w
    ), best AS (
      SELECT s.*, GREATEST(s.name_score, s.alias_score, s.email_score, s.phone_score, s.program_score) AS score FROM scored s
    )
    SELECT b.user_id, b.name, b.email, b.phone,
           CASE WHEN b.phone_score >= b.score THEN 'phone' WHEN b.program_score >= b.score THEN 'program_id'
                WHEN b.email_score >= b.score THEN 'email' WHEN b.name_score >= b.score THEN 'name' ELSE 'other_name' END AS matched_on,
           round(b.score::numeric, 3)::float AS score,
           EXISTS (SELECT 1 FROM client_staff_assignment ma WHERE ma.access_code_id = $1::uuid AND ma.client_user_id = b.user_id AND ma.staff_user_id = $3::uuid) AS mine
      FROM best b
     WHERE b.score >= 0.3
     ORDER BY b.score DESC, b.name NULLS LAST
     LIMIT $8::int`;
}

export interface SearchHit {
  user_id: string; name: string | null; email: string | null; phone: string | null;
  matched_on: "name" | "other_name" | "email" | "phone" | "program_id"; score: number; mine: boolean;
}

export async function searchParticipants(actor: OrgActor, q: string, opts: { scope?: "mine" | "all"; limit?: number } = {}): Promise<SearchHit[] | null> {
  if (!canSearch(actor)) return null;
  const norm = normalizeSearch(q);
  if (!searchable(norm)) return [];
  const digits = phoneDigits(norm);
  const scope = opts.scope === "mine" ? "mine" : "all";
  const limit = Math.max(1, Math.min(50, Math.floor(opts.limit ?? 20)));
  const env = await getSearchEnv();
  const [rows] = await runScoped<[SearchHit[]]>(scopeOf(actor), (sql) => [
    run(sql)(searchSql(env), [...reachParams(actor), norm, likeEscape(norm), digits.length >= 4 ? digits : "", scope, limit, wordPatterns(norm)]),
  ]);
  return rows;
}

/* -------------------------------------------------------------- duplicates -- */

/**
 * $1 org, $2 sees all, $3 actor, $4 normalized name, $5 normalized email,
 * $6 phone digits, $7 name word patterns. Everyone who belongs to or was
 * invited by the org, matched on what staff may see of them. Reach decides
 * only what is SAID about a match (see findPossibleDuplicates).
 */
export function duplicateSql(env: SearchEnv): string {
  return `WITH members AS (
      SELECT r.user_id FROM access_code_redemption r WHERE r.access_code_id = $1::uuid
      UNION SELECT oi0.user_id FROM org_invite oi0 WHERE oi0.access_code_id = $1::uuid
    ), ${whoCte(env, "members")},
    scored AS MATERIALIZED (
      SELECT w.*, ${nameScoreSql("lower(w.name)", "$4", "$7::text[]", env.trgm)} AS name_score FROM who w
    )
    SELECT s.user_id, s.name, s.email, s.phone_digits, s.name_score::float AS name_score, ${inReach("s.user_id")} AS in_reach
      FROM scored s
     WHERE ($5 <> '' AND s.email = $5)
        OR ($6 <> '' AND s.phone_digits = $6)
        OR ($4 <> '' AND (lower(regexp_replace(btrim(s.name), '\\s+', ' ', 'g')) = $4 OR (strpos($4, ' ') > 0 AND s.name_score >= 0.6)))
     LIMIT 25`;
}

/** What may be counted about a match the staff member does not work with. */
export function outsideReachReasons(reasons: DuplicateReason[]): DuplicateReason[] {
  return reasons.filter((r) => r === "email" || r === "phone");
}

export interface DuplicateMatch { userId: string; name: string | null; reasons: DuplicateReason[] }
export interface DuplicateReport {
  /** People this staff member works with: named, with a link. */
  matches: DuplicateMatch[];
  /** People they do not work with: counted by reason, never named. */
  othersByReason: Partial<Record<DuplicateReason, number>>;
}

/**
 * Before adding or inviting someone: does the organization already have them?
 * A match outside the staff member's reach is counted, never named, so the
 * warning cannot be used to look people up.
 */
export async function findPossibleDuplicates(actor: OrgActor, input: { name?: string | null; email?: string | null; phone?: string | null }): Promise<DuplicateReport | null> {
  if (actor.viaPlatformAdmin || !(actor.capabilities.has("org.participant.invite") || actor.capabilities.has("org.client.view_content"))) return null;
  const name = normalizeSearch(input.name ?? "");
  const email = normalizeSearch(input.email ?? "");
  const digits = phoneDigits(input.phone ?? "");
  const out: DuplicateReport = { matches: [], othersByReason: {} };
  if (!name && !email && digits.length < 7) return out;
  const env = await getSearchEnv();
  type Row = { user_id: string; name: string | null; email: string | null; phone_digits: string | null; name_score: number; in_reach: boolean };
  const [rows] = await runScoped<[Row[]]>(scopeOf(actor), (sql) => [
    run(sql)(duplicateSql(env), [...reachParams(actor), name, email.includes("@") ? email : "", digits.length >= 7 ? digits : "", wordPatterns(name)]),
  ]);
  for (const r of rows) {
    const reasons = duplicateReasons({ name: r.name, email: r.email, phoneDigits: r.phone_digits, nameScore: Number(r.name_score) || 0 }, { name, email, phone: digits });
    if (!reasons.length) continue;
    if (r.in_reach) { out.matches.push({ userId: r.user_id, name: r.name, reasons }); continue; }
    // Outside reach (S6): only an exact email or phone is counted, never a
    // name, so the warning cannot be used to test whether a name is here.
    for (const why of outsideReachReasons(reasons)) out.othersByReason[why] = (out.othersByReason[why] ?? 0) + 1;
  }
  return out;
}

/* -------------------------------------------------- phone and other names -- */

export interface ParticipantContact { phone: string | null; aliases: string[]; updated_at: string | null; updated_by_name: string | null }

export async function getParticipantContact(actor: OrgActor, clientId: string): Promise<ParticipantContact | null> {
  if (!canSearch(actor) || !UUID_RE.test(clientId)) return null;
  const [gate, rows] = await runScoped<[{ ok: boolean }[], ParticipantContact[]]>(scopeOf(actor), (sql) => [
    run(sql)(`SELECT ${inReach("$4::uuid")} AS ok`, [...reachParams(actor), clientId]),
    run(sql)(`SELECT c.phone, c.aliases, c.updated_at, u.name AS updated_by_name FROM participant_contact c LEFT JOIN users u ON u.id = c.updated_by
               WHERE c.access_code_id = $1::uuid AND c.participant_user_id = $4::uuid AND ${inReach("$4::uuid")}`, [...reachParams(actor), clientId]),
  ]);
  if (!gate[0]?.ok) return null;
  return rows[0] ?? { phone: null, aliases: [], updated_at: null, updated_by_name: null };
}

/** Clean what staff typed: up to 5 other names, each 1 to 120 characters, no repeats. */
export function cleanAliases(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n]/) : [];
  const out: string[] = [];
  for (const raw of list) {
    const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length === 5) break;
  }
  return out;
}

export async function setParticipantContact(actor: OrgActor, clientId: string, input: { phone?: string | null; aliases?: unknown }):
  Promise<{ ok: true } | { ok: false; error: string }> {
  if (actor.viaPlatformAdmin || !actor.capabilities.has("org.note.write")) return { ok: false, error: "You do not have access to that." };
  if (!UUID_RE.test(clientId)) return { ok: false, error: "That person is not on your caseload." };
  const phone = (input.phone ?? "").trim() || null;
  if (phone && (phone.length > 40 || phoneDigits(phone).length < 7)) return { ok: false, error: "That does not look like a phone number." };
  const aliases = cleanAliases(input.aliases);
  try {
    const [rows] = await runScoped<[{ ok: number }[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `INSERT INTO participant_contact (access_code_id, participant_user_id, phone, aliases)
         SELECT $1::uuid, $4::uuid, $5, $6::text[] WHERE ${inReach("$4::uuid")}
         ON CONFLICT (access_code_id, participant_user_id) DO UPDATE SET phone = EXCLUDED.phone, aliases = EXCLUDED.aliases
         RETURNING 1 AS ok`,
        [...reachParams(actor), clientId, phone, aliases]
      ),
    ]);
    return rows[0] ? { ok: true } : { ok: false, error: "That person is not on your caseload." };
  } catch { return { ok: false, error: "That did not save." }; }
}
