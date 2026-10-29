/**
 * Demo fix T1 round 3 (2026-10-29): what earlier staff answers looked up,
 * for the ANSWER check only (org-output-verify OrgFacts.priorToolRecords).
 *
 * Only the RESULT line of record entries this server signed for this staff
 * member, about a real staff tool (staff-tool-record.ts readToolRecord: HMAC
 * checked, shape checked, anything else dropped). Never the args (they hold
 * what the staff member typed into a search), never an unverified
 * annotation, never assistant answer text. The newest message is the staff
 * member's turn and is skipped, as withStaffToolRecords skips it.
 */
import { readToolRecord } from "./staff-tool-record";

export function priorToolRecordResults(messages: readonly Record<string, unknown>[], check: { userId: string; tools: ReadonlySet<string> }): string[] {
  return messages
    .slice(0, -1)
    .filter((m) => m.role === "assistant")
    .flatMap((m) => readToolRecord(m.annotations, check).map((e) => e.result))
    .slice(-40);
}
