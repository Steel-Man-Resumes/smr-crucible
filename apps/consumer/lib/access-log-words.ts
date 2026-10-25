/**
 * The participant's "Who has opened what" line for one access-log entry.
 * Pure, so the words are tested. A t.ROY read on a staff member's behalf is
 * an open like any other, and says so (C4 staff skills).
 */
export function accessLogAction(kind: string | undefined, scope: string, label: (scope: string) => string): string {
  if (kind === "queue") return "had your interview and follow-up dates on their daily work list";
  if (scope === "assistant:overview") return "asked t.ROY to look over what you share and what their organization has on file about you";
  if (scope === "assistant:changes") return "asked t.ROY what changed lately in what you share and what their organization has on file about you";
  return `opened ${label(scope).toLowerCase()}`;
}
