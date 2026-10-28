/**
 * Shared rules for the S6 routes (staff rewards, migration 111; directory
 * contributions, migration 112). Pure where it can be, so the rules are tested
 * without a server.
 *
 *  - Writes only by the person themselves: never while a platform admin views
 *    as them, never by a platform admin acting on an organization they are
 *    not a member of.
 *  - Staff-written words that other people will read (a good catch, a
 *    recognition note, what a listing told you) never carry record words:
 *    the same detector staff t.ROY uses (lib/staff-ai-safety.ts). These words
 *    never go to a model here, and the rule keeps a person's record out of a
 *    colleague's inbox, a funder report and the directory queue.
 */
import { hasStaffRecordWords } from "./staff-ai-safety";
import { readJson, refuseCrossOrigin } from "./org-crm-gate";

export { refuseCrossOrigin };

export const RECORD_WORDS_REFUSAL = "Keep record, court and supervision details out of this. Say what was done well, without them.";
export const VIEWING_REFUSAL = "Nothing is saved while you are viewing as someone else.";

/** The first piece of text that carries record words, or null. */
export function recordWordsIn(texts: readonly (string | null | undefined)[]): string | null {
  for (const t of texts) if (t && hasStaffRecordWords(t)) return t;
  return null;
}

export interface WriterCheck { viewing?: boolean; viaPlatformAdmin: boolean; actorUserId: string; sessionUserId: string | null | undefined }

/** May this request write as the actor? Only the actor, signed in as themselves. */
export function mayWrite(c: WriterCheck): boolean {
  return !c.viewing && !c.viaPlatformAdmin && !!c.sessionUserId && c.sessionUserId === c.actorUserId;
}

/** Today's date (UTC) as YYYY-MM-DD: the 112 intake compares with the database's current_date. */
export function todayUtc(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Is this a JSON body? (Writes here take application/json only, never text/plain.) */
export function isJsonRequest(headers: Headers): boolean {
  return /^application\/json\b/i.test(headers.get("content-type") ?? "");
}

/** The JSON body of a write, or null when it is not application/json (the route answers 415). */
export async function readJsonStrict(request: Request): Promise<Record<string, unknown> | null> {
  if (!isJsonRequest(request.headers)) return null;
  return readJson(request);
}

export const NOT_JSON = "Send this as JSON.";
