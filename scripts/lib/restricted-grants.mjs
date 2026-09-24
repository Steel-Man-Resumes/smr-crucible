/**
 * Tables the application role may NOT be given blanket access to.
 *
 * WHY THIS FILE EXISTS. Each migration that creates one of these revokes the
 * app role's write access -- inside `IF EXISTS (role smr_app)`. On a fresh
 * database (CI, a new Neon branch) the role does not exist yet when migrations
 * run, so that block is skipped; then rls-stage1 creates the role and runs
 * `GRANT ... ON ALL TABLES`, handing back everything the migrations meant to
 * withhold. CI was therefore testing a database where the app could forge the
 * audit trail, and production was not that database. (Found 2026-09-20 while
 * adding platform_admin; org_audit had been affected since it was created.)
 *
 * One list, applied after ANY blanket grant, and asserted by the isolation
 * suite so the CI database and production cannot disagree silently.
 */
export const APP_ROLE = "smr_app";

/** table -> the ONLY privileges the app role may hold on it. */
export const RESTRICTED_GRANTS = {
  org_audit: ["SELECT"],
  platform_admin: ["SELECT"],
  // Membership is created by smr_redeem_code and never edited. DELETE stays:
  // an org releasing its own pending invite's seat, under an org-scoped policy.
  access_code_redemption: ["SELECT", "DELETE"],
  // Sharing history and case notes are never deleted by the app; earlier
  // wordings of a note are written only by its trigger.
  sharing_grant: ["SELECT", "INSERT", "UPDATE"],
  sharing_request: ["SELECT", "INSERT", "UPDATE"],
  case_note: ["SELECT", "INSERT", "UPDATE"],
  case_note_version: ["SELECT"],
  org_capability_override: ["SELECT"],
  // Written only by smr_set_sharing_policy / smr_acknowledge_policy.
  org_sharing_policy_version: ["SELECT"],
  sharing_ack: ["SELECT"],
  // Finished or cancelled, never deleted.
  staff_task: ["SELECT", "INSERT", "UPDATE"],
  // Ended or corrected on the record; a check, once made, stands.
  outcome_record: ["SELECT", "INSERT", "UPDATE"],
  retention_check: ["SELECT", "INSERT"],
  staff_suggestion: ["SELECT", "INSERT", "UPDATE"],
  // Employer directory (061). Platform-admin tables: RLS decides who, and
  // nothing is ever deleted. The internal views run as the owner and see
  // through every policy, so the app holds nothing on them at all.
  directory_claim_policy: ["SELECT"],
  employer_org: ["SELECT", "INSERT", "UPDATE"],
  employer_alias: ["SELECT", "INSERT", "UPDATE"],
  employer_place: ["SELECT", "INSERT", "UPDATE"],
  employer_contact: ["SELECT", "INSERT", "UPDATE"],
  employer_relationship: ["SELECT", "INSERT", "UPDATE"],
  // A confirmation is a dated record of a fact; it is never edited.
  employer_relationship_confirmation: ["SELECT", "INSERT"],
  employer_evidence: ["SELECT", "INSERT", "UPDATE"],
  employer_signup: ["SELECT", "INSERT", "UPDATE"],
  employer_requirement: ["SELECT", "INSERT", "UPDATE"],
  employer_reply: ["SELECT", "INSERT", "UPDATE"],
  directory_proposal: ["SELECT", "INSERT", "UPDATE"],
  directory_import: ["SELECT"],
  directory_evidence_live: [],
  directory_place_evidence: [],
  employer_standing_v: [],
  directory_public_v: ["SELECT"],
  directory_public_evidence_v: ["SELECT"],
  directory_mark_v: ["SELECT"],
  directory_health_v: ["SELECT"],
};

/** The directory objects (061). Checked by EFFECTIVE privilege, not only direct grants. */
export const DIRECTORY_OBJECTS = [
  "directory_claim_policy", "employer_org", "employer_alias", "employer_place", "employer_contact",
  "employer_relationship", "employer_relationship_confirmation", "employer_evidence", "employer_signup",
  "employer_requirement", "employer_reply", "directory_proposal", "directory_import",
  "directory_evidence_live", "directory_place_evidence", "employer_standing_v",
  "directory_public_v", "directory_public_evidence_v", "directory_mark_v", "directory_health_v",
];

/**
 * Effective privileges (direct, PUBLIC and inherited) the app role holds on each
 * directory object, compared with RESTRICTED_GRANTS. Returns violations.
 * `run` takes SQL text and resolves to rows; any connection that can read the catalog.
 */
export async function checkEffectiveDirectoryGrants(run, role = APP_ROLE) {
  const problems = [];
  const PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
  for (const name of DIRECTORY_OBJECTS) {
    const allowed = RESTRICTED_GRANTS[name];
    if (!allowed) { problems.push(`${name} is missing from RESTRICTED_GRANTS`); continue; }
    const exists = await run(`SELECT to_regclass('public.${name}') IS NOT NULL AS ok`);
    if (!exists?.[0]?.ok) { problems.push(`${name} does not exist`); continue; }
    for (const p of PRIVS) {
      const [row] = await run(`SELECT has_table_privilege('${role}', 'public.${name}', '${p}') AS has`);
      if (row.has !== allowed.includes(p)) {
        problems.push(`${role} ${row.has ? "HOLDS" : "LACKS"} ${p} on ${name}; allowed: ${allowed.join(", ") || "nothing"}`);
      }
    }
  }
  return problems;
}

/** `run` takes SQL text and resolves to rows. Must be an owner connection. */
export async function applyRestrictedGrants(run, role = APP_ROLE) {
  for (const [table, allowed] of Object.entries(RESTRICTED_GRANTS)) {
    const exists = await run(`SELECT to_regclass('public.${table}') IS NOT NULL AS ok`);
    if (!exists?.[0]?.ok) continue;
    await run(`REVOKE ALL ON public.${table} FROM ${role}`);
    // An empty list means the app holds nothing on it at all.
    if (allowed.length) await run(`GRANT ${allowed.join(", ")} ON public.${table} TO ${role}`);
  }
}

/** Returns a list of human-readable violations; empty means the grants are right. */
export async function checkRestrictedGrants(run, role = APP_ROLE) {
  const problems = [];
  for (const [table, allowed] of Object.entries(RESTRICTED_GRANTS)) {
    const rows = await run(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = '${role}' AND table_schema = 'public' AND table_name = '${table}'`
    );
    const held = rows.map((r) => r.privilege_type).sort();
    const extra = held.filter((p) => !allowed.includes(p));
    const missing = allowed.filter((p) => !held.includes(p));
    if (extra.length) problems.push(`${role} holds ${extra.join(", ")} on ${table}; allowed: ${allowed.join(", ")}`);
    if (missing.length) problems.push(`${role} lacks ${missing.join(", ")} on ${table}`);
  }
  return problems;
}
