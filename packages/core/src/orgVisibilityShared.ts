/**
 * Why a staff member's list is empty, in words they can act on, and which
 * staff an admin would be widening with "let all staff see everyone".
 *
 * Pure: no database, safe for a client bundle. Nothing here changes who can
 * see whom. Visibility stays an admin's decision, made through the same
 * guarded, audited switch as Team & access.
 */

export const SEE_EVERYONE_CAPABILITY = "org.client.view_all";

export interface StaffEmptyStateInput {
  /** The viewer is limited to their own caseload. */
  ownCaseloadOnly: boolean;
  /** People assigned to the viewer, sharing or not. null = not known. */
  assignedToViewer: number | null;
  /** People who joined the organization and are assigned to nobody. null = not known. */
  unassignedJoined: number | null;
  /** Names of the people who can fix it (admins). May be empty. */
  adminNames: readonly string[];
}

export type StaffEmptyKind = "none_assigned_some_waiting" | "none_assigned" | "assigned_not_sharing" | "generic";

export interface StaffEmptyState {
  kind: StaffEmptyKind;
  message: string;
}

function whoToAsk(adminNames: readonly string[]): string {
  const names = adminNames.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return "your admin";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} or ${names[1]}`;
  return "your admin";
}

const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);

export function staffEmptyState(input: StaffEmptyStateInput): StaffEmptyState {
  const ask = whoToAsk(input.adminNames);
  if (!input.ownCaseloadOnly || input.assignedToViewer === null) {
    return { kind: "generic", message: "No one is sharing progress here yet. People turn sharing on themselves." };
  }
  if (input.assignedToViewer > 0) {
    return {
      kind: "assigned_not_sharing",
      message: `${people(input.assignedToViewer)} ${input.assignedToViewer === 1 ? "is" : "are"} assigned to you, but no one has turned on sharing yet. They turn it on in Settings, under Privacy & Consent.`,
    };
  }
  if ((input.unassignedJoined ?? 0) > 0) {
    const n = input.unassignedJoined as number;
    return {
      kind: "none_assigned_some_waiting",
      message: `No one is assigned to you yet. ${people(n)} ${n === 1 ? "has" : "have"} joined and ${n === 1 ? "is" : "are"} not assigned to anyone. Ask ${ask} to assign people to you, or to turn on "See everyone" for you.`,
    };
  }
  return {
    kind: "none_assigned",
    message: `No one is assigned to you yet. Ask ${ask} to assign people to you, or add a participant yourself and they will be assigned to you.`,
  };
}

export interface SeeEveryoneMember {
  userId: string;
  name: string | null;
  email: string | null;
  role: "owner" | "org_admin" | "staff";
  /** The actor may change this person's access. */
  editable: boolean;
  /** They can already see everyone. */
  seesEveryone: boolean;
}

/** Staff who see only their own caseload. Owners and admins already see everyone. */
export function ownCaseloadStaff<T extends SeeEveryoneMember>(members: readonly T[]): T[] {
  return members.filter((m) => m.role === "staff" && !m.seesEveryone);
}

/** Who "let all staff see everyone" would change: only people the actor may edit. */
export function seeEveryoneTargets<T extends SeeEveryoneMember>(members: readonly T[]): T[] {
  return ownCaseloadStaff(members).filter((m) => m.editable);
}
