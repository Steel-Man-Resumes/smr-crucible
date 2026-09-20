#!/usr/bin/env node
/**
 * Put the demo orgs back to "nothing shared yet", so the ask -> approve ->
 * read story can be performed live from the beginning.
 *
 *   node scripts/reset-demo-sharing.mjs
 *
 * DEMO ORGS ONLY: every statement is restricted to organizations whose name
 * ends in "(Demo)". It deletes sharing history, requests, case notes and the
 * access-log entries they produced. The application can do none of that --
 * sharing history and notes are not deletable by the app role, on purpose --
 * so this needs the owner credential, and it is only ever right for fiction.
 * Participant materials (resume, applications) are left in place.
 *
 * FOR THE MONTANA DEMO ORG USE `seed-demo-cohort.mjs` INSTEAD. That script IS
 * the reset: it rebuilds all six personas, including the people who are meant
 * to START with something shared. This one would leave them sharing nothing.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { assertBypassRole } from "./lib/assert-bypass-role.mjs";

const line = readFileSync("apps/consumer/.env.local", "utf8").split("\n").find((l) => l.trim().startsWith("DATABASE_URL="));
const sql = neon(line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""));
await assertBypassRole((q) => sql(q), "reset-demo-sharing");

const demo = await sql`SELECT id, partner_name FROM access_code WHERE partner_name LIKE '%(Demo)'`;
const ids = demo.map((d) => d.id);
if (ids.length === 0) { console.log("No demo orgs."); process.exit(0); }

const notes = await sql`DELETE FROM case_note WHERE access_code_id = ANY(${ids}::uuid[]) RETURNING id`;
const reqs = await sql`DELETE FROM sharing_request WHERE access_code_id = ANY(${ids}::uuid[]) RETURNING id`;
const grants = await sql`DELETE FROM sharing_grant WHERE access_code_id = ANY(${ids}::uuid[]) RETURNING id`;
const log = await sql`DELETE FROM data_access_log
   WHERE access_reason = 'org_client_view' AND fields_accessed->>'orgId' = ANY(${ids.map(String)}::text[]) RETURNING id`;
console.log(`Reset ${demo.length} demo orgs: ${grants.length} grants, ${reqs.length} requests, ${notes.length} notes, ${log.length} access-log entries removed.`);
