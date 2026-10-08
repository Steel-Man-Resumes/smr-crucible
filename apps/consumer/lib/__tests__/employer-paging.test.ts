/**
 * The employer board is searched and paged on the server (lane 3a Part 2,
 * item 3). Pure rules plus the SQL the core builds; the real route runs in
 * the Playwright pass against a scratch database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMPLOYER_MAX_PAGE,
  EMPLOYER_PAGE_SIZE,
  clampEmployerPage,
  employerLikePattern,
  employerPageSql,
} from "@crucible/core/src/employer";
import {
  EMPLOYER_PAGES_PER_DAY,
  EMPLOYER_PAGES_PER_DAY_NETWORK,
  EMPLOYER_PAGES_PER_DAY_TEAM,
  employerPageAllowed,
  employerPagesPerDay,
  parseEmployerQuery,
} from "../employer-paging";

test("a page is about 25, and the SQL asks for one more only to know if another page exists", () => {
  assert.equal(EMPLOYER_PAGE_SIZE, 25);
  for (const source of ["table", "directory"] as const) {
    const { sql, params } = employerPageSql(source, { page: 2 });
    assert.match(sql, /LIMIT \$1 OFFSET \$2/);
    assert.equal(params[0], 26);
    assert.equal(params[1], 50);
  }
});

test("there is no size knob and no 'everything': ?limit= is ignored, the page is capped", () => {
  const q = parseEmployerQuery(new URLSearchParams("limit=100000&page=99999&size=500"));
  assert.equal(q.page, EMPLOYER_MAX_PAGE);
  assert.deepEqual(Object.keys(q).sort(), ["industry", "page", "q"]);
  const { params } = employerPageSql("table", { page: 10_000 });
  assert.equal(params[0], EMPLOYER_PAGE_SIZE + 1);
  assert.equal(params[1], EMPLOYER_MAX_PAGE * EMPLOYER_PAGE_SIZE);
});

test("page numbers: junk and negatives are page 0", () => {
  for (const v of [null, "", "-3", "abc", "NaN"]) assert.equal(clampEmployerPage(v), 0);
  assert.equal(clampEmployerPage("3"), 3);
  assert.equal(parseEmployerQuery(new URLSearchParams("page=-1")).page, 0);
});

test("the search runs in SQL as a parameter, never pasted into the statement", () => {
  const evil = "x' OR 1=1; DROP TABLE employer; --";
  for (const source of ["table", "directory"] as const) {
    const { sql, params } = employerPageSql(source, { q: evil, industry: "Food service" });
    assert.ok(!sql.includes("DROP TABLE"));
    assert.ok(!sql.includes("Food service"));
    assert.ok(params.includes("Food service"));
    assert.ok(params.some((p) => typeof p === "string" && p.includes("DROP TABLE")));
    assert.match(sql, /ILIKE \$\d+ ESCAPE '\\'/);
  }
});

test("LIKE wildcards in a search are literal, and the text is trimmed and short", () => {
  assert.equal(employerLikePattern("100%_off"), "%100\\%\\_off%");
  assert.equal(employerLikePattern("a\\b"), "%a\\\\b%");
  assert.equal(employerLikePattern("   "), null);
  assert.equal(employerLikePattern("x".repeat(500))!.length, 80 + 2);
});

test("search reaches name, place, industry, roles and the evidence words", () => {
  const t = employerPageSql("table", { q: "cook" }).sql;
  for (const col of ["name", "industry", "primary_city", "county", "wi_region", "role_types", "evidence_summary"]) {
    assert.match(t, new RegExp(`COALESCE\\(${col}, ''\\) ILIKE`));
  }
  const d = employerPageSql("directory", { q: "cook" }).sql;
  for (const col of ["canonical_name", "industry", "city", "county", "state", "excerpt", "role_titles"]) {
    assert.match(d, new RegExp(`COALESCE\\(x\\.${col}, ''\\) ILIKE`));
  }
  // Published / marked rows only, either way.
  assert.match(t, /published = true/);
  assert.match(d, /p\.earns_mark OR p\.standing = 'says_yes_for_roles'/);
});

test("paging order is stable (a tiebreak on id), so pages never repeat or skip a row", () => {
  assert.match(employerPageSql("table", {}).sql, /lower\(d\.name\), d\.id\s+LIMIT/);
  assert.match(employerPageSql("directory", {}).sql, /x\.canonical_name, x\.place_id\s+LIMIT/);
});

test("'all' and blank industry mean no filter", () => {
  assert.equal(parseEmployerQuery(new URLSearchParams("industry=all")).industry, null);
  assert.equal(parseEmployerQuery(new URLSearchParams("industry=%20")).industry, null);
  assert.equal(parseEmployerQuery(new URLSearchParams("industry=Food%20service")).industry, "Food service");
});

test("paging is rate limited: 20 a day for a person, team tiers keep 120, and a network floor", () => {
  assert.equal(EMPLOYER_PAGES_PER_DAY, 20);
  assert.equal(EMPLOYER_PAGES_PER_DAY_TEAM, 120);
  for (const t of ["client", "default", "observer", null, undefined, "something-new"]) assert.equal(employerPagesPerDay(t), 20, String(t));
  for (const t of ["partner", "admin", "unlimited"]) assert.equal(employerPagesPerDay(t), 120, t);
  assert.equal(employerPageAllowed(20, 1, "client"), true);
  assert.equal(employerPageAllowed(21, 1, "client"), false, "a person's 21st page");
  assert.equal(employerPageAllowed(21, 1, "partner"), true);
  assert.equal(employerPageAllowed(121, 1, "partner"), false);
  // Many fresh accounts from one connection share the network floor.
  assert.equal(employerPageAllowed(1, EMPLOYER_PAGES_PER_DAY_NETWORK, "client"), true);
  assert.equal(employerPageAllowed(1, EMPLOYER_PAGES_PER_DAY_NETWORK + 1, "client"), false);
});

test("the route refuses a pending session and counts per network too", () => {
  const src = readFileSync(join(__dirname, "..", "..", "app", "api", "employers", "route.ts"), "utf8");
  assert.match(src, /forgeSessionUser\(await auth\(\)\)/);
  assert.match(src, /incrementIpUsage\(getClientIp\(request\), EMPLOYER_PAGES_ENDPOINT\)/);
  assert.match(src, /employerPageAllowed\(account, network, tier\)/);
});

test("the route counts before it answers, needs a session, and has no export", () => {
  const src = readFileSync(join(__dirname, "..", "..", "app", "api", "employers", "route.ts"), "utf8");
  assert.match(src, /if \(!userId\)[\s\S]*status: 401/);
  const countAt = src.indexOf("incrementUserUsage(userId, EMPLOYER_PAGES_ENDPOINT)");
  const searchAt = src.indexOf("searchPublishedEmployers(");
  assert.ok(countAt > 0 && searchAt > countAt, "counted before the search runs");
  assert.match(src, /status: 429/);
  assert.doesNotMatch(src, /listPublishedEmployers|limit:\s*\d|text\/csv|Content-Disposition/);
});

test("the page asks the server for one page at a time and never filters a full list", () => {
  const src = readFileSync(join(__dirname, "..", "..", "app", "(dashboard)", "dashboard", "employers", "page.tsx"), "utf8");
  assert.match(src, /\/api\/employers\?\$\{params\.toString\(\)\}/);
  assert.match(src, /page: String\(page\)/);
  assert.doesNotMatch(src, /employers\.filter\(/);
});
