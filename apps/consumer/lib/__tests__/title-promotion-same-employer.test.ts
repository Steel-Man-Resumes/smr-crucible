import { test } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus } from "@crucible/core/src/resumeStatus";

// 2026-11-04 production run (fictional Marqus Relly): the person's pasted resume carried two jobs at the same
// employer, Order Picker 2004-2012 then Shift Lead 2012-2016, dates on the line under each header. The finish
// page asked "We couldn't find 'Order Picker' in what you gave us" for the Northgate header, though the title
// and the employer and the years are all on the page the person pasted.
const PASTED = `MARQUS RELLY
Milwaukee, WI 53206
(414) 555-0126
marqus.relly@marqus-relly.example.invalid

OBJECTIVE
Seeking a full time warehouse position with a good company where I can use my skills.

EXPERIENCE

Forklift Operator / Order Picker, Steadfast Staffing (assigned to a cold storage distribution center), Milwaukee, WI
2021 - Present
- Drive forklift
- Pick orders
- Load and unload trucks
- Other duties as assigned

Shift Lead, Northgate Parts Distribution, Milwaukee, WI
2012 - 2016
- Was in charge of second shift
- Made sure orders went out
- Did inventory
- Trained new hires

Order Picker, Northgate Parts Distribution, Milwaukee, WI
2004 - 2012
- Picked orders
- Used RF scanner
- Kept area clean

EDUCATION
High School Diploma, Milwaukee, WI, 2003

SKILLS
Forklift, hard worker, team player, fast learner, dependable
`;

const STORY = `At Northgate I ran second shift for four years, about fifteen people. When the day shift left orders short I reorganized the pick path so we caught up before the trucks left, and we stopped missing the 10pm cutoff. I did the cycle counts every week and our shrink number went down. I trained every new picker on the RF scanner myself. At the cold storage site now I run a stand-up forklift and pick in the freezer, and they ask me to cover the lead when he is out.`;

const PAGE = `MARQUS RELLY
Milwaukee, WI 53206 | (414) 555-0126 | marqus.relly@marqus-relly.example.invalid

Warehouse Shift Lead and Forklift Operator

CAREER SUMMARY
Warehouse worker who ran second shift at Northgate Parts Distribution for four years and moved up from order picker to shift lead at the same company.

CORE COMPETENCIES
Forklift operation (stand-up and sit-down), order picking, RF scanner, cycle counts, loading and unloading trucks, training new hires

PROFESSIONAL EXPERIENCE

Forklift Operator / Order Picker | Steadfast Staffing (assigned to a cold storage distribution center) | Milwaukee, WI | 2021 - Present
- Run a stand-up forklift picking in the freezer.
- Pick orders.
- Load and unload trucks.

Shift Lead | Northgate Parts Distribution | Milwaukee, WI | 2012 - 2016
- Ran second shift for four years.
- Ran weekly cycle counts.
- Trained every new picker on the RF scanner.

Order Picker | Northgate Parts Distribution | Milwaukee, WI | 2004 - 2012
- Picked orders.
- Used an RF scanner.
- Kept the work area clean.

EDUCATION
High School Diploma | Milwaukee, WI | 2003
`;

test("two dated titles at one employer on the pasted resume are both the person's titles", () => {
  const status = getResumeStatus({ resumeText: PAGE, sourceText: `${PASTED}\n\n${STORY}`, ownResumeText: PASTED });
  const titles = status.openItems.filter((i) => i.kind === "title_unsaid").map((i) => i.line);
  assert.deepEqual(titles, [], JSON.stringify(status.openItems.map((i) => [i.kind, i.line, i.why]), null, 1));
});
