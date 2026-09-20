#!/usr/bin/env node
/**
 * Fails the build when application code reads or writes a row-level-protected
 * table through an UNSCOPED helper.
 *
 * WHY A LINT AND NOT JUST THE TESTS. An unscoped query against a protected
 * table does not throw. It returns nothing, and the code around it carries on
 * with "nothing" as if it were the answer: a tier gets demoted, a rate limit
 * falls to the anonymous default, a directory reports zero members. The
 * isolation suite asserts the sites that exist today. This catches the one
 * somebody writes next month.
 *
 * HOW. It is deliberately crude. For each source file it finds calls to an
 * unscoped helper -- query( getOne( insert( pool.query( c.query( client.query(
 * sqlEdge` -- takes the text of that call up to its closing parenthesis, and
 * looks for a protected table name inside it. Table names are matched as whole
 * words so an alias or a fragment built by concatenation is still caught as
 * long as the name appears in the call. A query assembled entirely elsewhere
 * and passed in as a variable is NOT caught; that is the known gap, and the
 * reason the suite exists too.
 *
 * EXCEPTIONS are a marker comment within the 15 lines above the call:
 *     // rls-lint-ok(<table>): <why this unscoped access is correct>
 * The reason is mandatory and the table must match. Not a list of line numbers
 * in this file: a line number is wrong the first time anyone edits above it,
 * and a marker sits next to the code it excuses, where a reviewer will see it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ONE list of protected tables, owned by core (the runtime health check reads
// the same array). Parsed out of the source so this script needs no build.
function protectedTables() {
  const src = readFileSync(new URL("../packages/core/src/rlsHealth.ts", import.meta.url), "utf8");
  const body = src.match(/RLS_PROTECTED_TABLES\s*=\s*\[([^\]]*)\]/)?.[1] ?? "";
  const names = Array.from(body.matchAll(/"([a-z_]+)"/g)).map((m) => m[1]);
  if (names.length === 0) throw new Error("could not read RLS_PROTECTED_TABLES from packages/core/src/rlsHealth.ts");
  return names;
}
export const PROTECTED_TABLES = protectedTables();

const ROOTS = ["apps/consumer/app", "apps/consumer/lib", "apps/consumer/auth.ts", "apps/consumer/components", "packages/core/src"];
const UNSCOPED = /(?<![\w.])(query|getOne|insert)\s*(<[^>(]*>)?\s*\(|\b(pool|c|client|conn)\.query\s*\(|\bsqlEdge\s*`/g;

function* walk(p) {
  const st = statSync(p);
  if (st.isFile()) { if (/\.(ts|tsx|mts)$/.test(p) && !/\.d\.ts$/.test(p)) yield p; return; }
  for (const name of readdirSync(p)) {
    if (name === "node_modules" || name === "__tests__" || name === ".next" || name === "dist") continue;
    yield* walk(join(p, name));
  }
}

/** Text of a call from its opening delimiter to the matching close. */
function callText(src, openIdx) {
  const open = src[openIdx];
  if (open === "`") {
    const end = src.indexOf("`", openIdx + 1);
    return src.slice(openIdx, end === -1 ? src.length : end + 1);
  }
  let depth = 0, inStr = null;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (inStr) { if (ch === "\\") i++; else if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return src.slice(openIdx, i + 1);
  }
  return src.slice(openIdx);
}

function excused(src, idx, table) {
  const above = src.slice(0, idx).split("\n").slice(-16).join("\n");
  return new RegExp(`rls-lint-ok\\(${table}\\):\\s*\\S.{10,}`).test(above);
}

/**
 * `import { query as dbQuery, getOne as one } from "@crucible/core"` -- an
 * alias is still the unscoped helper. The applications route did exactly this
 * and the first version of this linter walked straight past it.
 */
function aliasPattern(src) {
  const names = [];
  for (const imp of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
    for (const part of imp[1].split(",")) {
      const a = part.trim().match(/^(query|getOne|insert)\s+as\s+(\w+)$/);
      if (a) names.push(a[2]);
    }
  }
  // ...and the destructured form: const { query: dbQuery } = await import("@crucible/core")
  for (const d of src.matchAll(/\{([^{}]*)\}\s*=\s*await\s+import\(/g)) {
    for (const part of d[1].split(",")) {
      const a = part.trim().match(/^(query|getOne|insert)\s*:\s*(\w+)$/);
      if (a) names.push(a[2]);
    }
  }
  return names.length ? new RegExp(`(?<![\\w.])(${names.join("|")})\\s*(<[^>(]*>)?\\s*\\(`, "g") : null;
}

export function lintSource(file, src) {
  const problems = [];
  const alias = aliasPattern(src);
  for (const re of alias ? [UNSCOPED, alias] : [UNSCOPED]) lintWith(re, file, src, problems);
  return problems;
}

function lintWith(UNSCOPED, file, src, problems) {
  let m;
  UNSCOPED.lastIndex = 0;
  while ((m = UNSCOPED.exec(src))) {
    const openIdx = m.index + m[0].length - 1;
    const text = callText(src, openIdx);
    for (const table of PROTECTED_TABLES) {
      if (!new RegExp(`\\b${table}\\b`).test(text)) continue;
      if (excused(src, m.index, table)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      problems.push({ file, line, table, helper: m[0].replace(/\s+/g, " ").replace(/\s*[(`]$/, "") });
    }
  }
}

function selfTest() {
  const cases = [
    ["plain", "async function a(){ await query(`SELECT * FROM org_staff`) }", 1],
    ["generic", "async function a(){ await getOne<{id:string}>(`SELECT id FROM access_code_redemption WHERE x=$1`, [x]) }", 1],
    ["aliased join", "async function a(){ await query(`SELECT 1 FROM users u JOIN client_staff_assignment AS c ON c.x=u.id`) }", 1],
    ["concatenated", "async function a(){ await query('SELECT 1 FROM ' + 'org_audit' + ' WHERE 1=1') }", 1],
    ["pooled client", "async function a(){ await c.query(`DELETE FROM access_code_redemption`) }", 1],
    ["scoped helper is fine", "async function a(){ await queryAsUser(id, `SELECT 1 FROM access_code_redemption`) }", 0],
    ["runScoped is fine", "async function a(){ await runScoped(s, (sql) => [sql`SELECT 1 FROM org_staff`]) }", 0],
    ["similar name is fine", "async function a(){ await query(`SELECT 1 FROM org_staff_archive_note`) }", 0],
    ["excused with a reason", "async function a(){\n  // rls-lint-ok(org_staff): runs as the owner inside a migration helper\n  await query(`SELECT 1 FROM org_staff`) }", 0],
    ["excuse without a reason does not count", "async function a(){\n  // rls-lint-ok(org_staff):\n  await query(`SELECT 1 FROM org_staff`) }", 1],
    ["excuse for the wrong table does not count", "async function a(){\n  // rls-lint-ok(org_audit): some long enough reason here\n  await query(`SELECT 1 FROM org_staff`) }", 1],
    ["aliased import", "import { query as dbQuery } from '@crucible/core';\nasync function a(){ await dbQuery(`SELECT 1 FROM org_staff`) }", 1],
    ["destructured alias from a dynamic import", "async function a(){ const { query: dbQuery } = await import('@crucible/core');\n await dbQuery(`UPDATE org_staff SET x=1`) }", 1],
    ["comment nearby is fine", "// org_staff is protected\nasync function a(){ await query(`SELECT 1 FROM users`) }", 0],
  ];
  let bad = 0;
  for (const [name, src, want] of cases) {
    const got = lintSource("selftest.ts", src).length;
    if (got !== want) { bad++; console.error(`  selftest FAIL: ${name}: wanted ${want}, got ${got}`); }
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bad = selfTest();
  if (bad) { console.error(`\nlint-protected-tables: its own self-test failed (${bad}). Fix the linter first.\n`); process.exit(2); }
  const root = process.cwd();
  const problems = [];
  let files = 0;
  for (const r of ROOTS) {
    for (const f of walk(join(root, r))) {
      files++;
      problems.push(...lintSource(relative(root, f), readFileSync(f, "utf8")));
    }
  }
  if (problems.length) {
    console.error("\nUnscoped access to a row-level-protected table. This will not throw in");
    console.error("production; it will return NOTHING and the code will act on that.\n");
    for (const p of problems) console.error(`  ${p.file}:${p.line}  ${p.helper}()  ->  ${p.table}`);
    console.error("\nUse runScoped / runPerOrg (org data) or queryAsUser / getOneAsUser (a person's own");
    console.error("rows). If unscoped really is right, put this above the call, with a real reason:");
    console.error("    // rls-lint-ok(<table>): <why>\n");
    process.exit(1);
  }
  console.log(`lint-protected-tables: ${files} files, ${PROTECTED_TABLES.length} protected tables, self-test ok, no unscoped access`);
}
