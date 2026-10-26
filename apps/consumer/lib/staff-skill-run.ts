/**
 * Staff t.ROY, after the answer is checked (house build L6).
 *
 *   1. The skill-run log (migration 106): one row per staff answer, written
 *      as the staff member, best effort. Input summary through the record
 *      gate; only a hash of the answer.
 *   2. The answer stream. Staff answers are generated whole and checked
 *      before they are sent (route.ts), then re-emitted. Until this file the
 *      re-emit carried text only, so the offer_staff_draft result never
 *      reached the browser and "Put this draft on their page" could not
 *      appear. The stream now carries each offered draft as a finished tool
 *      call in its own step, then the text in a second step (so the chat
 *      does not send the turn back to the server), and the skill run's id as
 *      a message annotation, so a save or a copy can mark the run accepted.
 *
 * Pure where it can be, so the stream and the summary are tested without a
 * server, a model or a database.
 */
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";
import { STAFF_SKILLS, type StaffSkillId } from "./staff-troy";
import { skillRunInputSummary } from "./staff-ai-safety";

export const GENERAL_SKILL = "staff-general";

export function staffSkillLabel(skill: StaffSkillId | null | undefined): string {
  return STAFF_SKILLS.find((s) => s.id === skill)?.label ?? "Question";
}

/** The person a run was about: the panel's focus, else the first person a tool read. */
export function skillRunParticipant(focus: string | null, calls: readonly { participantId: string | null }[]): string | null {
  return focus ?? calls.find((c) => c.participantId)?.participantId ?? null;
}

type Core = Pick<typeof import("@crucible/core"), "logSkillRun">;

/** Write the run. Never throws: a failed log is reported and the answer still goes out. */
export async function recordStaffSkillRun(
  actor: OrgActor,
  run: { skill: StaffSkillId | null; focus: string | null; calls: readonly { tool: string; participantId: string | null }[]; userText: string | null; answer: string },
  core: () => Promise<Core> = () => import("@crucible/core"),
): Promise<string | null> {
  try {
    return await (await core()).logSkillRun(actor, {
      skill: run.skill ?? GENERAL_SKILL,
      participantId: skillRunParticipant(run.focus, run.calls),
      inputSummary: skillRunInputSummary(staffSkillLabel(run.skill), run.userText),
      tools: run.calls.map((c) => c.tool),
      output: run.answer,
    });
  } catch (err) {
    console.error("[staff-skill-run] log failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export interface OfferedDraft { toolCallId: string; args: unknown; result: Record<string, unknown> }

/** The offer_staff_draft results that are real drafts: unsaved, unsent, with a body. */
export function offeredDrafts(toolResults: readonly { toolCallId: string; toolName: string; args: unknown; result: unknown }[]): OfferedDraft[] {
  return toolResults.flatMap((r) => {
    const res = r.result as Record<string, unknown> | null;
    if (r.toolName !== "offer_staff_draft" || !res || res.status !== "draft_only" || res.saved !== false || res.sent !== false) return [];
    if (typeof res.body !== "string" || !res.body.trim() || typeof res.participantId !== "string") return [];
    return [{ toolCallId: String(r.toolCallId), args: r.args, result: res }];
  }).slice(0, 2);
}

/**
 * Run the answer check on every offered draft (fix round 1, B3). A draft
 * with any problem is held back; the notice says why, in the answer.
 */
export function checkStaffDrafts(drafts: readonly OfferedDraft[], check: (body: string) => string[]): { kept: OfferedDraft[]; held: string[]; notice: string } {
  const kept: OfferedDraft[] = [];
  const held: string[] = [];
  for (const d of drafts) {
    const problems = check(String(d.result.body ?? ""));
    if (problems.length) held.push(...problems); else kept.push(d);
  }
  const notice = held.length
    ? `\n\n---\n**A draft for their page was held back.** It did not pass the check: ${[...new Set(held)].join("; ")}. Ask for it again, or write it yourself.`
    : "";
  return { kept, held, notice };
}

/**
 * Participants the staff member named in their own (already gated) words: a
 * first name of an allowed selector, as a whole word, or a typed id. Used to
 * let a person tool open someone after a caseload read (fix round 1).
 */
export function namedParticipantIds(said: string, selectors: readonly { id: string; firstName: string }[]): string[] {
  const text = String(said ?? "");
  const ids = new Set<string>();
  for (const m of text.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)) ids.add(m[0].toLowerCase());
  for (const s of selectors) {
    const name = String(s.firstName ?? "").trim();
    if (name.length < 2 || !/^[0-9a-f-]{36}$/i.test(s.id)) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<![\\p{L}])${esc}(?![\\p{L}])`, "iu").test(text)) ids.add(s.id.toLowerCase());
  }
  return [...ids];
}

/**
 * The AI SDK data-stream lines for a checked staff answer (protocol v1):
 * f start step, 9 tool call, a tool result, e finish step, then f, 0 text,
 * 8 annotation, e, d. Without drafts it is the text, the annotation and the
 * finish, as before plus the annotation.
 */
export function staffAnswerStreamLines(answer: string, drafts: readonly OfferedDraft[], skillRunId: string | null, messageId: string): string[] {
  const lines: string[] = [];
  const usage = { promptTokens: 0, completionTokens: 0 };
  if (drafts.length) {
    lines.push(`f:${JSON.stringify({ messageId })}`);
    for (const d of drafts) {
      lines.push(`9:${JSON.stringify({ toolCallId: d.toolCallId, toolName: "offer_staff_draft", args: d.args ?? {} })}`);
      lines.push(`a:${JSON.stringify({ toolCallId: d.toolCallId, result: d.result })}`);
    }
    lines.push(`e:${JSON.stringify({ finishReason: "tool-calls", usage, isContinued: false })}`);
    lines.push(`f:${JSON.stringify({ messageId })}`);
  }
  lines.push(`0:${JSON.stringify(answer)}`);
  if (skillRunId) lines.push(`8:${JSON.stringify([{ skillRunId }])}`);
  if (drafts.length) lines.push(`e:${JSON.stringify({ finishReason: "stop", usage, isContinued: false })}`);
  lines.push(`d:${JSON.stringify({ finishReason: "stop", usage })}`);
  return lines.map((l) => l + "\n");
}

export { skillRunIdOf } from "./staff-troy";
