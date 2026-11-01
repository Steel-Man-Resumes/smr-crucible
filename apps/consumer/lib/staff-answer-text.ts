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
 * None of the card tools has that effect (navigate.ts returns navigated:false, drafts are unsaved), so the
 * claim is false whatever the tool returned. Review E1 (2026-11-01): only the model's own completion
 * claims; "Jean opened the handoff" and "review the ID task on his page" are not matched. Review F2: the
 * verb has to take the card's own object (a page, a draft, a person). Review G3: a capitalised word is
 * not a person ("I added ID to this checklist", "I added Monday to the draft" stay), so "added" counts
 * only with where the person went (to your caseload, as a participant); a draft counts only when it is
 * put somewhere it never goes (on his page, in her record), so "I have placed the draft below" stays;
 * and a name can be two or three words ("I opened Jean Valjean's page", "the draft is now on Jean's page").
 */
const FIRST_PERSON = String.raw`\bI(?:['’]ve| have|\s+(?:just|already|now))*\s+`;
// A name: up to three capitalised words, each with a lowercase letter after the capital (not "ID", "SSN"),
// "O’Neil" and "Jean-Luc" included. Each word is a fixed shape, so a long run of capitals or apostrophes
// is read once (timing check 2026-11-01: the looser [\w'’-]* was quadratic on 100k characters).
const NAME_WORD = String.raw`[A-Z](?:[a-z]+|['’][A-Z][a-z]+)(?:-[A-Z][a-z]+)?`;
const NAME = String.raw`(?:${NAME_WORD} ){0,2}${NAME_WORD}`;
const WHOSE = String.raw`(?:his|her|their|the|that|this|${NAME}['’]s)`;
const PAGE = String.raw`(?:participant\s+)?(?:page|profile|record|file|case notes)\b`;
const OPENED_PAGE = String.raw`(?:opened|navigated to|went to)\s+(?:${WHOSE}\s+)?(?:participant\s+)?(?:page|profile)\b`;
const PLACED_DRAFT = String.raw`(?:placed|put|saved|posted|added)\s+(?:(?:the|this|that|your|a)\s+)?(?:draft|note|check-in|message)\s+(?:on|in|into|to)\s+(?:${WHOSE}\s+)?${PAGE}`;
const PERSON_PRONOUN = String.raw`(?:him|her|them|the person|a person|the participant)\b`;
const WHERE_ADDED = String.raw`\s+(?:to|as|into|onto)\s+(?:(?:your|the|their|our|this|my|a|an)\s+)?(?:caseload|org|organi[sz]ation|team|people|roster|program|participants?|Refinery)\b`;
const ADDED_PERSON = String.raw`(?:(?:added|invited)\s+${PERSON_PRONOUN}|invited\s+${NAME}\b|added\s+${NAME}${WHERE_ADDED})`;
const DRAFT_ON_PAGE = String.raw`\b(?:[Tt]he |[Tt]his |[Tt]hat |[Yy]our )?(?:draft|note|check-in|message)\s+(?:is|has been|was)\s+(?:now\s+)?(?:(?:placed|put|saved)\s+)?(?:on|in)\s+${WHOSE}\s+${PAGE}`;
const PAGE_OPENED = String.raw`\b(?:[Hh]is|[Hh]er|[Tt]heir|[Tt]he|${NAME}['’]s)\s+page\s+(?:is|has been|was)\s+(?:now\s+)?open(?:ed)?\b`;
const COMPLETED_CLAIM = new RegExp(`${FIRST_PERSON}(?:${OPENED_PAGE}|${PLACED_DRAFT}|${ADDED_PERSON})|${DRAFT_ON_PAGE}|${PAGE_OPENED}`);
export function withoutCompletedClaims(text: string): string {
  return text
    .split(/\n/)
    .map((line) => line.split(/(?<=[.!?])\s+/).filter((sentence) => !COMPLETED_CLAIM.test(sentence)).join(" "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The final step takes back what came before it: nothing earlier is shown (review E5). Review F3: a
 * withdrawal names the thing withdrawn right after the verb ("discard that draft"), "do not send" counts
 * only with a supersession word ("don't send the earlier draft"; "do not send this draft until you have
 * reviewed it" is an instruction), "forget" is out ("don't forget the draft is unsaved"), and "that draft
 * was wrong" / "use this replacement" are in. Review G1: "discard both drafts", "neither draft should be
 * used" and "discard the revised draft" are in too. A regex is still a heuristic, and it decides the
 * cards as well as the prose (draftsAfterFinal), so draftsAfterFinal leans to no card when unsure.
 */
const SUPERSEDED = String.raw`(?:earlier|previous|prior|above|first|old|original)`;
const WHICH = String.raw`(?:that|the|this|my|both|all|either|any|each|every|second|last|latest|later|revised|new|${SUPERSEDED})`;
const THING = String.raw`(?:draft|answer|version|message|text|reply)s?`;
const WITHDRAWS = new RegExp([
  String.raw`\b(?:discard|disregard|ignore|scrap|do not use|don['’]t use)\s+(?:(?:${WHICH}|of)\s+)+${THING}\b`,
  String.raw`\b(?:do not send|don['’]t send|never send)\s+(?:(?:that|the|this|my)\s+)*(?:${SUPERSEDED}|both|either|any)\s+${THING}\b`,
  String.raw`\b(?:that|the|this|my|${SUPERSEDED})\s+${THING}\s+(?:was|is|were|are)\s+(?:wrong|incorrect|mistaken|not right)\b`,
  String.raw`\bneither\s+(?:draft|version|one)\b`,
  String.raw`\bnone of (?:the|these|those|my) (?:drafts|versions)\b`,
  String.raw`\buse (?:this|the) (?:replacement|corrected|revised|new)\b`,
  String.raw`\b(?:I (?:need|have) to|let me) correct\b`,
  String.raw`\bcorrection:`,
  String.raw`\bI was wrong\b`,
  String.raw`\bI (?:must|should) take (?:that|this) back\b`,
].join("|"), "i");
export const finalWithdraws = (final: string) => WITHDRAWS.test(final);

// Per clause of the final: does it take something back or keep something, and which drafts does it name?
const TAKES_BACK = /\b(?:discard|disregard|ignore|scrap|drop|delete|do not use|don['’]t use|do not send|don['’]t send|never send|wrong|incorrect|mistaken|not right|neither|none of)\b/i;
const KEEPS = /\b(?:use|keep|send|stands|is right|is correct|go with)\b/i;
const NAMES_ALL = /\b(?:both|all|either|any|each|every|neither|none)\b/i;
const NAMES_EARLIER = new RegExp(String.raw`\b(?:${SUPERSEDED}|initial)\b`, "i");
const NAMES_LATER = /\b(?:second|last|latest|later|revised|new|replacement|corrected|updated|this one)\b/i;

/**
 * The drafts the staff member may act on once the final step has spoken (reviews F5, G1). A draft is a
 * card only if the final did not take it back. The final is read clause by clause: "discard both" /
 * "neither draft" takes back every draft; "discard the earlier draft" takes back all but the last;
 * "discard the revised draft" takes back the last. With more than one offer the last stays only when no
 * clause took it back and either an earlier one was named as withdrawn or a clause keeps the later one
 * ("use this replacement", "the second one stands"); the first of two stays only when a clause keeps it
 * and the last is taken back. Anything else that withdraws ("I need to correct my answer", "that draft
 * was wrong" with nothing kept) leaves no card: a missing card costs a retype, a wrong one an action.
 */
export function draftsAfterFinal<T>(drafts: readonly T[], finalText: string): T[] {
  const final = String(finalText ?? "");
  if (!finalWithdraws(final)) return [...drafts];
  if (drafts.length === 0) return [];
  let backAll = false, backEarlier = false, backLater = false, keepEarlier = false, keepLater = false;
  for (const clause of final.split(/(?<=[.!?;:])\s+|\s*;\s*|,?\s+but\s+/i)) {
    if (TAKES_BACK.test(clause)) {
      if (NAMES_ALL.test(clause)) backAll = true;
      if (NAMES_EARLIER.test(clause)) backEarlier = true;
      if (NAMES_LATER.test(clause)) backLater = true;
    } else if (KEEPS.test(clause)) {
      if (NAMES_EARLIER.test(clause)) keepEarlier = true;
      if (NAMES_LATER.test(clause)) keepLater = true;
    }
  }
  if (backAll || (backEarlier && backLater) || drafts.length === 1) return [];
  if (backLater) return drafts.length === 2 && keepEarlier ? [drafts[0]] : [];
  if (backEarlier || keepLater) return [drafts[drafts.length - 1]];
  return [];
}

/**
 * ACT-01/02 (previews F and G, 2026-11-01): after a checked draft, "Send that to Valjean." / "Send it now."
 * ran no tool at all, and the model took back true facts from its own draft ("I added details that my
 * lookup didn't show: the title, the status, the Oct 24 date", "I also need to correct my last answer").
 * It had no new result, only the one-line lookup record of the earlier turn, which is a summary. A prompt
 * rule against this did not hold on two previews, so the route also cuts it: on a turn that only asks to
 * act on what was already given and reads nothing, the answer ends before its first sentence that
 * corrects, re-audits or rewrites the earlier answer. With nothing left, the plain action line is used.
 */
export const STAFF_ACTION_ONLY_TEXT = 'I can’t send, save or schedule anything. Press "Put this draft on their page" to review it there, or "Copy to use" and send it yourself, then mark it sent on their page.';
// A message that also questions, checks or changes the draft is not action-only: the model may reread then.
const ACTION_ONLY = /^(?![^\n]*\b(?:check|right|correct|wrong|sure|accurate|true|verify|confirm|fix|change|edit|update|but)\b)(?:(?:ok(?:ay)?|yes|yeah|great|thanks|good|perfect|cool)[,.!]?\s+)*(?:please\s+)?(?:(?:go ahead and|can you|could you|would you|just)\s+)?(?:send|text|email|put|place|post|save|copy|use|schedule|log|file|forward)\b(?!\s+me\b)[^?\n]{0,60}[.!?]?$/i;
/** The staff member's latest message only asks t.ROY to act on what it already gave ("Send it now."). */
export const actionOnlyRequest = (said: string) => ACTION_ONLY.test(String(said ?? "").trim());
const RETRACTS = new RegExp([
  WITHDRAWS.source,
  String.raw`\bI (?:also |now )?(?:need|have|want) to correct\b`,
  String.raw`\b(?:didn['’]t|did not|doesn['’]t|does not|don['’]t|do not) (?:show|support|include|list|mention)\b`,
  String.raw`\bnot in (?:what|the records?|the results?) I (?:read|saw)\b`,
  String.raw`\b(?:send|use) it as written\b`,
  String.raw`\bcheck or remove\b`,
  String.raw`\bI added (?:details|facts|things|words)\b`,
  String.raw`\bsticks? to (?:that|what)\b`,
  String.raw`\b(?:safe|safer|corrected|revised|accurate) version\b`,
].join("|"), "i");
/** The answer up to its first sentence that corrects or rewrites the earlier one; the action line if nothing is left. */
export function withoutUngroundedRetraction(answer: string): string {
  const sentences = String(answer ?? "").split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const at = sentences.findIndex((x) => RETRACTS.test(x));
  if (at < 0) return answer;
  return sentences.slice(0, at).join(" ").trim() || STAFF_ACTION_ONLY_TEXT;
}

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
  // with the same first-person cut (review E3: this path used to skip every rule). Review F4: a read step
  // whose result was not ok (locked, refused, unchanged) wrote its words before that result and they stay
  // out; an ok read keeps them here (the original T2 case, a search answered in its own step), and the
  // output check still reads every name and figure against the evidence.
  const fromCards = cardWords(steps, clean);
  const readFailed = (s: Step) => isReadStep(s) && (s.toolResults ?? []).some((r) => status(r) !== "ok");
  const fromAny = [...new Set(steps.filter((s) => !readFailed(s)).map((s) => withoutCompletedClaims(withoutNudge(String(s.text ?? "")))).filter(Boolean))];
  const body = (fromCards.length ? fromCards : fromAny).join("\n\n");
  const nudged = keepNudge && (final.includes(LISTING_NUDGE_LINE) || steps.some((s) => String(s.text ?? "").includes(LISTING_NUDGE_LINE)));
  if (body) return nudged ? `${body}\n\n${LISTING_NUDGE_LINE}` : body;
  if (draftOffered(steps)) return STAFF_DRAFT_ONLY_TEXT;
  return toolsRan ? STAFF_TOOLS_NO_TEXT : TROY_EMPTY_REPLY;
}
