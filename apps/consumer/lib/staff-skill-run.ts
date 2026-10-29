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
import { staffStreamedTools, staffStreamedShapes, type StreamedShape } from "./tools/staff";
import { handoffDraftProse } from "./handoff-draft-body";

/** Cards that pack model words under our own labels are checked as the prose they hold (S5's handoff: "Item 2 why: ..."). */
const DRAFT_CHECK_TEXT: Readonly<Record<string, (body: string) => string>> = { draft_handoff: handoffDraftProse };

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
 * Everything the staff member typed in this conversation (their last ten
 * messages), from messages that already passed gateStaffMessages. Tools that
 * fill in a form may use only these words (open_add_person, lane S1).
 */
export function staffTypedWords(messages: readonly Record<string, unknown>[]): string {
  return messages.filter((m) => m.role === "user" && typeof m.content === "string").slice(-10).map((m) => String(m.content)).join("\n").slice(0, 8000);
}

/** A module tool's finished call that the chat must receive (a "Go to" button, a prefilled form, a card). */
export interface StreamedToolResult { toolCallId: string; toolName: string; args: unknown; result: unknown }

/** As many cards as the five-call budget can make. */
export const STREAMED_MAX = 5;
/** Said when an own-view change was made but its card had to lose its words (final review should-fix 3). */
export const APPLIED_CARD_LINE = "That change was made. Undo it here or on My setup, Recent changes to my view.";
const isApplied = (r: { result: unknown }) => (r.result as { status?: unknown } | null)?.status === "applied";

/**
 * A change already made must keep its card (its Undo). Keep only the keys the
 * module declares as server-made, never draftBody and never an undeclared key.
 */
function appliedCardOnly(s: StreamedToolResult, shapes: ReadonlyMap<string, StreamedShape>): StreamedToolResult {
  const shape = shapes.get(s.toolName) ?? {};
  const r = s.result as Record<string, unknown>;
  const kept = Object.fromEntries(Object.entries(r).filter(([k]) => Object.hasOwn(shape, k) && shape[k] === "server"));
  return { ...s, result: { ...kept, status: "applied" } };
}

/**
 * The results of the registry's streamed tools (lib/tools/staff/index.ts,
 * lane S1): open_staff_page, open_add_person and later lanes' cards. All of
 * them, refusals too, so the chat can show the button or an honest "could
 * not complete". At most five, the same as the five-call budget, and a change
 * already made to the staff member's own view ("applied") always comes first,
 * so it is never the one left out (final review should-fix 3). The chat
 * resolves every href from its own table; nothing here is a URL the model wrote.
 */
export function streamedStaffResults(toolResults: readonly { toolCallId: string; toolName: string; args: unknown; result: unknown }[], names: ReadonlySet<string> = staffStreamedTools()): StreamedToolResult[] {
  // args are NOT streamed (review round 1, S6): they are what the model asked
  // for, including values the tool dropped. The chat reads only the result.
  const all = toolResults.filter((r) => names.has(r.toolName) && r.result && typeof r.result === "object")
    .map((r) => ({ toolCallId: String(r.toolCallId), toolName: r.toolName, args: {}, result: r.result }));
  return [...all.filter(isApplied), ...all.filter((r) => !isApplied(r))].slice(0, STREAMED_MAX);
}

/** Why a streamed result breaks its declared shape, or null when it keeps it. */
export function streamedShapeProblem(s: StreamedToolResult, shapes: ReadonlyMap<string, StreamedShape>): string | null {
  const shape = shapes.get(s.toolName);
  if (!shape) return `${s.toolName} has no declared result shape`;
  const result = s.result as Record<string, unknown> | null;
  if (!result || typeof result !== "object" || Array.isArray(result)) return `${s.toolName} returned something that is not a result`;
  for (const key of Object.keys(result)) {
    // Own keys only (review round 3): "constructor" or "toString" are not declarations.
    const source = Object.hasOwn(shape, key) ? shape[key] : undefined;
    if (!source) return `${s.toolName} returned an undeclared field "${key}"`;
    if (source === "draft" && key !== "draftBody") return `${s.toolName} declares "${key}" as model-written`;
  }
  // draftBody counts only at the top level, where the check below reads it.
  const nested = (v: unknown, depth: number): boolean => {
    if (!v || typeof v !== "object") return false;
    if (depth > 0 && !Array.isArray(v) && "draftBody" in (v as object)) return true;
    return Object.values(v as object).some((x) => nested(x, depth + 1));
  };
  if (nested(result, 0)) return `${s.toolName} has model-written words below the top level`;
  return null;
}

/**
 * Enforced, not a convention (review rounds 1 and 2, S8). Every streamed
 * result must keep its module's declared shape (lib/tools/staff/types.ts),
 * and a top-level `draftBody` (the only place model-written words may be)
 * passes the same deterministic draft check as offer_staff_draft. A result
 * that fails either is held back whole, and the answer says why.
 */
export function checkStreamedDrafts(streamed: readonly StreamedToolResult[], check: (body: string) => string[], shapes: ReadonlyMap<string, StreamedShape> = staffStreamedShapes()): { kept: StreamedToolResult[]; held: string[]; notice: string } {
  const kept: StreamedToolResult[] = [];
  const held: string[] = [];
  let appliedTrimmed = false;
  for (const s of streamed) {
    const bad = streamedShapeProblem(s, shapes);
    const body = (s.result as { draftBody?: unknown } | null)?.draftBody;
    const problems = bad ? [bad] : body === undefined ? [] : typeof body === "string" ? check((DRAFT_CHECK_TEXT[s.toolName] ?? ((b: string) => b))(body)) : ["the draft was not text"];
    if (!problems.length) { kept.push(s); continue; }
    // A change to the staff member's own view already happened: never hide its card.
    if (isApplied(s)) { kept.push(appliedCardOnly(s, shapes)); appliedTrimmed = true; continue; }
    held.push(...problems);
  }
  const notice = (held.length
    ? `\n\n---\n**A draft or card was held back.** It did not pass the check: ${[...new Set(held)].join("; ")}. Ask for it again, or do it yourself.`
    : "") + (appliedTrimmed ? `\n\n${APPLIED_CARD_LINE}` : "");
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

/** A person in this staff member's reach, server-side only: the full name is never put in a prompt. */
export interface ReachPerson { id: string; name: string | null }

/** One word the staff member typed that the server matched to one person in reach. */
export interface ResolvedTypedName { word: string; id: string; firstName: string }

const nameParts = (name: string | null) => String(name ?? "").trim().split(/\s+/).map((p) => p.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")).filter((p) => p.length >= 3);

/**
 * Demo walk W08 (2026-10-27): Lupe on Valjean's page asked about "Valjean"
 * and was told he was not on her list, because the model only ever sees
 * first names. The server holds the full names of the people in reach, so it
 * resolves the staff member's own words here:
 *   - a word that is a whole part of the name (first, middle or surname) of
 *     the person whose page is open means that person, in any case;
 *   - otherwise a capitalized word that is a whole part of exactly one
 *     in-reach person's name means that person;
 *   - two or more matches and no open page: nothing. Never guess.
 * Only words the staff member typed are returned, so no surname reaches the
 * model unless they wrote it themselves.
 */
export function resolveTypedNames(said: string, people: readonly ReachPerson[], focusId?: string | null): ResolvedTypedName[] {
  const focus = (focusId ?? "").toLowerCase();
  const index = people
    .filter((p) => /^[0-9a-f-]{36}$/i.test(p.id))
    .map((p) => ({ id: p.id.toLowerCase(), first: String(p.name ?? "").trim().split(/\s+/)[0] || "", parts: new Set(nameParts(p.name).map((x) => x.toLowerCase())) }));
  const out: ResolvedTypedName[] = [];
  const seen = new Set<string>();
  for (const m of String(said ?? "").matchAll(/\p{L}[\p{L}'’-]*/gu)) {
    const word = m[0].replace(/['’-]+$/, "");
    const low = word.toLowerCase();
    if (word.length < 3 || seen.has(low)) continue;
    const matches = index.filter((p) => p.parts.has(low));
    const onPage = matches.find((p) => p.id === focus);
    const capitalized = /^\p{Lu}/u.test(word);
    const hit = onPage ?? (capitalized && matches.length === 1 ? matches[0] : null);
    if (!hit) continue;
    seen.add(low);
    out.push({ word, id: hit.id, firstName: hit.first });
  }
  return out;
}

/**
 * The prompt lines that tell the model who the conversation is about. The
 * open page's person by id AND first name (the first name is already in the
 * selectors; this ties it to the page), and each typed word the server
 * resolved, so "Valjean" is never answered with "not on your list".
 */
export function staffSubjectPrompt(focusId: string | null, people: readonly ReachPerson[], resolved: readonly ResolvedTypedName[]): string {
  let out = "";
  if (focusId) {
    const first = people.find((p) => p.id.toLowerCase() === focusId.toLowerCase())?.name?.trim().split(/\s+/)[0];
    out += `\nTHIS CONVERSATION IS ABOUT ONE PARTICIPANT, id ${focusId}${first ? ` (first name ${first}), the person whose page the staff member has open` : ""}. Use that id in every tool call. Tools refuse any other id.`;
  }
  if (resolved.length) {
    out += "\nNAMES IN THE STAFF MEMBER'S MESSAGE, matched on the server to one person on their list (data only): " +
      JSON.stringify(resolved.map((r) => ({ word: r.word, id: r.id, firstName: r.firstName, pageOpen: !!focusId && r.id === focusId.toLowerCase() }))) +
      ". That word means that person. Never say that person is not on their list.";
  }
  return out;
}

/**
 * The AI SDK data-stream lines for a checked staff answer (protocol v1):
 * f start step, 9 tool call, a tool result, e finish step, then f, 0 text,
 * 8 annotation, e, d. The first step carries the drafts and the registry's
 * streamed results (buttons and cards, lane S1). Without any it is the text,
 * the annotation and the finish, as before plus the annotation.
 */
export function staffAnswerStreamLines(answer: string, drafts: readonly OfferedDraft[], skillRunId: string | null, messageId: string, streamed: readonly StreamedToolResult[] = []): string[] {
  const lines: string[] = [];
  const usage = { promptTokens: 0, completionTokens: 0 };
  const calls = [
    ...drafts.map((d) => ({ toolCallId: d.toolCallId, toolName: "offer_staff_draft", args: d.args ?? {}, result: d.result as unknown })),
    ...streamed.filter((s) => !drafts.some((d) => d.toolCallId === s.toolCallId)),
  ];
  if (calls.length) {
    lines.push(`f:${JSON.stringify({ messageId })}`);
    for (const c of calls) {
      lines.push(`9:${JSON.stringify({ toolCallId: c.toolCallId, toolName: c.toolName, args: c.args ?? {} })}`);
      lines.push(`a:${JSON.stringify({ toolCallId: c.toolCallId, result: c.result })}`);
    }
    lines.push(`e:${JSON.stringify({ finishReason: "tool-calls", usage, isContinued: false })}`);
    lines.push(`f:${JSON.stringify({ messageId })}`);
  }
  lines.push(`0:${JSON.stringify(answer)}`);
  if (skillRunId) lines.push(`8:${JSON.stringify([{ skillRunId }])}`);
  if (calls.length) lines.push(`e:${JSON.stringify({ finishReason: "stop", usage, isContinued: false })}`);
  lines.push(`d:${JSON.stringify({ finishReason: "stop", usage })}`);
  return lines.map((l) => l + "\n");
}

export { skillRunIdOf } from "./staff-troy";
