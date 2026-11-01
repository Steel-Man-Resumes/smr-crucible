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
// Review T3: only with where the person went; "Jean was invited to interview at STS" is a read report.
const PERSON_ADDED = String.raw`\b${NAME}\s+(?:has been|was|is now)\s+(?:added|invited)${WHERE_ADDED}`;
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
 * The final step takes back what came before it: nothing earlier is shown (review E5). Reviews F3, G1,
 * R4, R5, S5, T2 (2026-11-01): a withdrawal has to name a DRAFT ("discard that draft", "both drafts",
 * "neither draft", "don't send the earlier draft", "use the corrected draft"), or correct the whole answer
 * ("I need to correct my answer", "correction:"). Drafting prose about other things stays: "drop them off
 * at the STS front desk", "delete the old version of his resume", "skip the first one", "tell him to
 * ignore any texts", "please do not send this draft until you have reviewed it".
 */
const SUPERSEDED = String.raw`(?:earlier|previous|prior|above|first|old|original)`;
const VERB = String.raw`(?:discard|disregard|ignore|scrap|delete|remove|drop|skip|throw out|do not use|don['’]t use|do not place|don['’]t place|do not put|don['’]t put|do not go with|don['’]t go with)`;
const WHICH = String.raw`(?:that|the|this|my|your|second|third|last|latest|later|revised|new|two|three|${SUPERSEDED})`;
const WITHDRAWS = new RegExp([
  String.raw`\b${VERB}\s+(?:(?:${WHICH})(?:\s+and)?\s+)*drafts?\b(?!\s+(?:off|at|by)\b)`,
  String.raw`\b${VERB}\s+(?:both|all|either)(?:\s+of)?(?:\s+(?:the|my|these|those))?(?:\s+two)?\s+drafts?\b`,
  String.raw`\b(?:do not send|don['’]t send|never send)\s+(?:(?:that|the|this|my)\s+)*${SUPERSEDED}\s+(?:drafts?|answer|reply)\b`,
  String.raw`\b(?:that|the|this|my|${SUPERSEDED})\s+(?:drafts?|answer|reply)\s+(?:was|is|were|are)\s+(?:wrong|incorrect|mistaken|not right)\b`,
  String.raw`\b(?:disregard|ignore|scrap)\s+(?:my\s+)?(?:previous|earlier|last)\s+(?:answer|reply)\b`,
  // Review U1: "that version is wrong", "scrap this one", "don't send this one", "ignore that check-in",
  // "don't use it:" (not "don't send it until you have checked the date").
  String.raw`\b(?:that|this)\s+(?:one|version|check-in)\s+(?:was|is)\s+(?:wrong|incorrect|mistaken|not right)\b`,
  String.raw`\b(?:${VERB}|do not send|don['’]t send)\s+(?:this|that)\s+(?:one|version|check-in)\b(?!\s+(?:off|at|by|until|yet|before)\b)`,
  String.raw`\b(?:do not|don['’]t)\s+(?:use|send)\s+it\b(?!\s+(?:until|yet|before|without)\b)(?=\s*[:;.,])`,
  String.raw`\bneither\s+draft\b|\bneither of (?:the|my|these|those) drafts\b|\bnone of (?:the|these|those|my) drafts\b`,
  String.raw`\buse (?:this|the) (?:replacement|(?:corrected|revised|new) (?:draft|one))\b`,
  String.raw`\b(?:I (?:also )?(?:need|have) to|let me) correct\b`,
  String.raw`\bcorrection:`,
  String.raw`\bI was wrong\b`,
  String.raw`\bI (?:must|should) take (?:that|this) back\b`,
].join("|"), "i");
export const finalWithdraws = (final: string) => WITHDRAWS.test(final);

/**
 * With two or more drafts in one turn, any wording that chooses between them or takes one back means no
 * card at all (review T1, after four rounds of a clause reader that kept a withdrawn card on "use the
 * second draft, not the first", "don't discard the first draft, discard the second", "go with the second
 * one"). The route says so in one line. One turn with two offers is rare; a wrong card is an action.
 */
const CHOOSES = /\b(?:forget|never mind|scratch|mistake\w*|(?:one|draft|version) is better|error|discard\w*|disregard\w*|ignor\w*|scrap\w*|delet\w*|remov\w*|drop\w*|skip\w*|throw out|replac\w*|instead|not the|go with|only the|use the|use this|keep the|keep this|don['’]t use|do not use|don['’]t send|do not send|wrong|incorrect|mistaken|correct\w*|stands|take (?:it|that|this) back|changed my mind|revised|replacement)\b/i;
export const draftChoiceWithdrawn = (drafts: number, text: string) => drafts >= 2 && (CHOOSES.test(String(text ?? "")) || WITHDRAWS.test(String(text ?? "")));
// Review U4: says only what is true (it also fires on ordinary two-draft prose like "change the sign-off").
export const STAFF_DRAFTS_WITHDRAWN_NOTICE = "\n\n_No draft card this time. Ask for the draft again._";

/**
 * The drafts the staff member may act on once the answer has spoken (reviews F5, G1, R4, S3, T1). Two or
 * more offers: every one, unless the answer chooses between them or takes one back, then none. One offer:
 * it stays unless the answer takes back a draft; a rewrite turn ("use this revised draft", "discard the
 * earlier draft; use this replacement") keeps it, because what it replaces is from an earlier turn, and
 * a take-back of "that draft" or "this draft" with nothing kept removes it.
 */
export function draftsAfterFinal<T>(drafts: readonly T[], finalText: string): T[] {
  const final = String(finalText ?? "");
  if (drafts.length === 0) return [];
  if (drafts.length >= 2) return draftChoiceWithdrawn(drafts.length, final) ? [] : [...drafts];
  if (!finalWithdraws(final)) return [...drafts];
  const keeps = /\buse (?:this|the) (?:replacement|(?:corrected|revised|new) (?:draft|one))\b|\bhere(?: is|['’]s) the (?:corrected|revised|new|replacement)\b/i.test(final);
  const backNotEarlier = final.split(/(?<=[.!?;:])\s+|;/).some((c) => WITHDRAWS.test(c) && !new RegExp(String.raw`\b(?:${SUPERSEDED}|initial)\s+(?:drafts?|answer|reply)\b|(?<!(?:don['’]t|do not|never)\s)\b(?:use|here)\b`, "i").test(c));
  return keeps && !backNotEarlier ? [...drafts] : [];
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
  if (t.length > 120 || t.includes("\u0000")) return false;
  // Review T4: "Send it to Suicide Hotline" / "to Legal Aid Society" is not a person on their list.
  if ((t.match(TO_NAME) ?? []).some((n) => /\b(?:suicid\w*|hotline|crisis|legal|aid|law|lawyer|court|police|jail|hospital|shelter|hurt|kill|die|danger|emergency|defender|officer|victim\w*|probation|parole)\b/i.test(n))) return false;
  return ACTION_ONLY.test(t.replace(TO_NAME, "\u0000"));
};
const RETRACTS = new RegExp([
  WITHDRAWS.source,
  String.raw`\bI (?:also |now )?(?:need|have|want) to correct\b`,
  String.raw`\b(?:didn['’]t|did not|doesn['’]t|does not|don['’]t|do not) (?:show|support|include|list|mention)\b`,
  // Preview J r3 (2026-11-01): "One correction to my last answer:", "didn't come from the lookup", "The
  // lookup showed only ...". Tied to the earlier answer or the lookup (pre-merge review F4): "Department of
  // Corrections", "Jean has only a landline", "check the details on his page" are ordinary replies.
  String.raw`\bcorrections? (?:to|on|about|in) (?:my|the) (?:last|earlier|previous|first) (?:answer|reply|draft|message)\b`,
  String.raw`\b(?:didn['’]t|did not|doesn['’]t|does not) (?:come from|say|contain) (?:the|my|that) (?:lookup|read|records?|results?)\b|\b(?:the|my) (?:lookup|read|records?|results?) (?:didn['’]t|did not|doesn['’]t|does not) (?:say|show|support|include|list|mention|contain)\b`,
  String.raw`\b(?:the|my) (?:lookup|read|records?|results?) (?:showed|shows|had|has|returned) only\b`,
  String.raw`\bnot in (?:what|the records?|the results?) I (?:read|saw)\b`,
  String.raw`\b(?:send|use) it as written\b`,
  String.raw`\bcheck or remove\b`,
  String.raw`\bI added (?:details|facts|things|words)\b`,
  String.raw`\bsticks? to (?:that|what)\b`,
  String.raw`\b(?:safe|safer|corrected|revised|accurate) version\b`,
].join("|"), "i");
/** The fixed safety and legal-help lines: always kept, even inside a cut (review R1). */
// Review T5: a risk sentence the model wrote ("He may be at risk tonight, so call him first") stays too.
const SAFETY_LINE = /\b911\b|\b988\b|\b211\b|safety protocol|legal-aid directory|\b(?:at risk|in danger|unsafe|crisis|harm|hurt|suicid\w*|overdos\w*|threat\w*)\b/i;
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

/**
 * Card-step words that say the final answer again (preview H, TRAP-NUMBER-03, 2026-11-01: the model wrote
 * "Marqus's hourly wage is not on file for me..." in the button step and again, reworded, in the final,
 * and both were shown). Sentence by sentence (pre-merge review F3): a card-step sentence is dropped only
 * when the final already says it (same words, or nearly all its words in one final sentence with every
 * number and capitalised word there too). Any sentence with a fact the final lacks stays.
 */
const wordsOf = (t: string) => (t.toLowerCase().match(/[a-z0-9']+/g) ?? []);
const sentencesOf = (t: string) => t.split(/\n+|(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
const keyTokens = (t: string) => (t.match(/\b(?:\d[\d:/.,-]*|[A-Z][A-Za-z'’-]+)\b/g) ?? []).map((x) => x.toLowerCase()).filter((x) => !["i", "the", "a", "an", "if", "your", "here", "this", "that", "you", "it", "he", "she", "they"].includes(x));
function sentenceRepeated(sentence: string, finalSentences: string[], finalText: string): boolean {
  const a = wordsOf(sentence);
  // A label or a sign-off ("Email", "Lupe") is not a repeat, even when the final contains the word.
  if (a.length < 4) return false;
  if (finalText.includes(sentence)) return true;
  const keys = keyTokens(sentence);
  // A negation the final sentence does not share (or the reverse) is a different claim, never a repeat.
  const negated = (t: string) => /\b(?:not|no|never|none|nothing|nobody|without)\b|n['’]t\b/i.test(t);
  return finalSentences.some((f) => {
    if (negated(sentence) !== negated(f)) return false;
    const b = new Set(wordsOf(f));
    const fKeys = new Set(keyTokens(f));
    return a.filter((w) => b.has(w)).length / a.length >= 0.8 && keys.every((k) => fKeys.has(k));
  });
}
/** The card-step text with the sentences the final already says removed ("" when all of it repeats). */
export function withoutFinalRepeats(text: string, final: string): string {
  if (final.includes(text.trim())) return "";
  const finals = sentencesOf(final);
  // Line by line, so a draft's line breaks survive when nothing in it repeats.
  return text.split("\n").map((line) => line.split(/(?<=[.!?])\s+/).filter((x) => !x.trim() || !sentenceRepeated(x.trim(), finals, final)).join(" "))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
export const repeatsFinal = (text: string, final: string) => withoutFinalRepeats(text, final) === "";

export function staffAnswerText(steps: readonly Step[], finalText: string): string {
  const keepNudge = nudgeOk(steps);
  const clean = (s: string) => (keepNudge ? s : withoutNudge(s).replace(/[ \t]{2,}/g, " ").trim());
  const final = clean(String(finalText ?? "").trim());
  const toolsRan = steps.some((s) => (s.toolCalls?.length ?? 0) > 0);
  if (withoutNudge(final)) {
    const kept = finalWithdraws(final) ? [] : cardWords(steps, clean).map((t) => withoutFinalRepeats(t, final)).filter(Boolean);
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
