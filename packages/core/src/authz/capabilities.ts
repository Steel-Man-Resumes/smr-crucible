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
  staff: ["org.cohort.view", "org.client.view_assigned", "org.staff.view"],
  org_admin: [
    "org.cohort.view",
    "org.client.view_assigned",
    "org.client.view_all",
    "org.client.assign",
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
