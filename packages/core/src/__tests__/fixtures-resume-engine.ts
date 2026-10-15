/**
 * Deterministic fictional fixtures for the resume engine (rulebook, status
 * contract, defend step). Every person, employer, place and contact here is
 * invented for these tests.
 */

/** Thin history: odd jobs and one class, no numbers. */
export const THIN = {
  source: `Casey Example
Dayton, OH
I did yard work and snow shoveling for neighbors from 2021 to 2024.
I took a forklift class at the county job center in 2023 and passed the driving test.`,
  resume: `CASEY EXAMPLE
Dayton, OH

Yard and snow work for neighbors

PROFESSIONAL EXPERIENCE
YARD WORKER | Neighbors in Dayton | 2021 - 2024
- Did yard work and snow shoveling for neighbors.

CERTIFICATIONS
- Forklift training, county job center (2023), passed the driving test`,
};

/** No numbers anywhere, every line true and specific. */
export const NO_NUMBERS = {
  source: `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.
The owner asked me to show new cooks the grill.`,
  resume: `MORGAN SAMPLE
Toledo, OH | morgan@example.com

Line cook

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.
- Asked by the owner to show new cooks the grill.

CORE COMPETENCIES
Grill, Breakfast line, Vegetable prep, Kitchen closing`,
};

/** Supervised work, kept at its true size. */
export const HELPED_UNDER = {
  source: `Riley Placeholder
Akron, OH
Maintenance helper at Lakeside Apartments from 2018 to 2022.
On the morning rounds with the licensed operator I tested boiler water and helped with blowdown under the operator.`,
  faithful: `RILEY PLACEHOLDER
Akron, OH

PROFESSIONAL EXPERIENCE
MAINTENANCE HELPER | Lakeside Apartments | 2018 - 2022
- Tested boiler water on the morning rounds with the licensed operator.
- Helped with blowdown under the operator.`,
  soleActor: `RILEY PLACEHOLDER
Akron, OH

PROFESSIONAL EXPERIENCE
MAINTENANCE HELPER | Lakeside Apartments | 2018 - 2022
- Tested boiler water on the morning rounds.
- Performed boiler blowdown.`,
};

/** A credential whose type and status the person never gave. */
export const CREDENTIAL_NO_STATUS = {
  source: `Jamie Testcase
Canton, OH
Warehouse associate at Pinecrest Supply from 2020 to 2024. I drove a forklift and picked orders with a scanner.`,
  resume: `JAMIE TESTCASE
Canton, OH

PROFESSIONAL EXPERIENCE
WAREHOUSE ASSOCIATE | Pinecrest Supply | 2020 - 2024
- Drove a forklift and picked orders with a scanner.

CERTIFICATIONS
- Forklift Operator`,
};

/** One open BLOCK: a year the person never gave. */
export const ONE_BLOCK = {
  source: NO_NUMBERS.source,
  resume: NO_NUMBERS.resume.replace("2019 - 2023", "2018 - 2023"),
};

/** A long, true history that runs to two pages, with numbers the person gave. */
export const TWO_PAGE = (() => {
  const jobs = [
    ["DELIVERY DRIVER", "Northside Parts", "2019", "2024", "Drove a box truck to about 12 shops a day.", "Loaded the truck each morning from the pick list.", "Checked the truck before every route."],
    ["WAREHOUSE ASSOCIATE", "Pinecrest Supply", "2016", "2019", "Picked orders with an RF scanner on a 6-person night crew.", "Loaded outbound trailers at the dock.", "Counted stock for the monthly inventory."],
    ["LINE COOK", "Harbor Street Diner", "2013", "2016", "Ran the grill on the breakfast line.", "Prepped vegetables before open.", "Closed the kitchen at night."],
    ["DISHWASHER", "Harbor Street Diner", "2011", "2013", "Ran the dish machine during the dinner rush.", "Kept the dish area clean and stocked.", "Helped with prep under the head cook."],
    ["LAWN CREW MEMBER", "Greenway Lawn Care", "2008", "2011", "Mowed and trimmed on a 3-person crew.", "Loaded the trailer and fueled the mowers.", "Hauled brush to the yard waste site."],
    ["STOCKER", "Corner Market", "2005", "2008", "Stocked shelves and faced aisles on overnights.", "Unloaded the weekly delivery truck.", "Rotated dairy by date."],
    ["CAR WASH ATTENDANT", "Bright Shine Car Wash", "2003", "2005", "Guided cars onto the wash track.", "Dried and vacuumed cars at the exit.", "Opened the wash on Saturday mornings."],
    ["BUSSER", "Lakeview Grill", "2001", "2003", "Cleared and reset tables in the dining room.", "Carried dish bins to the dish area.", "Refilled the salad bar during lunch."],
    ["NEWSPAPER CARRIER", "Columbus Morning Courier", "1999", "2001", "Delivered papers on a morning route by bike.", "Collected payments from customers on the route.", "Bagged papers on rainy days."],
  ];
  const source = [
    "Taylor Fixture",
    "Columbus, OH | taylor@example.com",
    ...jobs.map(([t, c, a, b, ...bs]) => `${t} at ${c} from ${a} to ${b}. ${bs.join(" ")}`),
    "I got my OSHA 10 card in 2017. It does not expire.",
    "I finished my GED at Columbus Adult Learning Center in 2005.",
  ].join("\n");
  const body = jobs
    .map(([t, c, a, b, ...bs]) => [`${t} | ${c} | ${a} - ${b}`, ...bs.map((x) => `- ${x}`)].join("\n"))
    .join("\n\n");
  const resume = `TAYLOR FIXTURE
Columbus, OH | taylor@example.com

Delivery driver and warehouse associate

CAREER SUMMARY
Delivery driver with warehouse, kitchen and lawn crew work behind it. Drives a box truck on a daily shop route and loads it from the pick list. Picked orders with an RF scanner on a night crew.

CORE COMPETENCIES
Box truck, RF scanner, Pick list, Dock loading, Inventory counts, Grill, Dish machine, Mowers

PROFESSIONAL EXPERIENCE
${body}

EDUCATION
GED, Columbus Adult Learning Center | 2005

CERTIFICATIONS
- OSHA 10 card (2017)`;
  return { source, resume };
})();
