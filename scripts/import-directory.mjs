#!/usr/bin/env node
/**
 * Import the employer research ledger (prospect-machine's employer_intel export)
 * into the directory tables from migration 061, then report what the rules make
 * of it: how many places land in each standing, per state, and which earn the mark.
 *
 *   DIRECTORY_IMPORT_DATABASE_URL=... node scripts/import-directory.mjs [--source path] [--production]
 *
 * DRY RUN = run it against a throwaway database (a branch of the preview
 * project), read the report, delete the branch. Nothing about production changes.
 *
 * SAFETY
 *   - The target comes only from DIRECTORY_IMPORT_DATABASE_URL, never DATABASE_URL.
 *   - It refuses the production endpoint unless --production is passed.
 *   - Idempotent: every source row is recorded in directory_import and skipped on
 *     a second run.
 *   - Owner connection required (it writes platform-admin tables directly).
 *
 * MAPPING RULES (each one is a choice; the report counts what each did)
 *   - Names are re-keyed with normalizeEmployerName(); two ledger rows that
 *     normalize to the same key become one employer.
 *   - Places: a location with no state is skipped and becomes a review proposal.
 *     A location listing several cities or counties ("Milwaukee; Waukesha")
 *     becomes a service_area with no county, so nothing inherits from it.
 *   - Evidence: the ledger's classification becomes the claim type. Nothing is
 *     imported as Certain: no relationship record exists yet. Likely needs an
 *     A or B source with a link and an access date; everything else is Guessing.
 *   - The observed date is the day the source was read. Expiry follows the
 *     policy, so old evidence arrives already expired. That is the point.
 *   - Contacts: only unnamed role contacts are imported. Named people stay in
 *     connections-intel; each becomes a review proposal instead.
 *   - Open research questions become review proposals.
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROD_ENDPOINT = "ep-little-cloud-aphpkqbd";
const args = process.argv.slice(2);
const argVal = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const SOURCE = resolve(argVal("--source") ?? resolve(HERE, "../../prospect-machine/output/employer-intel/employer-intel.json"));
const TARGET = process.env.DIRECTORY_IMPORT_DATABASE_URL;
if (!TARGET) { console.error("\nSet DIRECTORY_IMPORT_DATABASE_URL (an owner connection). Never DATABASE_URL.\n"); process.exit(2); }
const isProd = new URL(TARGET).hostname.includes(PROD_ENDPOINT);
if (isProd && !args.includes("--production")) { console.error("\nREFUSING: production endpoint. Pass --production only on purpose.\n"); process.exit(2); }

const { normalizeEmployerName } = await import(resolve(HERE, "../packages/core/dist/employer.js"));
const sql = neon(TARGET);
const data = JSON.parse(readFileSync(SOURCE, "utf8"));
const today = new Date().toISOString().slice(0, 10);
const FOUND_BY = "employer_intel import";

const counts = {};
const bump = (k, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
const cap = (s, n) => (s == null ? null : String(s).slice(0, n));
const date = (s) => (s ? String(s).slice(0, 10) : null);

// ---- Already imported? -----------------------------------------------------
const seen = new Map();
const seenPlace = new Map(); // ledger location id -> neon place id, from an earlier run
for (const r of await sql`SELECT source_table, external_id, org_id, raw->>'place_id' AS place_id FROM directory_import WHERE source_system = 'employer_intel'`) {
  seen.set(`${r.source_table}:${r.external_id}`, r.org_id);
  if (r.source_table === "locations" && r.place_id) seenPlace.set(Number(r.external_id), r.place_id);
}
const existingOrgs = new Map((await sql`SELECT id, name_key FROM employer_org`).map((r) => [r.name_key, r.id]));

// ---- Organizations ---------------------------------------------------------
const orgById = new Map(); // ledger org id -> { id, key, model, kind }
const byKey = new Map();
const assessmentsByOrg = new Map();
for (const a of data.assessments) {
  if (!assessmentsByOrg.has(a.organization_id)) assessmentsByOrg.set(a.organization_id, []);
  assessmentsByOrg.get(a.organization_id).push(a);
}
const statements = [];
for (const o of data.organizations) {
  const key = normalizeEmployerName(o.canonical_name);
  if (key.length < 2) { bump("org skipped: empty name"); continue; }
  const text = (assessmentsByOrg.get(o.id) ?? []).map((a) => `${a.claim ?? ""} ${a.limitations ?? ""}`).join(" ").toLowerCase();
  // A researcher's explicit marker wins ([operating_model=...] in the ledger's
  // notes); otherwise a franchise mention in the evidence; otherwise unknown.
  const marked = /\[operating_model=(independent|franchise|corporate)\]/.exec(o.notes ?? "");
  const model = marked ? marked[1] : /franchis/.test(text) ? "franchise" : "unknown";
  // Public employers are often recorded as plain "employer" in the ledger. A
  // name like "Flathead County" or "City of Milwaukee", or a government
  // industry, marks them government, which lets their own policy count as
  // local (migration 062).
  const isGov = o.organization_type === "government"
    || (o.organization_type === "employer" && (/^(city|county|state|town|village) of\b|\bcounty$/i.test(o.canonical_name.trim())
                                              || /\bgovernment\b/i.test(o.industry ?? "")));
  const kind = isGov ? "government"
    : ["ecosystem_partner", "association"].includes(o.organization_type) ? "ecosystem_partner"
    : /staffing/i.test(o.industry ?? "") ? "staffing_agency" : "employer";
  let rec = byKey.get(key);
  if (!rec) {
    const id = existingOrgs.get(key) ?? randomUUID();
    rec = { id, key, model, kind };
    byKey.set(key, rec);
    if (!existingOrgs.has(key)) {
      statements.push(sql`INSERT INTO employer_org (id, canonical_name, name_key, org_kind, industry, website, careers_url, operating_model, notes)
        VALUES (${id}, ${cap(o.canonical_name, 200)}, ${key}, ${kind}, ${o.industry}, ${o.website}, ${o.careers_url}, ${model}, ${cap(o.notes, 4000)})`);
      bump("orgs created");
    } else bump("orgs already present");
  } else {
    bump("orgs merged into an existing key");
    if (model === "franchise") rec.model = "franchise";
  }
  orgById.set(o.id, rec);
  if (!seen.has(`organizations:${o.id}`)) {
    statements.push(sql`INSERT INTO directory_import (source_system, source_table, external_id, org_id, raw)
      VALUES ('employer_intel', 'organizations', ${String(o.id)}, ${rec.id}, ${JSON.stringify(o)}) ON CONFLICT DO NOTHING`);
  }
}
// A merge can reveal a franchise after the first insert.
for (const rec of byKey.values()) {
  if (rec.model === "franchise") statements.push(sql`UPDATE employer_org SET operating_model = 'franchise' WHERE id = ${rec.id}`);
}
await sql.transaction(statements);
statements.length = 0;

// ---- Aliases -----------------------------------------------------------------
const aliasTaken = new Set((await sql`SELECT alias_key FROM employer_alias`).map((r) => r.alias_key));
for (const a of data.organization_aliases) {
  const rec = orgById.get(a.organization_id);
  if (!rec) continue;
  const key = normalizeEmployerName(a.alias);
  if (key.length < 2 || key === rec.key || aliasTaken.has(key)) { bump("aliases skipped (same as name or taken)"); continue; }
  if (byKey.has(key) && byKey.get(key).id !== rec.id) { bump("aliases skipped (another employer's name)"); continue; }
  aliasTaken.add(key);
  statements.push(sql`INSERT INTO employer_alias (org_id, alias, alias_key, source) VALUES (${rec.id}, ${a.alias}, ${key}, 'employer_intel')`);
  bump("aliases created");
}

// ---- Places --------------------------------------------------------------------
const placeById = new Map(); // ledger location id -> neon place id
const proposals = [];
for (const l of data.locations) {
  const rec = orgById.get(l.organization_id);
  if (!rec) continue;
  const state = (l.state ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) {
    bump("places skipped: no state");
    proposals.push({ kind: "review", org: rec.id, reason: `Location "${l.label ?? l.city ?? "?"}" has no state; add it before it can carry evidence.`, payload: l });
    continue;
  }
  if (seenPlace.has(l.id)) { placeById.set(l.id, seenPlace.get(l.id)); bump("places already present"); continue; }
  const multi = /;/.test(l.county ?? "") || /;/.test(l.city ?? "");
  const id = randomUUID();
  placeById.set(l.id, id);
  statements.push(sql`INSERT INTO directory_import (source_system, source_table, external_id, org_id, raw)
    VALUES ('employer_intel', 'locations', ${String(l.id)}, ${rec.id}, ${JSON.stringify({ location: l, place_id: id })}) ON CONFLICT DO NOTHING`);
  statements.push(sql`INSERT INTO employer_place (id, org_id, place_kind, label, address, city, county, state, postal_code, operating_confirmed_on)
    VALUES (${id}, ${rec.id}, ${multi ? "service_area" : "site"}, ${l.label ?? (multi ? `${l.city ?? ""} (${l.county ?? ""})` : null)},
            ${l.address || null}, ${multi ? null : l.city || null}, ${multi ? null : l.county || null}, ${state},
            ${l.postal_code}, ${date(l.verified_on)})`);
  bump(multi ? "places created: multi-area service_area" : "places created: site");
}
await sql.transaction(statements);
statements.length = 0;

// ---- Evidence ----------------------------------------------------------------------
const CLAIM = { confirmed_corporate: "confirmed_corporate", direct_role_signal: "direct_role_signal",
                candidate_unverified: "candidate_unverified", ecosystem_partner: "ecosystem_partner" };
const asmById = new Map(data.assessments.map((a) => [a.id, a]));
for (const e of data.evidence) {
  if (seen.has(`evidence:${e.id}`)) { bump("evidence already imported"); continue; }
  const a = asmById.get(e.assessment_id);
  const rec = orgById.get(e.organization_id);
  let claim = CLAIM[a?.classification];
  // Directory rule (grading, 2026-09-24): coalition or pledge membership shows
  // what a company signed, not what it does. It is context, never a policy yes.
  const pledgeText = `${e.source_url ?? ""} ${e.claim_supported ?? ""} ${e.publisher ?? ""}`.toLowerCase();
  if (claim === "confirmed_corporate" && e.source_kind !== "official_policy"
      && /secondchancebusinesscoalition|second chance business coalition|coalition member|pledge/.test(pledgeText)) {
    claim = "context_only";
    bump("evidence re-graded: pledge/coalition -> context_only");
  }
  if (!a || !rec || !claim) { bump("evidence skipped: no usable assessment"); continue; }
  // A role signal needs a real job title. Legacy Airtable rows carry labels
  // like "Legacy Airtable source 1" or "CRST careers" instead, which can never
  // match a listing and are not evidence of a role; they arrive as leads.
  const roleTitle = cap(e.source_title || a.claim || "", 200);
  if (claim === "direct_role_signal" && /legacy airtable source|careers?$|employment opportunit|^job posting$|^\s*$/i.test(roleTitle)) {
    claim = "candidate_unverified";
    bump("evidence re-graded: role signal without a job title -> lead");
  }
  const placeId = a.location_id ? placeById.get(a.location_id) ?? null : null;
  let scope;
  if (claim === "confirmed_corporate" || claim === "context_only") scope = "company";
  else if (claim === "direct_role_signal") scope = "role";
  else scope = placeId ? "place" : "company";
  // The fact's own date when the source gives one (a 2023 press release is a
  // 2023 fact, however recently it was read); otherwise the day it was read.
  const published = date(e.published_on);
  const observed = (published && published <= today ? published : null) ?? date(e.accessed_on) ?? date(a.verified_on) ?? today;
  if (observed > today) { bump("evidence skipped: future date"); continue; }
  const grade = ["A", "B", "C", "D"].includes(e.evidence_grade) ? e.evidence_grade : "D";
  const likely = ["A", "B"].includes(grade) && e.source_url && e.accessed_on;
  const kinds = ["official_policy", "job_posting", "official_program", "official_location", "news", "aggregator", "directory", "legacy_import"];
  const kind = kinds.includes(e.source_kind) ? e.source_kind : "legacy_import";
  if (!e.source_url) { bump("evidence skipped: no link"); continue; }
  statements.push(sql`INSERT INTO employer_evidence (org_id, place_id, scope, claim_type, role_title, source_kind, source_url, source_title,
      publisher, excerpt, source_grade, confidence, confidence_score, observed_on, accessed_on, found_by, limitations)
    VALUES (${rec.id}, ${scope === "company" ? null : placeId}, ${scope}, ${claim},
            ${scope === "role" ? roleTitle : null},
            ${kind}, ${e.source_url}, ${cap(e.source_title, 300)}, ${cap(e.publisher, 200)}, ${cap(e.claim_supported, 500)},
            ${grade}, ${likely ? "likely" : "guessing"}, ${a.confidence ?? null}, ${observed}, ${date(e.accessed_on)},
            ${FOUND_BY}, ${cap(a.limitations, 2000)})`);
  statements.push(sql`INSERT INTO directory_import (source_system, source_table, external_id, org_id, raw)
    VALUES ('employer_intel', 'evidence', ${String(e.id)}, ${rec.id}, ${JSON.stringify({ evidence: e, assessment: a })}) ON CONFLICT DO NOTHING`);
  bump(`evidence created: ${claim}`);
  bump(`evidence confidence: ${likely ? "likely" : "guessing"}`);
  if (statements.length >= 80) { await sql.transaction(statements); statements.length = 0; }
}
if (statements.length) { await sql.transaction(statements); statements.length = 0; }

// ---- Business contacts the employer publishes (careers inbox, HR line, form) -----------
const CONTACTS = resolve(dirname(SOURCE), "../../data/business_contacts.jsonl");
let contactLines = [];
try { contactLines = readFileSync(CONTACTS, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)); }
catch { /* no contacts file yet */ }
for (const c of contactLines) {
  const rec = byKey.get(normalizeEmployerName(c.organization ?? ""));
  if (!rec || !["role_inbox", "hr_line", "careers_form"].includes(c.kind) || !c.value || !c.source_url) { bump("business contacts skipped"); continue; }
  const ext = `${rec.key}|${c.value}`.slice(0, 300);
  if (seen.has(`business_contacts:${ext}`)) { bump("business contacts already present"); continue; }
  const email = c.kind === "role_inbox" ? c.value : null;
  const phone = c.kind === "hr_line" ? c.value : null;
  const form = c.kind === "careers_form" ? c.value : null;
  statements.push(sql`INSERT INTO employer_contact (org_id, contact_kind, email, phone, form_url, source_url, checked_on)
    VALUES (${rec.id}, ${c.kind}, ${email}, ${phone}, ${form}, ${c.source_url}, ${date(c.checked_on) ?? today})`);
  statements.push(sql`INSERT INTO directory_import (source_system, source_table, external_id, org_id, raw)
    VALUES ('employer_intel', 'business_contacts', ${ext}, ${rec.id}, ${JSON.stringify(c)}) ON CONFLICT DO NOTHING`);
  bump("business contacts created");
}
if (statements.length) { await sql.transaction(statements); statements.length = 0; }

// ---- Contacts and open questions become proposals -------------------------------------
for (const c of data.contacts) {
  const rec = orgById.get(c.organization_id);
  if (!rec) continue;
  if (c.name) {
    bump("contacts NOT imported: named person (stays in connections-intel)");
    proposals.push({ kind: "contact_update", org: rec.id, reason: "A named person from research. Import only if the employer publishes them in a business role.", payload: { title: c.title, source_url: c.source_url } });
  }
}
for (const q of data.research_queue ?? []) {
  const rec = orgById.get(q.organization_id);
  if (!rec || q.status === "resolved" || q.status === "done") continue;
  proposals.push({ kind: "review", org: rec.id, reason: cap(q.question, 2000), payload: { reason: q.reason, priority: q.priority, due_on: q.due_on } });
  bump("open research questions -> proposals");
}
for (const p of proposals) {
  // One proposal per source item, however often the import runs.
  const pkey = `${p.kind}:${p.org}:${p.reason}`.slice(0, 500);
  if (seen.has(`proposals:${pkey}`)) { bump("proposals already present"); continue; }
  statements.push(sql`INSERT INTO directory_import (source_system, source_table, external_id, org_id, raw)
    VALUES ('employer_intel', 'proposals', ${pkey}, ${p.org}, ${JSON.stringify(p.payload ?? {})}) ON CONFLICT DO NOTHING`);
  bump("proposals created");
  statements.push(sql`INSERT INTO directory_proposal (kind, target_org_id, payload, proposed_by, reason)
    VALUES (${p.kind}, ${p.org}, ${JSON.stringify(p.payload)}, ${FOUND_BY}, ${p.reason ?? "review"})`);
  if (statements.length >= 80) { await sql.transaction(statements); statements.length = 0; }
}
if (statements.length) await sql.transaction(statements);

// ---- The report -------------------------------------------------------------------
console.log(`\nDirectory import -- ${isProd ? "PRODUCTION" : "non-production target"} -- ${today}\n`);
console.log("What the import did:");
for (const k of Object.keys(counts).sort()) console.log(`  ${String(counts[k]).padStart(4)}  ${k}`);

const rows = await sql`
  SELECT pl.state, st.standing, st.earns_mark, count(*)::int AS n
    FROM employer_standing_v st JOIN employer_place pl ON pl.id = st.place_id
   GROUP BY 1, 2, 3 ORDER BY 1, 4 DESC`;
console.log("\nPlaces by state and standing (today's rules, today's date):");
let last = "";
for (const r of rows) {
  if (r.state !== last) { console.log(`  ${r.state}`); last = r.state; }
  console.log(`    ${String(r.n).padStart(4)}  ${r.standing}${r.earns_mark ? "  (mark)" : ""}`);
}
const marked = await sql`
  SELECT o.canonical_name, pl.city, pl.county, pl.state, st.standing, st.confidence, st.soonest_local_expiry
    FROM employer_standing_v st JOIN employer_place pl ON pl.id = st.place_id JOIN employer_org o ON o.id = st.org_id
   WHERE st.earns_mark ORDER BY pl.state, o.canonical_name`;
console.log(`\nPlaces that earn "Hires people with records" today: ${marked.length}`);
for (const m of marked) console.log(`  ${m.state}  ${m.canonical_name} -- ${m.city ?? m.county ?? ""} -- ${m.standing}, ${m.confidence}, expires ${String(m.soonest_local_expiry).slice(0, 10)}`);
const pilot = await sql`
  SELECT st.standing, string_agg(DISTINCT o.canonical_name, '; ' ORDER BY o.canonical_name) AS names, count(DISTINCT o.id)::int AS n
    FROM employer_standing_v st JOIN employer_place pl ON pl.id = st.place_id JOIN employer_org o ON o.id = st.org_id
   WHERE pl.state = 'MT' AND lower(coalesce(pl.county, '')) IN ('lincoln', 'flathead', 'sanders')
   GROUP BY st.standing ORDER BY n DESC`;
console.log("\nNW Montana pilot area (Lincoln, Flathead, Sanders), employers by standing:");
for (const r of pilot) console.log(`  ${String(r.n).padStart(3)}  ${r.standing}: ${r.names}`);
const roleMarks = await sql`SELECT count(DISTINCT name_key)::int n FROM directory_mark_v WHERE basis = 'role'`;
console.log(`\nEmployers with a role-only mark (a live posting for one role): ${roleMarks[0].n}`);
const [h] = await sql`SELECT count(*) FILTER (WHERE status = 'active' AND expires_on < current_date)::int expired,
                             count(*) FILTER (WHERE status = 'active' AND expires_on >= current_date)::int live FROM employer_evidence`;
console.log(`Evidence: ${h.live} live, ${h.expired} already expired on arrival`);
const [pp] = await sql`SELECT count(*)::int n FROM directory_proposal WHERE status = 'pending'`;
console.log(`Review proposals waiting: ${pp.n}\n`);
