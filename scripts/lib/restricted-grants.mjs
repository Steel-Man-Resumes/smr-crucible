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
  // Customization (104): a field definition is retired, never deleted.
  custom_field_def: ["SELECT", "INSERT", "UPDATE"],
  // Value history (104): append-only, written only by its trigger.
  custom_field_value_version: ["SELECT"],
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
  // Staff invitations (100). Never deleted; the guard trigger limits UPDATE to
  // resend and revoke, and only the definer function accepts or declines.
  org_staff_invite: ["SELECT", "INSERT", "UPDATE"],
  // House L3b (102). The activity log and every earlier value of a placement
  // are written only by SECURITY DEFINER triggers: the app reads, never writes.
  org_activity: ["SELECT"],
  outcome_correction: ["SELECT"],
  // Staff t.ROY skill runs (106): append-only; the only change is the
  // acceptance, by the person who ran it (a column grant, checked below).
  ai_skill_run: ["SELECT", "INSERT", "UPDATE (accepted_by, accepted_at)"],
  // House L3a (103). Units and enrollments are closed or ended, never
  // deleted; a profile is changed, never removed. Taking a staff member out
  // of a unit is a real delete (the activity log keeps it).
  org_profile: ["SELECT", "INSERT", "UPDATE"],
  org_unit: ["SELECT", "INSERT", "UPDATE"],
  unit_member: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  enrollment: ["SELECT", "INSERT", "UPDATE"],
  // House L5 (105). The org's contact record and referrals are kept, never
  // deleted; referral history is written only by its trigger. (staff_draft
  // is the author's own scratch: SELECT, INSERT, UPDATE, DELETE, owner-only RLS.)
  participant_contact: ["SELECT", "INSERT", "UPDATE"],
  referral: ["SELECT", "INSERT", "UPDATE"],
  referral_event: ["SELECT"],
  // Staff build S3 (108). A person's own view change log: written by them,
  // never edited but for the one "undone" mark (a column grant), never
  // deleted by the app.
  view_change_log: ["SELECT", "INSERT", "UPDATE (undone_at)"],
  // Staff pass S5 (110). A handoff is withdrawn, never deleted.
  staff_handoff: ["SELECT", "INSERT", "UPDATE"],
};

/**
 * Functions the app role MUST be able to execute (102 onward). Row policies on
 * notes, tasks, placements, check-ins, suggestions, asks and the activity log
 * call smr_staff_reach as the querying role: without EXECUTE every scoped read
 * of those tables fails with "permission denied for function". Migrations grant
 * these only when the role already exists, so a fresh database (where this
 * role is created afterwards) needs them granted here, like the table list.
 */
export const APP_FUNCTIONS = [
  "smr_staff_sees_all(uuid, uuid)",
  "smr_staff_unit_reach(uuid, uuid, uuid)",
  "smr_staff_reach(uuid, uuid, uuid)",
  "smr_correct_retention_check(uuid, text, text, text, text)",
  // House L3a (103): the structure and enrollment write policies call these.
  "smr_org_structure_manager(uuid, uuid)",
  "smr_enrollment_writer(uuid, uuid)",
  "smr_enrollment_assigner(uuid, uuid)",
  // 104: the manager check inside the custom field, view and layout policies.
  "smr_org_manager(uuid)",
  "smr_org_staff_session(uuid)",
  // 105: called as the app role by the referral guard, the contact guard and
  // its generated column, the referral path check and the draft save.
  "smr_phone_digits(text)",
  "smr_referral_next(text)",
  "smr_referral_consent(uuid, uuid)",
  "smr_only_gone_refs_cleared(jsonb, jsonb, text[], text[])",
  "smr_purge_stale_staff_drafts()",
  "smr_retention_task_marks()",
  // 110: the person takes a next step from a handoff (acts only for app.user_id).
  "smr_accept_handoff_step(uuid)",
];
/**
 * Functions the app role must NEVER execute: the activity log's only writer,
 * and the org-role lookup that answers for any organization (definer-only).
 */
export const APP_FORBIDDEN_FUNCTIONS = [
  "org_activity_write(uuid, uuid, uuid, text, text, text, text)",
  "smr_org_role(uuid, uuid)",
  // House L3a (103): the structure tables' activity writer.
  "smr_structure_activity(uuid, uuid, uuid, text, uuid, text, text)",
  // Answers "is this person a volunteer" for any org: definer-only.
  "smr_is_volunteer(uuid, uuid)",
  // 104: activity trigger functions (definer); fired by triggers, never called.
  "custom_field_activity()",
  "org_customization_activity()",
  "custom_field_value_keep_version()",
  // 105: the retention task maker and its owner rule run only from definer triggers.
  "smr_make_retention_tasks(uuid)",
  "smr_retention_task_owner(uuid, uuid, uuid)",
  // 108: trigger functions (the activity writer and the log guard are definer); fired, never called.
  "org_customization_policy_activity()",
  "view_change_log_guard()",
  // 110: activity triggers and the item guard (definer); fired by triggers, never called.
  "org_activity_suggestion()",
  "org_activity_handoff()",
  "staff_suggestion_item_guard()",
  "staff_handoff_close_items()",
  "staff_handoff_has_items()",
];

/** "UPDATE (a, b)" -> { privilege: "UPDATE", columns: ["a", "b"] }; a table privilege -> null. */
export function columnGrant(entry) {
  const m = /^([A-Z]+)\s*\(([^)]*)\)$/.exec(entry);
  return m ? { privilege: m[1], columns: m[2].split(",").map((c) => c.trim()).filter(Boolean) } : null;
}

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
  for (const fn of APP_FUNCTIONS) {
    const exists = await run(`SELECT to_regprocedure('public.${fn}') IS NOT NULL AS ok`);
    if (exists?.[0]?.ok) await run(`GRANT EXECUTE ON FUNCTION public.${fn} TO ${role}`);
  }
  for (const fn of APP_FORBIDDEN_FUNCTIONS) {
    const exists = await run(`SELECT to_regprocedure('public.${fn}') IS NOT NULL AS ok`);
    if (exists?.[0]?.ok) await run(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, ${role}`);
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
    const tableAllowed = allowed.filter((p) => !columnGrant(p));
    const extra = held.filter((p) => !tableAllowed.includes(p));
    const missing = tableAllowed.filter((p) => !held.includes(p));
    if (extra.length) problems.push(`${role} holds ${extra.join(", ")} on ${table}; allowed: ${allowed.join(", ")}`);
    if (missing.length) problems.push(`${role} lacks ${missing.join(", ")} on ${table}`);
    // Column grants (for example the acceptance columns of ai_skill_run): exactly these columns.
    const columnRows = await run(
      `SELECT privilege_type, column_name FROM information_schema.role_column_grants
        WHERE grantee = '${role}' AND table_schema = 'public' AND table_name = '${table}'`
    );
    const tablePrivs = new Set(held);
    const wantColumns = new Set(allowed.map(columnGrant).filter(Boolean).flatMap((g) => g.columns.map((c) => `${g.privilege}:${c}`)));
    // A table-level privilege shows up per column too; only column grants beyond the table's count.
    const heldColumns = new Set(columnRows.filter((r) => !tablePrivs.has(r.privilege_type)).map((r) => `${r.privilege_type}:${r.column_name}`));
    const extraCols = [...heldColumns].filter((c) => !wantColumns.has(c));
    const missingCols = [...wantColumns].filter((c) => !heldColumns.has(c));
    if (extraCols.length) problems.push(`${role} holds column privileges ${extraCols.join(", ")} on ${table}; allowed: ${allowed.join(", ")}`);
    if (missingCols.length) problems.push(`${role} lacks column privileges ${missingCols.join(", ")} on ${table}`);
  }
  for (const fn of APP_FUNCTIONS) {
    const [row] = await run(`SELECT to_regprocedure('public.${fn}') IS NOT NULL AS ok,
                                    CASE WHEN to_regprocedure('public.${fn}') IS NULL THEN NULL
                                         ELSE has_function_privilege('${role}', 'public.${fn}', 'EXECUTE') END AS can`);
    if (row?.ok && !row.can) problems.push(`${role} cannot execute ${fn}; every scoped read of a reach-protected table would fail`);
  }
  for (const fn of APP_FORBIDDEN_FUNCTIONS) {
    const [row] = await run(`SELECT to_regprocedure('public.${fn}') IS NOT NULL AS ok,
                                    CASE WHEN to_regprocedure('public.${fn}') IS NULL THEN NULL
                                         ELSE has_function_privilege('${role}', 'public.${fn}', 'EXECUTE') END AS can`);
    if (row?.ok && row.can) problems.push(`${role} can execute ${fn}, so it could forge the activity log`);
  }
  return problems;
}
