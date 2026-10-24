/**
 * Career planner directions (magnum B6, Troy 2026-10-23: "some people have no
 * idea what lane they want... a career planner coach would help").
 *
 * The planner never lets the model invent a field. It picks from this list.
 * Each entry carries a dated primary source (BLS Occupational Outlook
 * Handbook, US overview), a plain first job and a typical later one, and a
 * record note written as advice ("ask how they look at a record"), never as
 * a claim about what employers do. Coaching, not legal advice.
 *
 * Pay is NOT here on purpose. No local pay source is wired, so the planner
 * shows no pay rather than guess (see plan.ts PAY_NOTE).
 *
 * Pure and client-safe.
 */

import { PATH_OCCUPATIONS, type OccupationEvidence } from "../paths/occupations";

export type Preparation = OccupationEvidence["preparation"];

export interface CareerDirection {
  id: string;
  title: string;
  /** The role the job search and the lane use. */
  searchRole: string;
  /** What the work is, in plain words. */
  plain: string;
  firstJob: string;
  laterJob: string;
  preparation: Preparation;
  /** Words that tie a person's own facts to this work. */
  terms: string[];
  heavyLifting: boolean;
  onFeetAllDay: boolean;
  /** The work itself needs a driver's license. */
  needsDriving: boolean;
  /** A state license or certification is part of the usual route. */
  stateLicense: boolean;
  /**
   * How to handle a record in this field, as advice with no claim about what
   * employers or boards do (boss ruling 2026-10-23, truth rule). A claim may be
   * added only with a dated primary source here, and the card shows it.
   */
  record: { note: string; source?: { title: string; url: string; checkedAt: string } };
  source: { title: string; url: string; reviewedAt: string; scope: "US occupation overview" };
}


/** AGENTS rule 8: every legal-adjacent output says this, word for word. */
export const RECORD_NOTE_FOOTER = "coaching, not legal advice";

type Extra = Pick<CareerDirection, "plain" | "firstJob" | "laterJob" | "heavyLifting" | "onFeetAllDay" | "needsDriving" | "stateLicense" | "record"> & {
  /** Everyday words people use for this work, on top of the explorer's terms (planner only). */
  moreTerms?: string[];
};

/** What the planner adds to each sourced occupation already in lib/paths. */
const FROM_PATHS: Record<string, Extra> = {
  "material-moving": {
    moreTerms: ["stocking", "unloading", "pallets", "orders"],
    plain: "You move, pack and load stock so orders go out right and on time.",
    firstJob: "Warehouse associate", laterJob: "Forklift operator or shift lead",
    heavyLifting: true, onFeetAllDay: true, needsDriving: false, stateLicense: false,
    record: { note: "Ask how they look at a record before you apply." },
  },
  "customer-service": {
    moreTerms: ["cashier", "front counter", "talking to people", "calming people", "customers"],
    plain: "You answer people's questions, fix their problems and keep them coming back, by phone, chat or in person.",
    firstJob: "Customer service representative", laterJob: "Team lead or account specialist",
    heavyLifting: false, onFeetAllDay: false, needsDriving: false, stateLicense: false,
    record: { note: "If the job handles payments or people's personal data, ask early how they look at a record." },
  },
  maintenance: {
    moreTerms: ["fix", "fixed", "fixing", "broke", "broken", "handyman", "plumbing", "painting"],
    plain: "You keep buildings and equipment working: find what broke, fix it, and write down what you did.",
    firstJob: "Maintenance helper", laterJob: "Maintenance technician",
    heavyLifting: true, onFeetAllDay: true, needsDriving: false, stateLicense: false,
    record: { note: "Ask how they look at a record before you apply. Ask again for work inside schools, hospitals or people's homes." },
  },
  cooking: {
    moreTerms: ["dish", "dishes", "diner", "cooking", "line cook", "busy kitchen"],
    plain: "You prep and cook food fast and clean, on a line or in a big kitchen.",
    firstJob: "Prep cook or line cook", laterJob: "Lead cook or kitchen manager",
    heavyLifting: false, onFeetAllDay: true, needsDriving: false, stateLicense: false,
    record: { note: "Ask how they look at a record before you apply." },
  },
  administrative: {
    plain: "You keep an office running: calls, schedules, files and paperwork.",
    firstJob: "Front desk or office assistant", laterJob: "Administrative assistant or office manager",
    heavyLifting: false, onFeetAllDay: false, needsDriving: false, stateLicense: false,
    record: { note: "Ask how they look at a record before you apply." },
  },
  "computer-support": {
    plain: "You help people when their computer, phone or software won't work.",
    firstJob: "Help desk technician", laterJob: "IT support specialist or network technician",
    heavyLifting: false, onFeetAllDay: false, needsDriving: false, stateLicense: false,
    record: { note: "If the job gives you access to company systems or customer data, ask early how they look at a record." },
  },
  bookkeeping: {
    moreTerms: ["money", "numbers", "budget", "cash drawer", "counting"],
    plain: "You keep a business's money records straight: bills, payments and the numbers that have to match.",
    firstJob: "Accounts payable or billing clerk", laterJob: "Bookkeeper",
    heavyLifting: false, onFeetAllDay: false, needsDriving: false, stateLicense: false,
    record: { note: "Money jobs: ask how they look at a record before you put in the time." },
  },
  "personal-care": {
    moreTerms: ["looked after", "taking care", "took care", "my grandmother", "my grandfather", "elderly"],
    plain: "You help people get through the day at home or in a facility, from meals to getting around.",
    firstJob: "Personal care aide", laterJob: "Home health aide or nursing assistant",
    heavyLifting: true, onFeetAllDay: true, needsDriving: false, stateLicense: true,
    record: { note: "Licensing and background rules for care work differ by state. Check yours before you pay for training." },
  },
  electrical: {
    plain: "You put in and fix wiring, outlets and panels, and learn the trade from people who know it.",
    firstJob: "Electrician helper or apprentice", laterJob: "Licensed electrician",
    heavyLifting: true, onFeetAllDay: true, needsDriving: false, stateLicense: true,
    record: { note: "Licensing rules differ by state. Check yours before you train, and ask the licensing board how they review a record." },
  },
  "graphic-design": {
    moreTerms: ["drawing", "art", "flyers", "logos"],
    plain: "You make things people look at: logos, flyers, layouts, social posts.",
    firstJob: "Freelance or junior designer", laterJob: "Graphic designer",
    heavyLifting: false, onFeetAllDay: false, needsDriving: false, stateLicense: false,
    record: { note: "Ask how they look at a record before you apply. For freelance work, lead with your portfolio." },
  },
  "production-management": {
    plain: "You run a production floor and keep the schedule and the quality where they need to be.",
    firstJob: "Production lead", laterJob: "Production supervisor or manager",
    heavyLifting: false, onFeetAllDay: true, needsDriving: false, stateLicense: false,
    record: { note: "Ask how they look at a record before you apply." },
  },
  software: {
    plain: "You build or test the apps and websites people use.",
    firstJob: "Junior developer or software tester", laterJob: "Software developer",
    heavyLifting: false, onFeetAllDay: false, needsDriving: false, stateLicense: false,
    record: { note: "Ask how they look at a record before you apply." },
  },
};

const checkedToday = (slug: string) => ({ title: "BLS Occupational Outlook Handbook", url: `https://www.bls.gov/ooh/${slug}.htm`, reviewedAt: "2026-10-23", scope: "US occupation overview" as const });

/** Added for the planner, each page read on 2026-10-23. */
const EXTRA: CareerDirection[] = [
  { id: "construction", title: "Construction work", searchRole: "Construction laborer", preparation: "on_job",
    plain: "You work on a crew building things, hauling material and running tools.",
    firstJob: "Construction laborer or helper", laterJob: "Skilled trade, crew lead or equipment operator",
    terms: ["construction", "demolition", "concrete", "framing", "roofing", "drywall", "laborer", "job site", "power tools"],
    heavyLifting: true, onFeetAllDay: true, needsDriving: false, stateLicense: false,
    record: { note: "Ask how they look at a record before you apply. Ask again for government or secure job sites." },
    source: checkedToday("construction-and-extraction/construction-laborers-and-helpers") },
  { id: "janitorial", title: "Cleaning and building care", searchRole: "Janitor", preparation: "on_job",
    plain: "You keep buildings clean and in good shape.",
    firstJob: "Janitor or custodian", laterJob: "Lead custodian or facilities tech",
    terms: ["cleaning", "janitor", "custodian", "housekeeping", "sanitation", "floor care", "mopping"],
    heavyLifting: false, onFeetAllDay: true, needsDriving: false, stateLicense: false,
    record: { note: "Ask how they look at a record before you apply. Ask again for schools, hospitals or secure buildings." },
    source: checkedToday("building-and-grounds-cleaning/janitors-and-building-cleaners") },
  { id: "truck-driving", title: "Truck driving", searchRole: "CDL truck driver", preparation: "varies",
    plain: "You haul freight from one place to another and own the road time.",
    firstJob: "Delivery driver, then CDL school", laterJob: "CDL Class A driver",
    terms: ["driving", "driver", "delivery", "truck", "cdl", "route", "hauling"],
    heavyLifting: false, onFeetAllDay: false, needsDriving: true, stateLicense: true,
    record: { note: "CDL rules differ by state. Check yours before you pay for school, and ask carriers how they look at a record." },
    source: checkedToday("transportation-and-material-moving/heavy-and-tractor-trailer-truck-drivers") },
  { id: "welding", title: "Welding and metal work", searchRole: "Welder", preparation: "varies",
    plain: "You join and cut metal with heat. Precise work you can see when it's done.",
    firstJob: "Welder helper or production welder", laterJob: "Certified welder or fabricator",
    terms: ["welding", "welder", "fabrication", "metal", "grinding", "torch", "mig", "tig"],
    heavyLifting: true, onFeetAllDay: true, needsDriving: false, stateLicense: false,
    record: { note: "Ask how they look at a record before you apply." },
    source: checkedToday("production/welders-cutters-solderers-and-brazers") },
  { id: "grounds", title: "Landscaping and grounds", searchRole: "Landscaper", preparation: "on_job",
    plain: "You work outside keeping yards and parks in shape, mostly mowing and planting.",
    firstJob: "Landscaping crew member", laterJob: "Crew lead or your own small crew",
    terms: ["landscaping", "lawn", "mowing", "yard", "gardening", "trees", "outdoor"],
    heavyLifting: true, onFeetAllDay: true, needsDriving: false, stateLicense: false,
    record: { note: "Ask how they look at a record before you apply." },
    source: checkedToday("building-and-grounds-cleaning/grounds-maintenance-workers") },
  { id: "human-services", title: "Helping people get services", searchRole: "Case aide", preparation: "on_job",
    plain: "You help people get what they need: housing, food, benefits, treatment.",
    firstJob: "Case aide or peer support worker", laterJob: "Case manager",
    terms: ["helping people", "mentoring", "peer", "case", "outreach", "community", "counseling", "support group"],
    heavyLifting: false, onFeetAllDay: false, needsDriving: false, stateLicense: false,
    record: { note: "Rules for work with kids or vulnerable adults differ by state. Check yours, and ask how they look at a record before you apply." },
    source: checkedToday("community-and-social-service/social-and-human-service-assistants") },
  { id: "auto-repair", title: "Auto repair", searchRole: "Automotive technician", preparation: "varies",
    plain: "You figure out what's wrong with cars and trucks and fix it.",
    firstJob: "Lube tech or tire tech", laterJob: "Automotive technician",
    terms: ["mechanic", "auto", "car", "engine", "brakes", "oil change", "tires", "automotive"],
    heavyLifting: true, onFeetAllDay: true, needsDriving: false, stateLicense: false,
    record: { note: "Ask how they look at a record, and at a driving record, before you apply." },
    source: checkedToday("installation-maintenance-and-repair/automotive-service-technicians-and-mechanics") },
];

export const CAREER_DIRECTIONS: CareerDirection[] = [
  ...PATH_OCCUPATIONS.filter((o) => FROM_PATHS[o.id]).map((o) => ({
    id: o.id, title: o.title, searchRole: o.searchRole, preparation: o.preparation, source: o.source, ...FROM_PATHS[o.id],
    terms: [...o.terms, ...(FROM_PATHS[o.id].moreTerms ?? [])],
  })).map(({ moreTerms: _unused, ...d }) => d as CareerDirection),
  ...EXTRA,
];

export function directionById(id: unknown): CareerDirection | null {
  return typeof id === "string" ? CAREER_DIRECTIONS.find((d) => d.id === id) ?? null : null;
}
