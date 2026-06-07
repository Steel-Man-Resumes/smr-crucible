/**
 * Import verified fair-chance employers from the SMR Employers Airtable into the
 * `employer` table. Idempotent (upsert on Airtable record id). Re-run to refresh.
 *
 *   npx tsx packages/core/scripts/import-employers.ts
 *
 * Reads AIRTABLE_API_KEY + AIRTABLE_SMR_EMPLOYERS_BASE_ID + DATABASE_URL from
 * apps/consumer/.env.local (no secrets on the shell). Publishes conservatively:
 * only Board Fit = "Good" rows are shown to job seekers; everything else is
 * imported as a lead (published = false) for outreach/admin.
 */

const PUBLISHABLE_BOARD_FIT = new Set(["Excellent", "Good"]);

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const txt = readFileSync(resolve(process.cwd(), "apps/consumer/.env.local"), "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const F = (fields: Record<string, any>, key: string) => {
  const v = fields[key];
  if (v === undefined || v === null || v === "") return null;
  return typeof v === "object" && v.name ? v.name : v; // singleSelect safety
};
const NUM = (v: any) => (v === null || v === undefined || v === "" ? null : Number(v));

(async () => {
  loadEnv();
  const KEY = process.env.AIRTABLE_API_KEY;
  const BASE = process.env.AIRTABLE_SMR_EMPLOYERS_BASE_ID;
  if (!KEY || !BASE) throw new Error("AIRTABLE_API_KEY / AIRTABLE_SMR_EMPLOYERS_BASE_ID missing");
  const { upsertEmployer, getEmployerStats } = await import("../src/employer");

  // Pull all Employers records (paginated).
  const records: { id: string; fields: Record<string, any> }[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/Employers`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { records: typeof records; offset?: string };
    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  let published = 0;
  for (const rec of records) {
    const f = rec.fields;
    const isPublished = PUBLISHABLE_BOARD_FIT.has(F(f, "Board Fit"));
    if (isPublished) published++;
    await upsertEmployer({
      source: "airtable",
      source_record_id: rec.id,
      name: F(f, "Employer / Org") || "(unnamed)",
      employer_type: F(f, "Employer Type"),
      industry: F(f, "Industry"),
      primary_city: F(f, "Primary City"),
      county: F(f, "County"),
      wi_region: F(f, "WI Region"),
      address: F(f, "Address"),
      phone: F(f, "Phone"),
      email: F(f, "Email"),
      contact_person: F(f, "Contact Person"),
      website: F(f, "Website"),
      careers_url: F(f, "Careers / Apply URL"),
      linkedin: F(f, "LinkedIn"),
      role_types: F(f, "Role Types Seen"),
      evidence_summary: F(f, "Evidence Summary"),
      evidence_type: F(f, "Evidence Type"),
      caveats: F(f, "Caveats / Applicant Notes"),
      confidence_tier: F(f, "Confidence Tier"),
      confidence_score: NUM(F(f, "Confidence Score")),
      rank: NUM(F(f, "Rank")),
      board_fit: F(f, "Board Fit"),
      publish_recommendation: F(f, "Publish Recommendation"),
      verification_status: F(f, "Verification Status"),
      follow_up_priority: F(f, "Follow-Up Priority"),
      suggested_outreach_ask: F(f, "Suggested Outreach Ask"),
      tags: F(f, "Airtable Tags"),
      status: F(f, "Status"),
      last_verified: F(f, "Last Verified"),
      published: isPublished,
    } as any);
  }

  const stats = await getEmployerStats();
  console.log(`Imported ${records.length} employers. Published (Board Fit Excellent/Good): ${published}.`);
  console.log("DB stats:", JSON.stringify(stats));
  process.exit(0);
})().catch((e) => {
  console.error("Import failed:", e);
  process.exit(1);
});
