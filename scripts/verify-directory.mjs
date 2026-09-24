#!/usr/bin/env node
/**
 * Prove the employer directory's rules hold IN THE DATABASE (migration 061).
 *
 * The directory's promises are all SQL: evidence expires by itself, "Certain"
 * needs a live relationship, company policy never earns the mark alone, a bad
 * experience needs two independent sources, and the app role can read the
 * public doors and nothing behind them. A mock would only prove the mock. So
 * this seeds real rows on a throwaway branch and reads them back, as the owner
 * and as smr_app.
 *
 * SAFETY, same rules as verify-org-isolation.mjs: it needs
 * ISOLATION_TEST_DATABASE_URL set on purpose (never DATABASE_URL); every
 * fixture is named `__dirtest ...`; cleanup runs first and in `finally`.
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

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
const owner = neon(OWNER_URL);
const app = neon(APP_URL);
const P = "__dirtest";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : "  -- " + detail}`);
  if (!ok) failures++;
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
  await owner`DELETE FROM employer_reply WHERE evidence_id IN (SELECT id FROM employer_evidence WHERE org_id = ANY(${ids}))`;
  await owner`DELETE FROM employer_requirement WHERE org_id = ANY(${ids})`;
  await owner`UPDATE employer_evidence SET superseded_by = NULL WHERE org_id = ANY(${ids})`;
  await owner`DELETE FROM employer_evidence WHERE org_id = ANY(${ids})`;
  await owner`DELETE FROM employer_signup WHERE org_id = ANY(${ids})`;
  await owner`DELETE FROM employer_relationship WHERE org_id = ANY(${ids})`;
  await owner`DELETE FROM employer_contact WHERE org_id = ANY(${ids})`;
  await owner`DELETE FROM employer_org WHERE id = ANY(${ids})`;
}

async function org(name, extra = {}) {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const [o] = await owner`
    INSERT INTO employer_org (canonical_name, name_key, operating_model, listing_visibility)
    VALUES (${name}, ${key}, ${extra.model ?? "unknown"}, ${extra.visibility ?? "public"}) RETURNING id, name_key`;
  return o;
}
async function place(orgId, kind = "site", county = "Flathead", state = "MT") {
  const [p] = await owner`
    INSERT INTO employer_place (org_id, place_kind, city, county, state)
    VALUES (${orgId}, ${kind}, ${kind === "site" ? "Kalispell" : null}, ${county}, ${state}) RETURNING id`;
  return p.id;
}
async function evidence(o) {
  const [e] = await owner`
    INSERT INTO employer_evidence (org_id, place_id, scope, claim_type, source_kind, source_url, publisher,
                                   source_grade, confidence, relationship_id, observed_on, accessed_on,
                                   hire_count, org_count, found_by)
    VALUES (${o.org}, ${o.place ?? null}, ${o.scope ?? (o.place ? "place" : "company")}, ${o.claim},
            ${o.kind ?? "official_policy"}, ${o.url === undefined ? "https://example.test/" + Math.random() : o.url},
            ${o.publisher ?? null}, ${o.grade ?? "A"}, ${o.confidence ?? "likely"}, ${o.rel ?? null},
            ${o.observed ?? new Date().toISOString().slice(0, 10)}, ${o.accessed ?? new Date().toISOString().slice(0, 10)},
            ${o.hires ?? null}, ${o.orgs ?? null}, 'verify-directory')
    RETURNING id, expires_on`;
  return e;
}
const standing = async (placeId) => (await owner`SELECT * FROM employer_standing_v WHERE place_id = ${placeId}`)[0];
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

console.log("\nEmployer directory rules (061)\n");
try {
  await cleanup();

  // 1. A fresh, local yes earns the mark, and the mark knows WHERE.
  const a = await org(`${P} Alpha Lumber`);
  const aPlace = await place(a.id);
  const ev = await evidence({ org: a.id, place: aPlace, claim: "employer_statement", kind: "employer_direct", url: null });
  let s = await standing(aPlace);
  check("a local employer statement reads 'says_yes_here' and earns the mark", s?.standing === "says_yes_here" && s?.earns_mark === true, JSON.stringify(s));
  const exp = new Date(ev.expires_on).toISOString().slice(0, 10);
  const want = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  check("expiry defaults from the policy (90 days for an employer statement)", exp === want, `${exp} vs ${want}`);

  // 2. Expired evidence stops counting on its own.
  const b = await org(`${P} Bravo Diner`);
  const bPlace = await place(b.id);
  await evidence({ org: b.id, place: bPlace, claim: "employer_statement", kind: "employer_direct", url: null, observed: daysAgo(120), accessed: daysAgo(120) });
  s = await standing(bPlace);
  check("a 120-day-old employer statement has expired: 'lead', no mark", s?.standing === "lead" && s?.earns_mark === false, JSON.stringify(s));

  // 3. Company policy alone never earns the mark.
  const c = await org(`${P} Charlie Mart`, { model: "franchise" });
  const cPlace = await place(c.id);
  await evidence({ org: c.id, claim: "confirmed_corporate" });
  s = await standing(cPlace);
  check("company policy alone reads 'company_policy' with no mark", s?.standing === "company_policy" && s?.earns_mark === false, JSON.stringify(s));

  // 4. Certain needs a relationship; a lapsed one falls back to likely.
  let refused = false;
  try { await evidence({ org: c.id, place: cPlace, claim: "employer_statement", kind: "employer_direct", url: null, confidence: "certain" }); }
  catch (e) { refused = /evidence_certain_needs_relationship/.test(String(e.message)); }
  check("'certain' without a relationship is refused by the database", refused);

  const d = await org(`${P} Delta Freight`);
  const dPlace = await place(d.id);
  const [live] = await owner`INSERT INTO employer_relationship (org_id, avenue, started_on, last_confirmed_on, cadence_days)
                             VALUES (${d.id}, 'employer_contact', ${daysAgo(30)}, ${daysAgo(10)}, 90) RETURNING id`;
  await evidence({ org: d.id, place: dPlace, claim: "employer_statement", kind: "employer_direct", url: null, confidence: "certain", rel: live.id });
  s = await standing(dPlace);
  check("'certain' with a live relationship stays certain", s?.confidence === "certain", JSON.stringify(s));
  await owner`UPDATE employer_relationship SET started_on = ${daysAgo(400)}, last_confirmed_on = ${daysAgo(200)} WHERE id = ${live.id}`;
  s = await standing(dPlace);
  check("once the relationship lapses, the same evidence reads 'likely'", s?.confidence === "likely", JSON.stringify(s));

  // 5. One bad experience is noted; two independent ones make it mixed.
  await evidence({ org: a.id, place: aPlace, claim: "negative_experience", kind: "news", publisher: "Paper One" });
  s = await standing(aPlace);
  check("one bad-experience source does not change the standing", s?.standing === "says_yes_here", JSON.stringify(s));
  await evidence({ org: a.id, place: aPlace, claim: "negative_experience", kind: "news", publisher: "Paper Two" });
  s = await standing(aPlace);
  check("two independent bad-experience sources make it 'mixed', no mark", s?.standing === "mixed" && s?.earns_mark === false, JSON.stringify(s));

  // 6. A written no.
  const e = await org(`${P} Echo Security`);
  const ePlace = await place(e.id);
  await evidence({ org: e.id, place: ePlace, claim: "negative_written", kind: "job_posting" });
  s = await standing(ePlace);
  check("a posting that says no reads 'says_no'", s?.standing === "says_no", JSON.stringify(s));

  // 7. County evidence covers a site in that county.
  const f = await org(`${P} Foxtrot County`);
  const fSite = await place(f.id, "site");
  const fCounty = await place(f.id, "county");
  await evidence({ org: f.id, place: fCounty, scope: "county", claim: "employer_statement", kind: "official_policy" });
  s = await standing(fSite);
  check("county-level evidence covers a site in the same county", s?.standing === "says_yes_here", JSON.stringify(s));

  // 8. Casework: counted from the first report, detail coarsened in public.
  const g = await org(`${P} Golf Kitchen`);
  const gPlace = await place(g.id);
  await evidence({ org: g.id, place: gPlace, claim: "confirmed_hire", kind: "casework_aggregate", url: null, hires: 1, orgs: 1, observed: daysAgo(20) });
  s = await standing(gPlace);
  check("one consented casework hire already reads 'proven_here'", s?.standing === "proven_here" && s?.earns_mark === true, JSON.stringify(s));

  // 9. Evidence is superseded, never rewritten.
  let guarded = false;
  try { await owner`UPDATE employer_evidence SET org_id = ${b.id} WHERE org_id = ${a.id}`; }
  catch (err) { guarded = /never rewritten/.test(String(err.message)); }
  check("moving evidence to another employer is refused", guarded);

  // 10. Hidden employers never reach a public door.
  const h = await org(`${P} Hotel Hidden`, { visibility: "hidden" });
  const hPlace = await place(h.id);
  await evidence({ org: h.id, place: hPlace, claim: "employer_statement", kind: "employer_direct", url: null });
  await owner`INSERT INTO employer_contact (org_id, contact_kind, email, source_url, checked_on)
              VALUES (${a.id}, 'role_inbox', 'jobs@example.test', 'https://example.test/careers', ${daysAgo(1)})`;

  // ---- As the app role ----
  const [admin] = await owner`SELECT user_id FROM platform_admin LIMIT 1`;
  const nobody = "00000000-0000-0000-0000-000000000000";

  const [pub] = await asApp(nobody, (q) => [q`SELECT org_id, standing, earns_mark FROM directory_public_v WHERE canonical_name LIKE ${P + "%"}`]);
  check("the app reads the public board without being an admin", pub.length >= 7, `${pub.length} rows`);
  check("a hidden employer is not on the public board", !pub.some((r) => r.org_id === h.id));

  const [mark] = await asApp(nobody, (q) => [q`SELECT name_key, state, county FROM directory_mark_v WHERE name_key LIKE ${P.toLowerCase().replace(/_/g, "") + "%"} OR name_key LIKE 'dirtest%'`]);
  const keys = mark.map((m) => m.name_key);
  check("the mark list carries the place: state MT, county Flathead", mark.length > 0 && mark.every((m) => m.state === "MT"), JSON.stringify(mark));
  check("company-policy-only and hidden employers are not in the mark list", !keys.includes(c.name_key) && !keys.includes(h.name_key), JSON.stringify(keys));

  const [pubEv] = await asApp(nobody, (q) => [q`SELECT hire_count, observed_on FROM directory_public_evidence_v WHERE org_id = ${g.id}`]);
  check("a casework count under 3 is not shown publicly", pubEv.length === 1 && pubEv[0].hire_count === null, JSON.stringify(pubEv));

  const [contactsNobody] = await asApp(nobody, (q) => [q`SELECT id FROM employer_contact WHERE org_id = ${a.id}`]);
  check("a non-admin reads zero contacts", contactsNobody.length === 0, `${contactsNobody.length} rows`);

  let internalDenied = false;
  try { await asApp(nobody, (q) => [q`SELECT 1 FROM employer_standing_v LIMIT 1`]); }
  catch (err) { internalDenied = /permission denied/.test(String(err.message)); }
  check("the app cannot open the internal standing view at all", internalDenied);

  let insertDenied = false;
  try { await asApp(nobody, (q) => [q`INSERT INTO employer_org (canonical_name, name_key) VALUES (${P + " Intruder"}, 'dirtest intruder')`]); }
  catch (err) { insertDenied = /row-level security/.test(String(err.message)); }
  check("a non-admin cannot add an employer", insertDenied);

  if (admin) {
    const [contactsAdmin] = await asApp(admin.user_id, (q) => [q`SELECT id FROM employer_contact WHERE org_id = ${a.id}`]);
    check("a platform admin reads the contact", contactsAdmin.length === 1, `${contactsAdmin.length} rows`);
    const [health] = await asApp(admin.user_id, (q) => [q`SELECT * FROM directory_health_v`]);
    check("a platform admin reads the health view", health.length === 1);
  } else {
    console.log("  SKIP  admin checks (no platform_admin row on this branch)");
  }
  const [healthNobody] = await asApp(nobody, (q) => [q`SELECT * FROM directory_health_v`]);
  check("a non-admin gets nothing from the health view", healthNobody.length === 0);
} catch (err) {
  console.error("\nERROR:", err.message);
  failures++;
} finally {
  await cleanup().catch((e) => console.error("cleanup failed:", e.message));
}

console.log(failures ? `\nFAILED  ${failures} check(s)\n` : "\nALL PASS\n");
process.exit(failures ? 1 : 0);
