/**
 * On-demand sync of per-org tracking from Neon -> Airtable (SMR partners base).
 *
 *   npx tsx packages/core/scripts/sync-partner-tracking.ts
 *
 * Reads DATABASE_URL + AIRTABLE_API_KEY + AIRTABLE_TRACKING_BASE_ID from
 * apps/consumer/.env.local. Uses the same core routine as the nightly cron
 * route (/api/cron/sync-tracking), so both write identical shapes. No PII.
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const txt = readFileSync(resolve(process.cwd(), "apps/consumer/.env.local"), "utf8");
for (const line of txt.split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_TRACKING_BASE_ID;
  if (!apiKey || !baseId) {
    throw new Error("AIRTABLE_API_KEY + AIRTABLE_TRACKING_BASE_ID required in apps/consumer/.env.local");
  }
  const { syncPartnerTrackingToAirtable } = await import("../src/partnerTracking");
  const { orgs } = await syncPartnerTrackingToAirtable({ apiKey, baseId });
  console.log(`Synced ${orgs} organizations + ${orgs} snapshot rows to base ${baseId}.`);
})();
