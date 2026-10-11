/**
 * The checked resource directory's read path (Phase 5 lane R3, round 2):
 * per-level caps in the page SQL, the RLS health TEMP rule, and the 082
 * migration's TEMP record / non-owner stop / conditional rollback and its
 * read-only preflight, checked as text. The SQL itself runs against the real
 * view in the lane's PGlite proof. No database here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resourceAppSql, RESOURCE_APP_LEVEL_CAP, RESOURCE_APP_LIMIT } from "../resourceDirectoryShared";
import { tempProblem } from "../rlsHealth";

const MIG = join(__dirname, "..", "..", "migrations");
const strip = (sql: string) => sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

test("the page caps each reach level on its own (review N3)", () => {
  assert.equal(RESOURCE_APP_LEVEL_CAP, 50);
  assert.equal(RESOURCE_APP_LEVEL_CAP * 4, RESOURCE_APP_LIMIT);
  const { sql, params } = resourceAppSql({ state: "MT", areas: ["food"], countyKeys: ["lincoln"], cityKey: "libby", zip: "59923" });
  assert.match(sql, /row_number\(\) OVER \(PARTITION BY m\.lvl ORDER BY m\.last_checked DESC/);
  assert.match(sql, /WHERE r\.rn <= \$6/);
  assert.doesNotMatch(sql, /\bLIMIT\b/);
  assert.equal(params[5], RESOURCE_APP_LEVEL_CAP);
});

test("RLS health: TEMP for the app is a problem only once 082 is applied (review N6)", () => {
  assert.match(tempProblem({ canCreateTemp: true, migration082Applied: true }) ?? "", /TEMP/);
  assert.equal(tempProblem({ canCreateTemp: true, migration082Applied: false }), null, "a fresh database before 082");
  assert.equal(tempProblem({ canCreateTemp: false, migration082Applied: true }), null);
  assert.equal(tempProblem({ canCreateTemp: false, migration082Applied: false }), null);
  const src = readFileSync(join(__dirname, "..", "rlsHealth.ts"), "utf8");
  assert.match(src, /has_database_privilege\(current_user, current_database\(\), 'TEMP'\)/);
  assert.match(src, /filename = '082_resource_app_view\.sql'/);
});

test("082 records PUBLIC's TEMP before revoking, stops a non-owner, and rolls back only what was there (N1, N2)", () => {
  const f = readFileSync(join(MIG, "082_resource_app_view.sql"), "utf8");
  const body = strip(f);
  assert.match(body, /082 temp state: public_had_temp=%s; revoke=%s/);
  assert.ok(body.indexOf("COMMENT ON FUNCTION") < body.indexOf("REVOKE TEMPORARY ON DATABASE"), "recorded before the revoke");
  assert.match(body, /prev !~ '\^082 temp state: '/, "a re-run keeps the first record");
  assert.match(body, /RAISE EXCEPTION '082: % does not own database %/);
  assert.match(body, /current_setting\('smr\.skip_082_temp_revoke', true\)/);
  assert.doesNotMatch(body, /RAISE NOTICE '082: TEMP not revoked/);
  const rollback = f.slice(f.indexOf("-- ROLLBACK"), f.indexOf("DO $$"));
  const lines = rollback.split("\n").map((l) => l.replace(/^--\s*/, "").trim()).filter((l) => /^(DO|DROP|DELETE)\b/.test(l));
  assert.match(lines[0], /^DO .*public_had_temp=true.*GRANT TEMPORARY ON DATABASE %I TO PUBLIC/);
  assert.match(lines[1], /^DROP VIEW/);
  assert.match(lines[2], /^DROP FUNCTION/, "the record is read before its function is dropped");
});

test("the 082 TEMP preflight is read-only", () => {
  const f = readFileSync(join(MIG, "dry-run", "082_temp_preflight.sql"), "utf8");
  const body = strip(f);
  assert.match(f, /^-- 082_temp_preflight\.sql\n-- READ-ONLY\. Makes no writes/);
  assert.match(body, /^\s*BEGIN TRANSACTION READ ONLY;/m);
  assert.match(body, /^\s*ROLLBACK;\s*$/m);
  assert.ok(body.indexOf("BEGIN TRANSACTION READ ONLY") < body.indexOf("SELECT"));
  assert.ok(body.lastIndexOf("ROLLBACK") > body.lastIndexOf("SELECT"));
  // Statements only: string literals (the regex patterns it searches for) are blanked first.
  const statements = body.replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(statements, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|COMMENT|COPY|SET ROLE|COMMIT|DO)\b/i);
});
