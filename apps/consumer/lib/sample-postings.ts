/**
 * Sample job postings for the keyword check on the Forge finish page.
 *
 * People are asked to "paste a job posting" and most don't have one open. These
 * give them something to try. Every sample is generic and written by Steel Man
 * Resumes: no real employer, no pay, no numbers (a test checks for digits and
 * employer names). They are labelled on screen as samples, never as real jobs.
 */

export const SAMPLE_POSTING_LABEL = "Sample posting written by SMR, not a real job.";

export interface SamplePosting {
  id: string;
  title: string;
  /** Words that tie the sample to a career path title from the Forge. */
  matches: string[];
  text: string;
}

export const SAMPLE_POSTINGS: readonly SamplePosting[] = [
  {
    id: "warehouse-associate",
    title: "Warehouse associate",
    matches: ["warehouse", "picker", "packer", "shipping", "receiving", "forklift", "inventory", "logistics", "distribution", "material handler"],
    text: `Warehouse Associate
Duties: pick and pack orders using a handheld scanner. Load and unload trucks at the dock. Stage outbound shipments and check them against the pick list. Keep aisles clean and safe. Count stock during inventory.
Qualifications: able to lift and move heavy boxes for a full shift. Able to stand and walk for long periods. Forklift or pallet jack experience a plus. Reliable attendance. Willing to work nights or weekends.`,
  },
  {
    id: "production-operator",
    title: "Production operator",
    matches: ["production", "operator", "manufacturing", "machine", "assembly", "assembler", "factory", "plant"],
    text: `Production Operator
Duties: run and watch production machines on an assigned line. Load materials and remove finished parts. Check parts against quality standards and set aside any that fail. Keep simple production records. Follow lockout and safety rules.
Qualifications: able to follow written work instructions. Comfortable with basic measuring tools. Steady attention to detail. Able to stand for a full shift. Willing to rotate shifts.`,
  },
  {
    id: "cna",
    title: "Certified nursing assistant (CNA)",
    matches: ["cna", "nursing", "caregiver", "home health", "patient", "care aide", "healthcare", "health care"],
    text: `Certified Nursing Assistant
Duties: help residents with bathing, dressing, eating and moving safely. Take and record vital signs. Report changes in a resident's condition to the nurse. Keep rooms clean and stocked. Treat every resident with patience and respect.
Qualifications: current state CNA certification. CPR certification or willing to get it. Good communication with residents, families and staff. Able to lift and turn residents with proper technique.`,
  },
  {
    id: "line-cook",
    title: "Line cook",
    matches: ["cook", "kitchen", "culinary", "food", "prep", "restaurant", "chef", "dishwasher"],
    text: `Line Cook
Duties: prepare and cook menu items on the line during service. Prep vegetables, proteins and sauces before open. Keep the station clean and follow food safety rules. Rotate and label stock. Help close the kitchen at night.
Qualifications: kitchen or food service experience. Food handler card or willing to get one. Able to work fast and stay calm during a rush. Able to work evenings, weekends and holidays.`,
  },
  {
    id: "customer-service",
    title: "Customer service representative",
    matches: ["customer service", "call center", "cashier", "retail", "sales associate", "front desk", "receptionist", "customer"],
    text: `Customer Service Representative
Duties: answer customer calls, chats and emails. Look up orders and accounts in the computer system. Solve problems or pass them to the right team. Take clear notes on every contact. Stay friendly with upset customers.
Qualifications: clear speaking and writing. Basic computer and typing skills. Patience and a calm manner. Able to follow a script and use good judgment. Customer service or retail experience a plus.`,
  },
  {
    id: "maintenance-tech",
    title: "Maintenance technician",
    matches: ["maintenance", "technician", "mechanic", "repair", "facilities", "hvac", "electrical", "plumbing", "handyman"],
    text: `Maintenance Technician
Duties: fix and maintain equipment, plumbing, electrical and building systems. Do planned maintenance and keep records of the work. Find the cause of breakdowns and repair them. Use hand and power tools safely. Respond to work orders on time.
Qualifications: hands-on repair experience. Able to read basic diagrams and manuals. Own basic hand tools. Able to climb ladders and work in tight spaces. Trade school or certifications a plus.`,
  },
  {
    id: "general-labor",
    title: "General labor",
    matches: ["labor", "laborer", "construction", "landscaping", "lawn", "groundskeeper", "helper", "crew", "demolition", "roofing"],
    text: `General Laborer
Duties: help the crew on job sites with loading, hauling and cleanup. Carry tools and materials where they are needed. Operate basic hand and power tools. Keep the site safe and tidy. Follow directions from the crew lead.
Qualifications: able to do physical work outdoors in all weather. Reliable transportation to job sites. Willing to learn. Safety boots required. Experience in construction or landscaping a plus.`,
  },
  {
    id: "office-assistant",
    title: "Office assistant",
    matches: ["office", "administrative", "admin", "clerk", "data entry", "secretary", "filing"],
    text: `Office Assistant
Duties: answer phones and greet visitors. Enter data and keep files organized. Schedule appointments and keep calendars up to date. Order office supplies. Help staff with copying, mailing and other daily tasks.
Qualifications: comfortable with email, spreadsheets and word processing. Organized and on time. Clear, polite communication. Able to keep information private. Office experience a plus.`,
  },
];

/**
 * Up to `n` samples, the person's own career paths first when a sample
 * matches one, then the rest in their usual order. No duplicates.
 */
export function pickSamplePostings(careerPathTitles: string[], n = 4): SamplePosting[] {
  const titles = careerPathTitles.map((t) => t.toLowerCase());
  const matched: SamplePosting[] = [];
  for (const title of titles) {
    for (const s of SAMPLE_POSTINGS) {
      if (matched.includes(s)) continue;
      if (s.matches.some((m) => title.includes(m))) matched.push(s);
    }
  }
  const rest = SAMPLE_POSTINGS.filter((s) => !matched.includes(s));
  return [...matched, ...rest].slice(0, Math.max(0, n));
}
