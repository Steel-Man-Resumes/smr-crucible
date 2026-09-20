#!/usr/bin/env node
/**
 * Give ONE demo participant something to share: a resume, a cover letter and a
 * handful of job applications. Without this the client page demo is a case
 * manager asking to see an empty library.
 *
 *   node scripts/seed-demo-materials.mjs
 *
 * DEMO ORGS ONLY, and it checks: the person must belong to an organization
 * whose name ends in "(Demo)" and have an @...example.invalid address.
 * Everything here is fiction. Idempotent: does nothing if they already have
 * materials. Owner credential required (it writes participant-owned rows).
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { assertBypassRole } from "./lib/assert-bypass-role.mjs";

const EMAIL = process.argv[2] || "wes.duvall@mtdemo.example.invalid";
const line = readFileSync("apps/consumer/.env.local", "utf8").split("\n").find((l) => l.trim().startsWith("DATABASE_URL="));
const sql = neon(line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""));
await assertBypassRole((q) => sql(q), "seed-demo-materials");

const [who] = await sql`
  SELECT u.id, u.name FROM users u
    JOIN access_code_redemption r ON r.user_id = u.id
    JOIN access_code ac ON ac.id = r.access_code_id
   WHERE u.email = ${EMAIL} AND u.email LIKE '%.example.invalid' AND ac.partner_name LIKE '%(Demo)'`;
if (!who) { console.error(`${EMAIL} is not a demo participant. Refusing.`); process.exit(1); }
const [{ n }] = await sql`SELECT ((SELECT count(*) FROM refinery_artifact WHERE user_id = ${who.id}) + (SELECT count(*) FROM job_application WHERE user_id = ${who.id}))::int AS n`;
if (n > 0) { console.log(`${who.name} already has materials (${n} rows). Nothing to do.`); process.exit(0); }

const days = (d) => new Date(Date.now() + d * 86400000).toISOString();
const resume = {
  formatVersion: 3,
  meta: { targetJob: "Line Cook", createdFrom: "demo-seed", jobListingUrl: "", targetCompany: "" },
  contact: { name: who.name, city: "Libby", state: "MT", email: EMAIL, phone: "(406) 555-0142" },
  summary: "Dependable kitchen worker with four years of high-volume prep and line experience. Holds a current ServSafe Food Handler card. Known for showing up early, keeping a clean station, and staying steady through a rush.",
  skills: ["Grill and saute stations", "Batch prep for 300+ covers", "ServSafe Food Handler", "Inventory and FIFO rotation", "Knife work", "Opening and closing checklists"],
  experience: [
    { id: "e1", title: "Prep and Line Cook", company: "Institutional Food Service", startDate: "2021", endDate: "2025",
      bullets: ["Prepared three daily meals for roughly 300 people, on time, for four years.", "Trained six new kitchen workers on station setup, sanitation and knife safety.", "Cut food waste on the prep line by tracking and rotating stock first-in, first-out."] },
    { id: "e2", title: "Warehouse Associate", company: "Kootenai Building Supply", startDate: "2017", endDate: "2019",
      bullets: ["Loaded and staged contractor orders; operated a pallet jack daily.", "Kept a clean safety record across two years."] },
  ],
  education: [{ id: "ed1", credential: "ServSafe Food Handler", institution: "National Restaurant Association", year: "2025" }, { id: "ed2", credential: "HiSET (high school equivalency)", institution: "State of Montana", year: "2022" }],
  contentBlocks: [],
};
const [r] = await sql`INSERT INTO refinery_artifact (user_id, artifact_type, target_context, content, is_current, updated_at)
  VALUES (${who.id}, 'resume', ${JSON.stringify({ source: "demo-seed", targetJob: "Line Cook" })}::jsonb, ${JSON.stringify(resume)}::jsonb, true, ${days(-3)}) RETURNING id`;
const [letter] = await sql`INSERT INTO refinery_artifact (user_id, artifact_type, target_context, content, updated_at)
  VALUES (${who.id}, 'cover_letter', ${JSON.stringify({ source: "demo-seed", targetJob: "Line Cook", targetCompany: "Cabinet Mountain Brewing" })}::jsonb,
          ${JSON.stringify({ targetJob: "Line Cook", targetCompany: "Cabinet Mountain Brewing", text: "Dear Hiring Manager,\n\nI am applying for the Line Cook opening. For four years I worked a prep and line station feeding about 300 people three times a day. That taught me to work clean, work fast, and keep my head when the tickets stack up.\n\nI hold a current ServSafe Food Handler card and I can work nights and weekends. I would be glad to come in and work a stage shift so you can see how I handle a station.\n\nThank you for your time.\n\n" + who.name })}::jsonb, ${days(-2)}) RETURNING id`;

const apps = [
  ["Line Cook", "Cabinet Mountain Brewing", "Libby, MT", "interviewing", -6, 2, r.id, letter.id, "Interview Thursday 2pm with the kitchen manager. Ask about the night bus."],
  ["Prep Cook", "Venture Inn Restaurant", "Libby, MT", "applied", -4, 3, r.id, null, "Dropped it off in person."],
  ["Dishwasher / Prep", "Treasure Mountain Casino", "Libby, MT", "heard_back", -9, 1, r.id, null, null],
  ["Warehouse Associate", "Kootenai Building Supply", "Libby, MT", "saved", null, null, null, null, "Would they take me back? Think about it."],
];
for (const [title, company, location, status, appliedDays, followDays, resumeId, letterId, notes] of apps) {
  await sql`INSERT INTO job_application (user_id, job_title, company, location, status, applied_at, follow_up_at, resume_artifact_id, cover_letter_artifact_id, notes, salary)
    VALUES (${who.id}, ${title}, ${company}, ${location}, ${status}, ${appliedDays == null ? null : days(appliedDays)}, ${followDays == null ? null : days(followDays)},
            ${resumeId}, ${letterId}, ${notes}, ${status === "interviewing" ? "$17.50/hr posted" : null})`;
}
console.log(`Seeded for ${who.name}: 1 resume, 1 cover letter, ${apps.length} applications (two carry private notes, which staff must never see).`);
