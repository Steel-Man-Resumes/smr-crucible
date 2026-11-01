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
// Review R6: "I went ahead and opened his page" is a qualifier run too; S8: "successfully".
const FIRST_PERSON = String.raw`\bI(?:['’]ve| have|\s+(?:just|already|now|went ahead and|also|successfully))*\s+`;
// A name: up to three capitalised words, each with a lowercase letter after the capital (not "ID", "SSN"),
// "O’Neil", "Jean-Luc", DeShawn and McKenzie (review R6), Ángel (review S8). Each word is a fixed
// shape, so a long run of capitals or apostrophes is read once (timing check 2026-11-01).
const NAME_WORD = String.raw`\p{Lu}(?:\p{Ll}+|['’]\p{Lu}\p{Ll}+)(?:\p{Lu}\p{Ll}+)?(?:-\p{Lu}\p{Ll}+)?`;
const NAME = String.raw`(?:${NAME_WORD} ){0,2}${NAME_WORD}`;
const WHOSE = String.raw`(?:his|her|their|the|that|this|${NAME}['’]s)`;
// Review S8: a record, file or case notes is someone's ("in his record"); "the record format your org
// uses" is not a destination.
const PAGE = String.raw`(?:(?:the\s+|that\s+|this\s+)?(?:participant\s+)?(?:page|profile)\b|(?:his|her|their|${NAME}['’]s)\s+(?:record|file|case notes)\b)`;
const OPENED_PAGE = String.raw`(?:opened|navigated to|went to|pulled up|brought up)\s+(?:${WHOSE}\s+)?(?:participant\s+)?(?:page|profile)\b`;
const PLACED_DRAFT = String.raw`(?:placed|put|saved|posted|added)\s+(?:it|(?:(?:the|this|that|your|a)\s+)?(?:draft|note|check-in|message))\s+(?:on|in|into|to)\s+(?:(?:his|her|their|${NAME}['’]s)\s+)?${PAGE}`;
// Review R6/S4: "I sent the check-in to Jean." Only the card's own thing (the draft, the check-in, it):
// "Hi Jean, I sent a message to STS about your ID" is a staff member's line inside a draft.
const SENT_DRAFT = String.raw`(?:sent|texted|emailed|scheduled|mailed)\s+(?:it\b|(?:(?:the|this|that|your)\s+)(?:draft|check-in)\b)`;
const PERSON_PRONOUN = String.raw`(?:him|her|them|the person|a person|the participant)\b`;
// Review S8: "I added Housing to the program list in the draft" is drafting; a list or section is no destination.
const WHERE_ADDED = String.raw`\s+(?:to|as|into|onto)\s+(?:(?:your|the|their|our|this|my|a|an)\s+)?(?:caseload|org|organi[sz]ation|team|people|roster|participants?|Refinery)\b(?!\s+(?:list|section|line|field|name))`;
// Review S8: "Jean has been added to your caseload."
const PERSON_ADDED = String.raw`\b${NAME}\s+(?:has been|was|is now)\s+(?:added|invited)\b`;
const ADDED_PERSON = String.raw`(?:(?:added|invited)\s+${PERSON_PRONOUN}|invited\s+${NAME}\b|added\s+${NAME}${WHERE_ADDED})`;
// Reviews R6/S4: a draft, check-in, note or message "now on" a page or profile is a completion claim;
// "His last note is in his case notes" and "the message was in her file" are what a read found.
// Review S8: a note or message needs "now" or a placing verb ("A note is on his page from Oct 24" is a read).
const DRAFT_ON_PAGE = String.raw`\b(?:[Tt]he |[Tt]his |[Tt]hat |[Yy]our )?(?:(?:draft|check-in)\s+(?:is|has been|was)\s+(?:now\s+)?(?:(?:placed|put|saved)\s+)?|(?:note|message)\s+(?:is now|has been (?:placed|put|saved)|was (?:placed|put|saved))\s+)(?:on|in)\s+${WHOSE}\s+(?:participant\s+)?(?:page|profile)\b`;
const PAGE_OPENED = String.raw`\b(?:[Hh]is|[Hh]er|[Tt]heir|[Tt]he|${NAME}['’]s)\s+page\s+(?:is|has been|was)\s+(?:now\s+)?open(?:ed)?\b`;
const COMPLETED_CLAIM = new RegExp(`${FIRST_PERSON}(?:${OPENED_PAGE}|${PLACED_DRAFT}|${SENT_DRAFT}|${ADDED_PERSON})|${DRAFT_ON_PAGE}|${PAGE_OPENED}|${PERSON_ADDED}`, "u");
export function withoutCompletedClaims(text: string): string {
  return text
    .split(/\n/)
    .map((line) => line.split(/(?<=[.!?])\s+/).filter((sentence) => !COMPLETED_CLAIM.test(sentence)).join(" "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The final step takes back what came before it: nothing earlier is shown (review E5), and the cards read
 * the same words (draftsAfterFinal). Reviews F3, G1, R4, R5, S5 (2026-11-01). A withdrawal has to name
 * a DRAFT: the verb's object is "draft" or "version" ("discard that draft", "delete the earlier version",
 * "neither draft", "both drafts"), or "one" with an order word ("the second one", "this one"). Drafting
 * prose about other things stays: "drop them off at the STS front desk", "delete the old text with his
 * SSN", "ignore the previous message from the clinic", "remove the old one", "tell him to ignore any
 * texts". Whole-answer corrections count too ("I need to correct my answer", "correction:"). Still a
 * heuristic: when it is unsure which draft, draftsAfterFinal shows no card.
 */
const SUPERSEDED = String.raw`(?:earlier|previous|prior|above|first|old|original)`;
const DRAFT_WORD = String.raw`(?:draft|version)s?`;
const VERB = String.raw`(?:discard|disregard|ignore|scrap|delete|remove|drop|skip|throw out|do not use|don['’]t use|do not place|don['’]t place|do not put|don['’]t put|do not go with|don['’]t go with)`;
// "Do not send" withdraws only with a supersession word: "do not send this draft until you have reviewed
// it" is an instruction (review F3), "don't send the earlier draft" is a withdrawal.
const SEND_BACK = String.raw`\b(?:do not send|don['’]t send|never send)\s+(?:(?:that|the|this|my)\s+)*${SUPERSEDED}\s+(?:${DRAFT_WORD}|ones?|answer|reply)\b`;
const ORD_ONE = String.raw`(?:first|second|third|last|latest|later|earlier|previous|revised|new|corrected|this|that|other)\s+one`;
const WHICH = String.raw`(?:that|the|this|my|your|second|third|last|latest|later|revised|new|two|three|${SUPERSEDED})`;
const WITHDRAWS = new RegExp([
  // "drop the first one off at STS" is about an ID, not a draft.
  String.raw`\b${VERB}\s+(?:(?:${WHICH})(?:\s+and)?\s+)*(?:${DRAFT_WORD}|${ORD_ONE})\b(?!\s+(?:off|at|by)\b)`,
  // Review S8: "Only the second draft is right" takes back the others.
  String.raw`\bonly the (?:first|second|third|last|latest|revised|new|corrected)\s+(?:${DRAFT_WORD}|one)\s+is\s+(?:right|correct|good|the one)\b`,
  SEND_BACK,
  String.raw`\b${VERB}\s+(?:both|all|either)(?:\s+of)?(?:\s+(?:the|my|these|those))?(?:\s+two)?\s+(?:${DRAFT_WORD}|ones?)\b`,
  String.raw`\b(?:that|the|this|my|${SUPERSEDED})\s+(?:${DRAFT_WORD}|answer|reply)\s+(?:was|is|were|are)\s+(?:wrong|incorrect|mistaken|not right)\b`,
  String.raw`\b(?:disregard|ignore|scrap)\s+(?:my\s+)?(?:previous|earlier|last)\s+(?:answer|reply)\b`,
  String.raw`\bneither\s+(?:draft|version)\b|\bneither of (?:the|my|these|those) (?:drafts|versions)\b`,
  String.raw`\bnone of (?:the|these|those|my) (?:drafts|versions)\b`,
  String.raw`\buse (?:this|the) (?:replacement|corrected|revised|new)\b`,
  String.raw`\b(?:I (?:also )?(?:need|have) to|let me) correct\b`,
  String.raw`\bcorrection:`,
  String.raw`\bI was wrong\b`,
  String.raw`\bI (?:must|should) take (?:that|this) back\b`,
].join("|"), "i");
export const finalWithdraws = (final: string) => WITHDRAWS.test(final);

// Per clause: does it take a draft back or keep one, and which drafts does it name?
const NEGATED_BACK = new RegExp(String.raw`\b(?:don['’]t|do not|never)\s+(?:discard|disregard|ignore|scrap|delete|remove|drop|skip|throw out)\b`, "i");
const TAKES_BACK = new RegExp(String.raw`\b${VERB}\b|${SEND_BACK}|\b(?:wrong|incorrect|mistaken|not right|neither|none of)\b`, "i");
const KEEPS = /\b(?:use|keep|send|place|put|stands|is right|is correct|go with|here is|here['’]s)\b/i;
const NAMES_ALL = new RegExp(String.raw`\b(?:both|all|either|neither|none)\b(?:\s+(?:of\s+)?(?:the|my|these|those|them))?(?:\s+two)?\s*(?:${DRAFT_WORD}|ones?)?\b|\b(?:both|them)\s*[.!;]?$`, "i");
// Review R4: the order word has to name a draft ("the first draft", "the second one", "the first two drafts").
const NAMES_EARLIER = new RegExp(String.raw`\b(?:${SUPERSEDED}|initial)\s+(?:(?:two|three)\s+)?(?:${DRAFT_WORD}|ones?)\b|\bfirst (?:two|and)\b`, "i");
const NAMES_LATER = new RegExp(String.raw`\b(?:second|third|last|latest|later|revised|new|corrected|updated)\s+(?:${DRAFT_WORD}|one)\b|\breplacement\b|\bthis one\b`, "i");
// A clause that KEEPS may name the draft by its order word alone ("use the first", "keep the second").
const KEEPS_EARLIER = new RegExp(String.raw`\b(?:${SUPERSEDED}|initial)\b`, "i");
const KEEPS_LATER = /\b(?:second|third|last|latest|later|revised|new|corrected|updated|replacement|this one)\b/i;
// Clauses: sentences, ";", ", but", and "and use/keep". Each split starts at the first space of a run
// (review S6: "\s*;\s*" and ",?\s+but" rescanned every space and were quadratic at 50k characters).
function clauses(text: string): string[] {
  return text.split(";")
    .flatMap((c) => c.split(/(?<=[.!?:])\s+/))
    // Review S8: "use the second draft and ignore the other one", "..., use the last one" split too.
    .flatMap((c) => c.split(/(?:,\s*|(?<!\s)\s+)(?:but\s+|and\s+(?=(?:then\s+)?(?:use|keep|send|go with|discard|disregard|ignore|scrap|delete|remove|drop|skip)\b))|,\s*(?=(?:then\s+)?(?:use|keep|go with)\b)/i))
    .map((c) => c.trim()).filter(Boolean);
}

/**
 * The drafts the staff member may act on once the answer has spoken (reviews F5, G1, R4, S3). A draft is
 * a card only if the answer did not take it back. Clause by clause: "discard both" / "neither draft" takes
 * back every draft; "discard the earlier draft" all but the last; "discard the revised draft" the last;
 * "don't discard the first draft" keeps it. A take-back that names no draft ("that one is wrong too")
 * leaves no card unless a clause keeps the later one ("use this replacement"). One offer stays when the
 * answer keeps it as the rewrite of an earlier turn's draft. Anything unclear leaves no card: a missing
 * card costs a retype, a wrong one an action.
 */
export function draftsAfterFinal<T>(drafts: readonly T[], finalText: string): T[] {
  const final = String(finalText ?? "");
  if (!finalWithdraws(final)) return [...drafts];
  if (drafts.length === 0) return [];
  let backAll = false, backEarlier = false, backLater = false, backUnnamed = false, keepEarlier = false, keepLater = false;
  for (const clause of clauses(final)) {
    if (TAKES_BACK.test(clause) && !NEGATED_BACK.test(clause)) {
      const all = NAMES_ALL.test(clause), earlier = NAMES_EARLIER.test(clause), later = NAMES_LATER.test(clause);
      if (all) backAll = true;
      if (earlier) backEarlier = true;
      if (later) backLater = true;
      if (!all && !earlier && !later) backUnnamed = true;
    } else if (KEEPS.test(clause) || NEGATED_BACK.test(clause)) {
      if (KEEPS_EARLIER.test(clause)) keepEarlier = true;
      if (KEEPS_LATER.test(clause)) keepLater = true;
    }
  }
  if (backAll || (backEarlier && backLater)) return [];
  if (drafts.length === 1) return keepLater && !backLater && !backUnnamed ? [...drafts] : [];
  // Two offers and the later one taken back, or the first kept and something unnamed taken back: the first.
  if (drafts.length === 2 && !backEarlier && ((backLater && !backUnnamed) || (keepEarlier && !keepLater && (backLater || backUnnamed)))) return [drafts[0]];
  if (backLater) return [];
  if (backUnnamed && !keepLater) return [];
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
// Reviews R1, S1, S7: action-only is a CLOSED shape, not a list of words to avoid. A yes, a verb, the thing
// already given (it, that, the draft), and at most a short tail (to a name or pronoun, now, on their page).
// "Send it, he said he wants to take his life." and "Text him that he can't be fired" have words beyond
// that shape, so they are never action-only and the model's whole answer stands.
const LEAD_IN = String.raw`(?:(?:ok(?:ay)?|yes|yeah|yep|sure|great|thanks|thank you|good|perfect|cool|alright|all right|looks good|sounds good|go ahead|that works|nice|love it)[,.!]*\s+)*`;
const ACT_VERB = String.raw`(?:send|text|email|put|place|post|save|copy|use|schedule|log|forward)`;
const ACT_OBJECT = String.raw`(?:it|that|this|them|(?:the|that|this|my|your)\s+(?:draft|check-in|message|text|email|note|one))`;
const ACT_TAIL = String.raw`(?:to\s+(?:him|her|them|\u0000)|now|right now|today|please|for me|again|as is|over|out|on\s+(?:his|her|their|the)\s+page|to\s+(?:his|her|their)\s+page)`;
const ACTION_ONLY = new RegExp(String.raw`^${LEAD_IN}(?:please\s+)?(?:(?:go ahead and|can you|could you|would you|just)\s+)?${ACT_VERB}\s+${ACT_OBJECT}(?:,?\s+${ACT_TAIL}){0,3}\s*[.!?]?$`, "iu");
/** The staff member's latest message only asks t.ROY to act on what it already gave ("Send it now."). */
// A name in "to Valjean" is matched case-sensitively first (review S8: under the case-insensitive shape
// "to his lawyer" read as a name), then stands in as one marker the shape accepts.
const TO_NAME = new RegExp(String.raw`(?<=\bto\s+)${NAME}\b`, "gu");
export const actionOnlyRequest = (said: string) => {
  const t = String(said ?? "").trim();
  return t.length <= 120 && !t.includes("\u0000") && ACTION_ONLY.test(t.replace(TO_NAME, "\u0000"));
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
/** The fixed safety and legal-help lines: always kept, even inside a cut (review R1). */
const SAFETY_LINE = /\b911\b|\b988\b|\b211\b|safety protocol|legal-aid directory/i;
/** The human step ("send it yourself", "mark it sent"): kept after a cut, unless it is itself a retraction (review S2). */
const HUMAN_STEP = /send it yourself|mark it sent|log the contact/i;
/**
 * The answer up to its first sentence that corrects or rewrites the earlier one, line breaks kept, plus
 * any later safety line, and any later human-step sentence that takes nothing back; the action line if
 * nothing is left.
 */
export function withoutUngroundedRetraction(answer: string): string {
  const text = String(answer ?? "");
  let cut = false, changed = false;
  const lines = text.split("\n").map((line) => line.split(/(?<=[.!?])\s+/).filter((sentence) => {
    if (!sentence.trim()) return true;
    const retracts = RETRACTS.test(sentence);
    if (!cut && retracts && !SAFETY_LINE.test(sentence)) cut = true;
    const keep = !cut || SAFETY_LINE.test(sentence) || (HUMAN_STEP.test(sentence) && !retracts);
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
