/**
 * House build 2026-10-26, lane L1 (migration 100): staff invitations with a
 * lifecycle, and the organization lifecycle (close, reopen, rename, delete
 * only when empty). The pure rules, and the SQL each path runs, read as text.
 * The database behaviour is proved in apps/consumer/lib/__tests__/
 * org-lifecycle-pglite.test.ts and scripts/verify-org-isolation.mjs.
 * Fictional addresses only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  staffInviteStatus,
  staffInviteIsOpen,
  isUndeliverableEmail,
  validateStaffInviteInput,
  inviteDeniesFor,
  STAFF_INVITE_STATUS_WORDS,
  STAFF_INVITE_TTL_DAYS,
  STAFF_PLACES_SQL,
  STAFF_INVITE_LIST_SQL,
  ANSWER_WORDS,
  orgFacingInvite,
  UNDELIVERABLE_LINE,
} from "../staffInvites";
import {
  validateOrgName,
  validateCloseReason,
  describeOrgHistory,
  CLOSED_MEANS,
  DELETE_MEANS,
} from "../orgAdmin";
import { STAFF_PRESETS, capabilitiesForRole } from "../authz/capabilities";
import { RLS_PROTECTED_TABLES } from "../rlsHealth";

const SRC = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const MIGRATION = readFileSync(new URL("../../migrations/100_org_lifecycle_invites.sql", import.meta.url), "utf8");
const NOW = new Date("2026-10-26T12:00:00Z");
const base = { path: "existing_account" as const, sendCount: 1, expiresAt: "2026-11-09T12:00:00Z", acceptedAt: null, declinedAt: null, revokedAt: null };

describe("staff invitation status", () => {
  it("is derived from the stamps, endings first", () => {
    assert.equal(staffInviteStatus({ ...base, revokedAt: "2026-10-25" }, NOW), "revoked");
    assert.equal(staffInviteStatus({ ...base, declinedAt: "2026-10-25" }, NOW), "declined");
    assert.equal(staffInviteStatus({ ...base, acceptedAt: "2026-10-25" }, NOW), "accepted");
    assert.equal(staffInviteStatus({ ...base, expiresAt: "2026-10-26T11:59:59Z" }, NOW), "expired");
    assert.equal(staffInviteStatus(base, NOW), "sent");
    assert.equal(staffInviteStatus({ ...base, sendCount: 0 }, NOW), "pending");
  });
  it("every path is accepted only by saying yes; status never depends on whether an account existed (B1, B2)", () => {
    for (const path of ["new_account", "existing_account"] as const) {
      assert.equal(staffInviteStatus({ ...base, path }, NOW), "sent", path);
      assert.equal(staffInviteStatus({ ...base, path, acceptedAt: "2026-10-25" }, NOW), "accepted", path);
    }
  });
  it("the organization-facing invitation has no path and no account id, and is identical for both paths", () => {
    const rec = {
      id: "i", email: "a@agency.org", name: "A", role: "staff" as const, title: null, addedBySupport: false, volunteer: false,
      invitedAt: "t", invitedByName: null, sendCount: 1, lastSentAt: "t", expiresAt: "t", status: "sent" as const, statusWords: "Sent, waiting for them",
      undeliverable: false, canResend: true, canRevoke: true,
    };
    const fromNew = orgFacingInvite({ ...rec, userId: "u1", path: "new_account", invitedBy: "x" } as never);
    const fromExisting = orgFacingInvite({ ...rec, userId: "u2", path: "existing_account", invitedBy: "y" } as never);
    assert.equal(JSON.stringify(fromNew), JSON.stringify(fromExisting));
    for (const k of ["path", "userId", "invitedBy", "inviterCanInvite"]) assert.ok(!(k in fromNew), k);
  });
  it("only open ones (pending, sent, expired) can be resent or revoked", () => {
    assert.deepEqual((["pending", "sent", "expired", "accepted", "declined", "revoked"] as const).map(staffInviteIsOpen), [true, true, true, false, false, false]);
  });
  it("has plain words for every status and invitations last 14 days", () => {
    assert.equal(STAFF_INVITE_TTL_DAYS, 14);
    for (const w of Object.values(STAFF_INVITE_STATUS_WORDS)) assert.match(w, /^[A-Z][a-z ,]+$/);
  });
});

describe("addresses that cannot receive email", () => {
  it("reserved test domains are never sent to", () => {
    for (const e of ["a@b.invalid", "x@demo.example.invalid", "q@site.test", "q@example.com", "q@mail.example.org", "q@host.localhost", "q@thing.example", "nope", "a@b"]) {
      assert.equal(isUndeliverableEmail(e), true, e);
    }
    for (const e of ["someone@gmail.com", "case.manager@agency.org", "a+tag@mail.co"]) assert.equal(isUndeliverableEmail(e), false, e);
  });
  it("the screen line says nothing was sent and points at the sign-up link", () => {
    assert.match(UNDELIVERABLE_LINE, /cannot receive email/);
    assert.match(UNDELIVERABLE_LINE, /sign-up link instead/);
  });
});

describe("invitation input", () => {
  it("normalizes, and a preset is staff with its own title", () => {
    const v = validateStaffInviteInput({ name: "  Lupe   Marin ", email: " Lupe@Agency.ORG ", role: "volunteer" });
    assert.deepEqual(v, { ok: true, value: { name: "Lupe Marin", email: "lupe@agency.org", role: "staff", preset: "volunteer", title: STAFF_PRESETS.volunteer.label } });
    assert.equal(validateStaffInviteInput({ name: "A", email: "a@agency.org", role: "org_admin" }).ok, true);
  });
  it("refuses a missing name, a bad email, an unknown role and a long title", () => {
    assert.equal(validateStaffInviteInput({ name: "", email: "a@agency.org" }).ok, false);
    assert.equal(validateStaffInviteInput({ name: "A", email: "not-an-email" }).ok, false);
    assert.equal(validateStaffInviteInput({ name: "A", email: "a@agency.org", role: "owner" }).ok, false);
    assert.equal(validateStaffInviteInput({ name: "A", email: "a@agency.org", title: "x".repeat(121) }).ok, false);
  });
  it("a volunteer invitation stores only restrictions the staff role would otherwise give", () => {
    const denies = inviteDeniesFor("volunteer");
    const staff = new Set(capabilitiesForRole("staff"));
    assert.ok(denies.length > 0);
    for (const c of denies) assert.ok(staff.has(c as never), c);
    assert.ok(denies.includes("org.participant.invite") && denies.includes("org.outcome.write"));
    assert.deepEqual(inviteDeniesFor(null), []);
  });
});

describe("the owner path no longer dead-ends on an existing account", () => {
  const access = SRC("orgAccess.ts");
  it("the old refusal is gone", () => {
    assert.doesNotMatch(access, /contact us and we will help/);
  });
  it("an existing account gets an invitation it accepts; a new address gets an account; both answer alike", () => {
    const fn = access.slice(access.indexOf("export async function inviteOrgStaff"), access.indexOf("export async function applyStaffPreset"));
    assert.match(fn, /inviteExistingAccount\(scope/);
    assert.match(fn, /createNewAccountInvite\(scope/);
    // The cap refusal is the same words on both paths.
    assert.equal((fn.match(/staffCapReason\(places\.n, places\.max\)/g) ?? []).length, 2);
  });
  it("B2: a new address gets no staff row and no capability writes at invite time; acceptance writes them", () => {
    const inv = SRC("staffInvites.ts");
    const fn = inv.slice(inv.indexOf("export async function createNewAccountInvite"), inv.indexOf("/** The scope a resolved actor writes under. */"));
    assert.doesNotMatch(fn, /INSERT INTO org_staff \(|smr_set_capability_override/);
    assert.match(fn, /'new_account', 0/);
    assert.match(fn, /inviteDeniesFor\(input\.preset\)/, "volunteer restrictions are stored on the invitation, applied at accept");
    assert.match(inv, /WHERE i\.user_id = \$1::uuid AND i\.path IN \('new_account', 'existing_account'\)/, "both paths answer on /dashboard/invites");
  });
  it("B1: staff places count every open invitation the same way, new address or existing account", () => {
    assert.match(STAFF_PLACES_SQL, /FROM org_staff WHERE access_code_id = \$1::uuid/);
    assert.match(STAFF_PLACES_SQL, /i\.path IN \('new_account', 'existing_account'\)[\s\S]*expires_at > now\(\)/);
  });
  it("B1: pressing Send again renews the one open invitation and keeps its real path for the email", () => {
    const inv = SRC("staffInvites.ts");
    assert.match(inv, /SELECT id, path FROM org_staff_invite WHERE access_code_id = \$1::uuid AND user_id = \$2::uuid/);
    assert.match(inv, /path: open\[0\]\.path, undeliverable: isUndeliverableEmail\(input\.email\), renewed: true/);
  });
  it("the list reads through the org scope only", () => {
    assert.match(STAFF_INVITE_LIST_SQL, /WHERE i\.access_code_id = \$1::uuid/);
    assert.doesNotMatch(STAFF_INVITE_LIST_SQL, /invited_by = |user_id = \$/);
  });
  it("revoke closes the invitation only; an admin's invitation needs the owner, or a platform admin on the admin route", () => {
    const inv = SRC("staffInvites.ts");
    const fn = inv.slice(inv.indexOf("export async function revokeStaffInvite"), inv.indexOf("export interface StaffInviteSend"));
    assert.match(fn, /UPDATE org_staff_invite SET revoked_at = now\(\)/);
    assert.doesNotMatch(fn, /DELETE FROM org_staff/);
    assert.match(fn, /actorMayActOnAdminInvite\(scope\.orgId, scope\.userId, caller\.platformAdmin\)/);
    assert.match(inv, /OR \(\$3::boolean AND EXISTS \(SELECT 1 FROM platform_admin pa/);
  });
  it("a resend whose original inviter can no longer invite makes the resender the inviter of record", () => {
    const inv = SRC("staffInvites.ts");
    const fn = inv.slice(inv.indexOf("export async function prepareStaffInviteResend"));
    assert.match(fn, /if \(!inv\.inviterCanInvite && inv\.invitedBy !== scope\.userId\)[\s\S]*SET invited_by = \$3::uuid/);
    assert.match(fn, /Only the owner can resend an admin's invitation/);
    assert.match(MIGRATION, /the inviter of record can only become the person acting/);
  });
  it("every database answer has words", () => {
    for (const r of ["ok", "declined", "not_found", "revoked", "answered", "expired", "closed", "inviter_gone", "full", "refused"]) {
      assert.ok(ANSWER_WORDS[r] && !/—/.test(ANSWER_WORDS[r]), r);
      assert.match(MIGRATION, new RegExp(`RETURN '${r}'`), `the function returns ${r}`);
    }
  });
});

describe("organization lifecycle", () => {
  it("names and close reasons are bounded, and a reason is required", () => {
    assert.deepEqual(validateOrgName("  Southside   Bridge  "), { ok: true, value: "Southside Bridge" });
    assert.equal(validateOrgName("x").ok, false);
    assert.equal(validateCloseReason("").ok, false);
    assert.equal(validateCloseReason("ok").ok, false);
    assert.equal(validateCloseReason("Program ended in September").ok, true);
    assert.equal(validateCloseReason("x".repeat(501)).ok, false);
  });
  it("says plainly what closing means and when delete is allowed", () => {
    assert.match(CLOSED_MEANS, /Members keep their accounts/);
    assert.match(CLOSED_MEANS, /Staff lose the workspace for this organization/);
    assert.match(CLOSED_MEANS, /history stay/);
    assert.match(CLOSED_MEANS, /reopen/);
    assert.match(DELETE_MEANS, /nobody ever joined, no staff, no invitations, no notes, tasks, outcomes or other history/);
    for (const t of [CLOSED_MEANS, DELETE_MEANS]) assert.doesNotMatch(t, /—|--/);
  });
  it("describes history in one plain sentence", () => {
    assert.equal(describeOrgHistory({}), "");
    assert.equal(describeOrgHistory({ access_code_redemption: 1 }), "1 member");
    assert.equal(describeOrgHistory({ access_code_redemption: 3, org_staff: 1, audited_changes: 12 }), "3 members, 1 staff member and 12 recorded changes");
    assert.equal(describeOrgHistory({ some_new_table: 2 }), "2 some new table rows");
  });
  it("close, reopen and rename write access_code as the admin, and only change what they say", () => {
    const admin = SRC("orgAdmin.ts");
    assert.match(admin, /SET is_active = false, close_reason = \$2, closed_by = \$3::uuid, closed_at = now\(\)[\s\S]*WHERE id = \$1::uuid AND is_active = true/);
    assert.match(admin, /SET is_active = true, updated_at = now\(\)\s*WHERE id = \$1::uuid AND is_active = false/);
    assert.match(admin, /SET partner_name = \$2, updated_at = now\(\) WHERE id = \$1::uuid/);
    assert.match(admin, /smr_admin_delete_org\(\$1::uuid, \$2\)/);
  });
});

describe("migration 100 follows the house pattern", () => {
  it("has its header, guards and an idempotent shape", () => {
    assert.match(MIGRATION, /^-- 100_org_lifecycle_invites\.sql\n/);
    assert.match(MIGRATION, /rolbypassrls OR rolsuper/);
    assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS closed_at/);
    assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users\(id\) ON DELETE SET NULL/);
    assert.match(MIGRATION, /ADD COLUMN IF NOT EXISTS close_reason TEXT/);
    assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS org_staff_invite/);
    for (const p of ["org_staff_invite_select", "org_staff_invite_insert", "org_staff_invite_update"]) {
      assert.match(MIGRATION, new RegExp(`DROP POLICY IF EXISTS ${p} ON org_staff_invite;\\nCREATE POLICY ${p}`));
    }
  });
  it("RLS is enabled AND forced, scoped by app.org_id, with the invitee's own rows readable", () => {
    assert.match(MIGRATION, /ALTER TABLE org_staff_invite ENABLE ROW LEVEL SECURITY;\nALTER TABLE org_staff_invite FORCE ROW LEVEL SECURITY;/);
    assert.match(MIGRATION, /FOR SELECT USING \(\s*access_code_id = NULLIF\(current_setting\('app\.org_id', true\), ''\)::uuid\s*OR user_id = NULLIF\(current_setting\('app\.user_id', true\), ''\)::uuid\)/);
    assert.match(MIGRATION, /FOR INSERT\s*WITH CHECK \(access_code_id = NULLIF\(current_setting\('app\.org_id', true\), ''\)::uuid\)/);
    assert.ok(RLS_PROTECTED_TABLES.includes("org_staff_invite" as never));
  });
  it("revokes before granting, never DELETE, and the guard (not column grants) keeps the rest fixed", () => {
    const grants = MIGRATION.slice(MIGRATION.indexOf("REVOKE ALL ON org_staff_invite FROM smr_app;"));
    assert.ok(grants.indexOf("REVOKE ALL ON org_staff_invite FROM smr_app;") < grants.indexOf("GRANT SELECT, INSERT, UPDATE ON org_staff_invite TO smr_app;"));
    assert.match(MIGRATION, /an invitation''s person, organization, role and origin cannot change/);
    assert.match(MIGRATION, /only the invited person answers an invitation/);
    assert.doesNotMatch(MIGRATION, /GRANT [^;]*DELETE[^;]*org_staff_invite/);
    for (const f of ["smr_answer_staff_invite(uuid, boolean)", "smr_admin_org_history(uuid)", "smr_admin_delete_org(uuid, text)"]) {
      assert.ok(MIGRATION.includes(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC;`), f);
    }
  });
  it("the definer functions pin search_path and take the person from app.user_id", () => {
    for (const fn of ["smr_answer_staff_invite", "smr_admin_org_history", "smr_admin_delete_org", "org_staff_invite_audit", "access_code_lifecycle_audit"]) {
      const at = MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      assert.ok(at > 0, fn);
      assert.match(MIGRATION.slice(at, at + 400), /SECURITY DEFINER SET search_path = pg_catalog, public/, fn);
    }
    const answer = MIGRATION.slice(MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.smr_answer_staff_invite("));
    assert.match(answer, /v_user uuid := NULLIF\(current_setting\('app\.user_id', true\), ''\)::uuid/);
    assert.match(answer, /i\.user_id <> v_user THEN RETURN 'not_found'/);
  });
  it("the guard clears revoked_by unless the invitation is being revoked", () => {
    assert.match(MIGRATION, /NEW\.revoked_by := v_actor;\n  ELSE\n    NEW\.revoked_by := NULL;/);
  });
  it("history also counts usage keyed by the code and the activity log when it exists", () => {
    assert.match(MIGRATION, /to_regclass\('public\.partner_usage_event'\) IS NOT NULL/);
    assert.match(MIGRATION, /WHERE e\.code = \(SELECT ac\.code FROM public\.access_code ac WHERE ac\.id = \$1\)/);
    assert.match(MIGRATION, /to_regclass\('public\.org_activity'\) IS NOT NULL/);
  });
  it("delete counts every foreign key to access_code from the catalog, and locks the row first", () => {
    assert.match(MIGRATION, /c\.contype = 'f' AND c\.confrelid = 'public\.access_code'::regclass/);
    assert.match(MIGRATION, /table_name NOT IN \('access_code', 'org_brand'\)/);
    const del = MIGRATION.slice(MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.smr_admin_delete_org("));
    assert.ok(del.indexOf("FOR UPDATE") < del.indexOf("smr_admin_org_history(p_org)"));
    assert.ok(del.indexOf("RETURN 'has_history'") < del.indexOf("DELETE FROM public.access_code"));
  });
  it("the audit never carries an address, a typed name or the close reason text", () => {
    const audit = MIGRATION.slice(MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.org_staff_invite_audit("), MIGRATION.indexOf("DROP TRIGGER IF EXISTS org_staff_invite_audit"));
    assert.doesNotMatch(audit, /invited_email|invited_name/);
    const life = MIGRATION.slice(MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.access_code_lifecycle_audit("), MIGRATION.indexOf("DROP TRIGGER IF EXISTS access_code_lifecycle_audit"));
    assert.match(life, /'reason_given'/);
    assert.doesNotMatch(life, /'close_reason', NEW\.close_reason/);
  });
  it("an invitation can only restrict: denies must be delegable, and an admin role needs the owner", () => {
    assert.match(MIGRATION, /NEW\.capability_denies <@ public\.smr_delegable_capabilities\(\)/);
    assert.match(MIGRATION, /only the owner can invite an admin/);
    assert.match(MIGRATION, /only a platform admin adds an existing account directly/);
  });
});
