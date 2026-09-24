#!/usr/bin/env node
/**
 * Prove the employer directory's rules hold IN THE DATABASE (migration 061).
 *
 * The directory's promises are all SQL: evidence expires by itself and is never
 * rewritten, "Certain" needs a live, named, dated relationship, company policy
 * never earns the mark alone, facts reach only as far as their policy allows,
 * a bad experience needs two independent organizations before it counts or is
 * shown, casework never reaches the public more precisely than county and
 * quarter, links never cross employers, and the app role reads the public doors
 * and nothing behind them. A mock would only prove the mock, so this seeds real
 * rows on a throwaway branch and reads them back, as the owner and as smr_app.
 *
 * Revised with the missing tests from the Codex review of 061 (2026-09-24).
 *
 * SAFETY: needs ISOLATION_TEST_DATABASE_URL and SMR_APP_DATABASE_URL (never
 * DATABASE_URL); refuses the production endpoint; both must point at the same
 * host; every fixture is named `__dirtest ...`; cleanup runs first and in
 * `finally`.
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { checkEffectiveDirectoryGrants } from "./lib/restricted-grants.mjs";

const PROD_ENDPOINT = "ep-little-cloud-aphpkqbd";
function readVar(file, name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(file, "utf8").split("\n").find((l) => l.trim().startsWith(name + "="));
    if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  } catch { /* none */ }
  return undefined;
}

const OWNER_URL = readVar(".env.isolation", "ISOLATION_TEST_DATABASE_URL");
const APP_URL = readVar(".env.smr-app", "SMR_APP_DATABASE_URL");
if (!OWNER_URL || !APP_URL) {
  console.error("\nNeeds ISOLATION_TEST_DATABASE_URL (.env.isolation) and SMR_APP_DATABASE_URL (.env.smr-app).\n");
  process.exit(2);
}
const hostOf = (u) => new URL(u).hostname.replace("-pooler", "");
if ([OWNER_URL, APP_URL].some((u) => new URL(u).hostname.includes(PROD_ENDPOINT))) {
  console.error("\nREFUSING: a connection string points at the production endpoint.\n");
  process.exit(2);
}
if (hostOf(OWNER_URL) !== hostOf(APP_URL)) {
  console.error("\nREFUSING: the owner and app connection strings point at different databases.\n");
  process.exit(2);
}

const owner = neon(OWNER_URL);
const app = neon(APP_URL);
const P = "__dirtest";
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

let failures = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : "  -- " + detail}`);
  if (!ok) failures++;
}
/** The statement must be refused by the database. */
async function refused(name, run) {
  let err = null;
  try { await run(); } catch (e) { err = e; }
  check(name, err !== null, "the database accepted it");
}

/** Run statements as smr_app with app.user_id set, in one transaction. */
async function asApp(userId, build) {
  const setup = [app`SELECT set_config('app.user_id', ${userId ?? ""}, true)`];
  const out = await app.transaction([...setup, ...build(app)]);
  return out.slice(1);
}

async function cleanup() {
  const ids = (await owner`SELECT id FROM employer_org WHERE canonical_name LIKE ${P + "%"}`).map((r) => r.id);
  if (!ids.length) return;
  await owner`DELETE FROM employer_reply WHERE org_id = ANY(${ids})`;
  await owner`DELETE FROM employer_requirement WHERE org_id = ANY(${ids})`;
  await owner`DELETE FROM employer_evidence WHERE org_id = ANY(${ids})`;
  await owner`DELETE FROM employer_signup WHERE org_id = ANY(${ids})`;
  await owner`DELETE FROM employer_relationship WHERE org_id = ANY(${ids})`;
  await owner`DELETE FROM employer_contact WHERE org_id = ANY(${ids})`;
  await owner`DELETE FROM employer_alias WHERE org_id = ANY(${ids})`;
  await owner`DELETE FROM employer_place WHERE org_id = ANY(${ids})`;
  await owner`DELETE FROM employer_org WHERE id = ANY(${ids})`;
}

let seq = 0;
async function org(name, extra = {}) {
  const [o] = await owner`
    INSERT INTO employer_org (canonical_name, name_key, operating_model, listing_visibility, org_kind)
    VALUES (${name}, directory_normalize_name(${name}), ${extra.model ?? "unknown"},
            ${extra.visibility ?? "public"}, ${extra.kind ?? "employer"}) RETURNING id, name_key`;
  return o;
}
async function place(orgId, kind = "site", county = "Flathead", state = "MT") {
  const [p] = await owner`
    INSERT INTO employer_place (org_id, place_kind, city, county, state)
    VALUES (${orgId}, ${kind}, ${kind === "site" ? "Kalispell" : null}, ${county}, ${state}) RETURNING id`;
  return p.id;
}
async function fresh(label, extra) {
  const o = await org(`${P} ${label}`, extra);
  return { o, p: await place(o.id) };
}
function evidence(o) {
  const casework = o.kind === "casework_aggregate";
  return owner`
    INSERT INTO employer_evidence (org_id, place_id, scope, claim_type, role_family, role_title, source_kind, source_url,
                                   publisher, source_orgs, source_grade, confidence, relationship_id, observed_on,
                                   accessed_on, expires_on, outcome_count, org_count, excerpt, found_by)
    VALUES (${o.org}, ${o.place ?? null}, ${o.scope ?? (o.place ? "place" : "company")}, ${o.claim},
            ${o.roleFamily ?? null}, ${o.roleTitle ?? null}, ${o.kind ?? "official_policy"},
            ${o.url !== undefined ? o.url : casework ? null : "https://example.test/" + ++seq},
            ${o.publisher ?? null}, ${o.sourceOrgs ?? []}, ${o.grade ?? "A"}, ${o.confidence ?? "likely"},
            ${o.rel ?? null}, ${o.observed ?? today()}, ${o.accessed === undefined ? (o.observed ?? today()) : o.accessed},
            ${o.expires ?? null}, ${o.outcomes ?? null}, ${o.orgs ?? null}, ${o.excerpt ?? null}, 'verify-directory')
    RETURNING id, expires_on`.then((r) => r[0]);
}
const standing = async (placeId) => (await owner`SELECT * FROM employer_standing_v WHERE place_id = ${placeId}`)[0];
async function liveRelationship(orgId, confirmedDaysAgo = 10, extra = {}) {
  const [c] = await owner`INSERT INTO employer_contact (org_id, contact_kind, email, source_url, checked_on)
                          VALUES (${orgId}, 'role_inbox', 'jobs@example.test', 'https://example.test/careers', ${daysAgo(1)}) RETURNING id`;
  const [r] = await owner`INSERT INTO employer_relationship (org_id, avenue, contact_id, started_on, cadence_days, status)
                          VALUES (${orgId}, 'employer_contact', ${c.id}, ${daysAgo(400)}, 90, ${extra.status ?? "active"}) RETURNING id`;
  await owner`INSERT INTO employer_relationship_confirmation (org_id, relationship_id, confirmed_on, method, confirmed_by)
              VALUES (${orgId}, ${r.id}, ${daysAgo(confirmedDaysAgo)}, 'email_reply', 'verify-directory')`;
  return { rel: r.id, contact: c.id };
}

console.log("\nEmployer directory rules (061)\n");
try {
  await cleanup();
  const [admin] = await owner`SELECT user_id FROM platform_admin LIMIT 1`;
  check("an admin fixture exists, so the admin checks below really run", Boolean(admin));
  const nobody = "00000000-0000-0000-0000-000000000000";

  // ---- One normalizer ----------------------------------------------------
  const { normalizeEmployerName } = await import("../packages/core/dist/employer.js");
  const names = ["Roehl Transport, Inc.", "IEA, L.L.C.", "Targeted Staffing", "AT&T Services", "  Kelly  Services Co ",
                 "Goodwill Greater Milwaukee & Chicago", "The Home Depot", "Flathead County", "McDonald's - Libby"];
  const sqlKeys = await Promise.all(names.map(async (n) => (await owner`SELECT directory_normalize_name(${n}) AS k`)[0].k));
  const mismatch = names.filter((n, i) => normalizeEmployerName(n) !== sqlKeys[i]);
  check("the SQL name normalizer matches employer.ts on every sample", mismatch.length === 0, JSON.stringify(mismatch));
  await refused("a key that is not in normalized form is refused", () =>
    owner`INSERT INTO employer_org (canonical_name, name_key) VALUES (${P + " Bad Key"}, 'Bad Key, Inc.')`);

  // ---- The basic ladder --------------------------------------------------
  const a = await fresh("Alpha Lumber");
  const ev = await evidence({ org: a.o.id, place: a.p, claim: "employer_statement", kind: "employer_direct", url: null });
  let s = await standing(a.p);
  check("a local employer statement reads 'says_yes_here' and earns the mark", s?.standing === "says_yes_here" && s?.earns_mark === true, JSON.stringify(s));
  const exp = new Date(ev.expires_on).toISOString().slice(0, 10);
  check("expiry defaults from the policy (90 days for an employer statement)", exp === new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10), exp);

  const b = await fresh("Bravo Diner");
  await evidence({ org: b.o.id, place: b.p, claim: "employer_statement", kind: "employer_direct", url: null, observed: daysAgo(120) });
  s = await standing(b.p);
  check("a 120-day-old employer statement has expired: 'lead', no mark", s?.standing === "lead" && s?.earns_mark === false, JSON.stringify(s));

  for (const model of ["corporate", "franchise"]) {
    const c = await fresh(`Charlie Mart ${model}`, { model });
    await evidence({ org: c.o.id, claim: "confirmed_corporate" });
    s = await standing(c.p);
    check(`company policy alone (${model}) reads 'company_policy' with no mark`, s?.standing === "company_policy" && !s?.earns_mark, JSON.stringify(s));
  }

  // 062: an employer that only operates locally speaks for its own place.
  for (const [label, extra] of [["government", { kind: "government" }], ["independent", { model: "independent" }]]) {
    const lo = await fresh(`Local Operator ${label}`, extra);
    await evidence({ org: lo.o.id, claim: "confirmed_corporate" });
    s = await standing(lo.p);
    check(`a ${label} employer's own policy reads 'says_yes_here' and earns the mark`, s?.standing === "says_yes_here" && s?.earns_mark === true, JSON.stringify(s));
  }
  const chain = await fresh("Chain Unknown Model");
  await evidence({ org: chain.o.id, claim: "confirmed_corporate" });
  s = await standing(chain.p);
  check("a chain of unknown model keeps 'company_policy' with no mark", s?.standing === "company_policy" && !s?.earns_mark, JSON.stringify(s));
  const loNo = await fresh("Local Operator Says No", { kind: "government" });
  await evidence({ org: loNo.o.id, claim: "confirmed_corporate" });
  await evidence({ org: loNo.o.id, place: loNo.p, claim: "negative_written", kind: "job_posting" });
  s = await standing(loNo.p);
  check("a local operator's policy plus a written no is 'mixed'", s?.standing === "mixed" && !s?.earns_mark, JSON.stringify(s));

  const partner = await fresh("Partner Program", { kind: "ecosystem_partner" });
  await evidence({ org: partner.o.id, place: partner.p, claim: "confirmed_hire", kind: "casework_aggregate", outcomes: 1, orgs: 1, sourceOrgs: ["org:x"] });
  s = await standing(partner.p);
  check("an ecosystem partner reads 'not_an_employer' and never earns the mark", s?.standing === "not_an_employer" && !s?.earns_mark, JSON.stringify(s));

  // ---- Certain -----------------------------------------------------------
  await refused("'certain' without a relationship is refused", () =>
    evidence({ org: a.o.id, place: a.p, claim: "employer_statement", kind: "employer_direct", url: null, confidence: "certain" }));
  await refused("a relationship through 'employer_contact' with no contact is refused", () =>
    owner`INSERT INTO employer_relationship (org_id, avenue, started_on) VALUES (${a.o.id}, 'employer_contact', ${daysAgo(5)})`);
  await refused("a confirmation dated in the future is refused", async () => {
    const r = await liveRelationship(a.o.id);
    await owner`INSERT INTO employer_relationship_confirmation (org_id, relationship_id, confirmed_on, method, confirmed_by)
                VALUES (${a.o.id}, ${r.rel}, ${daysAgo(-30)}, 'phone_call', 'verify-directory')`;
  });

  const d = await fresh("Delta Freight");
  const live = await liveRelationship(d.o.id, 10);
  await evidence({ org: d.o.id, place: d.p, claim: "employer_statement", kind: "employer_direct", url: null, confidence: "certain", rel: live.rel });
  s = await standing(d.p);
  check("'certain' with a live, confirmed relationship stays certain", s?.confidence === "certain", JSON.stringify(s));

  const e1 = await fresh("Echo Lapsed");
  const stale = await liveRelationship(e1.o.id, 200);
  await evidence({ org: e1.o.id, place: e1.p, claim: "employer_statement", kind: "employer_direct", url: null, confidence: "certain", rel: stale.rel });
  s = await standing(e1.p);
  check("a lapsed relationship drops a well-sourced item to 'likely'", s?.confidence === "likely", JSON.stringify(s));

  const e2 = await fresh("Echo Weak");
  const stale2 = await liveRelationship(e2.o.id, 200);
  await evidence({ org: e2.o.id, place: e2.p, claim: "employer_statement", kind: "employer_direct", url: null, confidence: "certain", rel: stale2.rel, accessed: null });
  s = await standing(e2.p);
  check("a lapsed relationship drops an item with no access date to 'guessing'", s?.confidence === "guessing", JSON.stringify(s));

  const e3 = await fresh("Echo Opted Out");
  const oo = await liveRelationship(e3.o.id, 5);
  await evidence({ org: e3.o.id, place: e3.p, claim: "employer_statement", kind: "employer_direct", url: null, confidence: "certain", rel: oo.rel });
  await owner`UPDATE employer_contact SET can_contact = false, opted_out_at = now() WHERE id = ${oo.contact}`;
  s = await standing(e3.p);
  check("when the contact opts out, the relationship is no longer live", s?.confidence === "likely", JSON.stringify(s));

  const pooled = await fresh("Pooled Confidence");
  const pr = await liveRelationship(pooled.o.id, 5);
  await evidence({ org: pooled.o.id, claim: "confirmed_corporate", confidence: "certain", rel: pr.rel });
  await evidence({ org: pooled.o.id, place: pooled.p, claim: "employer_statement", kind: "employer_direct", url: null, confidence: "guessing", grade: "C" });
  s = await standing(pooled.p);
  check("confidence comes from the evidence that decided the standing, not from all of it", s?.standing === "says_yes_here" && s?.confidence === "guessing", JSON.stringify(s));

  // ---- Negatives ---------------------------------------------------------
  const n1 = await fresh("Negatives One Source");
  await evidence({ org: n1.o.id, place: n1.p, claim: "employer_statement", kind: "employer_direct", url: null });
  await evidence({ org: n1.o.id, place: n1.p, claim: "negative_experience", kind: "news", publisher: "Paper One", sourceOrgs: ["paper one"] });
  await evidence({ org: n1.o.id, place: n1.p, claim: "negative_experience", kind: "news", publisher: "Paper One", sourceOrgs: ["paper one"] });
  s = await standing(n1.p);
  check("two reports from ONE organization count once: still 'says_yes_here'", s?.standing === "says_yes_here", JSON.stringify(s));
  let [pubNeg] = await asApp(nobody, (q) => [q`SELECT id FROM directory_public_evidence_v WHERE org_id = ${n1.o.id} AND claim_type = 'negative_experience'`]);
  check("an uncorroborated bad experience is not published", pubNeg.length === 0, `${pubNeg.length} rows`);

  const n2 = await fresh("Negatives Two Sources");
  await evidence({ org: n2.o.id, place: n2.p, claim: "employer_statement", kind: "employer_direct", url: null });
  await evidence({ org: n2.o.id, place: n2.p, claim: "negative_experience", kind: "news", publisher: "Paper One", sourceOrgs: ["paper one"] });
  await evidence({ org: n2.o.id, place: n2.p, claim: "negative_experience", kind: "partner_list", publisher: "Program Two", sourceOrgs: ["program two"] });
  s = await standing(n2.p);
  check("two independent organizations make it 'mixed', no mark", s?.standing === "mixed" && !s?.earns_mark, JSON.stringify(s));
  [pubNeg] = await asApp(nobody, (q) => [q`SELECT id FROM directory_public_evidence_v WHERE org_id = ${n2.o.id} AND claim_type = 'negative_experience'`]);
  check("once corroborated, both reports are published", pubNeg.length === 2, `${pubNeg.length} rows`);

  const n3 = await fresh("Negatives Only");
  await evidence({ org: n3.o.id, place: n3.p, claim: "negative_experience", kind: "news", publisher: "Paper One", sourceOrgs: ["paper one"] });
  await evidence({ org: n3.o.id, place: n3.p, claim: "negative_experience", kind: "news", publisher: "Paper Two", sourceOrgs: ["paper two"] });
  s = await standing(n3.p);
  check("two independent reports and no yes read 'reported_turned_down'", s?.standing === "reported_turned_down", JSON.stringify(s));

  const no = await fresh("Written No");
  await evidence({ org: no.o.id, place: no.p, claim: "negative_written", kind: "job_posting" });
  s = await standing(no.p);
  check("a posting that says no reads 'says_no'", s?.standing === "says_no", JSON.stringify(s));

  for (const positive of ["confirmed_hire", "staff_attestation", "employer_statement"]) {
    const z = await fresh("Mixed " + positive);
    await evidence({ org: z.o.id, place: z.p, claim: positive, kind: "employer_direct", url: null });
    await evidence({ org: z.o.id, place: z.p, claim: "negative_written", kind: "job_posting" });
    s = await standing(z.p);
    check(`${positive} plus a written no stays 'mixed' (a yes never hides a no)`, s?.standing === "mixed" && !s?.earns_mark, JSON.stringify(s));
  }

  // ---- Reach: county, state, franchise, role -----------------------------
  const geo = await fresh("Geography");
  const county = await place(geo.o.id, "county", "Flathead", "MT");
  const elsewhere = await place(geo.o.id, "site", "Lincoln", "MT");
  const otherState = await place(geo.o.id, "site", "Flathead", "WI");
  await evidence({ org: geo.o.id, place: county, scope: "county", claim: "employer_statement" });
  check("county evidence reaches a site in the same county", (await standing(geo.p))?.earns_mark === true);
  check("county evidence does not reach another county", (await standing(elsewhere))?.earns_mark === false);
  check("county evidence does not reach the same county name in another state", (await standing(otherState))?.earns_mark === false);

  const sw = await fresh("Statewide Hire");
  const swPlace = await place(sw.o.id, "statewide", null, "MT");
  await evidence({ org: sw.o.id, place: swPlace, scope: "state", claim: "confirmed_hire", kind: "casework_aggregate", outcomes: 5, orgs: 1, sourceOrgs: ["org:y"] });
  s = await standing(sw.p);
  check("a statewide hire does NOT make every site 'proven_here'", s?.standing !== "proven_here" && !s?.earns_mark, JSON.stringify(s));

  const fr = await fresh("Franchise Store", { model: "franchise" });
  const frCounty = await place(fr.o.id, "county", "Flathead", "MT");
  await evidence({ org: fr.o.id, place: frCounty, scope: "county", claim: "employer_statement" });
  s = await standing(fr.p);
  check("a franchise location takes nothing from a county place", !s?.earns_mark, JSON.stringify(s));

  await refused("a role posting recorded as place-wide is refused", () =>
    evidence({ org: a.o.id, place: a.p, scope: "place", claim: "direct_role_signal", kind: "job_posting" }));
  const role = await fresh("Role Only");
  await evidence({ org: role.o.id, place: role.p, scope: "role", claim: "direct_role_signal", kind: "job_posting", roleFamily: "kitchen", roleTitle: "Line Cook" });
  s = await standing(role.p);
  check("a role posting alone reads 'says_yes_for_roles' with no employer mark", s?.standing === "says_yes_for_roles" && !s?.earns_mark, JSON.stringify(s));
  const [roleMarks] = await asApp(nobody, (q) => [q`SELECT basis, role_family FROM directory_mark_v WHERE name_key = ${role.o.name_key}`]);
  check("the mark list carries it as a ROLE mark for kitchen only", roleMarks.length === 1 && roleMarks[0].basis === "role" && roleMarks[0].role_family === "kitchen", JSON.stringify(roleMarks));

  const roleNo = await fresh("Role No");
  await evidence({ org: roleNo.o.id, place: roleNo.p, claim: "employer_statement", kind: "employer_direct", url: null });
  await evidence({ org: roleNo.o.id, place: roleNo.p, scope: "role", claim: "negative_written", kind: "job_posting", roleFamily: "driving" });
  s = await standing(roleNo.p);
  check("a no for one role does not make the whole place 'says_no'", s?.standing === "says_yes_here", JSON.stringify(s));

  await refused("scope 'state' on a site place is refused", () =>
    evidence({ org: a.o.id, place: a.p, scope: "state", claim: "employer_statement" }));

  // ---- Casework ----------------------------------------------------------
  await refused("casework with no counts is refused", () =>
    evidence({ org: a.o.id, place: a.p, claim: "confirmed_hire", kind: "casework_aggregate" }));
  await refused("casework carrying free text is refused", () =>
    evidence({ org: a.o.id, place: a.p, claim: "confirmed_hire", kind: "casework_aggregate", outcomes: 1, orgs: 1, sourceOrgs: ["org:z"], excerpt: "PRIVATE" }));
  const g = await fresh("Golf Kitchen");
  await evidence({ org: g.o.id, place: g.p, claim: "confirmed_hire", kind: "casework_aggregate", roleFamily: "kitchen",
                   outcomes: 1, orgs: 1, sourceOrgs: ["org:g"], observed: daysAgo(20) });
  s = await standing(g.p);
  check("one consented casework hire already reads 'proven_here' (maximum use)", s?.standing === "proven_here" && s?.earns_mark === true, JSON.stringify(s));
  const [detail] = await asApp(nobody, (q) => [q`SELECT * FROM directory_public_evidence_v WHERE org_id = ${g.o.id}`]);
  const dq = detail[0] ?? {};
  check("public casework shows no site, no role, no count and no exact expiry under 3",
        detail.length === 1 && dq.place_id === null && dq.role_family === null && dq.outcome_count === null && dq.expires_on === null, JSON.stringify(detail));
  const qStart = (dt) => { const x = new Date(dt); return `${x.getUTCFullYear()}-${String(Math.floor(x.getUTCMonth() / 3) * 3 + 1).padStart(2, "0")}-01`; };
  check("public casework dates show as the start of a quarter", dq.observed_on && new Date(dq.observed_on).toISOString().slice(0, 10) === qStart(daysAgo(20)), String(dq.observed_on));
  const [board] = await asApp(nobody, (q) => [q`SELECT last_evidence_on, soonest_local_expiry FROM directory_public_v WHERE org_id = ${g.o.id}`]);
  const bq = board[0] ?? {};
  check("the board's freshness dates for casework are quarter-coarse too",
        board.length === 1 && new Date(bq.last_evidence_on).getUTCDate() === 1 && new Date(bq.soonest_local_expiry).getUTCDate() === 1, JSON.stringify(board));

  // ---- Written once --------------------------------------------------------
  for (const [label, assignment] of [
    ["renewing an expiry", "expires_on = current_date + 400"],
    ["an infinite expiry", "expires_on = 'infinity'::date"],
    ["rewriting confidence", "confidence = 'guessing'"],
    ["rewriting the source", "source_url = 'https://example.test/replacement'"],
    ["rewriting the checked date", "checked_on = current_date"],
    ["erasing locality", "place_id = NULL, scope = 'company'"],
    ["superseding by itself", "status = 'superseded', superseded_by = id"],
  ]) {
    const w = await fresh("Immutable " + label);
    const row = await evidence({ org: w.o.id, place: w.p, claim: "employer_statement" });
    await refused(label + " is refused", () => owner(`UPDATE employer_evidence SET ${assignment} WHERE id = $1`, [row.id]));
  }
  await refused("an expiry longer than the policy allows is refused on insert", () =>
    evidence({ org: a.o.id, place: a.p, claim: "employer_statement", expires: daysAgo(-900) }));
  await refused("evidence dated in the future is refused", () =>
    evidence({ org: a.o.id, place: a.p, claim: "employer_statement", observed: daysAgo(-30) }));
  const wd = await fresh("Withdrawn");
  const wdRow = await evidence({ org: wd.o.id, place: wd.p, claim: "employer_statement" });
  await owner`UPDATE employer_evidence SET status = 'withdrawn' WHERE id = ${wdRow.id}`;
  check("withdrawn evidence stops counting", (await standing(wd.p))?.standing === "lead");
  await refused("withdrawn evidence cannot be revived", () => owner`UPDATE employer_evidence SET status = 'active' WHERE id = ${wdRow.id}`);
  const sp = await fresh("Supersede");
  const oldRow = await evidence({ org: sp.o.id, place: sp.p, claim: "employer_statement", observed: daysAgo(10) });
  const newRow = await evidence({ org: sp.o.id, place: sp.p, claim: "employer_statement" });
  let superseded = true;
  try { await owner`UPDATE employer_evidence SET status = 'superseded', superseded_by = ${newRow.id} WHERE id = ${oldRow.id}`; }
  catch { superseded = false; }
  check("a newer item of the same employer may supersede an older one", superseded);

  // ---- Links never cross employers ---------------------------------------
  const x = await fresh("Cross A");
  const y = await fresh("Cross B");
  const yState = await place(y.o.id, "statewide", null, "MT");
  await refused("evidence on another employer's place is refused", () =>
    evidence({ org: x.o.id, place: yState, scope: "state", claim: "employer_statement" }));
  const yRow = await evidence({ org: y.o.id, place: y.p, claim: "employer_statement" });
  const xRow = await evidence({ org: x.o.id, place: x.p, claim: "employer_statement" });
  await refused("supersession by another employer's evidence is refused", () =>
    owner`UPDATE employer_evidence SET status = 'superseded', superseded_by = ${yRow.id} WHERE id = ${xRow.id}`);
  await refused("a requirement citing another employer's evidence is refused", () =>
    owner`INSERT INTO employer_requirement (org_id, place_id, requirement, evidence_id) VALUES (${x.o.id}, ${x.p}, 'cdl', ${yRow.id})`);
  const yRel = await liveRelationship(y.o.id, 5);
  await refused("Certain backed by another employer's relationship is refused", () =>
    evidence({ org: x.o.id, place: x.p, claim: "employer_statement", confidence: "certain", rel: yRel.rel }));
  await refused("a reply attached across employers is refused", () =>
    owner`INSERT INTO employer_reply (org_id, evidence_id, reply_text, received_on) VALUES (${x.o.id}, ${yRow.id}, 'no', ${today()})`);
  await refused("a place cannot be moved to another employer", () =>
    owner`UPDATE employer_place SET org_id = ${y.o.id} WHERE id = ${x.p}`);

  // ---- One name namespace -------------------------------------------------
  await refused("an alias cannot take another employer's name", () =>
    owner`INSERT INTO employer_alias (org_id, alias, alias_key) VALUES (${y.o.id}, 'collision', ${x.o.name_key})`);
  await owner`INSERT INTO employer_alias (org_id, alias, alias_key) VALUES (${y.o.id}, 'y other', directory_normalize_name(${P + " y other name"}))`;
  await refused("an employer cannot take another employer's alias as its name", () =>
    owner`INSERT INTO employer_org (canonical_name, name_key) VALUES (${P + " y other name"}, directory_normalize_name(${P + " y other name"}))`);

  // ---- Visibility, on every public door, aliases included ----------------
  for (const visibility of ["public", "case_managers_only", "hidden"]) {
    const v = await fresh("Visibility " + visibility, { visibility });
    await evidence({ org: v.o.id, place: v.p, claim: "employer_statement" });
    const aliasKey = v.o.name_key + " alias";
    await owner`INSERT INTO employer_alias (org_id, alias, alias_key) VALUES (${v.o.id}, ${aliasKey}, ${aliasKey})`;
    const [bd, dt, mk] = await asApp(nobody, (q) => [
      q`SELECT 1 FROM directory_public_v WHERE org_id = ${v.o.id}`,
      q`SELECT 1 FROM directory_public_evidence_v WHERE org_id = ${v.o.id}`,
      q`SELECT 1 FROM directory_mark_v WHERE name_key IN (${v.o.name_key}, ${aliasKey})`,
    ]);
    const ok = visibility === "public"
      ? bd.length === 1 && dt.length === 1 && mk.length === 2
      : bd.length === 0 && dt.length === 0 && mk.length === 0;
    check(`${visibility}: board, evidence and mark list (with alias) behave`, ok, JSON.stringify([bd.length, dt.length, mk.length]));
  }
  const [cm] = await asApp(nobody, (q) => [q`SELECT name_key, state, county FROM directory_mark_v WHERE name_key = ${a.o.name_key}`]);
  check("the mark list carries the place: state MT and county Flathead", cm.length === 1 && cm[0].state === "MT" && cm[0].county === "Flathead", JSON.stringify(cm));

  // ---- The app role ------------------------------------------------------
  for (const table of ["employer_org", "employer_alias", "employer_place", "employer_contact", "employer_relationship",
                       "employer_relationship_confirmation", "employer_evidence", "employer_signup", "employer_requirement",
                       "employer_reply", "directory_proposal", "directory_import"]) {
    for (const who of ["", nobody]) {
      const [rows] = await asApp(who, (q) => [q(`SELECT 1 FROM public.${table} LIMIT 1`)]);
      check(`${table}: nothing visible to a non-admin (${who ? "signed in" : "no user"})`, rows.length === 0, `${rows.length} rows`);
    }
  }
  for (const view of ["directory_evidence_live", "directory_place_evidence", "employer_standing_v"]) {
    let denied = false;
    try { await asApp(nobody, (q) => [q(`SELECT 1 FROM public.${view} LIMIT 1`)]); }
    catch (err) { denied = /permission denied/.test(String(err.message)); }
    check(`${view}: the app cannot open it at all`, denied);
  }
  const [upd] = await asApp(nobody, (q) => [q`UPDATE employer_org SET notes = 'intruder' WHERE id = ${a.o.id} RETURNING id`]);
  check("a non-admin update changes nothing", upd.length === 0);
  await refused("a non-admin cannot add an employer", () =>
    asApp(nobody, (q) => [q`INSERT INTO employer_org (canonical_name, name_key) VALUES (${P + " Intruder"}, directory_normalize_name(${P + " Intruder"}))`]));
  const [hn] = await asApp(nobody, (q) => [q`SELECT * FROM directory_health_v`]);
  check("a non-admin gets nothing from the health view", hn.length === 0);

  if (admin) {
    const [contacts] = await asApp(admin.user_id, (q) => [q`SELECT id FROM employer_contact WHERE org_id = ${d.o.id}`]);
    check("a platform admin reads the contact", contacts.length === 1, `${contacts.length} rows`);
    const [ins] = await asApp(admin.user_id, (q) => [q`INSERT INTO employer_org (canonical_name, name_key)
      VALUES (${P + " Admin Added"}, directory_normalize_name(${P + " Admin Added"})) RETURNING id`]);
    check("a platform admin adds an employer through the app role", ins.length === 1);
    const [health] = await asApp(admin.user_id, (q) => [q`SELECT * FROM directory_health_v`]);
    check("a platform admin reads the health view", health.length === 1);
  }

  const grantProblems = await checkEffectiveDirectoryGrants((q) => owner(q));
  check("effective privileges (direct, PUBLIC, inherited) match the restricted list", grantProblems.length === 0, grantProblems.join("; "));
} catch (err) {
  console.error("\nERROR:", err.message);
  failures++;
} finally {
  await cleanup().catch((e) => console.error("cleanup failed:", e.message));
}

console.log(failures ? `\nFAILED  ${failures} of ${checks} check(s)\n` : `\nALL PASS  (${checks} checks)\n`);
process.exit(failures ? 1 : 0);
