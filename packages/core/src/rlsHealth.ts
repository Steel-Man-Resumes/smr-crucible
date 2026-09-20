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
  problems: string[];
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
    const [{ n }] = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${name}`);
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
    problems,
  };
}
