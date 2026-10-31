/**
 * The staff answer's words, from every step of the model call (demo fix T2
 * round 3, live 923c517).
 *
 * THE BUG. generateText's `text` is the LAST step's text only (ai 4.3). When
 * the model wrote its answer in a step that also called a tool, and the last
 * step only added the listing nudge line ("Did this place still check out?
 * Called them lately?"), the staff member saw that line and its buttons and
 * no employers: the card's line stood in for the answer.
 *
 * THE RULE. Use the last step's words when they say something beyond the
 * nudge line. When they do not, put the earlier steps' words first and keep
 * the nudge line, if any, at the very end. When no step said anything and a
 * tool ran, say so plainly instead of showing only a card.
 */
import { LISTING_NUDGE_LINE } from "@crucible/core/src/staffRewardsShared";
import { TROY_EMPTY_REPLY } from "./ai/troy-chat";

export const STAFF_TOOLS_NO_TEXT = "I ran the search but have nothing to show yet. Ask again.";

const withoutNudge = (t: string) => t.split(LISTING_NUDGE_LINE).join("").trim();

type Step = { text?: string; toolCalls?: readonly unknown[]; toolResults?: readonly { toolName?: string; result?: unknown }[] };

const DRAFT_TOOL = "offer_staff_draft";
const calledDraft = (s: Step) => (s.toolCalls ?? []).some((c) => (c as { toolName?: string } | null)?.toolName === DRAFT_TOOL) || (s.toolResults ?? []).some((r) => r?.toolName === DRAFT_TOOL);
/** The body of every draft offered this turn (offer_staff_draft, status draft_only). */
function offeredDrafts(steps: readonly Step[]): string[] {
  const out: string[] = [];
  for (const s of steps) for (const r of s.toolResults ?? []) {
    const res = r?.result as { status?: unknown; body?: unknown } | null;
    if (r?.toolName === DRAFT_TOOL && res?.status === "draft_only" && typeof res.body === "string" && res.body.trim()) out.push(res.body.trim());
  }
  return [...new Set(out)];
}

/** The nudge line stays only when the nudge tool itself answered ok this turn (its buttons render then); otherwise it is cut (review R3 S2). */
function nudgeOk(steps: readonly Step[]): boolean {
  return steps.some((s) => (s.toolResults ?? []).some((r) => r?.toolName === "listing_check_nudge" && (r.result as { status?: unknown } | null)?.status === "ok"));
}

export function staffAnswerText(steps: readonly Step[], finalText: string): string {
  const keepNudge = nudgeOk(steps);
  const clean = (s: string) => (keepNudge ? s : withoutNudge(s).replace(/[ \t]{2,}/g, " ").trim());
  const final = clean(String(finalText ?? "").trim());
  const toolsRan = steps.some((s) => (s.toolCalls?.length ?? 0) > 0);
  if (withoutNudge(final)) {
    // Harness TRAP-ACT-02 (2026-10-31) and review C1/C2 (2026-11-01): the model wrote its drafts in
    // the step that called offer_staff_draft and closed with a short note; only the note reached
    // the staff member. Provenance decides what comes back, never length: the words of a step that
    // offered a draft are kept ahead of the final step, and a draft body the tool was given that no
    // text repeats is shown as the draft. Any other earlier step (a corrected claim, a working line)
    // stays dropped, so the last step's correction is never undone.
    const draftWords = [...new Set(steps.slice(0, -1).filter(calledDraft).map((s) => clean(String(s.text ?? ""))).filter((t) => t && !final.includes(t)))];
    const shown = `${draftWords.join("\n")}\n${final}`;
    const bodies = offeredDrafts(steps).filter((b) => !shown.includes(b));
    const draftBlock = bodies.map((b) => `Draft (unsaved, in this reply):\n\n${b}`).join("\n\n");
    return [...draftWords, draftBlock, final].filter(Boolean).join("\n\n");
  }
  const earlier = steps.map((s) => withoutNudge(String(s.text ?? ""))).filter(Boolean);
  // The last step's text is in steps too; it is nudge-only here, so it was dropped above.
  const body = [...new Set(earlier)].join("\n\n");
  const nudged = keepNudge && (final.includes(LISTING_NUDGE_LINE) || steps.some((s) => String(s.text ?? "").includes(LISTING_NUDGE_LINE)));
  if (body) return nudged ? `${body}\n\n${LISTING_NUDGE_LINE}` : body;
  return toolsRan ? STAFF_TOOLS_NO_TEXT : TROY_EMPTY_REPLY;
}
