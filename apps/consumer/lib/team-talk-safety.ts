/**
 * Team talk and the model (staff side lane S4). Comment bodies are
 * staff-written free text, like case-note bodies, and staff sometimes write a
 * record or supervision detail into them. Nothing in lane S4 sends a comment
 * to a model. Any t.ROY tool that ever reads comments (a summary of a
 * person's team talk, "what did Dana say about Jordan") must call this, so
 * record words are withheld whole, by the same gate as notes
 * (lib/staff-ai-safety.ts staffTextGate; staff record consent is always no).
 * Change-request text and replies go through the same function.
 */
import { staffTextGate, WITHHELD_NOTE } from "./staff-ai-safety";

export interface TalkForModel { author: string; at: string; body: string }

/** The comments a tool may show the model: author, time, and the gated body. Says when something was withheld. */
export function teamTalkForModel(comments: readonly { author_name: string | null; created_at: string; body: string }[]):
  { comments: TalkForModel[]; withheld: number; note: string | null } {
  const gate = staffTextGate();
  const out = comments.map((c) => ({ author: c.author_name?.trim() || "A teammate", at: c.created_at, body: gate.pass(c.body) }));
  return { comments: out, withheld: gate.withheld, note: gate.withheld ? WITHHELD_NOTE : null };
}
