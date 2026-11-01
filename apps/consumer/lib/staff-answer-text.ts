/**
 * The staff answer's words, from every step of the model call (demo fix T2
 * round 3, live 923c517; rewritten rounds three and four of the 2026-10-31
 * weekend from Codex's D and E reviews).
 *
 * THE BUG. generateText's `text` is the LAST step's text only (ai 4.3). The
 * model often writes its answer in a step that also calls a tool (a "Go to"
 * button, a draft offer, the listing nudge) and then closes with one short
 * line after the result. Showing only the last step loses the answer: the
 * staff member saw a sign-off and no drafts (TRAP-ACT-02 on B).
 *
 * WHAT THE STEP LOG SHOWED (preview E, [staff-steps]): the model writes NO
 * text in a step that calls a read tool, and sometimes no text in a button
 * step either; when it does write in a button or draft step, that text is the
 * answer (TRAP-ACT-01: 321 chars with the draft offer, 146 after). ROOM-10 on
 * E was a model that never wrote the triage (0, 0, 49 chars), not a drop here.
 *
 * THE RULE.
 *   - A READ step (any call to a tool that reads or changes something whose
 *     result the model has not seen: caseload, overview, header, directory,
 *     view changes) is narration. Dropped.
 *   - A CARD step (every call in it offers a button, a prefilled form, a draft
 *     or the nudge: open_staff_page, open_add_person, offer_staff_draft,
 *     listing_check_nudge, draft_directory_contribution, draft_handoff) is
 *     written after at least one read. Its words are kept, in order, ahead of
 *     the final step. These tools never open a page, add a person or place a
 *     draft themselves (navigate.ts returns navigated:false even on ok), so a
 *     first-person sentence that says one of those happened is cut from every
 *     card step, refused or not. Other people's actions ("Jean opened the
 *     handoff") and instructions ("review it on his page") stay.
 *   - The final step's words come last and are authoritative. When they
 *     withdraw or correct what came before ("discard that draft", "I need to
 *     correct my last answer"), the earlier card words are dropped.
 *   - Draft bodies are never copied into the prose: the draft card shows the
 *     body the tool was given (AssistantChat, data-staff-draft-body) once the
 *     check passes. No words at all plus a draft offered: the reply says so.
 * The same policy runs whether or not the final step said anything. When no
 * step said anything beyond the nudge line, the earlier words (any step) are
 * used with the same first-person cut (the original T2 fix), and when nothing
 * was said at all and a tool ran, the reply says so plainly.
 */
import { LISTING_NUDGE_LINE } from "@crucible/core/src/staffRewardsShared";
import { TROY_EMPTY_REPLY } from "./ai/troy-chat";

export const STAFF_TOOLS_NO_TEXT = "I ran the search but have nothing to show yet. Ask again.";
export const STAFF_DRAFT_ONLY_TEXT = "Your draft is below, unsaved and in this reply only. Nothing was saved or sent.";

const withoutNudge = (t: string) => t.split(LISTING_NUDGE_LINE).join("").trim();

type Step = { text?: string; toolCalls?: readonly unknown[]; toolResults?: readonly { toolName?: string; result?: unknown }[] };

/** Tools whose result is a card for the staff member to act on. None of them completes an action. */
export const CARD_TOOLS: ReadonlySet<string> = new Set([
  "open_staff_page", "open_add_person", "offer_staff_draft", "listing_check_nudge", "draft_directory_contribution", "draft_handoff",
]);
const DRAFT_TOOL = "offer_staff_draft";

function stepTools(s: Step): string[] {
  const calls = (s.toolCalls ?? []).map((c) => String((c as { toolName?: unknown } | null)?.toolName ?? ""));
  const results = (s.toolResults ?? []).map((r) => String(r?.toolName ?? ""));
  return [...calls, ...results];
}
const isCardStep = (s: Step) => { const t = stepTools(s); return t.length > 0 && t.every((n) => CARD_TOOLS.has(n)); };
const isReadStep = (s: Step) => stepTools(s).length > 0 && !isCardStep(s);
const status = (r: { result?: unknown }) => String((r.result as { status?: unknown } | null)?.status ?? "");
const draftOffered = (steps: readonly Step[]) => steps.some((s) => (s.toolResults ?? []).some((r) => r?.toolName === DRAFT_TOOL && status(r) === "draft_only"));

/**
 * A first-person sentence that says a card tool completed something it never does: I opened the page,
 * I placed/put the draft on their page, I added/invited the person, the draft is now on their page.
 * Review E1 (2026-11-01): only the model's own completion claims; "Jean opened the handoff" and
 * "review the ID task on his page" are not matched.
 */
const COMPLETED_CLAIM = /\bI(?:'ve| have| just| already)?\s+(?:now\s+)?(?:opened|placed|put|added|invited|navigated)\b|\b(?:the |this |that |your )?(?:draft|note|check-in|message)\s+(?:is|has been|was)\s+(?:now\s+)?(?:placed|put)?\s*on\s+(?:his|her|their|the|that)\s+page\b|\b(?:his|her|their|the)\s+page\s+(?:is|has been|was)\s+(?:now\s+)?opened?\b/i;
export function withoutCompletedClaims(text: string): string {
  return text
    .split(/\n/)
    .map((line) => line.split(/(?<=[.!?])\s+/).filter((sentence) => !COMPLETED_CLAIM.test(sentence)).join(" "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The final step takes back what came before it: nothing earlier is shown (review E5). */
const WITHDRAWS = /\b(?:discard|disregard|ignore|scrap|forget|do not use|don't use|please don't send|do not send)\b[^.!?\n]*\b(?:that|the|this|my|earlier|previous|above|prior)\b[^.!?\n]*\b(?:draft|answer|version|message|text|reply)\b|\b(?:I (?:need|have) to|let me) correct\b|\bcorrection:|\bI was wrong\b|\bI (?:must|should) take (?:that|this) back\b/i;
export const finalWithdraws = (final: string) => WITHDRAWS.test(final);

/** The nudge line stays only when the nudge tool itself answered ok this turn (its buttons render then); otherwise it is cut (review R3 S2). */
function nudgeOk(steps: readonly Step[]): boolean {
  return steps.some((s) => (s.toolResults ?? []).some((r) => r?.toolName === "listing_check_nudge" && status(r) === "ok"));
}

/** The words of the card steps after the first read step (or all card steps when nothing was read), final step excluded. */
function cardWords(steps: readonly Step[], clean: (s: string) => string): string[] {
  const earlier = steps.slice(0, -1);
  const firstRead = earlier.findIndex(isReadStep);
  const out: string[] = [];
  earlier.forEach((s, idx) => {
    if (!isCardStep(s) || (firstRead >= 0 && idx < firstRead)) return;
    const text = withoutCompletedClaims(clean(String(s.text ?? "")));
    if (text && !out.includes(text)) out.push(text);
  });
  return out;
}

export function staffAnswerText(steps: readonly Step[], finalText: string): string {
  const keepNudge = nudgeOk(steps);
  const clean = (s: string) => (keepNudge ? s : withoutNudge(s).replace(/[ \t]{2,}/g, " ").trim());
  const final = clean(String(finalText ?? "").trim());
  const toolsRan = steps.some((s) => (s.toolCalls?.length ?? 0) > 0);
  if (withoutNudge(final)) {
    const kept = finalWithdraws(final) ? [] : cardWords(steps, clean).filter((t) => !final.includes(t));
    return [...kept, final].join("\n\n");
  }
  // Nothing said in the last step beyond the nudge line: the card steps' words, else any step's words,
  // with the same first-person cut (review E3: this path used to skip every rule).
  const fromCards = cardWords(steps, clean);
  const fromAny = [...new Set(steps.map((s) => withoutCompletedClaims(withoutNudge(String(s.text ?? "")))).filter(Boolean))];
  const body = (fromCards.length ? fromCards : fromAny).join("\n\n");
  const nudged = keepNudge && (final.includes(LISTING_NUDGE_LINE) || steps.some((s) => String(s.text ?? "").includes(LISTING_NUDGE_LINE)));
  if (body) return nudged ? `${body}\n\n${LISTING_NUDGE_LINE}` : body;
  if (draftOffered(steps)) return STAFF_DRAFT_ONLY_TEXT;
  return toolsRan ? STAFF_TOOLS_NO_TEXT : TROY_EMPTY_REPLY;
}
