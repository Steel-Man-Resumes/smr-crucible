/**
 * When the dashboard asks for contact details (demo review 2026-10-28,
 * Marqus): the server gate says "needs_profile" while a name or phone is
 * missing, and the dashboard used to replace the whole page with a form
 * marked required, even for someone with saved resumes and applications.
 *
 * Someone who already has saved work sees their dashboard, with the contact
 * form as a quiet, optional nudge they can open. Only a person with nothing
 * saved yet gets the form as the page. The gate itself is unchanged (tools
 * that need a profile still say so); this decides only how the dashboard asks.
 * Nothing is filled in for anyone.
 */
export function profileAsNudge(o: { forgeComplete: boolean; resumeCount: number; artifactCount: number }): boolean {
  return o.forgeComplete || o.resumeCount > 0 || o.artifactCount > 0;
}

export const CONTACT_NUDGE = {
  summary: "Add a phone number to your resume header",
  hint: "Optional for now. Employers call this number, so add it when you are ready.",
  title: "Your contact details",
  intro: "These go on your resume header. Nothing else.",
  needBoth: "Add a name and a phone number to save these.",
  save: "Save",
} as const;
