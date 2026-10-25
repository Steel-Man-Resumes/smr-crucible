/**
 * Pure rules for the CRM staff tour controller (components/tour/StaffTour.tsx),
 * kept here so they are unit tested without React.
 *
 * Who gets it: organization staff in a workspace organization (orgRole set,
 * crmV2 on, tier partner), never under view-as or assist. The route refuses
 * writes under impersonation too (app/api/onboarding/tour/route.ts).
 *
 * The person: the tour's participant stops use a real person from the staff
 * member's own list. Source one is the first person row Today already drew
 * (no request). Source two is the caseload read the People page makes
 * (/api/partner/org, the organization's own records, a cohort read). Nothing
 * here reads or opens a participant's shared items.
 */

export const STAFF_TOUR_OPEN_EVENT = 'staff-tour-open';
export const STAFF_TOUR_PARAM = 'crm';
export const STAFF_TOUR_HOME = '/dashboard/today';

export interface StaffTourRole {
  tier?: string | null;
  orgRole?: string | null;
  crmV2?: boolean;
  impersonating?: unknown;
  orgName?: string | null;
  capabilities?: readonly string[];
}

/** Organization staff only, workspace on, nobody impersonated. */
export function staffTourAllowed(role: StaffTourRole | null | undefined): boolean {
  if (!role) return false;
  return role.tier === 'partner' && !!role.orgRole && role.crmV2 === true && !role.impersonating;
}

/** A demonstration organization: its name ends in "(Demo)" (the shell's rule). */
export function isDemoOrg(name: string | null | undefined): boolean {
  return /\(Demo\)\s*$/.test(name ?? '');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The first participant in the caseload payload the People page reads; null when the list is empty or the shape is wrong. */
export function firstPersonFromCohort(json: unknown): string | null {
  const clients = (json as { cohort?: { clients?: unknown } } | null)?.cohort?.clients;
  if (!Array.isArray(clients)) return null;
  for (const c of clients) {
    const id = (c as { userId?: unknown } | null)?.userId;
    if (typeof id === 'string' && UUID.test(id)) return id;
  }
  return null;
}

/** A participant id read off a Today row's data attribute; null unless it is a UUID. */
export function personIdFromRow(value: string | null | undefined): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

/** True when the URL asks for the staff tour on its home page. */
export function staffTourRequested(pathname: string | null, params: { get(name: string): string | null } | null | undefined): boolean {
  return pathname === STAFF_TOUR_HOME && params?.get('tour') === STAFF_TOUR_PARAM;
}
