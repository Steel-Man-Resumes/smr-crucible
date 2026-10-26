/**
 * Is row-level security actually enforcing anything, for THIS connection?
 *
 * The defining danger of this whole layer is that it appears to work. Policies
 * can be written, applied and correct while enforcing nothing -- because the
 * connecting role can bypass them, or FORCE was never set, or a table was
 * simply missed -- with no error and a schema that reads like a secured one.
 * So this asks the database, as the application's own role, and reports only
 * signals: no rows, no names, no counts of real people.
 */
import { query, runPerOrg } from "./db";

/**
 * Every row-level-protected table. ONE list: scripts/lint-protected-tables.mjs
 * reads this array out of this file, so a table added here is linted the same
 * day. Keep it a plain string-literal array.
 */
export const RLS_PROTECTED_TABLES = [
  "org_staff",
  "client_staff_assignment",
  "org_audit",
  "access_code_redemption",
  "sharing_grant",
  "sharing_request",
  "case_note",
  "case_note_version",
  "org_sharing_policy_version",
  "sharing_ack",
  "staff_task",
  "outcome_record",
  "retention_check",
  "staff_suggestion",
  // staff invitations (100), org scope plus the invitee's own rows
  "org_staff_invite",
  // participant-owned, owner only
  "vault_document",
  "user_progress_event",
  "consumer_profile",
  "refinery_artifact",
  "job_application",
  // career lanes (074), owner only
  "career_lane",
  "lane_tool_intro",
  // practice record (076), owner only
  "practice_entry",
  // D11 (migration 080): saved record checks, owner only
  "record_check_saved",
  // Phase 5 R1 (migration 081): saved resume revisions, owner only
  "artifact_revision",
  "forge_writer_receipt",
  // Phase 5 R2 (migration 083): today's task on the person's lane, owner only
  "lane_focus",
  "ai_operation",
  "ai_tool_policy",
  "directory_publication_alias",
  "forge_package_delivery",
  "forge_package_email_sent",
  "progression_policy",
  "progression_account",
  "progression_grant",
  "progression_request",
  "tailor_batch_claim",
  // Refinery seats (migration 096)
  "refinery_access_policy",
  "refinery_seat_legacy",
  "org_seat_offer",
  "access_code_departure",
  // Organization brand (migration 099): members read, owner sets the logo
  "org_brand",
  // House L3b (migration 102): the activity log and placement corrections,
  // org-scoped and reach-scoped, written only by triggers
  "org_activity",
  "outcome_correction",
  // Staff t.ROY skill runs (migration 106): own runs, owner and org admins read all, reach-restricted
  "ai_skill_run",
  // Organization structure (migration 103): profile, units, unit staff, and
  // enrollments (reach-restricted per participant)
  "org_profile",
  "org_unit",
  "unit_member",
  "enrollment",
] as const;

export interface RlsHealth {
  ok: boolean;
  role: string;
  roleCanBypass: boolean;
  tables: Record<string, { enabled: boolean; forced: boolean; unscopedReadIsEmpty: boolean }>;
  /** Scoped to a demo org, membership and staff ARE visible: proves "empty" above is enforcement, not an empty table. */
  scopedReadSeesRows: boolean | null;
  /** The database's own clock. If this does not move between two calls, the answer is a cached one. */
  checkedAt: string;
  /** Newest applied migration. Says WHICH database this is, without naming a host. */
  latestMigration: string | null;
  /**
   * Can this connection create temporary objects? Migration 082 takes TEMP away
   * from the app (a planted temp type or function is how a definer function's
   * search_path gets hijacked). null when the check itself could not run.
   */
  appCanCreateTemp: boolean | null;
  problems: string[];
}

/**
 * The TEMP rule (review N6): once 082 is applied the app must not hold TEMP on
 * the database; before 082 (a fresh database) holding it is the default and
 * is not a problem. Pure, so it is unit tested.
 */
export function tempProblem(t: { canCreateTemp: boolean; migration082Applied: boolean }): string | null {
  return t.canCreateTemp && t.migration082Applied
    ? "the app role can create temporary objects (TEMP on the database), which migration 082 revoked: something granted it back"
    : null;
}

export async function getRlsHealth(): Promise<RlsHealth> {
  const problems: string[] = [];
  const [me] = await query<{ who: string; bypass: boolean }>(
    `SELECT current_user AS who, (rolbypassrls OR rolsuper) AS bypass FROM pg_roles WHERE rolname = current_user`
  );
  if (me?.bypass) problems.push(`connected as ${me.who}, which can bypass row-level security: every policy is inert`);

  const [stamp] = await query<{ at: string; latest: string | null }>(
    `SELECT now()::text AS at, (SELECT max(filename) FROM _migrations) AS latest`
  );

  let appCanCreateTemp: boolean | null = null;
  try {
    const [t] = await query<{ temp: boolean; m082: boolean }>(
      `SELECT has_database_privilege(current_user, current_database(), 'TEMP') AS temp,
              EXISTS (SELECT 1 FROM _migrations WHERE filename = '082_resource_app_view.sql') AS m082`
    );
    appCanCreateTemp = !!t?.temp;
    const p = tempProblem({ canCreateTemp: !!t?.temp, migration082Applied: !!t?.m082 });
    if (p) problems.push(p);
  } catch {
    problems.push("could not check whether the app role holds TEMP on the database");
  }

  const flags = await query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1::text[])`,
    [RLS_PROTECTED_TABLES as unknown as string[]]
  );
  const tables: RlsHealth["tables"] = {};
  for (const name of RLS_PROTECTED_TABLES) {
    const f = flags.find((r) => r.relname === name);
    // Deliberately unscoped: the whole point is that this must see nothing.
    // (The table name is interpolated from the constant above, never from input.)
    let n: number;
    if (name === 'directory_publication_alias') {
      // Only the narrow definer function may resolve approved aliases. The
      // application must not receive SELECT on the raw identity map at all.
      const [privilege] = await query<{ allowed: boolean }>(
        "SELECT has_table_privilege(current_user, $1, 'SELECT') AS allowed", [name]);
      n = privilege?.allowed === false ? 0 : 1;
      if (n) problems.push(`${name}: raw alias reads must be denied`);
    } else {
      [{ n }] = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${name}`);
    }
    tables[name] = { enabled: !!f?.relrowsecurity, forced: !!f?.relforcerowsecurity, unscopedReadIsEmpty: n === 0 };
    if (!f?.relrowsecurity) problems.push(`${name}: row-level security is not enabled`);
    else if (!f.relforcerowsecurity) problems.push(`${name}: not FORCED, so the table owner bypasses it`);
    if (n !== 0) problems.push(`${name}: an unscoped read returned rows`);
  }

  // Zero rows from an empty table proves nothing. A demo org is a maintained
  // fixture with known members and staff: scoped to it, they must be visible.
  let scopedReadSeesRows: boolean | null = null;
  const [demo] = await query<{ id: string }>(
    `SELECT id FROM access_code WHERE partner_name LIKE '%(Demo)' AND is_active ORDER BY created_at LIMIT 1`
  );
  if (demo) {
    const seen = await runPerOrg<{ members: number; staff: number }>(
      [demo.id],
      "",
      `SELECT (SELECT COUNT(*)::int FROM access_code_redemption WHERE access_code_id = $1) AS members,
              (SELECT COUNT(*)::int FROM org_staff WHERE access_code_id = $1) AS staff`,
      (id) => [id]
    );
    const row = seen.get(demo.id)?.[0];
    scopedReadSeesRows = !!row && row.members > 0 && row.staff > 0;
    if (!scopedReadSeesRows) problems.push("scoped to a demo org, its members or staff were NOT visible: scoped reads are broken");
  }

  return {
    ok: problems.length === 0,
    role: me?.who ?? "unknown",
    roleCanBypass: !!me?.bypass,
    tables,
    scopedReadSeesRows,
    checkedAt: stamp?.at ?? "",
    latestMigration: stamp?.latest ?? null,
    appCanCreateTemp,
    problems,
  };
}
