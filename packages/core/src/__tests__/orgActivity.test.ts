/**
 * House lane L3b (migration 102): the activity log's words, its filters, its
 * CSV, the correction reason rule, and the places where SQL in the migration
 * must agree with TypeScript (the reach rule copies the role bundles; the
 * retention correction assumes every role writes outcomes by default).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  activitySentence, activityWho, activityPerson, activityFilters, activityDate, activityCsv, csvCell,
  ACTIVITY_ENTITIES, ACTIVITY_ENTITY_LABELS, isActivityEntity, type ActivityRow,
} from "../orgActivityShared";
import { correctionReason } from "../orgOutcomes";
import { capabilitiesForRole, ORG_STAFF_ROLES, computeOrgCapabilities, STAFF_PRESETS } from "../authz/capabilities";
import { RLS_PROTECTED_TABLES } from "../rlsHealth";

const MIGRATION = readFileSync(new URL("../../migrations/102_reach_activity_audit.sql", import.meta.url), "utf8");
const PERSON = "00000000-0000-0000-0000-0000000000aa";
const STAFF = "00000000-0000-0000-0000-0000000000bb";

function row(p: Partial<ActivityRow>): ActivityRow {
  return {
    id: "1", at: "2026-10-26T15:00:00Z", entity: "note", action: "created", summary: "added a call note",
    actor_user_id: STAFF, actor_role: "staff", actor_name: "Alma Reyes", participant_user_id: PERSON, participant_name: "Jordan",
    staff_user_id: null, staff_name: null, ...p,
  };
}

describe("activity sentences", () => {
  it("names the actor and the person, in one plain sentence", () => {
    assert.equal(activitySentence(row({})), "Alma Reyes added a call note for Jordan.");
  });
  it("puts the person before a parenthesis or a due date", () => {
    assert.equal(activitySentence(row({ entity: "retention", summary: "recorded the 30-day check-in (still there)" })), "Alma Reyes recorded the 30-day check-in for Jordan (still there).");
    assert.equal(activitySentence(row({ entity: "task", summary: "added a task, due 2026-11-01" })), "Alma Reyes added a task for Jordan, due 2026-11-01.");
  });
  it("replaces 'them' with the person", () => {
    assert.equal(activitySentence(row({ entity: "sharing", summary: "asked them to share their resumes" })), "Alma Reyes asked Jordan to share their resumes.");
  });
  it("says the person's own action without repeating them", () => {
    const r = row({ entity: "sharing", summary: "started sharing their resumes", actor_user_id: PERSON, actor_role: "participant", actor_name: "Jordan" });
    assert.equal(activitySentence(r), "Jordan started sharing their resumes.");
  });
  it("caseload changes name both people", () => {
    const base = { entity: "assignment", staff_user_id: STAFF, staff_name: "Sam Lee" };
    assert.equal(activitySentence(row({ ...base, action: "assigned", summary: "assigned them to a caseload" })), "Alma Reyes assigned Jordan to Sam Lee's caseload.");
    assert.equal(activitySentence(row({ ...base, action: "assigned", summary: "moved them to another caseload" })), "Alma Reyes moved Jordan to Sam Lee's caseload.");
    assert.equal(activitySentence(row({ ...base, action: "unassigned", summary: "took them off a caseload" })), "Alma Reyes took Jordan off Sam Lee's caseload.");
  });
  it("team changes name the team member", () => {
    assert.equal(activitySentence(row({ entity: "staff", participant_user_id: null, participant_name: null, staff_user_id: STAFF, staff_name: "Sam Lee", summary: "added a team member as staff" })),
      "Alma Reyes added a team member as staff: Sam Lee.");
  });
  it("never names a person who has not shared their name", () => {
    const r = row({ participant_name: null });
    assert.equal(activityPerson(r), "a person who has not shared their name");
    assert.equal(activitySentence(r), "Alma Reyes added a call note for a person who has not shared their name.");
    assert.equal(activityWho(row({ actor_user_id: PERSON, actor_role: "participant", actor_name: null, participant_name: null })), "The person");
  });
  it("says who acted when it was not a team member", () => {
    assert.equal(activityWho(row({ actor_user_id: null, actor_role: null })), "Automatic");
    assert.equal(activityWho(row({ actor_role: "platform_admin" })), "Steel Man support");
    assert.equal(activityWho(row({ actor_role: "other" })), "Someone outside the team");
    assert.equal(activityWho(row({ actor_name: null })), "A team member");
  });
  it("labels every kind of record, with no em dashes in any word shown", () => {
    for (const e of ACTIVITY_ENTITIES) assert.ok(ACTIVITY_ENTITY_LABELS[e] && !/—/.test(ACTIVITY_ENTITY_LABELS[e]));
    assert.equal(isActivityEntity("note"), true); assert.equal(isActivityEntity("notes"), false);
  });
});

describe("activity filters", () => {
  it("keeps only well-formed values", () => {
    const f = activityFilters({ participantId: PERSON, staffId: "nope", entity: "note", from: "2026-10-01", to: "2026-02-30", before: "123", limit: "50" });
    assert.deepEqual(f, { participantId: PERSON, staffId: null, entity: "note", from: "2026-10-01", to: null, before: "123", limit: 50 });
  });
  it("drops an unknown kind and an injected id, caps the page and swaps reversed dates", () => {
    const f = activityFilters({ entity: "note'; DROP TABLE x;--", participantId: "1 OR 1=1", before: "1; select", limit: "99999", from: "2026-10-20", to: "2026-10-01" }, 200);
    assert.equal(f.entity, null); assert.equal(f.participantId, null); assert.equal(f.before, null); assert.equal(f.limit, 200);
    assert.equal(f.from, "2026-10-01"); assert.equal(f.to, "2026-10-20");
  });
  it("reads real calendar dates only", () => {
    assert.equal(activityDate("2026-10-26"), "2026-10-26");
    assert.equal(activityDate("2026-13-01"), null);
    assert.equal(activityDate("26-10-2026"), null);
  });
});

describe("activity CSV", () => {
  it("has a header, one sentence per row, and quotes everything", () => {
    const csv = activityCsv([row({})]);
    const [head, line] = csv.split("\r\n");
    assert.match(head, /^"When \(UTC\)","Who","What happened","Person"/);
    assert.match(line, /"2026-10-26 15:00:00","Alma Reyes","Alma Reyes added a call note for Jordan\.","Jordan"/);
  });
  it("cannot be turned into a spreadsheet formula", () => {
    assert.equal(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
    assert.equal(csvCell("@SUM(A1)"), `"'@SUM(A1)"`);
    const csv = activityCsv([row({ actor_name: "=cmd|' /C calc'!A0" })]);
    assert.ok(!csv.includes(',"=cmd'), csv);
  });
});

describe("correction reasons", () => {
  it("needs 3 to 500 characters of real text", () => {
    assert.equal(correctionReason("  Typed the   wrong date "), "Typed the wrong date");
    assert.equal(correctionReason("no"), null);
    assert.equal(correctionReason("x".repeat(501)), null);
    assert.equal(correctionReason(undefined), null);
  });
});

describe("migration 102 agrees with the TypeScript it copies", () => {
  it("the roles that see everyone by default are exactly owner and org_admin (smr_staff_sees_all)", () => {
    const byDefault = ORG_STAFF_ROLES.filter((r) => capabilitiesForRole(r).includes("org.client.view_all")).sort();
    assert.deepEqual(byDefault, ["org_admin", "owner"]);
    assert.match(MIGRATION, /smr_org_role\(p_org, p_staff\) IN \('owner', 'org_admin'\)/);
  });
  it("a deny on view_all wins over the role default, as computeOrgCapabilities applies it", () => {
    assert.equal(computeOrgCapabilities("org_admin", [], ["org.client.view_all"]).has("org.client.view_all"), false);
    assert.match(MIGRATION, /capability = 'org.client.view_all' AND o.effect = 'deny'/);
  });
  it("every role writes outcomes by default, so a correction is refused only by a deny (smr_correct_retention_check)", () => {
    for (const r of ORG_STAFF_ROLES) assert.ok(capabilitiesForRole(r).includes("org.outcome.write"), r);
    assert.ok(STAFF_PRESETS.volunteer.denies.includes("org.outcome.write"), "the volunteer preset denies it, which the function honors");
    assert.match(MIGRATION, /capability = 'org.outcome.write' AND o.effect = 'deny'/);
  });
  it("the entity list matches the database CHECK", () => {
    const check = MIGRATION.match(/entity\s+TEXT NOT NULL CHECK \(entity IN \(([^)]*)\)\)/)?.[1] ?? "";
    const inSql = Array.from(check.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]).sort();
    assert.deepEqual(inSql, [...ACTIVITY_ENTITIES].sort());
  });
  it("trigger summaries are fixed words: no typed column is ever concatenated into one", () => {
    // The text columns a person types. None may appear in a summary expression.
    for (const col of ["body", "title", "employer", "job_title", "reason", "note", "correction_reason", "invited_name", "invited_email", "partner_name"]) {
      const concatenated = new RegExp(`\\|\\|\\s*(NEW|OLD)\\.${col}\\b`);
      assert.ok(!concatenated.test(MIGRATION), `a summary concatenates ${col}`);
    }
    for (const word of ["parole", "probation", "offense", "conviction", "felon", "inmate"]) {
      assert.ok(!new RegExp(`'[^']*\\b${word}`, "i").test(MIGRATION.replace(/^--.*$/gm, "")), `a summary literal holds the record word "${word}"`);
    }
  });
  it("the new tables are on the protected list the RLS lint and health check read", () => {
    for (const t of ["org_activity", "outcome_correction"]) assert.ok((RLS_PROTECTED_TABLES as readonly string[]).includes(t), t);
  });
  it("every per-participant table gets a restrictive reach policy, and the after-guard insists on it", () => {
    for (const t of ["case_note", "case_note_version", "staff_task", "outcome_record", "retention_check", "staff_suggestion", "sharing_request", "org_activity", "outcome_correction"]) {
      assert.ok(MIGRATION.includes(`'${t}.${t}_reach'`), `after-guard lists ${t}_reach`);
    }
    assert.match(MIGRATION, /permissive = 'RESTRICTIVE'/);
  });
  it("the per-row reach parts that depend only on the actor are uncorrelated subqueries (review S2)", () => {
    assert.match(MIGRATION, /\(SELECT public\.smr_staff_sees_all\(NULLIF\(current_setting\('app\.org_id', true\), ''\)::uuid, NULLIF\(current_setting\('app\.user_id', true\), ''\)::uuid\)\)/);
    assert.match(MIGRATION, /%1\$s IN \(SELECT a\.client_user_id FROM public\.client_staff_assignment a/);
  });
  it("deleting a staff account is allowed for every guarded author column (review B1)", () => {
    for (const fn of ["retention_check_guard", "outcome_record_guard", "case_note_keep_version", "staff_task_guard", "staff_suggestion_guard", "sharing_request_guard"]) {
      const body = MIGRATION.slice(MIGRATION.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${fn}()`));
      assert.match(body.slice(0, 1500), /NOT EXISTS \(SELECT 1 FROM public\.users u WHERE u\.id = OLD\./, fn);
    }
    assert.ok(!/CHECK \(source <> 'staff_verified' OR \(verification_method IS NOT NULL AND verified_by IS NOT NULL/.test(MIGRATION));
  });
});
