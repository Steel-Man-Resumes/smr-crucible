#!/usr/bin/env node
/**
 * The Montana demo cohort: six FICTIONAL people spread from "just enrolled" to
 * "placed", so one organization's screens show every state the product has.
 *
 *   node scripts/seed-demo-cohort.mjs
 *
 * Source: ~/todash/smr/MT-DOC-DEMO-COHORT-AND-STAFF-HANDOFF-2026-09-20.md.
 *
 * THE PEOPLE ARE INVENTED. THE EMPLOYERS ARE REAL and were chosen from a vetted
 * list, for what they are: real, local, currently hiring. Exactly ONE has
 * sourced fair-chance evidence (Flathead County Government, whose own HR page
 * says a conviction does not automatically disqualify an applicant). Nothing
 * here marks any other employer as fair-chance, and no application or hire
 * below took place -- which is why demo orgs carry a "Sample data" line on
 * every staff screen. Two employers are deliberately absent (Simms, Sun
 * Mountain Lumber): their connection to corrections is prison-industry labor,
 * not hiring. Job titles are generic roles, not quotes of real postings.
 *
 * An earlier version of this seed (seed-demo-materials) gave Wes applications
 * at four Libby businesses I had not checked against anything. This replaces it.
 *
 * IDEMPOTENT AND DESTRUCTIVE FOR DEMO PARTICIPANTS ONLY: it clears and rebuilds
 * the materials, sharing state and case notes of the Montana demo org's
 * participants. Every statement is limited to that organization's members with
 * an @...example.invalid address. Owner credential required: it writes sharing
 * grants for fictional people, which the application can never do for anyone.
 *
 * STARTING STATE FOR THE LIVE STORY: Wes has materials and has shared NOTHING,
 * so "Russ asks, Wes approves, Russ reads" can be performed from the beginning.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { assertBypassRole } from "./lib/assert-bypass-role.mjs";

const line = readFileSync("apps/consumer/.env.local", "utf8").split("\n").find((l) => l.trim().startsWith("DATABASE_URL="));
const sql = neon(line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""));
await assertBypassRole((q) => sql(q), "seed-demo-cohort");

const [org] = await sql`SELECT id, partner_user_id FROM access_code WHERE code = 'MTDEMO' AND partner_name LIKE '%(Demo)'`;
if (!org) { console.error("MTDEMO demo org not found. Run seed-demo-orgs first."); process.exit(1); }
const staff = await sql`SELECT os.user_id, u.name FROM org_staff os JOIN users u ON u.id = os.user_id WHERE os.access_code_id = ${org.id}`;
const russ = staff.find((s) => s.name === "Russ Feeney")?.user_id, alma = staff.find((s) => s.name === "Alma Trejo")?.user_id;
if (!russ || !alma) { console.error("Demo staff not found."); process.exit(1); }

const at = (d) => new Date(Date.now() + d * 86400000).toISOString();
const TEXT_VERSION = "2026-09-20.1";
const email = (n) => `${n.toLowerCase().replace(/[^a-z]+/g, ".")}@mtdemo.example.invalid`;

async function person(name, stage, lastActiveDays, staffId) {
  const [u] = await sql`INSERT INTO users (name, email, tier, current_stage) VALUES (${name}, ${email(name)}, 'client', ${stage})
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, current_stage = EXCLUDED.current_stage RETURNING id`;
  await sql`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES (${u.id}, ${org.id}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO consumer_consent (user_id, consent_layer, status, consent_text_version, collection_context)
            VALUES (${u.id}, 'sharing', 'granted', 'demo-seed', ${JSON.stringify({ source: "demo-seed" })}::jsonb)
            ON CONFLICT (user_id, consent_layer) DO UPDATE SET status = 'granted'`;
  await sql`UPDATE users SET next_step_cached_at = ${lastActiveDays == null ? null : at(-lastActiveDays)} WHERE id = ${u.id}`;
  if (staffId) await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES (${org.id}, ${u.id}, ${staffId}, ${org.partner_user_id})
                         ON CONFLICT (access_code_id, client_user_id) DO UPDATE SET staff_user_id = EXCLUDED.staff_user_id`;
  // clean slate for this fictional person
  await sql`DELETE FROM case_note WHERE client_user_id = ${u.id}`;
  await sql`DELETE FROM sharing_request WHERE user_id = ${u.id}`;
  await sql`DELETE FROM sharing_grant WHERE user_id = ${u.id}`;
  await sql`DELETE FROM data_access_log WHERE target_user_id = ${u.id} AND access_reason = 'org_client_view'`;
  await sql`DELETE FROM job_application WHERE user_id = ${u.id}`;
  await sql`DELETE FROM refinery_artifact WHERE user_id = ${u.id}`;
  return u.id;
}
const resumeBody = (name, target, summary, skills, experience, education) => ({
  formatVersion: 3, meta: { targetJob: target, createdFrom: "demo-seed", jobListingUrl: "", targetCompany: "" },
  contact: { name, city: "Libby", state: "MT", email: email(name), phone: "(406) 555-01" + String(name.length).padStart(2, "0") },
  summary, skills, experience, education, contentBlocks: [],
});
async function artifact(userId, type, target, content, daysAgo, pinned = false) {
  const [r] = await sql`INSERT INTO refinery_artifact (user_id, artifact_type, target_context, content, is_current, created_at, updated_at)
    VALUES (${userId}, ${type}, ${JSON.stringify({ source: "demo-seed", ...target })}::jsonb, ${JSON.stringify(content)}::jsonb, ${pinned}, ${at(-daysAgo)}, ${at(-daysAgo)}) RETURNING id`;
  return r.id;
}
async function application(userId, a) {
  await sql`INSERT INTO job_application (user_id, job_title, company, location, status, applied_at, follow_up_at, hired_at, resume_artifact_id, cover_letter_artifact_id, notes, created_at, updated_at)
    VALUES (${userId}, ${a.title}, ${a.company}, ${a.location}, ${a.status}, ${a.applied == null ? null : at(-a.applied)}, ${a.followUp == null ? null : at(a.followUp)},
            ${a.hired == null ? null : at(-a.hired)}, ${a.resume ?? null}, ${a.letter ?? null}, ${a.notes ?? null}, ${at(-(a.applied ?? a.touched ?? 1))}, ${at(-(a.touched ?? a.applied ?? 1))})`;
}
const share = (userId, scope, daysAgo) => sql`INSERT INTO sharing_grant (user_id, access_code_id, scope, text_version, granted_at) VALUES (${userId}, ${org.id}, ${scope}, ${TEXT_VERSION}, ${at(-daysAgo)})`;
const note = (userId, author, kind, body, daysAgo, visible = false) => sql`INSERT INTO case_note (access_code_id, client_user_id, author_user_id, kind, body, occurred_at, created_at, visible_to_participant)
  VALUES (${org.id}, ${userId}, ${author}, ${kind}, ${body}, ${at(-daysAgo)}, ${at(-daysAgo)}, ${visible})`;

// 1. Just enrolled. Nothing built, nothing shared. The default-closed state.
await person("Nadia Brooks", 1, null, null);

// 2. Resume drafted, NOT shared. Staff can see she exists and her stage, and cannot open anything.
const colton = await person("Colton Reese", 2, 31, russ);
await artifact(colton, "resume", { targetJob: "Equipment Operator" }, resumeBody("Colton Reese", "Equipment Operator",
  "Equipment operator and laborer with six years on road and site crews. Comfortable on a skid steer and a loader, steady in bad weather, and used to early starts.",
  ["Skid steer and loader operation", "Grade checking", "Traffic control", "Chainsaw and small engine upkeep", "OSHA 10"],
  [{ id: "e1", title: "Laborer and Equipment Operator", company: "County road crew (seasonal)", startDate: "2016", endDate: "2020", bullets: ["Ran a loader and a skid steer on gravel and culvert jobs.", "Flagged and set traffic control on two-lane closures."] }],
  [{ id: "ed1", credential: "OSHA 10-Hour Construction", institution: "OSHA Outreach", year: "2024" }]), 33, true);

// 3. Resume shared, staff reviewed. Target employer: Cabinet Peaks Medical Center (Libby's largest employer).
const priya = await person("Priya Raines", 3, 1, alma);
const priyaResume = await artifact(priya, "resume", { targetJob: "Environmental Services Technician" }, resumeBody("Priya Raines", "Environmental Services Technician",
  "Careful, reliable cleaner with three years of commercial and institutional housekeeping. Follows infection-control procedure to the letter and keeps a checklist honest.",
  ["Infection-control cleaning", "Floor care equipment", "Chemical safety (SDS)", "Laundry operations", "Inventory and restocking"],
  [{ id: "e1", title: "Housekeeping and Laundry Worker", company: "Institutional Facilities", startDate: "2022", endDate: "2025", bullets: ["Cleaned and restocked a 120-bed housing unit on a daily schedule.", "Handled and logged cleaning chemicals by the safety data sheet."] },
   { id: "e2", title: "Room Attendant", company: "Highway 2 Motel", startDate: "2019", endDate: "2021", bullets: ["Turned 14 rooms a shift to inspection standard."] }],
  [{ id: "ed1", credential: "HiSET (high school equivalency)", institution: "State of Montana", year: "2023" }]), 4, true);
await application(priya, { title: "Environmental Services Technician", company: "Cabinet Peaks Medical Center", location: "Libby, MT", status: "saved", touched: 2, resume: priyaResume });
await share(priya, "resume", 3);
await note(priya, alma, "note", "Reviewed the resume she shared. Strong, specific intake. Suggested she lead with the infection-control experience for the hospital role.", 2);

// 4. Tailored and applied. Flathead County Government is the ONE employer here with sourced fair-chance evidence.
//    Shares NOTHING yet: this is the person the live "ask, approve, read" story is told with.
const wes = await person("Wes Duvall", 4, 2, russ);
const wesResume = await artifact(wes, "resume", { targetJob: "Road and Bridge Maintenance Worker" }, resumeBody("Wes Duvall", "Road and Bridge Maintenance Worker",
  "Dependable crew worker with four years of high-volume kitchen production and two years of warehouse and yard work. Shows up early, works safe, and stays steady when the day gets long.",
  ["Pallet jack and yard equipment", "Batch production for 300+ people", "ServSafe Food Handler", "Inventory and first-in, first-out rotation", "Opening and closing checklists"],
  [{ id: "e1", title: "Prep and Line Cook", company: "Institutional Food Service", startDate: "2021", endDate: "2025", bullets: ["Prepared three daily meals for roughly 300 people, on time, for four years.", "Trained six new kitchen workers on station setup, sanitation and knife safety."] },
   { id: "e2", title: "Warehouse and Yard Associate", company: "Building supply yard", startDate: "2017", endDate: "2019", bullets: ["Loaded and staged contractor orders; operated a pallet jack daily.", "Kept a clean safety record across two years."] }],
  [{ id: "ed1", credential: "ServSafe Food Handler", institution: "National Restaurant Association", year: "2025" }, { id: "ed2", credential: "HiSET (high school equivalency)", institution: "State of Montana", year: "2022" }]), 3, true);
const wesLetter = await artifact(wes, "cover_letter", { targetJob: "Road and Bridge Maintenance Worker", targetCompany: "Flathead County Government" },
  { targetJob: "Road and Bridge Maintenance Worker", targetCompany: "Flathead County Government", text: "Dear Hiring Manager,\n\nI am applying for the Road and Bridge Maintenance Worker opening. For four years I worked a production line feeding about 300 people three times a day, and before that I worked a supply yard loading contractor orders. Both taught me to work safe, work clean, and keep going when the day runs long.\n\nI am available for early starts and seasonal overtime, and I would welcome the chance to talk.\n\nThank you for your time.\n\nWes Duvall" }, 2);
await application(wes, { title: "Road and Bridge Maintenance Worker", company: "Flathead County Government", location: "Kalispell, MT", status: "applied", applied: 2, followUp: 5, resume: wesResume, letter: wesLetter, notes: "Ask Russ about a ride to Kalispell if they call." });
await application(wes, { title: "Production Assembler", company: "Nomad GCS", location: "Libby, MT", status: "saved", touched: 1, notes: "Not sure I qualify. Think about it." });

// 5. Interview scheduled. Nomad GCS: real, growing, local. NOT presented as fair-chance.
const marisol = await person("Marisol Vance", 5, 1, alma);
const marisolResume = await artifact(marisol, "resume", { targetJob: "Production Assembler" }, resumeBody("Marisol Vance", "Production Assembler",
  "Detail-minded assembler with three years of bench work to written spec. Reads a work order, checks her own work, and asks before guessing.",
  ["Hand and power tools", "Reading work orders and drawings", "Quality checks to spec", "Crimping and basic wiring", "5S workstation upkeep"],
  [{ id: "e1", title: "Assembly and Upholstery Worker", company: "Vocational Production Shop", startDate: "2022", endDate: "2025", bullets: ["Built and inspected assemblies to written spec on a daily quota.", "Caught and logged defects before they left the bench."] }],
  [{ id: "ed1", credential: "OSHA 10-Hour General Industry", institution: "OSHA Outreach", year: "2025" }]), 6, true);
await application(marisol, { title: "Production Assembler", company: "Nomad GCS", location: "Libby, MT", status: "interviewing", applied: 8, followUp: 2, resume: marisolResume, notes: "Interview Thursday 10am. Wear the boots." });
await share(marisol, "resume", 7); await share(marisol, "applications", 7);
await note(marisol, alma, "meeting", "Interview at Nomad GCS set for Thursday 10am. Sent her the Job Service Montana interview-prep link and we walked through the availability question.", 1, true);

// 6. Placed. Northwest Community Health Center: a real employer and a real referral partner.
const terrell = await person("Terrell Judd", 6, 5, russ);
const terrellResume = await artifact(terrell, "resume", { targetJob: "Facilities Assistant" }, resumeBody("Terrell Judd", "Facilities Assistant",
  "Facilities and grounds worker with five years keeping a large building running: floors, minor repairs, and a preventive maintenance checklist that actually got done.",
  ["Preventive maintenance rounds", "Minor plumbing and electrical", "Floor care", "Work order systems", "Grounds and snow removal"],
  [{ id: "e1", title: "Maintenance Worker", company: "Institutional Facilities", startDate: "2020", endDate: "2025", bullets: ["Completed weekly preventive maintenance rounds across a 200-bed building.", "Closed out repair work orders and logged parts used."] }],
  [{ id: "ed1", credential: "EPA 608 Type I", institution: "ESCO Institute", year: "2025" }]), 30, true);
await application(terrell, { title: "Facilities Assistant", company: "Northwest Community Health Center", location: "Libby, MT", status: "hired", applied: 34, hired: 9, touched: 5, resume: terrellResume });
await share(terrell, "applications", 20);
await note(terrell, russ, "note", "Placed: started at Northwest Community Health Center. First week went well. 30-day check-in on the calendar; no further action needed until then.", 5);

// Retire the one placeholder the first seed wrote for the hired participant.
await sql`DELETE FROM job_application WHERE company = 'Demo Logistics Co'`;
// Seats should say what the roster says.
await sql`UPDATE access_code SET times_redeemed = (SELECT count(*) FROM access_code_redemption r WHERE r.access_code_id = access_code.id) WHERE id = ${org.id}`;

const [{ n }] = await sql`SELECT count(*)::int AS n FROM access_code_redemption WHERE access_code_id = ${org.id}`;
console.log(`Montana demo cohort: ${n} fictional participants.
  1 Nadia Brooks    enrolled, nothing built, nothing shared, unassigned
  2 Colton Reese    resume drafted 33 days ago, NOT shared, quiet (Russ)
  3 Priya Raines    resume shared + reviewed; saved Cabinet Peaks Medical Center (Alma)
  4 Wes Duvall      tailored + applied to Flathead County Government; shares NOTHING yet -> live story (Russ)
  5 Marisol Vance   interviewing at Nomad GCS; resume + applications shared; visible note (Alma)
  6 Terrell Judd    placed at Northwest Community Health Center; applications shared (Russ)`);
