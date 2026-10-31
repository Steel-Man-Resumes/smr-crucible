/**
 * The staff answer's words, from every step of the model call (demo fix T2
 * round 3, live 923c517; rewritten round three of the 2026-10-31 weekend).
 *
 * THE BUG. generateText's `text` is the LAST step's text only (ai 4.3). The
 * model often writes its answer in a step that also calls a tool (a "Go to"
 * button, a draft offer, the listing nudge) and then closes with one short
 * line after the result. Showing only the last step loses the answer: the
 * staff member saw "You can open Jean from People." and no triage (harness
 * ROOM-10, DEMO-09 on preview D), or a sign-off and no drafts (TRAP-ACT-02).
 *
 * THE RULE. Provenance by step kind, never by length.
 *   - A READ step (any call to a tool that reads: caseload, overview, tasks,
 *     directory, header) is written before the model has seen the facts. Its
 *     words are narration ("Let me look.") and are dropped.
 *   - An ACTION step (every call in it is a button, a draft offer, a view
 *     change or the nudge) is written after the reads are done. Its words are
 *     the answer and are kept, in order, ahead of the final step's words.
 *     Only action steps after the last read step count.
 *   - A refused action cannot have happened. From a refused action step, a
 *     sentence that says the page opened or the draft was placed is cut; the
 *     rest of the step's words stay (a triage is still a triage when the
 *     button was refused). The final step's words always come last, so a
 *     correction written there is never undone.
 *   - Draft bodies are never copied into the prose: the draft card carries
 *     the body the tool was given (AssistantChat, offer_staff_draft). When no
 *     step said anything and a draft was offered, the reply says where it is.
 * When no step said anything beyond the nudge line, every step's words are
 * used (the original T2 fix), and when nothing was said at all and a tool
 * ran, the reply says so plainly instead of showing only a card.
 */
import { LISTING_NUDGE_LINE } from "@crucible/core/src/staffRewardsShared";
import { TROY_EMPTY_REPLY } from "./ai/troy-chat";

export const STAFF_TOOLS_NO_TEXT = "I ran the search but have nothing to show yet. Ask again.";
export const STAFF_DRAFT_ONLY_TEXT = "Your draft is below, unsaved and in this reply only. Nothing was saved or sent.";

const withoutNudge = (t: string) => t.split(LISTING_NUDGE_LINE).join("").trim();

type Step = { text?: string; toolCalls?: readonly unknown[]; toolResults?: readonly { toolName?: string; result?: unknown }[] };

/** Tools that act on what was already read: buttons, draft offers, own-view changes, the nudge. Every other name, and a call with no name, is a read. */
export const ACTION_TOOLS: ReadonlySet<string> = new Set([
  "open_staff_page", "open_add_person", "offer_staff_draft", "change_my_view", "undo_my_view_change",
  "propose_shared_view", "listing_check_nudge", "draft_directory_contribution", "draft_handoff",
]);
const DRAFT_TOOL = "offer_staff_draft";

function stepTools(s: Step): string[] {
  const calls = (s.toolCalls ?? []).map((c) => String((c as { toolName?: unknown } | null)?.toolName ?? ""));
  const results = (s.toolResults ?? []).map((r) => String(r?.toolName ?? ""));
  return [...calls, ...results];
}
const isActionStep = (s: Step) => { const t = stepTools(s); return t.length > 0 && t.every((n) => ACTION_TOOLS.has(n)); };
const isReadStep = (s: Step) => stepTools(s).length > 0 && !isActionStep(s);
const status = (r: { result?: unknown }) => String((r.result as { status?: unknown } | null)?.status ?? "");
const wasRefused = (s: Step) => (s.toolResults ?? []).some((r) => /^(refused|unavailable)$/.test(status(r)));
const draftOffered = (steps: readonly Step[]) => steps.some((s) => (s.toolResults ?? []).some((r) => r?.toolName === DRAFT_TOOL && status(r) === "draft_only"));

/** A sentence from a refused action step that says the action happened: the page opened, the draft placed or put there. */
const ACTED_CLAIM = /\b(?:opened|placed)\b|\bI(?:'ve| have| just)?\s+put\b|\bon (?:that|the|his|her|their|its) page\b/i;
function withoutActedClaims(text: string): string {
  return text
    .split(/\n/)
    .map((line) => line.split(/(?<=[.!?])\s+/).filter((sentence) => !ACTED_CLAIM.test(sentence)).join(" "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The nudge line stays only when the nudge tool itself answered ok this turn (its buttons render then); otherwise it is cut (review R3 S2). */
function nudgeOk(steps: readonly Step[]): boolean {
  return steps.some((s) => (s.toolResults ?? []).some((r) => r?.toolName === "listing_check_nudge" && status(r) === "ok"));
}

/** The words of the action steps after the last read step, final step excluded; refused-action claims cut. */
function answerSteps(steps: readonly Step[], clean: (s: string) => string): string[] {
  const earlier = steps.slice(0, -1);
  let lastRead = -1;
  earlier.forEach((s, i) => { if (isReadStep(s)) lastRead = i; });
  const out: string[] = [];
  for (const s of earlier.slice(lastRead + 1)) {
    if (!isActionStep(s)) continue;
    const raw = clean(String(s.text ?? ""));
    const text = wasRefused(s) ? withoutActedClaims(raw) : raw;
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

export function staffAnswerText(steps: readonly Step[], finalText: string): string {
  const keepNudge = nudgeOk(steps);
  const clean = (s: string) => (keepNudge ? s : withoutNudge(s).replace(/[ \t]{2,}/g, " ").trim());
  const final = clean(String(finalText ?? "").trim());
  const toolsRan = steps.some((s) => (s.toolCalls?.length ?? 0) > 0);
  if (withoutNudge(final)) {
    const kept = answerSteps(steps, clean).filter((t) => !final.includes(t));
    return [...kept, final].join("\n\n");
  }
  const earlier = steps.map((s) => withoutNudge(String(s.text ?? ""))).filter(Boolean);
  // The last step's text is in steps too; it is nudge-only here, so it was dropped above.
  const body = [...new Set(earlier)].join("\n\n");
  const nudged = keepNudge && (final.includes(LISTING_NUDGE_LINE) || steps.some((s) => String(s.text ?? "").includes(LISTING_NUDGE_LINE)));
  if (body) return nudged ? `${body}\n\n${LISTING_NUDGE_LINE}` : body;
  if (draftOffered(steps)) return STAFF_DRAFT_ONLY_TEXT;
  return toolsRan ? STAFF_TOOLS_NO_TEXT : TROY_EMPTY_REPLY;
}
