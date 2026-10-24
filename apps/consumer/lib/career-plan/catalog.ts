/**
 * Career planner directions (magnum B6, Troy 2026-10-23: "some people have no
 * idea what lane they want... a career planner coach would help").
 *
 * The planner never lets the model invent a field. It picks from this list.
 * Each entry carries a dated primary source (BLS Occupational Outlook
 * Handbook, US overview), a plain first job and a typical later one, and a
 * general note on how a record tends to land in that field. The record notes
 * are coaching, not a rule and not legal advice: the screen says so and
 * points the person to the employer and their state's current rules.
 *
 * Pay is NOT here on purpose. No local pay source is wired, so the planner
 * shows no pay rather than guess (see plan.ts PAY_NOTE).
 *
 * Pure and client-safe.
 */

import { PATH_OCCUPATIONS, type OccupationEvidence } from "../paths/occupations";

export type RecordLevel = "often_open" | "varies" | "closer_look" | "licensed";
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
  record: { level: RecordLevel; note: string };
  source: { title: string; url: string; reviewedAt: string; scope: "US occupation overview" };
}

export const RECORD_LEVEL_LABEL: Record<RecordLevel, string> = {
  often_open: "Often open to people with records",
  varies: "Depends on the employer",
  closer_look: "Records often get a closer look",
  licensed: "A license board may look at a record",
};

export const RECORD_NOTE_FOOTER = "Our general note from coaching. Not a rule and not legal advice. Check the employer and your state's current rules.";

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
    record: { level: "often_open", note: "A lot of warehouses hire people with records. Many still run a check, so ask how they look at it." },
  },
  "customer-service": {
    moreTerms: ["cashier", "front counter", "talking to people", "calming people", "customers"],
    plain: "You answer people's questions, fix their problems and keep them coming back, by phone, chat or in person.",
    firstJob: "Customer service representative", laterJob: "Team lead or account specialist",
    heavyLifting: false, onFeetAllDay: false, needsDriving: false, stateLicense: false,
    record: { level: "varies", note: "Jobs that handle payments or personal data can look closer at theft or fraud charges. Others care more about how you talk to people." },
  },
  maintenance: {
    moreTerms: ["fix", "fixed", "fixing", "broke", "broken", "handyman", "plumbing", "painting"],
    plain: "You keep buildings and equipment working: find what broke, fix it, and write down what you did.",
    firstJob: "Maintenance helper", laterJob: "Maintenance technician",
    heavyLifting: true, onFeetAllDay: true, needsDriving: false, stateLicense: false,
    record: { level: "varies", note: "Plenty of shops and property companies hire people with records. Jobs inside schools, hospitals or homes where people live often check closer." },
  },
  cooking: {
    moreTerms: ["dish", "dishes", "diner", "cooking", "line cook", "busy kitchen"],
    plain: "You prep and cook food fast and clean, on a line or in a big kitchen.",
    firstJob: "Prep cook or line cook", laterJob: "Lead cook or kitchen manager",
    heavyLifting: false, onFeetAllDay: true, needsDriving: false, stateLicense: false,
    record: { level: "often_open", note: "Many kitchens don't make a record the main question. Schools, hospitals and some chains check closer." },
  },
  administrative: {
    plain: "You keep an office running: calls, schedules, files and paperwork.",
    firstJob: "Front desk or office assistant", laterJob: "Administrative assistant or office manager",
    heavyLifting: false, onFeetAllDay: false, needsDriving: false, stateLicense: false,
    record: { level: "varies", note: "Depends a lot on the office. Legal, medical and money offices tend to check closer." },
  },
  "computer-support": {
    plain: "You help people when their computer, phone or software won't work.",
    firstJob: "Help desk technician", laterJob: "IT support specialist or network technician",
    heavyLifting: false, onFeetAllDay: false, needsDriving: false, stateLicense: false,
    record: { level: "closer_look", note: "Jobs with access to company systems or customer data often run a check. Certifications and a home lab can count for a lot." },
  },
  bookkeeping: {
    moreTerms: ["money", "numbers", "budget", "cash drawer", "counting"],
    plain: "You keep a business's money records straight: bills, payments and the numbers that have to match.",
    firstJob: "Accounts payable or billing clerk", laterJob: "Bookkeeper",
    heavyLifting: false, onFeetAllDay: false, needsDriving: false, stateLicense: false,
    record: { level: "closer_look", note: "Money jobs often look hard at theft or fraud charges. Other charges may matter less. Ask before you put in a lot of time." },
  },
  "personal-care": {
    moreTerms: ["looked after", "taking care", "took care", "my grandmother", "my grandfather", "elderly"],
    plain: "You help people get through the day at home or in a facility, from meals to getting around.",
    firstJob: "Personal care aide", laterJob: "Home health aide or nursing assistant",
    heavyLifting: true, onFeetAllDay: true, needsDriving: false, stateLicense: true,
    record: { level: "licensed", note: "Care work with older or disabled people usually has state background check rules, and some charges can bar you for a while. Check your state's rules before you spend money on training." },
  },
  electrical: {
    plain: "You put in and fix wiring, outlets and panels, and learn the trade from people who know it.",
    firstJob: "Electrician helper or apprentice", laterJob: "Licensed electrician",
    heavyLifting: true, onFeetAllDay: true, needsDriving: false, stateLicense: true,
    record: { level: "licensed", note: "Apprenticeships are often open. The license comes later, and some state boards look at a record. Ask the board how they review one." },
  },
  "graphic-design": {
    moreTerms: ["drawing", "art", "flyers", "logos"],
    plain: "You make things people look at: logos, flyers, layouts, social posts.",
    firstJob: "Freelance or junior designer", laterJob: "Graphic designer",
    heavyLifting: false, onFeetAllDay: false, needsDriving: false, stateLicense: false,
    record: { level: "often_open", note: "A strong portfolio often matters more than a check, especially for freelance work. Some employers still run one." },
  },
  "production-management": {
    plain: "You run a production floor and keep the schedule and the quality where they need to be.",
    firstJob: "Production lead", laterJob: "Production supervisor or manager",
    heavyLifting: false, onFeetAllDay: true, needsDriving: false, stateLicense: false,
    record: { level: "varies", note: "Many plants promote from the floor. Defense and secure plants check closer." },
  },
  software: {
    plain: "You build or test the apps and websites people use.",
    firstJob: "Junior developer or software tester", laterJob: "Software developer",
    heavyLifting: false, onFeetAllDay: false, needsDriving: false, stateLicense: false,
    record: { level: "varies", note: "Your projects count for a lot here. Big companies and government work usually run a check." },
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
    record: { level: "often_open", note: "Construction often hires people with records. Government and secure sites can check closer." },
    source: checkedToday("construction-and-extraction/construction-laborers-and-helpers") },
  { id: "janitorial", title: "Cleaning and building care", searchRole: "Janitor", preparation: "on_job",
    plain: "You keep buildings clean and in good shape, often on your own and often at night.",
    firstJob: "Janitor or custodian", laterJob: "Lead custodian or facilities tech",
    terms: ["cleaning", "janitor", "custodian", "housekeeping", "sanitation", "floor care", "mopping"],
    heavyLifting: false, onFeetAllDay: true, needsDriving: false, stateLicense: false,
    record: { level: "often_open", note: "Many cleaning jobs hire people with records. Schools, hospitals and secure buildings check closer." },
    source: checkedToday("building-and-grounds-cleaning/janitors-and-building-cleaners") },
  { id: "truck-driving", title: "Truck driving", searchRole: "CDL truck driver", preparation: "varies",
    plain: "You haul freight from one place to another and own the road time.",
    firstJob: "Delivery driver, then CDL school", laterJob: "CDL Class A driver",
    terms: ["driving", "driver", "delivery", "truck", "cdl", "route", "hauling"],
    heavyLifting: false, onFeetAllDay: false, needsDriving: true, stateLicense: true,
    record: { level: "licensed", note: "You need a CDL. Some carriers and some loads have record rules, and driving charges matter most. Ask carriers and your state's licensing office." },
    source: checkedToday("transportation-and-material-moving/heavy-and-tractor-trailer-truck-drivers") },
  { id: "welding", title: "Welding and metal work", searchRole: "Welder", preparation: "varies",
    plain: "You join and cut metal with heat. Precise work you can see when it's done.",
    firstJob: "Welder helper or production welder", laterJob: "Certified welder or fabricator",
    terms: ["welding", "welder", "fabrication", "metal", "grinding", "torch", "mig", "tig"],
    heavyLifting: true, onFeetAllDay: true, needsDriving: false, stateLicense: false,
    record: { level: "often_open", note: "Many shops hire people with records. Defense and secure work can check closer." },
    source: checkedToday("production/welders-cutters-solderers-and-brazers") },
  { id: "grounds", title: "Landscaping and grounds", searchRole: "Landscaper", preparation: "on_job",
    plain: "You work outside keeping yards and parks in shape, mostly mowing and planting.",
    firstJob: "Landscaping crew member", laterJob: "Crew lead or your own small crew",
    terms: ["landscaping", "lawn", "mowing", "yard", "gardening", "trees", "outdoor"],
    heavyLifting: true, onFeetAllDay: true, needsDriving: false, stateLicense: false,
    record: { level: "often_open", note: "Landscaping crews often hire people with records. Work at schools or homes can check closer." },
    source: checkedToday("building-and-grounds-cleaning/grounds-maintenance-workers") },
  { id: "human-services", title: "Helping people get services", searchRole: "Case aide", preparation: "on_job",
    plain: "You help people get what they need: housing, food, benefits, treatment. Lived experience can count here.",
    firstJob: "Case aide or peer support worker", laterJob: "Case manager",
    terms: ["helping people", "mentoring", "peer", "case", "outreach", "community", "counseling", "support group"],
    heavyLifting: false, onFeetAllDay: false, needsDriving: false, stateLicense: false,
    record: { level: "closer_look", note: "Some programs value lived experience. Jobs with kids or vulnerable adults run strict checks, and the rules differ by state." },
    source: checkedToday("community-and-social-service/social-and-human-service-assistants") },
  { id: "auto-repair", title: "Auto repair", searchRole: "Automotive technician", preparation: "varies",
    plain: "You figure out what's wrong with cars and trucks and fix it.",
    firstJob: "Lube tech or tire tech", laterJob: "Automotive technician",
    terms: ["mechanic", "auto", "car", "engine", "brakes", "oil change", "tires", "automotive"],
    heavyLifting: true, onFeetAllDay: true, needsDriving: false, stateLicense: false,
    record: { level: "often_open", note: "Many shops hire people with records. Some want a clean driving record so you can move customer cars." },
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
