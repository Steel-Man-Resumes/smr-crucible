/**
 * Seed: verified fair-chance employers, Grand Rapids / Kent County, MI (P2, Codex 12).
 *
 * Trial-relevant, deliberately SMALL, and primary-source-verified. Each row's
 * fair-chance signal was confirmed by reading the source page on 2026-08-07 (URLs +
 * quotes recorded in the `notes` column for audit). Five weaker candidates that only
 * appeared on a West Michigan Works "Second Chance Job Fair" participant list (no
 * employer-specific statement, event no longer running) were DROPPED -- a "Verified"
 * badge must never rest on a name in a list. Better three solid than eight shaky.
 *
 * PROMOTE-ONLY. NOT part of `npm run migrate`. Preview and prod currently share one
 * Neon DB, so running this publishes these employers to the LIVE board immediately.
 * Do NOT run it during preview-only work -- run it at promote, together with the
 * branch merge, so the board and the overhaul go live in one motion:
 *
 *   node scripts/seed-gr-kent-employers.mjs     (reads DATABASE_URL from consumer env)
 *
 * Idempotent: upserts on (source, source_record_id) = ('manual-gr-kent', <slug>).
 * Re-run any time to refresh copy or re-verify.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(root, "apps/consumer/.env.local"), "utf8");
const url = env
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL="))
  .slice(13)
  .replace(/"/g, "");

const VERIFIED = "2026-08-07";

const EMPLOYERS = [
  {
    slug: "gr-cascade-engineering",
    name: "Cascade Engineering",
    industry: "Plastics manufacturing",
    primary_city: "Grand Rapids, MI",
    role_types: "Production, Assembly, Machine operation, Plant operations",
    website: "https://www.cascadeng.com/",
    careers_url: "https://www.cascadeng.com/careers/",
    confidence_tier: "A",
    evidence_type: "own-website",
    why:
      "Cascade Engineering says on its own careers site that it actively hires returning citizens and does not ask about criminal history on the initial application. Hiring is based on readiness to work, not your record.",
    caveats:
      "This describes company-wide practice, not a guarantee for every role. Some safety-sensitive positions may still involve an individualized review.",
    source_url: "https://www.cascadeng.com/about/people/",
    quote:
      "We believe in second chances. That's why Cascade Engineering actively hires returning citizens... No criminal history questions on initial applications. Hiring decisions based on potential and readiness to work.",
  },
  {
    slug: "gr-montage-furniture-services",
    name: "Montage Furniture Services",
    industry: "Furniture services / warehouse & logistics",
    primary_city: "Grand Rapids, MI",
    role_types: "Warehouse, Parts processing, Logistics support, Field delivery",
    website: "https://www.montagefs.com/",
    careers_url: null,
    confidence_tier: "B+",
    evidence_type: "reentry-network",
    why:
      "A senior HR leader at Montage Furniture Services publicly said second-chance hiring has been an outstanding source of talent, and that they have hired several strong employees through these programs.",
    caveats:
      "That statement came through a West Michigan Works hiring event, not a standing written policy. Confirm current openings and practices directly with the employer.",
    source_url: "https://www.westmiworks.org/blog/jobs/second-chance-job-fair/",
    quote:
      "Working with second chance programs has been an outstanding source of talent for our organization. -- John McMahon, senior HR generalist, Montage Furniture Services",
  },
  {
    slug: "gr-rapid-line",
    name: "Rapid-Line",
    industry: "Metal fabrication manufacturing",
    primary_city: "Wyoming, MI",
    role_types: "General labor, Press brake operator, Machinist, Welder, Laser operator, Painter",
    website: "https://www.rapid-line.com/",
    careers_url: "https://www.rapid-line.com/employment/",
    confidence_tier: "B",
    evidence_type: "reentry-network",
    why:
      "Rapid-Line was a featured employer at West Michigan Works' Second Chance Job Fair for returning citizens and describes itself as focused on equal-opportunity employment in the community it operates in.",
    caveats:
      "The signal comes from a West Michigan Works job fair that is not currently running. Confirm current hiring practices directly with Rapid-Line.",
    source_url: "https://www.westmiworks.org/blog/jobs/meet-employer-second-chance-job-fair/",
    quote:
      "We are here for more than making money. We want to engage the community and provide equal opportunity employment to the community we operate in.",
  },
];

const c = new pg.Client({ connectionString: url });
await c.connect();

const before = await c.query("SELECT count(*)::int n FROM employer WHERE published");
let n = 0;
for (const e of EMPLOYERS) {
  await c.query(
    `INSERT INTO employer
       (source, source_record_id, name, industry, primary_city, county, wi_region,
        website, careers_url, role_types, evidence_summary, evidence_type, caveats,
        confidence_tier, board_fit, verification_status, last_verified, published, notes)
     VALUES ('manual-gr-kent', $1, $2, $3, $4, 'Kent', NULL,
        $5, $6, $7, $8, $9, $10, $11, 'Good', 'verified', $12, true, $13)
     ON CONFLICT (source, source_record_id) DO UPDATE SET
        name = EXCLUDED.name, industry = EXCLUDED.industry, primary_city = EXCLUDED.primary_city,
        website = EXCLUDED.website, careers_url = EXCLUDED.careers_url, role_types = EXCLUDED.role_types,
        evidence_summary = EXCLUDED.evidence_summary, evidence_type = EXCLUDED.evidence_type,
        caveats = EXCLUDED.caveats, confidence_tier = EXCLUDED.confidence_tier,
        board_fit = EXCLUDED.board_fit, verification_status = EXCLUDED.verification_status,
        last_verified = EXCLUDED.last_verified, published = EXCLUDED.published,
        notes = EXCLUDED.notes, updated_at = now()`,
    [
      e.slug, e.name, e.industry, e.primary_city, e.website, e.careers_url, e.role_types,
      e.why, e.evidence_type, e.caveats, e.confidence_tier, VERIFIED,
      `Fair-chance signal verified ${VERIFIED} at ${e.source_url} -- "${e.quote}"`,
    ]
  );
  n++;
  console.log(`  upserted: ${e.name} [${e.confidence_tier}]`);
}

const after = await c.query("SELECT count(*)::int n FROM employer WHERE published");
console.log(`\nSeeded ${n} GR/Kent employers. Published board: ${before.rows[0].n} -> ${after.rows[0].n}.`);
await c.end();
