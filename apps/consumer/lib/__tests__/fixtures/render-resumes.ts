/**
 * Fictional resumes for the renderer tests. Names, places and employers are
 * made up. Text follows the shape the Forge writes: name, contact line,
 * headline, then sections with TITLE | Company | City, State | Years job lines.
 */

export const ONE_PAGE = [
  "JORDAN RIVERS",
  "Milwaukee, WI | 414-555-0100 | jordan.rivers@example.com",
  "Warehouse Associate | Order Picking | Packing | Count Checks",
  "",
  "CAREER SUMMARY",
  "Warehouse worker with six years of picking, packing and loading. Known for accurate counts, steady pace and showing up on time. Looking for a full-time warehouse role with overtime.",
  "",
  "CORE COMPETENCIES",
  "Warehouse: Handheld RF scanner picking | Pack station: box size, packing slips, shipping labels | Count checks against the pick list | Manual pallet jack | Stretch-wrapping pallets",
  "Customers: Booking appointments, Quoting prices, Walk-around checks with the owner, Cash and card payments",
  "",
  "PROFESSIONAL EXPERIENCE",
  "",
  "Shift Lead | Northgate Plastics | Milwaukee, WI",
  "- Ran a crew of six on second shift, assigned stations and covered breaks.",
  "- Checked item counts against the pick list and held an order for a recount instead of shipping a guess.",
  "",
  "Warehouse Associate | Acme Logistics | Milwaukee, WI | 2021 - Present",
  "Picks and packs orders for an online fulfillment site.",
  "- Pick orders into totes with a handheld RF scanner, then pack them at the pack station.",
  "- Load 40 trucks a day with no safety incidents.",
  "- Trained three new hires on forklift safety.",
  "",
  "Loader | Coop Street Freight, Milwaukee, 2018 - 2020",
  "- Loaded and unloaded trailers, stacked pallets and kept the dock clean.",
  "",
  "EDUCATION",
  "Milwaukee Area Technical College, Milwaukee, WI | 2017 - 2018",
  "",
  "CERTIFICATIONS",
  "- OSHA 10 (2022)",
  "- Forklift operator, employer-issued (2021)",
  "",
].join("\n");

function role(i: number): string[] {
  const years = [
    "2024 - Present", "2021 - 2024", "2018 - 2021", "2015 - 2018", "2012 - 2015", "2009 - 2012",
  ][i];
  return [
    `Operations Lead ${i + 1} | Midwest Freight Group | Chicago, IL | ${years}`,
    "Ran a dock crew across three shifts and kept the schedule on time.",
    "- Led a team of twelve that moved large volumes of freight every shift while keeping safety scores steady and on-time delivery above the target for the whole facility.",
    "- Cut overtime by shifting start times with the crew and posting the plan a week ahead so people could plan their lives around it.",
    "- Counted every inbound pallet against the paperwork and wrote up short counts the same day, so the office never had to chase a missing pallet.",
    "- Trained new hires on the dock procedures, the scanner, and the safety walk, and checked their first week of work with them.",
    "- Kept the break room, the dock and the yard clean, and reported every damaged rack to maintenance in writing.",
    "",
  ];
}

export const TWO_PAGE = [
  "MORGAN CASEY",
  "Chicago, IL | 312-555-0188 | morgan.casey@example.com",
  "Operations Manager",
  "",
  "CAREER SUMMARY",
  "Operations leader with over fifteen years running distribution docks, leading crews and keeping freight moving safely. Wants a supervisor role at a growing distribution center.",
  "",
  "CORE COMPETENCIES",
  "Logistics, Safety, Lean, Scheduling, Budgets, Hiring, Cycle counts, Dock scheduling, Inbound receiving, Outbound shipping, Crew training",
  "",
  "PROFESSIONAL EXPERIENCE",
  "",
  ...[0, 1, 2, 3, 4, 5].flatMap(role),
  "EDUCATION",
  "City College, Chicago, IL | 2007 - 2009",
  "",
].join("\n");

export const COVER_LETTER = [
  "Dear Hiring Team,",
  "",
  "I am applying for the Warehouse Associate role. I bring six years of picking, packing and loading, and a record of accurate counts and steady attendance. My resume is attached.",
  "",
  "I would welcome the chance to talk about how I can help your team. Thank you for your time.",
  "",
  "Sincerely,",
  "Jordan Rivers",
].join("\n");
