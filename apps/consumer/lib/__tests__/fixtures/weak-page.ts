/**
 * Phase 6, lane S2: a fictional weak page in the style Troy saw on the
 * 2026-10-11 preview run (objective, soft-skill list, duty lines, month dates,
 * a title-case heading), and the reply a writer following the rewording A
 * prompt returns for it (the mock writer: no model call). Fictional person,
 * fictional employers, a reserved 555-01xx number and an example.com address.
 */

export const WEAK_PAGE = `Rory Example
Libby, MT | (406) 555-0147 | rory@example.com

Objective
Looking for a job where I can use my skills and grow with a good company.

Skills
Hard worker, team player, fast learner, good communication

Work Experience
Forklift Driver | Northgate Supply | Libby, MT | 8/2021 - 12/2022
In charge of the guys on my shift.
Did safety audits.
Drove forklift and loaded 6 trucks a night.
Helped the lead with inventory counts.

Stocker | Corner Mart | 2016 - 2018
Stocked shelves.
Dealt with customers at the register.

Education
Lincoln County High School | 2015`;

/** The resume part of the mock writer's reply. */
export const MOCK_WRITER_RESUME = `RORY EXAMPLE
Libby, MT | (406) 555-0147 | rory@example.com

Forklift Driver and Stocker

CAREER SUMMARY
Forklift driver who supervised the shift crew at Northgate Supply and loaded 6 trucks a night. Ran safety audits and helped the lead with inventory counts. Earlier stocked shelves and served customers at the register at Corner Mart.

CORE COMPETENCIES
Forklift operation, Truck loading, Inventory counts, Safety audits, Shelf stocking, Register and customer service

PROFESSIONAL EXPERIENCE

FORKLIFT DRIVER | Northgate Supply | Libby, MT | 8/2021 - 12/2022
- Supervised the shift crew.
- Ran safety audits.
- Drove a forklift and loaded 6 trucks a night.
- Helped the lead with inventory counts.

STOCKER | Corner Mart | 2016 - 2018
- Stocked shelves.
- Served customers at the register.

EDUCATION
Lincoln County High School | 2015`;

/** The change list the mock writer prints after the marker (two bad entries the server must drop). */
export const MOCK_WRITER_CHANGES = [
  {
    old: "Looking for a job where I can use my skills and grow with a good company.",
    new: "Forklift driver who supervised the shift crew at Northgate Supply and loaded 6 trucks a night.",
    why: "An objective tells them what you want. A summary tells them what you bring.",
    rule: "objective",
  },
  {
    old: "Hard worker, team player, fast learner, good communication",
    new: "Forklift operation, Truck loading, Inventory counts, Safety audits, Shelf stocking, Register and customer service",
    why: "Anyone can write hard worker. Naming the work you did proves it.",
    rule: "soft_skill_list",
  },
  {
    old: "In charge of the guys on my shift.",
    new: "Supervised the shift crew.",
    why: "\"In charge of\" reads like a job description. Saying you supervised the crew shows what you did.",
    rule: "duty_phrasing",
  },
  {
    old: "Did safety audits.",
    new: "Ran safety audits.",
    why: "\"Did\" is a weak start. \"Ran\" says you owned the audit.",
    rule: "duty_phrasing",
  },
  {
    old: "Dealt with customers at the register.",
    new: "Served customers at the register.",
    why: "\"Dealt with\" sounds like a chore. \"Served\" is the work you did.",
    rule: "duty_phrasing",
  },
  {
    old: "Work Experience",
    new: "PROFESSIONAL EXPERIENCE",
    why: "A clear heading tells a hiring manager where your jobs start.",
    rule: "heading",
  },
  // Dropped by the server: this old line is not on the person's page.
  { old: "Ran the whole warehouse.", new: "Supervised the shift crew.", why: "Made up.", rule: "duty_phrasing" },
  // Dropped by the server: this new line is not on the final resume.
  { old: "Stocked shelves.", new: "Stocked shelves for the entire store every night.", why: "Bigger.", rule: "duty_phrasing" },
];

/** The writer's whole reply: the resume, the marker, the JSON list. */
export function mockWriterReply(resume = MOCK_WRITER_RESUME): string {
  return `${resume}\n\n===CHANGES===\n${JSON.stringify(MOCK_WRITER_CHANGES, null, 1)}\n`;
}
