/**
 * Org capabilities -- what someone may do, separated from whose data they see.
 *
 * TWO AXES, AND THEY ARE NOT THE SAME QUESTION.
 *   `users.tier`  answers "what product features may this ACCOUNT use" --
 *                 rate limits, model access, feature gates. An ENTITLEMENT.
 *   org role      answers "whose data may this person SEE" -- the only
 *                 question an admin console actually asks. AUTHORIZATION.
 *
 * Today these are conflated: roughly a dozen routes compare `tier === "admin"`
 * inline, and three separate files each keep their own tier RANK table with
 * different values. A rank is the wrong model to begin with -- "partner" and
 * "observer" are not more or less than each other, they are different jobs. A
 * capability set has no ordering to get wrong.
 *
 * THE ALLOWLIST IS THE LOAD-BEARING PROPERTY. A capability string that is not
 * in this file does not exist. Rows read from the database are filtered against
 * it, so a stale row, a typo, or a tampered record can never grant a power the
 * code does not define. Read that sentence twice before adding a dynamic source
 * of capabilities.
 *
 * Bundles live in TypeScript, not in a table. A role definition should not need
 * a migration to change, and in a public repo the bundles are better as
 * something a reader can see than as rows they cannot.
 */

export const ORG_CAPABILITIES = [
  // Seeing the cohort
  "org.cohort.view",
  "org.client.view_assigned",
  "org.client.view_all",
  "org.client.assign",
  // Working with one participant. view_content is necessary and NEVER
  // sufficient: it lets staff read what a participant has SHARED, and the
  // grant is checked separately on every read (orgClientView.ts).
  "org.client.view_content",
  "org.client.request_sharing",
  "org.note.write",
  "org.task.write",
  "org.outcome.write",
  "org.suggest.write",
  // Bringing people in. Inviting a PARTICIPANT is ordinary casework; inviting
  // STAFF decides who can read case data and stays with admins (org.staff.invite).
  "org.participant.invite",
  // The organization's numbers: funnel, outcomes, workload by staff member.
  "org.insights.view",
  // Running the org
  "org.staff.view",
  "org.staff.invite",
  "org.staff.manage",
  "org.settings.manage",
  // Money and capacity
  "org.seats.view",
  "org.costs.view",
  // Accountability
  "org.export",
  "org.audit.view",
  "org.impersonate.view_as",
] as const;

export type OrgCapability = (typeof ORG_CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(ORG_CAPABILITIES);

export function isOrgCapability(value: string): value is OrgCapability {
  return CAPABILITY_SET.has(value);
}

/**
 * Roles as they exist in the schema today: `access_code.partner_user_id`
 * identifies the owner, and `org_staff.role` is 'org_admin' or 'staff'.
 * `getOrgContext` already collapses those into exactly these three.
 */
export const ORG_STAFF_ROLES = ["owner", "org_admin", "staff"] as const;
export type OrgStaffRole = (typeof ORG_STAFF_ROLES)[number];

/**
 * What each role can do.
 *
 * Staff deliberately see only their ASSIGNED clients, not the whole cohort.
 * That is not a courtesy to the org, it is a courtesy to the participants: a
 * case manager has no business reading the job applications of somebody else's
 * caseload, and the narrower default is the one that ages well when an org
 * grows from three staff to thirty.
 */
const ROLE_BUNDLES: Record<OrgStaffRole, readonly OrgCapability[]> = {
  staff: [
    "org.cohort.view",
    "org.client.view_assigned",
    "org.staff.view",
    "org.client.view_content",
    "org.client.request_sharing",
    "org.note.write",
    "org.task.write",
    "org.outcome.write",
    "org.suggest.write",
    "org.participant.invite",
  ],
  org_admin: [
    "org.cohort.view",
    "org.client.view_assigned",
    "org.client.view_all",
    "org.client.assign",
    "org.client.view_content",
    "org.client.request_sharing",
    "org.note.write",
    "org.task.write",
    "org.outcome.write",
    "org.suggest.write",
    "org.participant.invite",
    "org.insights.view",
    "org.staff.view",
    "org.staff.invite",
    "org.staff.manage",
    "org.seats.view",
    "org.export",
    "org.audit.view",
  ],
  owner: [
    "org.cohort.view",
    "org.client.view_assigned",
    "org.client.view_all",
    "org.client.assign",
    "org.client.view_content",
    "org.client.request_sharing",
    "org.note.write",
    "org.task.write",
    "org.outcome.write",
    "org.suggest.write",
    "org.participant.invite",
    "org.insights.view",
    "org.staff.view",
    "org.staff.invite",
    "org.staff.manage",
    "org.settings.manage",
    "org.seats.view",
    "org.costs.view",
    "org.export",
    "org.audit.view",
  ],
};

export function capabilitiesForRole(role: OrgStaffRole): readonly OrgCapability[] {
  return ROLE_BUNDLES[role] ?? [];
}

/**
 * Resolve what a person may actually do.
 *
 * Pure: no database, no session, no clock. Every authorization decision in the
 * console reduces to this function, which means the rules can be tested
 * exhaustively without standing anything up.
 *
 * DENY WINS, and it is applied last, so the order of grants never matters and
 * a revocation cannot be defeated by also holding a grant. Unknown strings from
 * either list are dropped rather than honored.
 */
export function computeOrgCapabilities(
  role: OrgStaffRole,
  grants: readonly string[] = [],
  denies: readonly string[] = []
): Set<OrgCapability> {
  const denied = new Set(denies.filter(isOrgCapability));
  const effective = new Set<OrgCapability>();

  for (const cap of capabilitiesForRole(role)) {
    if (!denied.has(cap)) effective.add(cap);
  }
  for (const cap of grants) {
    if (isOrgCapability(cap) && !denied.has(cap)) effective.add(cap);
  }
  return effective;
}

/**
 * How wide this person's view of the cohort is.
 *
 * The single place that converts a capability set into a data reach, so no
 * query has to decide for itself. Mirrors the capability/scope split: the
 * capability answers the verb, this answers the rows.
 */
export type CohortReach = "all" | "assigned" | "none";

export function cohortReach(capabilities: ReadonlySet<OrgCapability>): CohortReach {
  if (capabilities.has("org.client.view_all")) return "all";
  if (capabilities.has("org.client.view_assigned")) return "assigned";
  return "none";
}


/**
 * What an owner or admin may switch on or off for ONE person, in plain words.
 * Must match the list inside smr_set_capability_override (migration 053): the
 * database refuses anything not on its own copy, so a capability added here
 * without a migration simply cannot be set.
 */
export const DELEGABLE_CAPABILITIES: { capability: OrgCapability; label: string; help: string }[] = [
  { capability: "org.client.view_all", label: "See everyone, not just their own caseload", help: "Off: they see only the participants assigned to them." },
  { capability: "org.client.view_content", label: "Open what participants have shared", help: "Resumes, applications and letters a participant chose to share. Every open is visible to the participant." },
  { capability: "org.client.request_sharing", label: "Ask participants to share", help: "The participant sees their name and their reason, and decides." },
  { capability: "org.note.write", label: "Write case notes", help: "Notes belong to the organization and cannot be deleted." },
  { capability: "org.task.write", label: "Create tasks", help: "Their own to-dos, and tasks shared with a participant." },
  { capability: "org.outcome.write", label: "Record placements and retention checks", help: "What happened after hire, and how you know." },
  { capability: "org.suggest.write", label: "Suggest jobs and comment on shared documents", help: "The participant decides what to do with each one. Staff never edit their work." },
  { capability: "org.client.assign", label: "Assign participants to staff", help: "Move people between caseloads." },
  { capability: "org.participant.invite", label: "Invite participants", help: "Each invite uses one of your seats." },
  { capability: "org.insights.view", label: "See the organization's numbers", help: "Funnel, outcomes and workload by staff member." },
  { capability: "org.export", label: "Export the caseload", help: "Download a spreadsheet of who they can see." },
  { capability: "org.seats.view", label: "See seats used", help: "" },
  { capability: "org.costs.view", label: "See AI cost", help: "What each participant's AI use has cost." },
];
