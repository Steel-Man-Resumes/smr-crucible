/**
 * A fictional person (Jean Valjean, production manager) as the first real
 * walk of "Check and finish" found him on 2026-10-24. Every fact is invented;
 * the employers are invented; the target employer is a placeholder.
 */

/** His finished Forge resume (the gate passed it). */
export const FINISHED = `JEAN VALJEAN
(414) 555-0100 | jean@example.com | Milwaukee, WI

PROFESSIONAL SUMMARY
Production and heavy-labor professional with over 25 years in manufacturing, rigging, and material handling.

PROFESSIONAL EXPERIENCE

PRODUCTION MANAGER | Madeleine Glassworks, Milwaukee, WI, March 2019 - Present
- Responsible for managing day-to-day production operations.
- Supervise production employees and assign daily work.
- Work with ownership to improve production methods and lower costs.
- Keep production records and report results to management.

PRODUCTION WORKER | Digne Lumber & Stone, Milwaukee, WI, June 2015 - March 2019
- Loaded, unloaded, and moved heavy materials by hand and with equipment.
- Operated forklift and hoisting equipment.
- Assisted with repairs to buildings and equipment.
- Followed all safety rules and worked with the crew.

SKILLS
Rigging | heavy lifting | forklift and hoisting equipment operation | equipment inspection | production operations management | employee hiring and scheduling | training | recordkeeping`;

/** His confirmed Master Draft details, in his words. */
export const MASTER = {
  revision: 3,
  facts: [
    { id: "f1", text: "I manage day-to-day production operations, supervise the production employees, and assign the daily work.", status: "confirmed" },
    { id: "f2", text: "I handle hiring, training, and scheduling for the production crew.", status: "confirmed" },
    { id: "f3", text: "At Digne Lumber & Stone I was a Production Worker from June 2015 to March 2019.", status: "confirmed" },
    { id: "f4", text: "I trained and mentored new workers on the rigging crew.", status: "needs_check" },
  ],
};

/** The Forge upload the server held for him (his typed words): thinner than what he gave later. */
export const UPLOAD = `Jean Valjean
Milwaukee, WI
Production Manager at Madeleine Glassworks since March 2019.
Before that I worked at Digne Lumber & Stone.`;

/** The Tailor's draft for a production supervisor job, as the check page opened it. */
export const TAILORED = `JEAN VALJEAN
(414) 555-0100 | jean@example.com | Milwaukee, WI

PROFESSIONAL EXPERIENCE

Production Manager | Madeleine Glassworks, March 2019 - Present
- Manage day-to-day production operations.
- Supervise production employees and assign daily work.
- Handle hiring, training, and scheduling for the production crew.
- Maintain safe work practices and follow safety regulations.

Production Worker | Digne Lumber & Stone, June 2015 - March 2019
- Operated forklift and hoisting equipment.
- Assisted with repairs to buildings and equipment.

SKILLS
Crew supervision | Training and mentoring new workers | Work assignment and task delegation | Material loading, unloading, and moving | Production recordkeeping and reporting | Equipment and building repair/maintenance`;

export const SKILLS_LINE = TAILORED.split("\n").at(-1) as string;

/** The parent's own cut answers, made on the parent's page (never on the Tailor's). */
export const PARENT_CUTS = [
  { line: "- Maintained safe work practices and followed all safety regulations.", answer: "", verdict: "cut" as const },
  { line: "- Handle hiring, training, and scheduling of employees.", answer: "", verdict: "cut" as const },
];

/** His resumes, as the store lists them (the names a card uses). */
export const ARTIFACTS = [
  { id: "forge", target_context: { source: "forge", targetJob: "" } },
  { id: "tailored", target_context: { source: "job", targetJob: "Production Supervisor" } },
  { id: "older", target_context: { source: "job", targetJob: "Shift Lead" } },
];

/** Revision rows: his Forge resume finished last; an older resume finished once, then a newer draft (review S2); the Tailor draft. */
export const REVISIONS = [
  { artifact_id: "forge", status: "finished", resume_text: FINISHED, created_at: "2026-10-23T01:49:37.374Z", revision_number: 2 },
  { artifact_id: "forge", status: "draft", resume_text: `${FINISHED}\n- Ran the whole plant.`, created_at: "2026-10-22T23:18:19.122Z", revision_number: 1 },
  { artifact_id: "older", status: "finished", resume_text: "JEAN VALJEAN\n\nPROFESSIONAL EXPERIENCE\n\nShift Lead | Madeleine Glassworks, 2019 - Present\n- Trained 12 new hires.", created_at: "2026-10-20T10:00:00.000Z", revision_number: 1 },
  { artifact_id: "older", status: "draft", resume_text: "JEAN VALJEAN\n\nPROFESSIONAL EXPERIENCE\n\nShift Lead | Madeleine Glassworks, 2019 - Present\n- Trained new hires.", created_at: "2026-10-21T10:00:00.000Z", revision_number: 2 },
  { artifact_id: "tailored", status: "draft", resume_text: TAILORED, created_at: "2026-10-24T14:49:35.130Z", revision_number: 1 },
];

/** A finished resume where the person kept inside work on the page (review B2): the block must go whole. */
export const FINISHED_WITH_RECORD = `JEAN VALJEAN

PROFESSIONAL EXPERIENCE

Production Worker | Digne Lumber & Stone, June 2015 - March 2019
- Operated forklift and hoisting equipment.

Kitchen Lead | Stanley Correctional Institution, 2010 - 2014
- Supervised a crew of twelve kitchen workers on every shift.
- Planned weekly menus and ordered food for 1,500 meals a day.

SKILLS
Forklift operation | Menu planning`;
