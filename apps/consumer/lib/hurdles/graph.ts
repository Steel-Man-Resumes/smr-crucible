/**
 * Hurdle planner decision graph (PURE DATA, no network, no DB).
 *
 * The person picks the hurdles in their way (several allowed). Each hurdle is
 * a small graph: the next question depends on the last answer. A "many" node
 * queues one follow-up per choice picked, so "no car" and "bus hours" each get
 * their own next question. Only the record hurdle ends in the disclosure
 * conversation plan; every other hurdle ends in an action plan and one choice:
 * what the person wants an employer to know.
 *
 * Minimum collection: no node asks for a diagnosis, an offense, a case number,
 * a name, an SSN or a story about what happened. Free text is always optional.
 * Record nodes are marked `sensitive`: they never reach a model without the
 * record consent (see lib/hurdles/phrase.ts).
 *
 * Copy rule: plain words, no dashes as punctuation, never a label for the
 * person, nothing that assumes a hurdle is solved.
 */

import type { JobShift } from "@crucible/core/src/jobSearchFilters";

export const HURDLE_IDS = [
  "gaps", "record", "schedule", "transport", "housing", "health",
  "documents", "skills", "money", "other", "not_sure",
] as const;
export type HurdleId = (typeof HURDLE_IDS)[number];

export function isHurdleId(x: unknown): x is HurdleId {
  return typeof x === "string" && (HURDLE_IDS as readonly string[]).includes(x);
}

/** Support search categories (components/lanes/SupportSearch.tsx ids). */
export type SupportCategory =
  | "transportation" | "housing" | "id_documents" | "legal" | "financial"
  | "employment" | "education" | "mental_health" | "substance";

/** A functional limit the person may choose to carry into job search. */
export interface Constraint {
  shifts?: JobShift[];
  radiusMiles?: number;
  remote?: boolean;
  partTime?: boolean;
  fullTime?: boolean;
}

export interface Choice {
  id: string;
  label: string;
  /** Next node. undefined = the node's own `next`. null = this hurdle ends. "TELL" = the hurdle's tell node. */
  next?: string | null;
  /** What the plan lists as known when this is picked. Defaults to the label. */
  fact?: string;
  /** A concrete step for "what to do now". */
  action?: string;
  /** A question the person can ask an employer. */
  ask?: string;
  support?: SupportCategory[];
  constraint?: Constraint;
  /** "Not sure" style answers: answered, but still open. */
  uncertain?: boolean;
  /** Picking this adds another hurdle to the person's list (used by "not sure"). */
  addsHurdle?: HurdleId;
}

export type NodeKind = "one" | "many" | "text";

export interface HurdleNode {
  id: string;
  hurdle: HurdleId;
  kind: NodeKind;
  question: string;
  help?: string;
  choices?: Choice[];
  /** Default next for text nodes, skips, and many nodes after their queued follow-ups. */
  next?: string | null;
  /** What this question decides, in plain words (coverage and "still open" lines). */
  decision: string;
  placeholder?: string;
  maxLength?: number;
  format?: "state" | "text";
  /** Record detail: never sent to a model without the record consent. */
  sensitive?: boolean;
}

export interface HurdleDef {
  id: HurdleId;
  label: string;
  blurb: string;
  start: string;
  support: SupportCategory[];
  /** A first step that is true no matter what was answered. */
  firstStep: string;
}

const NOT_SURE: Choice = { id: "not_sure", label: "Not sure", uncertain: true };
const RATHER_NOT: Choice = { id: "rather_not", label: "Rather not say", uncertain: true, fact: "You chose not to say. That's fine." };
export const TELL = "TELL";

export const HURDLES: Record<HurdleId, HurdleDef> = {
  gaps: { id: "gaps", label: "Gaps in my work history", blurb: "Time between jobs, or a stretch with no work on paper.", start: "gaps.length", support: ["employment"], firstStep: "Write the dates of each gap on one line each, month and year, so every form says the same thing." },
  record: { id: "record", label: "A record or background check", blurb: "A form question, an interview, or a check after an offer.", start: "record.where", support: ["legal"], firstStep: "Find out what the form or the employer actually asks, in their own words, before you plan an answer." },
  schedule: { id: "schedule", label: "Schedule and caregiving", blurb: "Kids, family, school, another job, or appointments.", start: "schedule.what", support: ["employment"], firstStep: "Write down the hours you can work, every day of the week, so you can say it in one breath." },
  transport: { id: "transport", label: "Getting to work", blurb: "No car, bus hours, a license, or the cost of the trip.", start: "transport.what", support: ["transportation"], firstStep: "Before you apply, check how you would get to that address at the shift's start and end time." },
  housing: { id: "housing", label: "Housing", blurb: "Staying with someone, a shelter, or a place that may change.", start: "housing.now", support: ["housing"], firstStep: "Make sure you have one address and one phone number that can reach you for the next month." },
  health: { id: "health", label: "Health and work adjustments", blurb: "Limits, breaks, appointments, or what helps you work well.", start: "health.impact", support: ["mental_health"], firstStep: "Write what helps you do the work well, in plain words. You never have to name a condition." },
  documents: { id: "documents", label: "ID, documents and licenses", blurb: "State ID, Social Security card, a driver's or work license.", start: "documents.missing", support: ["id_documents"], firstStep: "Make a list of what you have and what you are missing. Most jobs ask for ID before your first day." },
  skills: { id: "skills", label: "Skills, computers and phone access", blurb: "Online applications, a phone that runs out, or a skill to learn.", start: "skills.what", support: ["education"], firstStep: "Find one place you can get online for an hour, a few times a week." },
  money: { id: "money", label: "Money", blurb: "Need pay fast, costs to start, fines, or benefits.", start: "money.what", support: ["financial"], firstStep: "Write the least you can take home each week and still cover your bills." },
  other: { id: "other", label: "Something else", blurb: "Something not on this list.", start: "other.what", support: ["employment"], firstStep: "Write it down in a few words. A hurdle with a name is easier to plan around." },
  not_sure: { id: "not_sure", label: "Not sure yet", blurb: "A few questions to help you find what is in the way.", start: "not_sure.signs", support: ["employment"], firstStep: "Pick one hurdle from what you found and work it first." },
};

/** Order shown in the picker. */
export const HURDLE_ORDER: HurdleId[] = [
  "gaps", "record", "schedule", "transport", "housing", "health", "documents", "skills", "money", "other", "not_sure",
];

const SHIFT_CHOICES = (next: string | null | undefined): Choice[] => [
  { id: "day", label: "Days", fact: "You can work day shifts.", constraint: { shifts: ["day"] }, next },
  { id: "evening", label: "Evenings", fact: "You can work evening shifts.", constraint: { shifts: ["evening"] }, next },
  { id: "night", label: "Nights", fact: "You can work night shifts.", constraint: { shifts: ["night"] }, next },
  { id: "weekend", label: "Weekends", fact: "You can work weekends.", constraint: { shifts: ["weekend"] }, next },
  { id: "rotating", label: "A rotating schedule", fact: "You can work a rotating schedule.", constraint: { shifts: ["rotating"] }, next },
  { ...NOT_SURE, next },
];

function n(node: HurdleNode): HurdleNode { return node; }

const NODE_LIST: HurdleNode[] = [
  // ── Transport ────────────────────────────────────────────────────────────
  n({ id: "transport.what", hurdle: "transport", kind: "many", decision: "what gets in the way of the trip",
    question: "What gets in the way of getting to work?", help: "Pick all that fit.",
    choices: [
      { id: "no_car", label: "No car right now", fact: "You don't have a car right now.", next: "transport.options" },
      { id: "bus_hours", label: "Bus or train hours", fact: "Bus or train hours don't always line up with work.", next: "transport.bus_when" },
      { id: "license", label: "No license, or it's suspended", fact: "Your license is a problem right now.", next: "transport.license" },
      { id: "cost", label: "Cost of gas, fares or repairs", fact: "The cost of getting to work is a problem.", next: "transport.cost", support: ["financial"] },
      { id: "ride", label: "A ride I can't count on", fact: "Your ride isn't always there.", next: "transport.backup" },
      { id: "access", label: "Getting on and off is hard (accessibility)", fact: "Parts of the trip are hard to get through.", next: "transport.access" },
      { ...NOT_SURE, next: "transport.distance" },
    ], next: "transport.distance" }),
  n({ id: "transport.bus_when", hurdle: "transport", kind: "many", decision: "when transit doesn't work",
    question: "When does the bus or train not work for you?",
    choices: [
      { id: "early", label: "Early mornings", fact: "Transit doesn't run early enough for you.", ask: "What time does the shift start, and does that ever change?" },
      { id: "late", label: "Late nights", fact: "Transit stops before late shifts end.", ask: "What time does the shift end on a normal day?" },
      { id: "weekends", label: "Weekends", fact: "Weekend transit doesn't work for you." },
      { id: "route", label: "The route doesn't reach the job", fact: "Some job sites are off the route.", action: "Check the trip on a transit map from your address to the job address before you apply." },
      NOT_SURE,
    ], next: "transport.shift_fit" }),
  n({ id: "transport.shift_fit", hurdle: "transport", kind: "many", decision: "which shifts you can reach",
    question: "With the bus as it runs now, which shifts can you reach?", help: "This can go into your job search filters later, only if you say so.",
    choices: SHIFT_CHOICES(undefined), next: "transport.distance" }),
  n({ id: "transport.options", hurdle: "transport", kind: "many", decision: "how you get around now",
    question: "How do you get around now?",
    choices: [
      { id: "walk", label: "Walk", fact: "You walk to get around." },
      { id: "bike", label: "Bike", fact: "You bike to get around." },
      { id: "bus", label: "Bus or train", fact: "You use the bus or train." },
      { id: "rides", label: "Rides from family or friends", fact: "Family or friends give you rides.", next: "transport.backup" },
      { id: "rideshare", label: "Rideshare or cab sometimes", fact: "You use rideshare or a cab sometimes." },
      NOT_SURE,
    ], next: "transport.distance" }),
  n({ id: "transport.license", hurdle: "transport", kind: "one", decision: "where your license stands",
    question: "Where does your license stand?",
    choices: [
      { id: "never", label: "Never had one", fact: "You haven't had a driver's license.", action: "If a job needs driving, ask what it takes to test for a license where you live." },
      { id: "suspended", label: "Suspended or revoked", fact: "Your license is suspended or revoked.", action: "Ask the DMV or the court what it takes to get it back, and write down every step and cost they name.", support: ["legal"] },
      { id: "expired", label: "Expired", fact: "Your license is expired.", action: "Check what renewing it costs and what papers you need to bring." },
      NOT_SURE,
    ], next: "transport.options" }),
  n({ id: "transport.cost", hurdle: "transport", kind: "many", decision: "which trip costs hit hardest",
    question: "Which costs hit hardest?",
    choices: [
      { id: "gas", label: "Gas", fact: "Gas is hard to cover." },
      { id: "fares", label: "Bus or train fares", fact: "Fares are hard to cover.", action: "Ask the transit agency or a local job center about reduced fares or passes." },
      { id: "repairs", label: "Car repairs", fact: "Car repairs are hard to cover." },
      { id: "insurance", label: "Insurance", fact: "Car insurance is hard to cover." },
      NOT_SURE,
    ], next: "transport.distance" }),
  n({ id: "transport.backup", hurdle: "transport", kind: "one", decision: "whether there is a backup ride",
    question: "If your ride falls through, is there a backup?",
    choices: [
      { id: "yes", label: "Yes", fact: "You have a backup if a ride falls through." },
      { id: "no", label: "No", fact: "There is no backup ride yet.", action: "Find one backup way to get there (a bus route, a second person, a rideshare budget) before your first shift." },
      NOT_SURE,
    ], next: "transport.distance" }),
  n({ id: "transport.access", hurdle: "transport", kind: "many", decision: "what would make the trip work",
    question: "What would make the trip work?",
    choices: [
      { id: "paratransit", label: "A door to door ride service", fact: "A door to door ride service would help.", action: "Ask your transit agency how to sign up for its door to door ride service." },
      { id: "stop", label: "A stop with a ramp or elevator", fact: "You need a stop with a ramp or elevator." },
      { id: "short_walk", label: "A shorter walk from the stop", fact: "A long walk from the stop is hard." },
      NOT_SURE,
    ], next: "transport.distance" }),
  n({ id: "transport.distance", hurdle: "transport", kind: "one", decision: "how far you can get to work today",
    question: "How far can you get to work today?",
    choices: [
      { id: "under5", label: "Under 5 miles", fact: "You can get to work within about 5 miles.", constraint: { radiusMiles: 5 } },
      { id: "5to15", label: "5 to 15 miles", fact: "You can get to work within about 15 miles.", constraint: { radiusMiles: 15 } },
      { id: "15to30", label: "15 to 30 miles", fact: "You can get to work within about 30 miles.", constraint: { radiusMiles: 30 } },
      { id: "home", label: "Only from home (remote)", fact: "Right now you can only work from home.", constraint: { remote: true } },
      NOT_SURE,
    ], next: TELL }),

  // ── Schedule and caregiving ──────────────────────────────────────────────
  n({ id: "schedule.what", hurdle: "schedule", kind: "many", decision: "what shapes your hours",
    question: "What shapes the hours you can work?", help: "Pick all that fit.",
    choices: [
      { id: "care", label: "Kids or family I care for", fact: "You care for kids or family.", next: "schedule.care_hours" },
      { id: "job", label: "Another job", fact: "You have another job to work around." },
      { id: "school", label: "School or classes", fact: "You have school or classes to work around.", support: ["education"] },
      { id: "appointments", label: "Appointments I have to keep", fact: "You have appointments you have to keep.", next: "schedule.appointments" },
      NOT_SURE,
    ], next: "schedule.hours" }),
  n({ id: "schedule.care_hours", hurdle: "schedule", kind: "many", decision: "when care is covered",
    question: "When is care covered?",
    choices: [
      { id: "school_hours", label: "During school hours", fact: "Care is covered during school hours." },
      { id: "daytime", label: "Daytime", fact: "Care is covered in the daytime." },
      { id: "evenings", label: "Evenings", fact: "Care is covered in the evenings." },
      { id: "no_backup", label: "No backup when they are sick", fact: "There is no backup care on sick days yet.", action: "Line up one person who could cover a sick day, even if you never use them." },
      NOT_SURE,
    ], next: "schedule.hours" }),
  n({ id: "schedule.appointments", hurdle: "schedule", kind: "one", decision: "how often appointments come up",
    question: "How often do the appointments come up?",
    choices: [
      { id: "weekly", label: "Every week", fact: "You have appointments every week.", ask: "How does the team handle a standing weekly appointment?" },
      { id: "monthly", label: "About once a month", fact: "You have appointments about once a month.", ask: "How much notice do you need to swap a shift?" },
      { id: "changes", label: "It changes", fact: "Your appointments change from time to time.", ask: "How much notice do you need to swap a shift?" },
      NOT_SURE,
    ], next: "schedule.hours" }),
  n({ id: "schedule.hours", hurdle: "schedule", kind: "many", decision: "which shifts you can work",
    question: "Which shifts can you work?", help: "This can go into your job search filters later, only if you say so.",
    choices: SHIFT_CHOICES(undefined), next: "schedule.total" }),
  n({ id: "schedule.total", hurdle: "schedule", kind: "one", decision: "how many hours a week",
    question: "How many hours a week can you work?",
    choices: [
      { id: "full", label: "Full time", fact: "You can work full time.", constraint: { fullTime: true } },
      { id: "part", label: "Part time", fact: "You can work part time.", constraint: { partTime: true } },
      NOT_SURE,
    ], next: TELL }),

  // ── Work history gaps ────────────────────────────────────────────────────
  n({ id: "gaps.length", hurdle: "gaps", kind: "one", decision: "how long the gap is",
    question: "How long is the longest gap?",
    choices: [
      { id: "under6", label: "Under 6 months", fact: "Your longest gap is under 6 months." },
      { id: "6to12", label: "6 to 12 months", fact: "Your longest gap is 6 to 12 months." },
      { id: "1to3", label: "1 to 3 years", fact: "Your longest gap is 1 to 3 years." },
      { id: "over3", label: "More than 3 years", fact: "Your longest gap is more than 3 years." },
      { id: "several", label: "Several gaps", fact: "You have more than one gap." },
      NOT_SURE,
    ], next: "gaps.filled" }),
  n({ id: "gaps.filled", hurdle: "gaps", kind: "many", decision: "what filled the time",
    question: "What filled the time? Pick only what you are comfortable naming.", help: "You choose what an employer hears. This is just for your plan.",
    choices: [
      { id: "family", label: "Caring for family", fact: "You were caring for family." },
      { id: "health", label: "Health", fact: "Health took some of that time." },
      { id: "inside", label: "Time inside", fact: "Some of the gap was time inside.", next: "gaps.inside" },
      { id: "searching", label: "Looking for work", fact: "You were looking for work." },
      { id: "school", label: "School or training", fact: "You were in school or training.", next: "gaps.proof" },
      { id: "informal", label: "Cash or side work", fact: "You did cash or side work.", next: "gaps.informal" },
      { id: "moving", label: "Moving or housing", fact: "Moving or housing took some of that time." },
      RATHER_NOT,
    ], next: "gaps.proof" }),
  n({ id: "gaps.inside", hurdle: "gaps", kind: "one", decision: "whether to plan the record conversation too",
    question: "Do you want to plan the record conversation too?",
    choices: [
      { id: "yes", label: "Yes, add it", addsHurdle: "record", fact: "You added the record conversation to your plan." },
      { id: "no", label: "Not now", fact: "You chose not to plan the record conversation right now." },
    ], next: "gaps.proof" }),
  n({ id: "gaps.informal", hurdle: "gaps", kind: "one", decision: "whether side work can count as work",
    question: "Could that work go on your resume as real work?", help: "Real work is real work. It only goes on the page if you can explain every line.",
    choices: [
      { id: "yes", label: "Yes", fact: "Your side work can count as work history.", action: "Write what you did, who it was for, and the months you did it. That can fill part of the gap." },
      { id: "no", label: "No", fact: "The side work stays off the page." },
      NOT_SURE,
    ], next: "gaps.proof" }),
  n({ id: "gaps.proof", hurdle: "gaps", kind: "many", decision: "what shows what you did",
    question: "Is there anything that shows what you did in that time?",
    choices: [
      { id: "certs", label: "A certificate or class record", fact: "You have a certificate or class record from that time." },
      { id: "reference", label: "Someone who would vouch for me", fact: "Someone could vouch for what you did.", action: "Ask that person if they would take a call from an employer." },
      { id: "pay", label: "Pay records", fact: "You have pay records from that time." },
      { id: "nothing", label: "Nothing yet", fact: "Nothing shows that time yet." },
      NOT_SURE,
    ], next: "gaps.asked" }),
  n({ id: "gaps.asked", hurdle: "gaps", kind: "one", decision: "whether an employer has asked yet",
    question: "Has an employer asked about the gap yet?",
    choices: [
      { id: "yes", label: "Yes", fact: "An employer has asked about the gap.", action: "Practice a two sentence answer: the dates, then what you are doing now." },
      { id: "no", label: "Not yet", fact: "No employer has asked about the gap yet." },
    ], next: TELL }),

  // ── Housing ──────────────────────────────────────────────────────────────
  n({ id: "housing.now", hurdle: "housing", kind: "one", decision: "where housing stands",
    question: "What is going on with housing?", help: "Pick the closest one. No details needed.",
    choices: [
      { id: "stable", label: "Stable for now", fact: "Housing is stable for now.", next: "housing.impact" },
      { id: "staying", label: "Staying with someone", fact: "You're staying with someone.", next: "housing.stay" },
      { id: "shelter", label: "In a shelter", fact: "You're staying in a shelter.", next: "housing.address", support: ["housing"] },
      { id: "at_risk", label: "I may lose my place", fact: "You may lose your place.", next: "housing.when" },
      { id: "no_address", label: "No address to use", fact: "You don't have an address to use right now.", next: "housing.address" },
      { ...RATHER_NOT, next: "housing.impact" },
    ], next: "housing.impact" }),
  n({ id: "housing.address", hurdle: "housing", kind: "many", decision: "how employers can reach you",
    question: "What do you have that an employer can use to reach you?",
    choices: [
      { id: "mail", label: "An address that gets mail", fact: "You have an address that gets mail." },
      { id: "phone", label: "A phone that works", fact: "You have a phone that works." },
      { id: "neither", label: "Neither right now", fact: "You don't have a mail address or a working phone yet.", action: "Ask a shelter, library or job center if you can use their address for mail, and get one number employers can leave a message on." },
      NOT_SURE,
    ], next: "housing.impact" }),
  n({ id: "housing.when", hurdle: "housing", kind: "one", decision: "when housing could change",
    question: "When could it change?",
    choices: [
      { id: "month", label: "This month", fact: "Your housing could change this month.", action: "Call a housing help line this week. Ask what they need from you to start." },
      { id: "soon", label: "In 1 to 3 months", fact: "Your housing could change in the next few months." },
      NOT_SURE,
    ], next: "housing.impact" }),
  n({ id: "housing.stay", hurdle: "housing", kind: "one", decision: "whether you can stay while you start a job",
    question: "Can you stay there while you start a job?",
    choices: [
      { id: "yes", label: "Yes", fact: "You can stay where you are while you start a job." },
      { id: "no", label: "No", fact: "You may need to move before or after you start.", support: ["housing"] },
      NOT_SURE,
    ], next: "housing.impact" }),
  n({ id: "housing.impact", hurdle: "housing", kind: "many", decision: "how housing touches work",
    question: "How does it touch work?",
    choices: [
      { id: "rest", label: "Hard to rest before shifts", fact: "It's hard to rest before shifts." },
      { id: "calls", label: "Hard to get calls or mail", fact: "Calls or mail don't always reach you." },
      { id: "moving", label: "I may move soon", fact: "You may move soon.", ask: "Is there more than one location I could work from?" },
      { id: "fine", label: "It doesn't right now", fact: "Housing doesn't touch work right now." },
      NOT_SURE,
    ], next: TELL }),

  // ── Health and work adjustments ──────────────────────────────────────────
  n({ id: "health.impact", hurdle: "health", kind: "many", decision: "how it touches the work",
    question: "How does it touch the work? You don't have to name a condition.",
    choices: [
      { id: "lifting", label: "Limits on standing or lifting", fact: "You have limits on standing or lifting.", ask: "How much of the shift is standing or lifting?" },
      { id: "breaks", label: "I need breaks", fact: "You need breaks during a shift.", ask: "How are breaks scheduled on this team?" },
      { id: "schedule", label: "I need a certain schedule", fact: "You need a certain schedule." },
      { id: "appointments", label: "Appointments", fact: "You have appointments to keep." },
      { id: "focus", label: "Focus or memory", fact: "Focus or memory can make some tasks harder.", ask: "How do people usually learn the job here?" },
      { id: "settings", label: "Some settings are hard (noise, crowds, stress)", fact: "Some work settings are hard for you." },
      NOT_SURE,
    ], next: "health.helped" }),
  n({ id: "health.helped", hurdle: "health", kind: "many", decision: "what has helped before",
    question: "Has something helped you work well before?",
    choices: [
      { id: "schedule", label: "A different schedule", fact: "A different schedule has helped before." },
      { id: "equipment", label: "A stool, a cart or other equipment", fact: "Equipment has helped before." },
      { id: "written", label: "Written steps or checklists", fact: "Written steps have helped before." },
      { id: "quiet", label: "A quieter spot", fact: "A quieter spot has helped before." },
      { id: "time_off", label: "Time off for appointments", fact: "Time off for appointments has helped before." },
      NOT_SURE,
    ], next: "health.ask" }),
  n({ id: "health.ask", hurdle: "health", kind: "one", decision: "whether and when to ask for an adjustment",
    question: "Do you want to ask an employer for a change that helps you work?",
    choices: [
      { id: "before", label: "Yes, before I start", fact: "You want to ask for a change before you start.", action: "Write the change you need in one line, framed around the work (for example, a stool at the station)." },
      { id: "after", label: "Yes, after I start", fact: "You want to ask for a change after you start.", action: "Write the change you need in one line so it's ready when you ask." },
      { id: "no", label: "Not now", fact: "You don't want to ask for a change right now." },
      NOT_SURE,
    ], next: TELL }),

  // ── ID, documents and licenses ───────────────────────────────────────────
  n({ id: "documents.missing", hurdle: "documents", kind: "many", decision: "which papers are missing",
    question: "What are you missing?", help: "Pick all that fit.",
    choices: [
      { id: "state_id", label: "State ID", fact: "You need a state ID.", next: "documents.blocker" },
      { id: "ss_card", label: "Social Security card", fact: "You need your Social Security card.", next: "documents.blocker" },
      { id: "birth", label: "Birth certificate", fact: "You need your birth certificate.", next: "documents.blocker" },
      { id: "drivers", label: "Driver's license", fact: "You need a driver's license.", next: "documents.drivers" },
      { id: "work_license", label: "A license or certificate for a job", fact: "You need a license or certificate for a job.", next: "documents.work_license" },
      NOT_SURE,
    ], next: "documents.need_by" }),
  n({ id: "documents.blocker", hurdle: "documents", kind: "many", decision: "what is stopping you from getting it",
    question: "What is stopping you from getting it?",
    choices: [
      { id: "cost", label: "The cost", fact: "The cost of the document is a problem.", action: "Ask a job center or reentry program if they help pay for ID documents." },
      { id: "chain", label: "I need another document first", fact: "You need one document to get another.", action: "Start with the document the others depend on. Ask the office what they accept instead." },
      { id: "address", label: "I need an address", fact: "You need an address to get it." },
      NOT_SURE,
    ], next: "documents.need_by" }),
  n({ id: "documents.drivers", hurdle: "documents", kind: "one", decision: "where your license stands",
    question: "Where does your license stand?",
    choices: [
      { id: "never", label: "Never had one", fact: "You haven't had a driver's license." },
      { id: "suspended", label: "Suspended or revoked", fact: "Your license is suspended or revoked.", action: "Ask the DMV or the court what it takes to get it back.", support: ["legal"] },
      { id: "expired", label: "Expired", fact: "Your license is expired." },
      NOT_SURE,
    ], next: "documents.need_by" }),
  n({ id: "documents.work_license", hurdle: "documents", kind: "text", decision: "which job license",
    question: "Which license or certificate? (for example CDL, forklift, CNA)", placeholder: "A few words. You can skip this.", maxLength: 80,
    next: "documents.board" }),
  n({ id: "documents.board", hurdle: "documents", kind: "one", decision: "whether you have asked the board what it needs",
    question: "Have you asked the people who issue it what they need from you?",
    choices: [
      { id: "yes", label: "Yes", fact: "You have asked what they need." },
      { id: "no", label: "Not yet", fact: "You haven't asked what they need yet.", action: "Call or check the website of whoever issues that license and write down what they need from you." },
      NOT_SURE,
    ], next: "documents.need_by" }),
  n({ id: "documents.need_by", hurdle: "documents", kind: "one", decision: "when you need it",
    question: "When do you need it?",
    choices: [
      { id: "apply", label: "Before I can apply", fact: "You need it before you can apply." },
      { id: "start", label: "Before I start", fact: "You need it before your first day.", ask: "What do you need from me on the first day?" },
      NOT_SURE,
    ], next: TELL }),

  // ── Skills, computers and phone access ───────────────────────────────────
  n({ id: "skills.what", hurdle: "skills", kind: "many", decision: "what gets in the way",
    question: "What gets in the way?", help: "Pick all that fit.",
    choices: [
      { id: "computer", label: "No computer", fact: "You don't have a computer.", next: "skills.online" },
      { id: "phone", label: "My phone or data runs out", fact: "Your phone or data runs out.", next: "skills.online" },
      { id: "online", label: "Email or online applications", fact: "Email or online applications are hard.", next: "skills.online" },
      { id: "job_skill", label: "A skill the job asks for", fact: "A job asks for a skill you want to build.", next: "skills.which" },
      { id: "reading", label: "Reading or writing", fact: "Reading or writing can slow you down.", next: "skills.reading" },
      NOT_SURE,
    ], next: "skills.learn" }),
  n({ id: "skills.online", hurdle: "skills", kind: "many", decision: "where you can get online",
    question: "Where can you get online?",
    choices: [
      { id: "library", label: "A library", fact: "You can get online at a library." },
      { id: "friend", label: "A friend or family member", fact: "You can get online through a friend or family." },
      { id: "phone_only", label: "My phone only", fact: "You get online on your phone only." },
      { id: "nowhere", label: "Nowhere right now", fact: "You have no place to get online right now.", action: "Ask your library or a job center about computer time and free phone or data programs." },
      NOT_SURE,
    ], next: "skills.learn" }),
  n({ id: "skills.which", hurdle: "skills", kind: "text", decision: "which skill", question: "Which skill? (for example forklift, Excel, typing)",
    placeholder: "A few words. You can skip this.", maxLength: 80, next: "skills.learn" }),
  n({ id: "skills.reading", hurdle: "skills", kind: "many", decision: "what helps with reading and writing",
    question: "What would help?",
    choices: [
      { id: "person", label: "Someone to go through it with me", fact: "Going through forms with someone helps." },
      { id: "voice", label: "Voice or audio tools", fact: "Voice tools help you." },
      { id: "time", label: "More time", fact: "More time helps you." },
      NOT_SURE,
    ], next: "skills.learn" }),
  n({ id: "skills.learn", hurdle: "skills", kind: "many", decision: "how you like to learn",
    question: "How do you like to learn?",
    choices: [
      { id: "hands_on", label: "Hands on", fact: "You learn best hands on." },
      { id: "video", label: "Videos", fact: "You learn well from videos." },
      { id: "class", label: "A class", fact: "You learn well in a class." },
      { id: "one_on_one", label: "One on one", fact: "You learn best one on one." },
      NOT_SURE,
    ], next: TELL }),

  // ── Money ────────────────────────────────────────────────────────────────
  n({ id: "money.what", hurdle: "money", kind: "many", decision: "what the money problem is",
    question: "What is the money problem?", help: "Pick all that fit.",
    choices: [
      { id: "fast", label: "I need pay fast", fact: "You need a paycheck soon.", next: "money.when" },
      { id: "start", label: "Costs to start (boots, clothes, tools, fares)", fact: "Starting a job has costs you need to cover.", next: "money.start" },
      { id: "debt", label: "Debt, fines or fees", fact: "Debt, fines or fees are part of the picture.", next: "money.debt" },
      { id: "benefits", label: "Benefits I could lose", fact: "You're worried a job could change your benefits.", next: "money.benefits" },
      NOT_SURE,
    ], next: TELL }),
  n({ id: "money.when", hurdle: "money", kind: "one", decision: "how soon you need pay",
    question: "How soon do you need a paycheck?",
    choices: [
      { id: "week", label: "This week", fact: "You need pay this week.", ask: "When is the first payday after I start?", action: "Look at day labor, temp agencies and jobs that pay weekly while you search." },
      { id: "month", label: "This month", fact: "You need pay this month.", ask: "When is the first payday after I start?" },
      NOT_SURE,
    ], next: TELL }),
  n({ id: "money.start", hurdle: "money", kind: "many", decision: "which start costs",
    question: "Which costs?",
    choices: [
      { id: "boots", label: "Boots or safety gear", fact: "You need boots or safety gear.", ask: "Does the company provide safety gear or pay for boots?" },
      { id: "clothes", label: "Work clothes", fact: "You need work clothes." },
      { id: "tools", label: "Tools", fact: "You need tools.", ask: "Are tools provided?" },
      { id: "fares", label: "Fares or gas for the first weeks", fact: "You need fares or gas until the first paycheck." },
      NOT_SURE,
    ], next: TELL }),
  n({ id: "money.debt", hurdle: "money", kind: "one", decision: "whether fines touch your license or pay",
    question: "Do fines, fees or support orders touch your license or your pay?",
    choices: [
      { id: "yes", label: "Yes", fact: "Fines, fees or support orders touch your license or pay.", action: "Ask a legal aid office if there is a payment plan or a way to reduce what you owe.", support: ["legal"] },
      { id: "no", label: "No", fact: "Fines don't touch your license or pay." },
      NOT_SURE,
    ], next: TELL }),
  n({ id: "money.benefits", hurdle: "money", kind: "one", decision: "which benefits",
    question: "Do you want to know how a paycheck could change your benefits before you take a job?",
    choices: [
      { id: "yes", label: "Yes", fact: "You want to know how a paycheck could change your benefits.", action: "Ask a benefits office or counselor how much you can earn before your benefits change." },
      { id: "no", label: "No", fact: "You're not worried about benefits right now." },
      NOT_SURE,
    ], next: TELL }),

  // ── Something else ───────────────────────────────────────────────────────
  n({ id: "other.what", hurdle: "other", kind: "text", decision: "what is in the way", question: "In a few words, what is in the way?",
    placeholder: "Short is fine. You can skip this.", maxLength: 200, next: "other.where" }),
  n({ id: "other.where", hurdle: "other", kind: "many", decision: "which part of the job it touches",
    question: "Which part does it touch?",
    choices: [
      { id: "hired", label: "Getting hired", fact: "It touches getting hired." },
      { id: "getting_there", label: "Getting to work", fact: "It touches getting to work." },
      { id: "keeping", label: "Keeping a job", fact: "It touches keeping a job." },
      NOT_SURE,
    ], next: TELL }),

  // ── Not sure yet ─────────────────────────────────────────────────────────
  n({ id: "not_sure.signs", hurdle: "not_sure", kind: "many", decision: "what has happened lately",
    question: "Have any of these happened in the last few months?", help: "Each one you pick adds a short set of questions.",
    choices: [
      { id: "ride", label: "Missed or turned down work because of a ride", addsHurdle: "transport", fact: "Rides have cost you work." },
      { id: "papers", label: "Got asked for ID or papers I didn't have", addsHurdle: "documents", fact: "Missing papers have slowed you down." },
      { id: "check", label: "Got turned down after a background check", addsHurdle: "record", fact: "A background check has come up." },
      { id: "gap", label: "Got asked about time between jobs", addsHurdle: "gaps", fact: "Gaps have come up." },
      { id: "hours", label: "Kids, family or school made the hours hard", addsHurdle: "schedule", fact: "Hours have been hard to fit." },
      { id: "health", label: "Health got in the way", addsHurdle: "health", fact: "Health has gotten in the way." },
      { id: "housing", label: "Housing or mail problems", addsHurdle: "housing", fact: "Housing has gotten in the way." },
      { id: "money", label: "Money ran out before payday", addsHurdle: "money", fact: "Money has run short." },
      { id: "online", label: "Could not finish an online application", addsHurdle: "skills", fact: "Online applications have been hard." },
      { id: "none", label: "None of these", next: "not_sure.free", fact: "None of the usual hurdles fit." },
    ], next: null }),
  n({ id: "not_sure.free", hurdle: "not_sure", kind: "text", decision: "what feels off", question: "What feels off when you look for work? Short is fine.",
    placeholder: "You can skip this.", maxLength: 200, next: null }),

  // ── Record and background checks (the only path to a disclosure plan) ────
  n({ id: "record.where", hurdle: "record", kind: "many", decision: "where it's coming up",
    question: "Where is it coming up?", help: "Pick all that fit.",
    choices: [
      { id: "form", label: "A question on an application", fact: "An application asks about it.", next: "record.form_question" },
      { id: "interview", label: "In an interview", fact: "It may come up in an interview.", next: "record.raise" },
      { id: "check", label: "A background check after an offer", fact: "There is a background check after an offer.", next: "record.check_stage" },
      { id: "work", label: "With a supervisor or HR at work", fact: "It may come up with a supervisor or HR.", next: "record.raise" },
      { ...NOT_SURE, next: "record.raise" },
    ], next: "record.kind" }),
  n({ id: "record.form_question", hurdle: "record", kind: "text", sensitive: true, decision: "what the form asks, in its words",
    question: "What does the form ask, in its own words?", help: "Copy it exactly if you can. The form's own words decide what you answer.",
    placeholder: "For example: Have you been convicted of a felony in the last 7 years?", maxLength: 300, next: "record.kind" }),
  n({ id: "record.check_stage", hurdle: "record", kind: "one", sensitive: true, decision: "where you are with the check",
    question: "Where are you with the check?",
    choices: [
      { id: "not_started", label: "It has not started", fact: "The check has not started." },
      { id: "signed", label: "I signed the form for it", fact: "You signed the form for the check.", action: "Ask the employer for a copy of the report when it comes back." },
      { id: "notice", label: "I got a letter saying they may not hire me because of it", fact: "You got a letter that they may not hire you because of the check.", action: "Read the letter for any date it gives to answer, and answer before that date. Ask for a copy of the report if it isn't attached." },
      NOT_SURE,
    ], next: "record.kind" }),
  n({ id: "record.raise", hurdle: "record", kind: "one", sensitive: true, decision: "whether you bring it up or wait",
    question: "Do you want to bring it up yourself, or wait to be asked?", help: "There is no one right way. You decide.",
    choices: [
      { id: "me", label: "I'll bring it up", fact: "You want to bring it up yourself." },
      { id: "wait", label: "I'll wait to be asked", fact: "You want to wait until they ask." },
      { id: "later", label: "I'll decide later", fact: "You will decide later whether to bring it up.", uncertain: true },
    ], next: "record.kind" }),
  n({ id: "record.kind", hurdle: "record", kind: "one", sensitive: true, decision: "what kind of record",
    question: "What kind of record? You can skip this.",
    choices: [
      { id: "misdemeanor", label: "Misdemeanor", fact: "Your record is a misdemeanor." },
      { id: "felony", label: "Felony", fact: "Your record includes a felony." },
      { id: "both", label: "Both", fact: "Your record includes a felony and a misdemeanor." },
      { id: "pending", label: "A pending case", fact: "You have a pending case.", action: "Talk to your lawyer before you say anything about a pending case to an employer." },
      RATHER_NOT,
    ], next: "record.when" }),
  n({ id: "record.when", hurdle: "record", kind: "one", sensitive: true, decision: "how long ago",
    question: "How long ago was the most recent one?",
    choices: [
      { id: "lt1", label: "Less than 1 year", fact: "The most recent one was less than a year ago." },
      { id: "1to3", label: "1 to 3 years", fact: "The most recent one was 1 to 3 years ago." },
      { id: "3to7", label: "3 to 7 years", fact: "The most recent one was 3 to 7 years ago." },
      { id: "7plus", label: "More than 7 years", fact: "The most recent one was more than 7 years ago." },
      RATHER_NOT,
    ], next: "record.supervision" }),
  n({ id: "record.supervision", hurdle: "record", kind: "one", sensitive: true, decision: "whether you are on supervision",
    question: "Are you on probation, parole or other supervision right now?",
    choices: [
      { id: "yes", label: "Yes", fact: "You're on supervision right now.", next: "record.conditions" },
      { id: "no", label: "No", fact: "You're not on supervision right now." },
      { ...RATHER_NOT },
    ], next: "record.state" }),
  n({ id: "record.conditions", hurdle: "record", kind: "one", sensitive: true, decision: "whether your conditions touch work",
    question: "Do your conditions touch work? (hours, travel, kind of job, internet use)",
    choices: [
      { id: "yes", label: "Yes", fact: "Your conditions touch work.", action: "Check your written conditions with your officer before you accept a job." },
      { id: "no", label: "No", fact: "Your conditions don't touch work." },
      { ...NOT_SURE, action: "Ask your officer which jobs and hours your conditions allow, before you accept an offer." },
    ], next: "record.state" }),
  n({ id: "record.state", hurdle: "record", kind: "text", format: "state", decision: "which state the job is in",
    question: "Which state is the job in?", help: "Two letters, like MT or WI. It's used to show dated sources for that state.",
    placeholder: "MT", maxLength: 2, next: "record.worry" }),
  n({ id: "record.worry", hurdle: "record", kind: "many", sensitive: true, decision: "what worries you about the conversation",
    question: "What worries you most about the conversation?",
    choices: [
      { id: "details", label: "Being pushed for details", fact: "You worry about being pushed for details.", action: "Practice one more true sentence for when they push, then turn back to the work." },
      { id: "turned_down", label: "Being turned down", fact: "You worry about being turned down." },
      { id: "too_much", label: "Saying too much", fact: "You worry about saying too much.", action: "Keep the first answer to two sentences. Stop there and let them ask." },
      { id: "surprise", label: "The check showing something I didn't expect", fact: "You worry the check could show something you didn't expect.", action: "Think about getting a copy of your own record first, so nothing on the check surprises you.", support: ["legal"] },
      NOT_SURE,
    ], next: "record.lead" }),
  n({ id: "record.lead", hurdle: "record", kind: "many", decision: "what you want them to hear about you now",
    question: "What do you want them to hear about you now?",
    choices: [
      { id: "work", label: "My current or recent work", fact: "You want them to hear about your current or recent work." },
      { id: "training", label: "Training or school I finished", fact: "You want them to hear about training or school you finished." },
      { id: "showing_up", label: "How I show up", fact: "You want them to hear how you show up." },
      { id: "reference", label: "Someone who will vouch for me", fact: "You want them to hear from someone who will vouch for you.", action: "Ask that person if they will take a call from an employer." },
      NOT_SURE,
    ], next: "record.own_words" }),
  n({ id: "record.own_words", hurdle: "record", kind: "text", sensitive: true, decision: "your one sentence about it",
    question: "If you had to say it in one sentence, what would you say?", help: "Your words. Short is fine. No details needed. You can skip this.",
    placeholder: "For example: I have a felony from 2019.", maxLength: 240, next: "record.now_words" }),
  n({ id: "record.now_words", hurdle: "record", kind: "text", decision: "one true thing about what you do now",
    question: "And one true thing about what you do now?", help: "Your words. You can skip this.",
    placeholder: "For example: I've worked at the yard for a year and a half.", maxLength: 240, next: null }),
];

function tellNode(h: HurdleId): HurdleNode {
  return {
    id: `${h}.tell`, hurdle: h, kind: "one", decision: "what you choose to tell an employer",
    question: "What do you want an employer to know about this?", help: "Your choice. You can change it any time.",
    choices: [
      { id: "nothing", label: "Nothing. It stays with me.", fact: "You chose to keep this to yourself." },
      { id: "job_only", label: "Only what touches the schedule or the work", fact: "You chose to share only what touches the schedule or the work." },
      { id: "more", label: "More of the picture, in my own words", fact: "You chose to share more of the picture, in your own words." },
      { id: "later", label: "I'll decide later", fact: "You will decide later what to share.", uncertain: true },
    ],
    next: null,
  };
}

const TELL_HURDLES: HurdleId[] = HURDLE_IDS.filter((h) => h !== "record" && h !== "not_sure");

export const NODES: Record<string, HurdleNode> = Object.fromEntries(
  [...NODE_LIST, ...TELL_HURDLES.map(tellNode)].map((node) => [node.id, node])
);

export function getNode(id: string): HurdleNode | undefined {
  return Object.prototype.hasOwnProperty.call(NODES, id) ? NODES[id] : undefined;
}

/** Resolve the TELL sentinel to the hurdle's own tell node (or the end). */
export function resolveNext(hurdle: HurdleId, next: string | null | undefined): string | null {
  if (next === undefined || next === null) return null;
  if (next === TELL) return TELL_HURDLES.includes(hurdle) ? `${hurdle}.tell` : null;
  return next;
}
