/**
 * Settings -> Download your data, pure part (TOOL-REVISIONS S8). No I/O.
 *
 * The page shows eight boxes; /api/user/export-data has more categories than
 * that, and it returns the extra ones only for a full copy. Unticking any box
 * used to drop those extras without a word. This module says, for any set of
 * ticks, exactly what the copy leaves out, and builds the request body.
 */

export const EXPORT_BOXES = [
  { key: 'resumes', label: 'Resumes and Forge results' },
  { key: 'applications', label: 'Job applications' },
  { key: 'chat', label: 'Chat history with t.ROY' },
  { key: 'consent', label: 'Consent records' },
  { key: 'usage', label: 'Usage totals' },
  { key: 'progress', label: 'Your activity history' },
  { key: 'record_check', label: 'Saved record checks' },
  { key: 'sharing', label: 'What you share, who opened it, and what your organization has on file about you' },
] as const;
export type ExportBox = (typeof EXPORT_BOXES)[number]['key'];
export type ExportTicks = Record<ExportBox, boolean>;

/** In the file only when every box is ticked (export-data returns them for a full copy). */
export const FULL_COPY_ONLY = [
  { key: 'decisions', label: 'the record of AI suggestions about you' },
  { key: 'login_history', label: 'your sign-in history' },
  { key: 'org', label: 'your program memberships' },
  { key: 'support', label: 'messages you sent to Steel Man' },
  { key: 'disclosure_rehearsal', label: 'disclosure practice transcripts' },
  { key: 'interview_voice', label: 'interview practice transcripts' },
  { key: 'avatar', label: 'the list of your photos' },
  { key: 'vault', label: 'the list of your documents' },
] as const;

export const ALL_TICKED: ExportTicks = Object.fromEntries(EXPORT_BOXES.map(b => [b.key, true])) as ExportTicks;

/** The categories to ask for; undefined means everything. */
export function exportCategories(ticks: ExportTicks): ExportBox[] | undefined {
  const chosen = EXPORT_BOXES.filter(b => ticks[b.key]).map(b => b.key);
  return chosen.length === EXPORT_BOXES.length ? undefined : chosen;
}

/** Everything this set of ticks leaves out of the file, in words. The documents themselves are never in it. */
export function exportLeavesOut(ticks: ExportTicks): string[] {
  if (!exportCategories(ticks)) return [];
  const unticked = EXPORT_BOXES.filter(b => !ticks[b.key]).map(b => b.label.charAt(0).toLowerCase() + b.label.slice(1));
  return [...unticked, ...FULL_COPY_ONLY.map(c => c.label)];
}

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Named for the person's own date, not UTC. */
export function exportFileName(now: Date): string { return `steel-man-data-${day(now)}.json`; }
export function documentsFileName(now: Date): string { return `steel-man-documents-${day(now)}.zip`; }

export const SHARED_COMPUTER_WARNING =
  'These files hold your chat history, record checks and documents. On a shared or library computer, anyone who opens the Downloads folder can read them. Download only on your own phone or computer, or delete the files and empty the trash when you finish.';
export const OWN_DEVICE_LABEL = 'This is my own phone or computer';

/**
 * The confirm part of an export request. A password account re-enters its
 * password; an account with no password confirms with the own-device tick.
 * Typing DELETE is for deleting, never for exporting.
 */
export function exportConfirmBody(input: { password: string; ownDevice: boolean }): { confirm: true; password?: string; ownDevice: boolean } {
  return { confirm: true, ...(input.password ? { password: input.password } : {}), ownDevice: input.ownDevice };
}

/** Server side: the no-password gate for exports. */
export function noPasswordExportConfirmed(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as Record<string, unknown>).ownDevice === true;
}
