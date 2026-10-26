/**
 * Organization structure, the pure half (migration 103, house lane L3a).
 *
 * No database and no React here, so the browser, the routes and the tests
 * share one copy of: the organization types, the default words, the modules,
 * the unit kinds, the enrollment statuses and the moves between them, the
 * exit reasons, and the starting templates the setup wizard offers per type.
 *
 * The database keeps its own copy of the rules that protect data (103 checks
 * kinds, statuses, moves, word keys, the label rule and depth). This file is
 * the friendly first answer; the tables are the control. A test reads 103 and
 * fails if the two lists drift.
 */

/* ------------------------------------------------------------ org types -- */

export const ORG_TYPES = [
  "reentry_nonprofit", "workforce_board", "job_center", "corrections_facility", "community_supervision",
  "faith_based", "education_training", "employer_partner", "legal_aid", "housing", "recovery_health",
  "coalition", "other",
] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export function isOrgType(v: unknown): v is OrgType {
  return typeof v === "string" && (ORG_TYPES as readonly string[]).includes(v);
}

/** What each type is called on screen, and one plain line about who it fits. */
export const ORG_TYPE_INFO: Record<OrgType, { label: string; help: string }> = {
  reentry_nonprofit: { label: "Reentry nonprofit", help: "Helps people coming home find work, housing and support." },
  workforce_board: { label: "Workforce board", help: "Runs job centers and funded programs across an area." },
  job_center: { label: "Job center", help: "One center where people come for job search help." },
  corrections_facility: { label: "Corrections facility", help: "Prepares people inside for work before they go home." },
  community_supervision: { label: "Probation or parole office", help: "Officers working caseloads across offices." },
  faith_based: { label: "Faith-based program", help: "A church or ministry running mentoring or job help." },
  education_training: { label: "School or training program", help: "Classes, certificates and cohorts." },
  employer_partner: { label: "Employer", help: "A business hiring people and helping them stay." },
  legal_aid: { label: "Legal aid", help: "Clinics for record clearing, licenses and other legal help." },
  housing: { label: "Housing program", help: "Transitional or supportive housing." },
  recovery_health: { label: "Recovery or health program", help: "Peer support and recovery services." },
  coalition: { label: "Coalition", help: "Several member organizations working together." },
  other: { label: "Something else", help: "Start simple and shape it as you go." },
};

/* ---------------------------------------------------------- terminology -- */

export const TERM_KEYS = [
  "participant", "participants", "staff_member", "case_manager", "program", "site", "team", "caseload", "enrollment",
] as const;
export type TermKey = (typeof TERM_KEYS)[number];
export type OrgTerms = Record<TermKey, string>;

export const DEFAULT_ORG_TERMS: Readonly<OrgTerms> = Object.freeze({
  participant: "participant",
  participants: "participants",
  staff_member: "staff member",
  case_manager: "case manager",
  program: "program",
  site: "site",
  team: "team",
  caseload: "caseload",
  enrollment: "enrollment",
});

/** Plain words for each key, for the wizard's word editor. */
export const TERM_LABELS: Record<TermKey, { label: string; help: string }> = {
  participant: { label: "One person you serve", help: "Shown everywhere a person on your list is named." },
  participants: { label: "More than one", help: "The same word for a group." },
  staff_member: { label: "Someone on your team", help: "Anyone working at your organization." },
  case_manager: { label: "The person who works with someone", help: "Case manager, navigator, officer, mentor..." },
  program: { label: "A program", help: "What people are enrolled in." },
  site: { label: "A place", help: "Site, center, office, campus, location..." },
  team: { label: "A team", help: "A group of staff." },
  caseload: { label: "The people one staff member works with", help: "Caseload, roster, list..." },
  enrollment: { label: "Being in a program", help: "Enrollment, placement, membership..." },
};

/**
 * Words that label a person by their record. Never allowed as the word for
 * the people an organization serves (house words rule: never a label on a
 * person). The database refuses the same pattern (103 org_profile_guard).
 */
export const LABEL_WORDS = /(felon|offender|inmate|convict|ex-con|criminal|prisoner|delinquent)/i;
export const TERM_MAX = 40;

export type TermProblem = { key: TermKey; message: string };

/** Check one word for one key. Null when it is fine. */
export function termProblem(key: TermKey, value: string): string | null {
  const v = value.trim();
  if (v.length < 1) return "Type a word, or leave the default.";
  if (v.length > TERM_MAX) return `Keep it to ${TERM_MAX} characters.`;
  if (/[<>{}[\]\\]/.test(v)) return "Use plain letters and spaces.";
  if ((key === "participant" || key === "participants") && LABEL_WORDS.test(v)) {
    return "Pick a word that names the person, not their record.";
  }
  return null;
}

/**
 * Clean a terminology object from a request or the database: known keys only,
 * trimmed, and any bad value dropped so the default shows through. Returns the
 * kept overrides (only what differs from the default) and the problems found.
 */
export function normalizeTerms(input: unknown): { terms: Partial<OrgTerms>; problems: TermProblem[] } {
  const terms: Partial<OrgTerms> = {};
  const problems: TermProblem[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { terms, problems };
  for (const key of TERM_KEYS) {
    const raw = (input as Record<string, unknown>)[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") { problems.push({ key, message: "Type a word." }); continue; }
    const problem = termProblem(key, raw);
    if (problem) { problems.push({ key, message: problem }); continue; }
    const v = raw.trim().replace(/\s+/g, " ");
    if (v !== DEFAULT_ORG_TERMS[key]) terms[key] = v;
  }
  return { terms, problems };
}

/** The words to use: stored overrides over the defaults. Never throws, never empty. */
export function resolveOrgTerms(stored: unknown): OrgTerms {
  const { terms } = normalizeTerms(stored);
  return { ...DEFAULT_ORG_TERMS, ...terms };
}

/** Simple English plural for a stored word ("site" -> "sites", "facility" -> "facilities"). */
export function pluralTerm(word: string): string {
  const w = word.trim();
  if (!w) return w;
  if (/(staff|people|personnel)$/i.test(w)) return w;
  if (/(s|x|z|ch|sh)$/i.test(w)) return `${w}es`;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

/** First letter up, for headings and sentence starts. */
export function capTerm(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/* -------------------------------------------------------------- modules -- */

export const ORG_MODULES = ["programs", "sites", "teams", "referrals", "outcomes", "custom_fields", "saved_views", "ai_assist"] as const;
export type OrgModule = (typeof ORG_MODULES)[number];
export type OrgModules = Record<OrgModule, boolean>;

export const DEFAULT_ORG_MODULES: Readonly<OrgModules> = Object.freeze({
  programs: true, sites: false, teams: false, referrals: true, outcomes: true, custom_fields: true, saved_views: true, ai_assist: true,
});

export const MODULE_INFO: Record<OrgModule, { label: string; help: string }> = {
  programs: { label: "Programs and cohorts", help: "Enroll people in programs, track who is active and who finished." },
  sites: { label: "Sites", help: "More than one place: offices, centers, campuses or facilities." },
  teams: { label: "Teams", help: "Groups of staff who share a set of people." },
  referrals: { label: "Referrals", help: "Send people to other services and see what happened." },
  outcomes: { label: "Placements and outcomes", help: "Jobs started and check-ins at 30, 90 and 180 days." },
  custom_fields: { label: "Your own fields", help: "Add the fields your funders ask about." },
  saved_views: { label: "Saved views", help: "Save the lists your team looks at every day." },
  ai_assist: { label: "t.ROY for staff", help: "Drafts and summaries for your team. Nothing is saved or sent without a click." },
};

export function resolveOrgModules(stored: unknown): OrgModules {
  const out: OrgModules = { ...DEFAULT_ORG_MODULES };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  for (const m of ORG_MODULES) {
    const v = (stored as Record<string, unknown>)[m];
    if (typeof v === "boolean") out[m] = v;
  }
  return out;
}

/* ---------------------------------------------------------------- units -- */

export const UNIT_KINDS = ["program", "cohort", "site", "facility", "housing_unit", "office", "team", "caseload", "other"] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];
export function isUnitKind(v: unknown): v is UnitKind {
  return typeof v === "string" && (UNIT_KINDS as readonly string[]).includes(v);
}

/** Kinds a person can be enrolled in. The database refuses the rest (103). */
export const ENROLLABLE_KINDS: readonly UnitKind[] = ["program", "cohort", "caseload"];
export const UNIT_MAX_DEPTH = 4;
export const UNIT_NAME_MAX = 80;

/** The word for a kind, in the organization's own words where it has one. */
export function unitKindWord(kind: UnitKind, terms: OrgTerms = DEFAULT_ORG_TERMS): string {
  switch (kind) {
    case "program": return terms.program;
    case "site": return terms.site;
    case "team": return terms.team;
    case "caseload": return terms.caseload;
    case "cohort": return "cohort";
    case "facility": return "facility";
    case "housing_unit": return "housing unit";
    case "office": return "office";
    default: return "group";
  }
}

export const UNIT_ROLES = ["lead", "member", "viewer"] as const;
export type UnitRole = (typeof UNIT_ROLES)[number];
export function isUnitRole(v: unknown): v is UnitRole {
  return typeof v === "string" && (UNIT_ROLES as readonly string[]).includes(v);
}
export const UNIT_ROLE_INFO: Record<UnitRole, { label: string; help: string }> = {
  lead: { label: "Lead", help: "Sees everyone enrolled here and in the groups under it." },
  member: { label: "Member", help: "Sees everyone enrolled here." },
  viewer: { label: "Viewer", help: "Sees that this group exists and who works in it, not the people enrolled." },
};

/** A unit tree as the wizard edits it (no ids yet). */
export interface UnitDraft { kind: UnitKind; name: string; children?: UnitDraft[] }

export type TreeProblem = { path: string; message: string };

/**
 * Check a draft tree before anything is written: kinds known, names present
 * and short, unique among siblings, at most 4 levels, at most 60 units.
 */
export function checkUnitTree(tree: readonly UnitDraft[], maxUnits = 60): TreeProblem[] {
  const problems: TreeProblem[] = [];
  let count = 0;
  const walk = (nodes: readonly UnitDraft[], depth: number, path: string) => {
    const seen = new Set<string>();
    nodes.forEach((n, i) => {
      const here = `${path}${i + 1}`;
      count++;
      if (!n || !isUnitKind(n.kind)) problems.push({ path: here, message: "Pick what kind of group this is." });
      const name = typeof n?.name === "string" ? n.name.trim() : "";
      if (!name) problems.push({ path: here, message: "Give it a name." });
      else if (name.length > UNIT_NAME_MAX) problems.push({ path: here, message: `Keep names to ${UNIT_NAME_MAX} characters.` });
      else if (seen.has(name.toLowerCase())) problems.push({ path: here, message: `"${name}" is here twice. Give each its own name.` });
      seen.add(name.toLowerCase());
      if (depth > UNIT_MAX_DEPTH) problems.push({ path: here, message: `Groups go at most ${UNIT_MAX_DEPTH} levels deep.` });
      if (n?.children?.length) walk(n.children, depth + 1, `${here}.`);
    });
  };
  walk(tree, 1, "");
  if (count > maxUnits) problems.push({ path: "", message: `Start with at most ${maxUnits} groups. You can add more later.` });
  return problems;
}

/** Depth-first order with the parent index, the way the setup writes it. */
export function flattenUnitTree(tree: readonly UnitDraft[]): { kind: UnitKind; name: string; parentIndex: number | null }[] {
  const out: { kind: UnitKind; name: string; parentIndex: number | null }[] = [];
  const walk = (nodes: readonly UnitDraft[], parent: number | null) => {
    for (const n of nodes) {
      out.push({ kind: n.kind, name: n.name.trim(), parentIndex: parent });
      const me = out.length - 1;
      if (n.children?.length) walk(n.children, me);
    }
  };
  walk(tree, null);
  return out;
}

/* ---------------------------------------------------------- enrollments -- */

export const ENROLLMENT_STATUSES = ["referred", "enrolled", "active", "paused", "completed", "exited", "withdrawn"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
export const OPEN_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = ["referred", "enrolled", "active", "paused"];
export const DONE_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = ["completed", "exited", "withdrawn"];
export const START_STATUSES: readonly EnrollmentStatus[] = ["referred", "enrolled", "active"];

export function isEnrollmentStatus(v: unknown): v is EnrollmentStatus {
  return typeof v === "string" && (ENROLLMENT_STATUSES as readonly string[]).includes(v);
}
export const isOpenStatus = (s: EnrollmentStatus) => OPEN_ENROLLMENT_STATUSES.includes(s);

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  referred: "Referred", enrolled: "Enrolled", active: "Active", paused: "Paused",
  completed: "Finished", exited: "Left", withdrawn: "Withdrew",
};

/**
 * Allowed moves. Must match smr_enrollment_move_ok in 103 (a test compares
 * them). A finished enrollment can be reopened to correct a mistake.
 */
export const ENROLLMENT_MOVES: Record<EnrollmentStatus, readonly EnrollmentStatus[]> = {
  referred: ["enrolled", "active", "withdrawn", "exited"],
  enrolled: ["active", "paused", "completed", "exited", "withdrawn"],
  active: ["paused", "completed", "exited", "withdrawn"],
  paused: ["active", "completed", "exited", "withdrawn"],
  completed: ["enrolled", "active"],
  exited: ["enrolled", "active"],
  withdrawn: ["enrolled", "active"],
};

export function canMoveEnrollment(from: EnrollmentStatus, to: EnrollmentStatus): boolean {
  return from === to || ENROLLMENT_MOVES[from].includes(to);
}

export const STATUS_REASONS = [
  "completed", "found_work", "moved_away", "chose_to_stop", "could_not_reach", "transferred",
  "program_ended", "left_organization", "needs_a_pause", "other",
] as const;
export type StatusReason = (typeof STATUS_REASONS)[number];
export function isStatusReason(v: unknown): v is StatusReason {
  return typeof v === "string" && (STATUS_REASONS as readonly string[]).includes(v);
}
export const STATUS_REASON_LABELS: Record<StatusReason, string> = {
  completed: "Finished the program",
  found_work: "Found work",
  moved_away: "Moved away",
  chose_to_stop: "Chose to stop",
  could_not_reach: "Could not reach them",
  transferred: "Moved to another program",
  program_ended: "The program ended",
  left_organization: "Left the organization",
  needs_a_pause: "Needs a pause",
  other: "Another reason",
};

/** Reasons offered for a move to `to` (left_organization is set by the system only). */
export function reasonsFor(to: EnrollmentStatus): StatusReason[] {
  switch (to) {
    case "paused": return ["needs_a_pause", "could_not_reach", "found_work", "other"];
    case "completed": return ["completed", "found_work", "other"];
    case "exited": return ["found_work", "moved_away", "could_not_reach", "transferred", "program_ended", "other"];
    case "withdrawn": return ["chose_to_stop", "moved_away", "found_work", "other"];
    default: return [];
  }
}

/** Does a move to `to` ask for a reason? */
export const reasonNeeded = (to: EnrollmentStatus) => reasonsFor(to).length > 0;

/**
 * The organization's own id for a person. Letters, numbers, spaces and . _ / -
 * up to 40. The screen says plainly: never a DOC number or a case number.
 * Must match 103's CHECK.
 */
export const PROGRAM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/;
export const PROGRAM_ID_HELP = "Your organization's own number for this person, if you use one. Never a DOC number or a case number.";

/* ------------------------------------------------------------ templates -- */

export interface OrgTemplate {
  type: OrgType;
  terms: Partial<OrgTerms>;
  modules: Partial<OrgModules>;
  units: UnitDraft[];
  /** One plain line the wizard shows under the tree. */
  note: string;
}

/**
 * Starting points per organization type. Suggestions only: every word, module
 * and unit is editable in the wizard before anything is saved, and the tree
 * can be changed later from Structure. No real organization or person is
 * named; program names are common public ones.
 */
export const ORG_TEMPLATES: Record<OrgType, OrgTemplate> = {
  reentry_nonprofit: {
    type: "reentry_nonprofit",
    terms: {},
    modules: { programs: true, sites: true },
    units: [
      { kind: "program", name: "Job readiness" },
      { kind: "program", name: "Reentry case management" },
      { kind: "site", name: "Main office" },
    ],
    note: "Two programs and one site. Add a cohort under a program when a new group starts.",
  },
  workforce_board: {
    type: "workforce_board",
    terms: { case_manager: "career planner", site: "center" },
    modules: { programs: true, sites: true, teams: true },
    units: [
      {
        kind: "site", name: "Main job center", children: [
          { kind: "program", name: "Adult services", children: [{ kind: "cohort", name: "Fall cohort" }] },
          { kind: "program", name: "Dislocated worker services" },
          { kind: "program", name: "Youth services" },
        ],
      },
    ],
    note: "Center, then program, then cohort. Add a center for each place you run.",
  },
  job_center: {
    type: "job_center",
    terms: { participant: "job seeker", participants: "job seekers", case_manager: "employment specialist", site: "center" },
    modules: { programs: true, sites: false },
    units: [
      { kind: "program", name: "One-on-one job search" },
      { kind: "program", name: "Job search workshop", children: [{ kind: "cohort", name: "Next workshop" }] },
    ],
    note: "A program for one-on-one help and one for workshops, with a cohort per workshop.",
  },
  corrections_facility: {
    type: "corrections_facility",
    terms: { participant: "resident", participants: "residents", case_manager: "reentry coordinator", site: "facility" },
    modules: { programs: true, sites: true, referrals: false },
    units: [
      {
        kind: "facility", name: "Main facility", children: [
          { kind: "housing_unit", name: "Unit A", children: [{ kind: "program", name: "Reentry readiness" }] },
          { kind: "program", name: "Job skills class" },
        ],
      },
    ],
    note: "Facility, then housing unit, then program. Only staff see this structure; it never appears on a resume or anything a person sends.",
  },
  community_supervision: {
    type: "community_supervision",
    terms: { participant: "client", participants: "clients", case_manager: "officer", site: "office" },
    modules: { programs: false, sites: true, teams: true },
    units: [
      {
        kind: "other", name: "North region", children: [
          { kind: "office", name: "Main office", children: [
            { kind: "caseload", name: "Caseload 1" },
            { kind: "caseload", name: "Caseload 2" },
          ] },
        ],
      },
    ],
    note: "Region, then office, then caseload. An officer added to a caseload sees the people in it; a regional lead sees every caseload below.",
  },
  faith_based: {
    type: "faith_based",
    terms: { case_manager: "mentor" },
    modules: { programs: true, teams: true },
    units: [
      { kind: "program", name: "Mentoring" },
      { kind: "program", name: "Job readiness" },
      { kind: "team", name: "Volunteer mentors" },
    ],
    note: "Two programs and a team for your volunteers. Volunteers see only the people they are paired with.",
  },
  education_training: {
    type: "education_training",
    terms: { participant: "student", participants: "students", case_manager: "advisor", site: "campus" },
    modules: { programs: true, sites: true },
    units: [
      { kind: "program", name: "Welding certificate", children: [{ kind: "cohort", name: "Spring cohort" }] },
      { kind: "program", name: "Forklift certification", children: [{ kind: "cohort", name: "Next class" }] },
      { kind: "site", name: "Main campus" },
    ],
    note: "A program per course of study, a cohort per class that starts together.",
  },
  employer_partner: {
    type: "employer_partner",
    terms: { participant: "new hire", participants: "new hires", case_manager: "supervisor", site: "location" },
    modules: { programs: true, sites: true, teams: true, referrals: false },
    units: [
      {
        kind: "site", name: "Main location", children: [
          { kind: "team", name: "First shift" },
          { kind: "team", name: "Second shift" },
          { kind: "program", name: "Fair-chance hiring" },
        ],
      },
    ],
    note: "Location, then teams. New hires go in the hiring program so supervisors can follow up at 30, 90 and 180 days.",
  },
  legal_aid: {
    type: "legal_aid",
    terms: { participant: "client", participants: "clients", case_manager: "advocate" },
    modules: { programs: true, sites: true },
    units: [
      { kind: "program", name: "Record clearing clinic" },
      { kind: "program", name: "License restoration" },
      { kind: "site", name: "Main office" },
    ],
    note: "A program per kind of clinic. Keep anything from a court file out of notes.",
  },
  housing: {
    type: "housing",
    terms: { participant: "resident", participants: "residents", case_manager: "housing navigator", site: "property" },
    modules: { programs: true, sites: true },
    units: [
      { kind: "program", name: "Transitional housing" },
      { kind: "program", name: "Housing search help" },
      { kind: "site", name: "Main residence" },
    ],
    note: "A program per kind of help, and a site per property.",
  },
  recovery_health: {
    type: "recovery_health",
    terms: { participant: "member", participants: "members", case_manager: "peer specialist" },
    modules: { programs: true, teams: true },
    units: [
      { kind: "program", name: "Peer recovery support" },
      { kind: "program", name: "Employment support" },
      { kind: "team", name: "Peer team" },
    ],
    note: "Keep treatment and health details out of this system; it is for work and support.",
  },
  coalition: {
    type: "coalition",
    terms: { staff_member: "partner staff", case_manager: "navigator", site: "member organization" },
    modules: { programs: true, sites: true, referrals: true },
    units: [
      { kind: "site", name: "Member organization 1" },
      { kind: "site", name: "Member organization 2" },
      { kind: "program", name: "Coalition navigation" },
    ],
    note: "Each member organization is a site. Put staff in their own organization's site so each sees their own people.",
  },
  other: {
    type: "other",
    terms: {},
    modules: {},
    units: [{ kind: "program", name: "Main program" }],
    note: "One program to start. Add sites, teams and cohorts when you need them.",
  },
};

/** The template for a type, as full words and modules (defaults filled in). */
export function templateFor(type: OrgType): { terms: OrgTerms; modules: OrgModules; units: UnitDraft[]; note: string } {
  const t = ORG_TEMPLATES[type] ?? ORG_TEMPLATES.other;
  return {
    terms: { ...DEFAULT_ORG_TERMS, ...t.terms },
    modules: { ...DEFAULT_ORG_MODULES, ...t.modules },
    units: JSON.parse(JSON.stringify(t.units)) as UnitDraft[],
    note: t.note,
  };
}

/* -------------------------------------------------------------- profile -- */

export interface OrgProfile {
  orgId: string;
  orgType: OrgType;
  displayName: string | null;
  timezone: string;
  terms: OrgTerms;
  modules: OrgModules;
  setupCompletedAt: string | null;
  /** False when no profile row exists yet (defaults are shown). */
  saved: boolean;
}

export const DEFAULT_TIMEZONE = "America/Chicago";

/** US time zones offered in the wizard; any IANA zone the database knows is accepted. */
export const COMMON_TIMEZONES: readonly { id: string; label: string }[] = [
  { id: "America/New_York", label: "Eastern" },
  { id: "America/Chicago", label: "Central" },
  { id: "America/Denver", label: "Mountain" },
  { id: "America/Phoenix", label: "Arizona" },
  { id: "America/Los_Angeles", label: "Pacific" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
];

export function isTimezoneLike(v: unknown): v is string {
  return typeof v === "string" && v.length <= 64 && /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(v);
}

export function defaultOrgProfile(orgId: string): OrgProfile {
  return {
    orgId, orgType: "other", displayName: null, timezone: DEFAULT_TIMEZONE,
    terms: { ...DEFAULT_ORG_TERMS }, modules: { ...DEFAULT_ORG_MODULES }, setupCompletedAt: null, saved: false,
  };
}
