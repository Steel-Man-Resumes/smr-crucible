/**
 * The participant's "Who has opened what" line for one access-log entry.
 * Pure, so the words are tested. A t.ROY read on a staff member's behalf is
 * an open like any other, and says so (C4 staff skills). Also used for the
 * data export, so it shows the same words instead of a resource code.
 */
export function accessLogAction(kind: string | undefined, scope: string, label: (scope: string) => string, via?: string | null): string {
  // A Steel Man Resumes admin checking what a staff member's screens show
  // (developer view-as, house lane L2). Named as themselves, never as the staff member.
  if (via === "admin view" && kind === "queue") return "saw your interview and follow-up dates while checking a staff member's work list for Steel Man Resumes";
  if (via === "admin view") return `opened ${label(scope).toLowerCase()} while checking a staff member's view for Steel Man Resumes`;
  if (kind === "queue") return "had your interview and follow-up dates on their daily work list";
  if (scope === "assistant:overview") return "asked t.ROY to look over what you share and what their organization has on file about you";
  if (scope === "assistant:changes") return "asked t.ROY what changed lately in what you share and what their organization has on file about you";
  if (scope === "assistant:progress") return "asked t.ROY to look at the progress you share with them";
  if (scope === "assistant:tasks") return "asked t.ROY to look at their tasks about you";
  if (via === "t.ROY") return `asked t.ROY, which opened ${label(scope).toLowerCase()}`;
  return `opened ${label(scope).toLowerCase()}`;
}
