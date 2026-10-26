/**
 * The participant's "Who has opened what" line for one access-log entry.
 * Pure, so the words are tested. A t.ROY read on a staff member's behalf is
 * an open like any other, and says so (C4 staff skills). Also used for the
 * data export, so it shows the same words instead of a resource code.
 */
export function accessLogAction(kind: string | undefined, scope: string, label: (scope: string) => string, via?: string | null): string {
  if (kind === "queue") return "had your interview and follow-up dates on their daily work list";
  if (scope === "assistant:overview") return "asked t.ROY to look over what you share and what their organization has on file about you";
  if (scope === "assistant:changes") return "asked t.ROY what changed lately in what you share and what their organization has on file about you";
  if (scope === "assistant:progress") return "asked t.ROY to look at the progress you share with them";
  if (scope === "assistant:tasks") return "asked t.ROY to look at their tasks about you";
  if (via === "t.ROY") return `asked t.ROY, which opened ${label(scope).toLowerCase()}`;
  return `opened ${label(scope).toLowerCase()}`;
}

export interface AccessLogLineEntry {
  kind?: string;
  scope: string;
  who: string | null;
  orgName: string | null;
  via?: string | null;
}

/**
 * The whole line, without the date: who, where, and what they did. Used by
 * "Who has opened what" and by the data export, so both say the same thing.
 *
 * A Steel Man Resumes admin checking what a staff member's screens show
 * (developer view-as, house lane L2) is named as themselves and is never
 * placed "at" the organization: they do not work there. The organization is
 * named as whose staff view was being checked.
 */
export function accessLogLine(e: AccessLogLineEntry, label: (scope: string) => string): string {
  if (e.via === "admin view") {
    const who = `${e.who || "An admin"} from Steel Man Resumes`;
    const where = e.orgName ? ` of ${e.orgName}` : "";
    return e.kind === "queue"
      ? `${who} saw your interview and follow-up dates while checking a staff work list${where}`
      : `${who} opened ${label(e.scope).toLowerCase()} while checking a staff view${where}`;
  }
  return `${e.who || "A staff member"}${e.orgName ? ` at ${e.orgName}` : ""} ${accessLogAction(e.kind, e.scope, label, e.via)}`;
}
