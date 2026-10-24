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
  // Tier 3 (071). An activity is a dated record of a fact; it is never edited.
  employer_working_agreement: ["SELECT", "INSERT", "UPDATE"],
  employer_agreement_activity: ["SELECT", "INSERT"],
  directory_tier_v: [],
  // D11 record check (080). Owner-only saved checks: never edited, so no
  // UPDATE; deleted by the owner, by revoking the yes, or by delete-my-data.
  record_check_saved: ["SELECT", "INSERT", "DELETE"],
  // Local resource directory (072). Platform-admin tables, admin RLS, nothing is
  // deleted. The app reads only the two public views, which show a row only when
  // its newest check is PASS, fresh, unchanged, and not low confidence or dataset-only.
  resource_area: [],
  resource_org: [],
  resource_service: [],
  resource_check: [],
  resource_contact: [],
  resource_suppression: [],
  resource_chain: [],
  resource_chain_step: [],
  resource_chain_step_review: [],
  resource_chain_step_dep: [],
  resource_public_v: ["SELECT"],
  resource_chain_public_v: ["SELECT"],
  resource_recheck_queue_v: [],
  resource_chain_recheck_queue_v: [],
  // Verification tiers (073). Admin-only; the app role holds nothing.
  resource_corroboration: [],
  resource_chain_step_corroboration: [],
  resource_relationship: [],
  resource_relationship_event: [],
  resource_corroboration_void: [],
  resource_relationship_event_void: [],
  resource_service_tier_v: [],
  resource_chain_tier_v: [],
  // 088: curated directory allowlist, owner-written, read only by the tier view.
  resource_directory_publisher: [],
  // The app's one read of the directory (082): approved, fresh, active services,
  // public fields only. Built on resource_public_v; no base table is granted.
  resource_app_v: ["SELECT"],
  // Delivery leases and cost records need UPDATE after blanket grants too.
  forge_package_delivery: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  forge_package_email_sent: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  ai_operation: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  ai_tool_policy: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  directory_publication_alias: [],
  employer_publication_v: ["SELECT"],
  resource_publication_v: ["SELECT"],
  resource_chain_publication_v: ["SELECT"],
  // 089: layered bands (A checked / B listed / C found) over the same publication; read only.
  resource_band_publication_v: ["SELECT"],
  resource_chain_band_publication_v: ["SELECT"],
  // 090: the employer ledger in two bands (A the mark, B reported); read only.
  employer_band_publication_v: ["SELECT"],
  // Phase 5 R1 (081). Saved resume revisions, owner only: never edited (a
  // change is a new revision), so no UPDATE; deleted by delete-my-data.
  artifact_revision: ["SELECT", "INSERT", "DELETE"],
  // 081: the newest writer's receipt nonce per run, owner only (moves forward
  // by UPDATE; deleted by delete-my-data).
  forge_writer_receipt: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  // Refinery seats (096). The policy row is updated by admins, never inserted
  // or deleted from the app; grandfather rows are written by the close action
  // and removed by an admin; offers are written by organizations and answered
  // only through definer functions; departures only by definer functions.
  refinery_access_policy: ["SELECT", "UPDATE"],
  refinery_seat_legacy: ["SELECT", "INSERT", "DELETE"],
  org_seat_offer: ["SELECT", "INSERT"],
  access_code_departure: ["SELECT"],
};

/** The directory objects (061). Checked by EFFECTIVE privilege, not only direct grants. */
export const DIRECTORY_OBJECTS = [
  "directory_claim_policy", "employer_org", "employer_alias", "employer_place", "employer_contact",
  "employer_relationship", "employer_relationship_confirmation", "employer_evidence", "employer_signup",
  "employer_requirement", "employer_reply", "directory_proposal", "directory_import",
  "directory_evidence_live", "directory_place_evidence", "employer_standing_v",
  "directory_public_v", "directory_public_evidence_v", "directory_mark_v", "directory_health_v",
  "employer_working_agreement", "employer_agreement_activity", "directory_tier_v",
  "resource_area", "resource_org", "resource_service", "resource_check", "resource_contact",
  "resource_suppression", "resource_chain", "resource_chain_step", "resource_chain_step_review",
  "resource_chain_step_dep", "resource_public_v", "resource_chain_public_v", "resource_recheck_queue_v",
  "resource_chain_recheck_queue_v",
  "resource_corroboration", "resource_chain_step_corroboration", "resource_relationship", "resource_relationship_event", "resource_corroboration_void", "resource_relationship_event_void", "resource_service_tier_v", "resource_chain_tier_v", "resource_directory_publisher",
  "resource_app_v", "directory_publication_alias", "employer_publication_v", "resource_publication_v", "resource_chain_publication_v",
  "resource_band_publication_v", "resource_chain_band_publication_v", "employer_band_publication_v",
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
