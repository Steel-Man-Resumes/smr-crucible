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
// Review R6: "I went ahead and opened his page" is a qualifier run too.
const FIRST_PERSON = String.raw`\bI(?:['’]ve| have|\s+(?:just|already|now|went ahead and|also))*\s+`;
// A name: up to three capitalised words, each with a lowercase letter after the capital (not "ID", "SSN"),
// "O’Neil" and "Jean-Luc" included. Each word is a fixed shape, so a long run of capitals or apostrophes
// is read once (timing check 2026-11-01: the looser [\w'’-]* was quadratic on 100k characters).
// Review R6: an inner capital is a name too (DeShawn, LaToya, McKenzie), still fixed-shape.
const NAME_WORD = String.raw`[A-Z](?:[a-z]+|['’][A-Z][a-z]+)(?:[A-Z][a-z]+)?(?:-[A-Z][a-z]+)?`;
const NAME = String.raw`(?:${NAME_WORD} ){0,2}${NAME_WORD}`;
const WHOSE = String.raw`(?:his|her|their|the|that|this|${NAME}['’]s)`;
const PAGE = String.raw`(?:participant\s+)?(?:page|profile|record|file|case notes)\b`;
const OPENED_PAGE = String.raw`(?:opened|navigated to|went to)\s+(?:${WHOSE}\s+)?(?:participant\s+)?(?:page|profile)\b`;
const PLACED_DRAFT = String.raw`(?:placed|put|saved|posted|added)\s+(?:it|(?:(?:the|this|that|your|a)\s+)?(?:draft|note|check-in|message))\s+(?:on|in|into|to)\s+(?:${WHOSE}\s+)?${PAGE}`;
// Review R6: "I sent the check-in to Jean." No tool sends, texts, emails or schedules anything.
const SENT_DRAFT = String.raw`(?:sent|texted|emailed|scheduled|mailed)\s+(?:it\b|(?:(?:the|this|that|your|a|my)\s+)?(?:draft|note|check-in|message|text|email)\b)`;
const PERSON_PRONOUN = String.raw`(?:him|her|them|the person|a person|the participant)\b`;
const WHERE_ADDED = String.raw`\s+(?:to|as|into|onto)\s+(?:(?:your|the|their|our|this|my|a|an)\s+)?(?:caseload|org|organi[sz]ation|team|people|roster|program|participants?|Refinery)\b`;
const ADDED_PERSON = String.raw`(?:(?:added|invited)\s+${PERSON_PRONOUN}|invited\s+${NAME}\b|added\s+${NAME}${WHERE_ADDED})`;
// Review R6: only a draft or check-in on a page or profile; "His last note is in his case notes" and
// "the message was in her file" are what a read found, not a completion claim.
const DRAFT_ON_PAGE = String.raw`\b(?:[Tt]he |[Tt]his |[Tt]hat |[Yy]our )?(?:draft|check-in)\s+(?:is|has been|was)\s+(?:now\s+)?(?:(?:placed|put|saved)\s+)?(?:on|in)\s+${WHOSE}\s+(?:participant\s+)?(?:page|profile)\b`;
const PAGE_OPENED = String.raw`\b(?:[Hh]is|[Hh]er|[Tt]heir|[Tt]he|${NAME}['’]s)\s+page\s+(?:is|has been|was)\s+(?:now\s+)?open(?:ed)?\b`;
const COMPLETED_CLAIM = new RegExp(`${FIRST_PERSON}(?:${OPENED_PAGE}|${PLACED_DRAFT}|${SENT_DRAFT}|${ADDED_PERSON})|${DRAFT_ON_PAGE}|${PAGE_OPENED}`);
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
// Which draft, after a withdrawal verb. Review R5: "any", "each" and "every" are out ("tell him to ignore
// any texts that ask for his SSN" is advice); "both"/"all"/"either" count only with draft words.
const WHICH = String.raw`(?:that|the|this|my|second|third|last|latest|later|revised|new|two|three|${SUPERSEDED})`;
const THING = String.raw`(?:draft|answer|version|message|text|reply|one)s?`;
const DRAFTS = String.raw`(?:drafts|versions|answers|ones)`;
const WITHDRAWS = new RegExp([
  // Review R4: delete, remove, drop, "do not place/put" are withdrawals too.
  String.raw`\b(?:discard|disregard|ignore|scrap|delete|remove|drop|do not use|don['’]t use|do not place|don['’]t place|do not put|don['’]t put)\s+(?:${WHICH}\s+)+${THING}\b`,
  String.raw`\b(?:discard|disregard|ignore|scrap|delete|remove|drop|do not use|don['’]t use|do not send|don['’]t send)\s+(?:both|all|either)(?:\s+of)?(?:\s+(?:the|my|these|those))?(?:\s+two)?\s+(?:draft|version|answer|one)s?\b`,
  String.raw`\b(?:discard|disregard|ignore|scrap|delete|remove|drop)\s+(?:both|them|them both)\b`,
  String.raw`\b(?:do not send|don['’]t send|never send)\s+(?:(?:that|the|this|my)\s+)*${SUPERSEDED}\s+${THING}\b`,
  String.raw`\b(?:that|the|this|my|${SUPERSEDED})\s+${THING}\s+(?:was|is|were|are)\s+(?:wrong|incorrect|mistaken|not right)\b`,
  // Review R5: "neither one has a phone on file" is not about the drafts.
  String.raw`\bneither\s+(?:draft|version)\b|\bneither of (?:the|my|these|those) (?:drafts|versions)\b`,
  String.raw`\bnone of (?:the|these|those|my) (?:drafts|versions)\b`,
  String.raw`\buse (?:this|the) (?:replacement|corrected|revised|new)\b`,
  String.raw`\b(?:I (?:also )?(?:need|have) to|let me) correct\b`,
  String.raw`\bcorrection:`,
  String.raw`\bI was wrong\b`,
  String.raw`\bI (?:must|should) take (?:that|this) back\b`,
].join("|"), "i");
export const finalWithdraws = (final: string) => WITHDRAWS.test(final);

// Per clause of the final: does it take something back or keep something, and which drafts does it name?
const TAKES_BACK = /\b(?:discard|disregard|ignore|scrap|drop|delete|do not use|don['’]t use|do not send|don['’]t send|never send|wrong|incorrect|mistaken|not right|neither|none of)\b/i;
const KEEPS = /\b(?:use|keep|send|place|put|stands|is right|is correct|go with)\b/i;
const NAMES_ALL = new RegExp(String.raw`\b(?:both|all|either|neither|none)\b(?:\s+(?:of\s+)?(?:the|my|these|those|them))?(?:\s+two)?\s*(?:${DRAFTS}|draft|version|one)?\b|\b(?:both|them)\s*[.!;]?$`, "i");
// Review R4: the ordinal has to name a draft ("the first draft", "the second one", "the first two drafts"),
// so "it lists his previous employer" names no draft.
const NAMES_EARLIER = new RegExp(String.raw`\b(?:${SUPERSEDED}|initial)\s+(?:(?:two|three)\s+)?${THING}\b|\bfirst two\b`, "i");
// A clause that KEEPS may name the draft by its ordinal alone ("use the first", "keep the second").
const KEEPS_EARLIER = new RegExp(String.raw`\b(?:${SUPERSEDED}|initial)\b`, "i");
const KEEPS_LATER = /\b(?:second|third|last|latest|later|revised|new|corrected|updated|replacement|this one)\b/i;
const NAMES_LATER = new RegExp(String.raw`\b(?:second|third|last|latest|later|revised|new|corrected|updated)\s+${THING}\b|\breplacement\b|\bthis one\b`, "i");

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
  let backUnnamed = false;
  // Review R5: "Discard the first draft and use the second one" is two clauses.
  for (const clause of final.split(/(?<=[.!?;:])\s+|\s*;\s*|,?\s+but\s+|,?\s+and\s+(?=(?:then\s+)?(?:use|keep|send|go with)\b)/i)) {
    if (TAKES_BACK.test(clause)) {
      if (NAMES_ALL.test(clause)) backAll = true;
      if (NAMES_EARLIER.test(clause)) backEarlier = true;
      if (NAMES_LATER.test(clause)) backLater = true;
      if (!NAMES_ALL.test(clause) && !NAMES_EARLIER.test(clause) && !NAMES_LATER.test(clause)) backUnnamed = true;
    } else if (KEEPS.test(clause)) {
      if (KEEPS_EARLIER.test(clause)) keepEarlier = true;
      if (KEEPS_LATER.test(clause)) keepLater = true;
    }
  }
  if (backAll || (backEarlier && backLater)) return [];
  // One offer this turn (review R5): a rewrite turn ("use this revised version") keeps it, because what it
  // replaces is from an earlier turn; any withdrawal that does not name an earlier draft removes it.
  if (drafts.length === 1) return keepLater && !backLater && !backUnnamed ? [...drafts] : [];
  // Two offers and the later one taken back: the first stays. With three or more, "the second" may not be
  // the last, so nothing stays.
  if (backLater) return drafts.length === 2 && !backUnnamed ? [drafts[0]] : [];
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
// Review R1: danger, crisis and legal words are never action-only: the model must answer those in full.
const NOT_ACTION_ONLY = /\b(?:check|correct|wrong|sure it|accurate|true|verify|confirm|fix|change|edit|update|but|danger|unsafe|hurt|harm|kill|suicid\w*|die|dead|end it|end his|end her|overdos\w*|weapon|gun|threat\w*|abuse\w*|crisis|emergency|police|arrest\w*|warrant|fired|legal|law|lawyer|attorney|court|rights?\s+(?:to|as)|can['’]t be|illegal|scared|afraid|safe)\b|\b(?:is|are|was)\s+(?:that|this|it)\s+right\b|\b(?:that|this|it)['’]s\s+right\b|\bright\s*\?|911|988/i;
// Review R7: the usual ways to say yes before "send it".
const LEAD_IN = String.raw`(?:(?:ok(?:ay)?|yes|yeah|yep|sure|great|thanks|thank you|good|perfect|cool|alright|all right|looks good|sounds good|go ahead|that works|nice|love it)[,.!]*\s+)*`;
const ACTION_ONLY = new RegExp(String.raw`^${LEAD_IN}(?:please\s+)?(?:(?:go ahead and|can you|could you|would you|just)\s+)?(?:send|text|email|put|place|post|save|copy|use|schedule|log|file|forward)\b(?!\s+me\b)[^?\n]{0,60}[.!?]?$`, "i");
/** The staff member's latest message only asks t.ROY to act on what it already gave ("Send it now."). */
export const actionOnlyRequest = (said: string) => {
  const t = String(said ?? "").trim();
  return !NOT_ACTION_ONLY.test(t) && ACTION_ONLY.test(t);
};
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
/** Sentences that always stay: the safety and legal-help lines, and the human step (review R1, R8). */
const ALWAYS_KEEP = /\b911\b|\b988\b|\b211\b|safety protocol|legal help|legal-aid|in danger|send it yourself|mark it sent|log the contact/i;
/**
 * The answer up to its first sentence that corrects or rewrites the earlier one, line breaks kept, plus
 * any later safety, legal-help or human-step sentence; the action line if nothing is left.
 */
export function withoutUngroundedRetraction(answer: string): string {
  const text = String(answer ?? "");
  let cut = false, changed = false;
  const lines = text.split("\n").map((line) => line.split(/(?<=[.!?])\s+/).filter((sentence) => {
    if (!sentence.trim()) return true;
    if (!cut && RETRACTS.test(sentence) && !ALWAYS_KEEP.test(sentence)) cut = true;
    const keep = !cut || ALWAYS_KEEP.test(sentence);
    if (!keep) changed = true;
    return keep;
  }).join(" "));
  if (!changed) return answer;
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out || STAFF_ACTION_ONLY_TEXT;
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
