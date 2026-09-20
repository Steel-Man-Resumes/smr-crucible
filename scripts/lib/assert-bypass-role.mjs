/**
 * Seeds write org_staff and client_staff_assignment, which are row-level
 * protected. As a role that cannot bypass RLS, an unscoped INSERT is refused
 * and -- worse -- an upsert's follow-up SELECT reads back empty, so the script
 * prints a tidy summary of nothing. Every seed ASSUMED an owner connection;
 * since production's DATABASE_URL became smr_app, the assumption is one copied
 * env var away from false. Assert it instead.
 *
 * `run` is any function that takes SQL text and resolves to an array of rows,
 * so both the pg client and the neon driver can use this.
 */
export async function assertBypassRole(run, scriptName) {
  const rows = await run(
    "SELECT current_user AS who, rolbypassrls FROM pg_roles WHERE rolname = current_user"
  );
  const role = rows?.[0];
  if (!role?.rolbypassrls) {
    console.error(
      `\n${scriptName}: connected as "${role?.who}", which cannot bypass row-level security.\n` +
        `Seeding org_staff / client_staff_assignment would be refused or silently\n` +
        `read back empty. Use an owner connection (neondb_owner), not the app role.\n`
    );
    process.exit(2);
  }
  return role.who;
}
