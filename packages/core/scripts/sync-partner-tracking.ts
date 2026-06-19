/**
 * Sync per-organization tracking from Neon -> Airtable (SMR Partner Tracking base).
 *
 *   npx tsx packages/core/scripts/sync-partner-tracking.ts
 *
 * Reads DATABASE_URL + AIRTABLE_API_KEY + AIRTABLE_TRACKING_BASE_ID from
 * apps/consumer/.env.local. Idempotent:
 *   - "Organizations" table: one row per org, upserted on the Code field.
 *   - "Snapshots" table: one dated row per org per run (trend history).
 *
 * No PII -- counts, rates, timestamps only. Safe to run on a cron.
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const txt = readFileSync(resolve(process.cwd(), "apps/consumer/.env.local"), "utf8");
for (const line of txt.split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_TRACKING_BASE_ID;
const ORGS_TABLE = "Organizations";
const SNAPSHOTS_TABLE = "Snapshots";

async function air(method: string, path: string, body?: unknown) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Airtable ${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  if (!API_KEY || !BASE_ID) throw new Error("AIRTABLE_API_KEY + AIRTABLE_TRACKING_BASE_ID required (set in apps/consumer/.env.local)");

  const { getPartnerTrackingRows } = await import("../src/partnerTracking");
  const rows = await getPartnerTrackingRows();
  const today = new Date().toISOString().slice(0, 10);

  // Map existing Organizations rows by Code for upsert.
  const existing: Record<string, string> = {};
  let offset: string | undefined;
  do {
    const page: any = await air("GET", `${encodeURIComponent(ORGS_TABLE)}?pageSize=100${offset ? `&offset=${offset}` : ""}`);
    for (const r of page.records) if (r.fields.Code) existing[r.fields.Code] = r.id;
    offset = page.offset;
  } while (offset);

  let upserts = 0;
  for (const o of rows) {
    const fields = {
      Code: o.code,
      Organization: o.partner_name,
      Tier: o.tier,
      Active: o.is_active,
      "Seats Used": o.seats_used,
      "Seats Total": o.seats_total ?? undefined,
      Participants: o.attributed_users,
      "Tool Uses": o.tool_calls,
      "Forge Started": o.funnel.forge_sessions_started,
      "Forge Completed": o.funnel.forge_sessions_completed,
      "Refinery Users": o.funnel.refinery_users,
      Applications: o.funnel.applications_logged,
      Interviews: o.funnel.interviews,
      Offers: o.funnel.offers,
      Hires: o.funnel.hires,
      "Forge Completion %": o.forge_completion_rate,
      "Placement %": o.placement_rate,
      "Last Activity": o.last_activity ?? undefined,
      Updated: new Date().toISOString(),
    };
    if (existing[o.code]) {
      await air("PATCH", encodeURIComponent(ORGS_TABLE), { records: [{ id: existing[o.code], fields }] });
    } else {
      await air("POST", encodeURIComponent(ORGS_TABLE), { records: [{ fields }] });
    }
    upserts++;

    // Append a dated snapshot row (trend history).
    await air("POST", encodeURIComponent(SNAPSHOTS_TABLE), {
      records: [{
        fields: {
          Snapshot: `${today} ${o.code}`,
          Date: today,
          Code: o.code,
          Organization: o.partner_name,
          Participants: o.attributed_users,
          "Tool Uses": o.tool_calls,
          "Forge Completed": o.funnel.forge_sessions_completed,
          Hires: o.funnel.hires,
          "Placement %": o.placement_rate,
        },
      }],
    });
  }

  console.log(`Synced ${upserts} organizations + ${upserts} snapshot rows to base ${BASE_ID}.`);
})();
