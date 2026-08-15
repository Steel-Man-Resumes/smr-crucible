/**
 * Phase 2.5 page-fit sanity harness. Runs the deterministic estimator on a short
 * and a dense fixture and prints pageCount / finalPageFullness / band so the
 * numbers can be eyeballed. Pure, no DB, no browser.
 *
 * Run: node --import tsx scripts/verify-25-pagefit.mjs
 */

import { computeFitPlan } from "../packages/core/src/pageFit.ts";
import { estimatePageFit } from "../packages/core/src/pageFitShared.ts";

function wc(s) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const SHORT = [
  "JORDAN RIVERS",
  "555-1212 | jordan@example.com | Milwaukee, WI",
  "Warehouse Associate",
  "",
  "PROFESSIONAL SUMMARY",
  "Reliable warehouse worker with two years moving freight safely and on time. Known for showing up early, keeping a clean dock, and training new hires without drama.",
  "",
  "PROFESSIONAL EXPERIENCE",
  "",
  "Warehouse Associate | Acme Logistics, 2023 - Present",
  "- Loaded 40 trucks a day with zero safety incidents over 18 months.",
  "- Trained 3 new hires on forklift safety and dock procedures.",
  "- Cut mis-picks by keeping the staging area organized every shift.",
  "",
  "EDUCATION & CERTIFICATIONS",
  "Forklift Certification | OSHA  2023",
  "",
].join("\n");

function dense() {
  const lines = [
    "MORGAN CASEY",
    "555-8888 | morgan.casey@example.com | Chicago, IL",
    "Operations Manager",
    "",
    "PROFESSIONAL SUMMARY",
    "Operations leader with over twenty years running distribution centers, leading large teams, and cutting costs while lifting safety and service across multiple sites and shifts every year.",
    "",
    "CORE COMPETENCIES",
    "Logistics | Safety | Lean | Scheduling | Budgets | Hiring",
    "",
    "PROFESSIONAL EXPERIENCE",
    "",
  ];
  const roles = [
    "Operations Manager | Global Freight, 2016 - Present",
    "Shift Supervisor | Regional Distribution, 2010 - 2016",
    "Warehouse Lead | Midwest Storage, 2006 - 2010",
    "Forklift Operator | City Warehousing, 2002 - 2006",
    "Loader | First Freight, 1998 - 2002",
  ];
  for (const t of roles) {
    lines.push(t);
    for (let i = 0; i < 4; i++) {
      lines.push(
        "- Led a team that moved large volumes of freight every shift while improving safety scores, cutting overtime, and keeping on-time delivery above target."
      );
    }
    lines.push("");
  }
  lines.push("EDUCATION & CERTIFICATIONS", "Associate Degree | City College  2000", "");
  return lines.join("\n");
}

function report(name, content) {
  const r = estimatePageFit(content);
  const plan = computeFitPlan(content);
  console.log(`\n=== ${name} (${wc(content)} words) ===`);
  console.log(`  pageCount        : ${r.pageCount}`);
  console.log(`  finalPageFullness: ${(r.finalPageFullness * 100).toFixed(1)}%`);
  console.log(`  band             : ${r.band}`);
  console.log(`  status           : ${plan.status}`);
  console.log(`  totalHeight/usable: ${r.totalHeightTwips} / ${r.usableHeightTwips} twips`);
  console.log(`  ledger[0]        : ${plan.ledger[0]?.message ?? "(none)"}`);
}

report("SHORT resume", SHORT);
report("DENSE resume", dense());
console.log("");
