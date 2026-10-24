/**
 * AI phrasing for the hurdle plan (PURE pipeline; the model call is injected).
 *
 * The model gets only the person's own answers (picked labels and the words
 * they typed) and returns a short summary per hurdle, plus the record opening
 * and follow-up when the person gave record consent. It is told to add nothing.
 * Then stripUnsupported() removes any sentence that carries a fact the answers
 * do not hold, and the caller reports how many lines came out.
 *
 * Record detail (nodes marked sensitive) never reaches the model without the
 * record consent. Without it, the record hurdle is left out of the prompt and
 * its plan stays exactly as built from the answers.
 */

import { HURDLES, getNode, isHurdleId, type HurdleId } from "./graph";
import { stripUnsupported } from "./fact-check";
import { cleanText, reachedAnswers, type Answer, type PlannerState } from "./reducer";

export interface PhraseRequest {
  selected: HurdleId[];
  answers: Record<string, Answer>;
  recordConsent: boolean;
  targetJob?: string;
  strengths?: string[];
}

export interface Phrasing {
  summaries: Partial<Record<HurdleId, string>>;
  record?: { open: string; next: string };
}

export interface PhraseResult {
  status: "phrased" | "nothing_to_phrase";
  phrasing: Phrasing;
  /** Sentences the checker removed because the answers did not support them. */
  stripped: string[];
}

/** Parse an untrusted request body into a clean PhraseRequest, or null. */
export function readPhraseRequest(body: unknown): PhraseRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const selected = Array.isArray(b.selected) ? [...new Set(b.selected.filter(isHurdleId))] : [];
  if (!selected.length || selected.length > 11) return null;
  const answers: Record<string, Answer> = {};
  if (b.answers && typeof b.answers === "object") {
    for (const [id, raw] of Object.entries(b.answers as Record<string, unknown>).slice(0, 200)) {
      const node = getNode(id);
      if (!node || !raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      if (r.skipped === true) { answers[id] = { skipped: true }; continue; }
      if (node.kind === "text") { const t = cleanText(node, r.text); if (t) answers[id] = { text: t }; continue; }
      const ids = new Set((node.choices ?? []).map((c) => c.id));
      const choices = Array.isArray(r.choices) ? [...new Set(r.choices.filter((c): c is string => typeof c === "string" && ids.has(c)))] : [];
      if (choices.length) answers[id] = { choices: node.kind === "one" ? choices.slice(0, 1) : choices };
    }
  }
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
  return {
    selected, answers, recordConsent: b.recordConsent === true,
    targetJob: str(b.targetJob, 120) || undefined,
    strengths: Array.isArray(b.strengths) ? b.strengths.map((s) => str(s, 80)).filter(Boolean).slice(0, 6) : undefined,
  };
}

/** The answer lines the model may use, per hurdle, and the source text the checker trusts. */
export function phraseSources(req: PhraseRequest): { lines: Partial<Record<HurdleId, string[]>>; sources: string[]; hurdles: HurdleId[] } {
  const state: PlannerState = { phase: "done", selected: req.selected, answers: req.answers, cursor: null };
  const answers = reachedAnswers(state);
  const lines: Partial<Record<HurdleId, string[]>> = {};
  const sources: string[] = [];
  const hurdles = req.selected.filter((h) => h !== "not_sure" && (h !== "record" || req.recordConsent));
  for (const [id, a] of Object.entries(answers)) {
    const node = getNode(id)!;
    if (!hurdles.includes(node.hurdle) || a.skipped) continue;
    if (node.sensitive && !req.recordConsent) continue;
    const out = (lines[node.hurdle] ??= []);
    if (node.kind === "text") {
      if (a.text) { out.push(`${node.question} ${a.text}`); sources.push(a.text); }
      continue;
    }
    for (const c of node.choices ?? []) if (a.choices?.includes(c.id)) {
      out.push(`${node.question} ${c.label}`);
      sources.push(c.label, c.fact ?? "");
    }
  }
  if (req.targetJob) sources.push(req.targetJob);
  for (const s of req.strengths ?? []) sources.push(s);
  for (const h of hurdles) sources.push(HURDLES[h].label);
  return { lines, sources, hurdles: hurdles.filter((h) => (lines[h]?.length ?? 0) > 0) };
}

export function buildPhrasePrompt(req: PhraseRequest): { system: string; user: string; hurdles: HurdleId[]; sources: string[] } {
  const { lines, sources, hurdles } = phraseSources(req);
  const blocks = hurdles.map((h) => `HURDLE ${h} (${HURDLES[h].label}):\n${(lines[h] ?? []).map((l) => `- ${l}`).join("\n")}`);
  const wantRecord = hurdles.includes("record");
  const system = `You put a job seeker's own answers into plain, warm sentences for their private plan. You are a careful writer, not an advisor.

RULES:
- Use ONLY what is in their answers. Add no fact: no number, name, place, employer, program, date, diagnosis, outcome or claim they did not give.
- Never say a hurdle is solved, handled, resolved or in place unless their answer says exactly that. If something is not sure, say it is still open.
- Never label the person. Never guess their feelings or motives.
- No legal statements. No promises about what an employer will do.
- Second person ("you"), 6th grade reading level, two or three short sentences per summary.
- Never use a dash as punctuation (no em dash, no "--"). No emojis.
- Return JSON only.`;
  const shape = `{"summaries": {${hurdles.map((h) => `"${h}": "..."`).join(", ")}}${wantRecord ? `, "record": {"open": "what they could say first, in their own words, under 25 words", "next": "what they could say if asked more, under 30 words"}` : ""}}`;
  const user = `${req.targetJob ? `TARGET JOB: ${req.targetJob}\n` : ""}${req.strengths?.length ? `STRENGTHS THEY CONFIRMED: ${req.strengths.join("; ")}\n` : ""}
THEIR ANSWERS:
${blocks.join("\n\n")}

${wantRecord ? "For the record, write the opening and the follow-up as the person would say them, first person, built only from their own words above. If they gave no words, keep it to a plain sentence with no details.\n\n" : ""}Return exactly this JSON shape:
${shape}`;
  return { system, user, hurdles, sources };
}

function plainDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ", ").replace(/\s+--\s+/g, ", ");
}

/** Parse and check the model's reply. Unparseable output phrases nothing. */
export function checkPhraseReply(raw: string, hurdles: HurdleId[], sources: string[]): PhraseResult {
  const stripped: string[] = [];
  const phrasing: Phrasing = { summaries: {} };
  const m = typeof raw === "string" ? raw.match(/\{[\s\S]*\}/) : null;
  let parsed: any = null;
  try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
  if (!parsed || typeof parsed !== "object") throw new Error("unparseable");
  const take = (v: unknown, max: number): string => {
    if (typeof v !== "string") return "";
    const r = stripUnsupported(plainDashes(v).slice(0, max), sources);
    stripped.push(...r.stripped);
    return r.text;
  };
  for (const h of hurdles) {
    const t = take(parsed.summaries?.[h], 600);
    if (t) phrasing.summaries[h] = t;
  }
  if (hurdles.includes("record") && parsed.record && typeof parsed.record === "object") {
    const open = take(parsed.record.open, 300), next = take(parsed.record.next, 400);
    if (open || next) phrasing.record = { open, next };
  }
  return { status: "phrased", phrasing, stripped };
}

/** The whole pipeline with the model call injected (the route and the tests both use it). */
export async function phraseHurdlePlan(req: PhraseRequest, callModel: (system: string, user: string) => Promise<string>): Promise<PhraseResult> {
  const prompt = buildPhrasePrompt(req);
  if (!prompt.hurdles.length) return { status: "nothing_to_phrase", phrasing: { summaries: {} }, stripped: [] };
  const raw = await callModel(prompt.system, prompt.user);
  return checkPhraseReply(raw, prompt.hurdles, prompt.sources);
}

/** MOCK_AI reply: built only from the answers, so it always passes the checker. */
export function mockPhraseReply(req: PhraseRequest): string {
  const { lines, hurdles } = phraseSources(req);
  const summaries: Record<string, string> = {};
  for (const h of hurdles) {
    const facts = (lines[h] ?? []).slice(0, 2).map((l) => l.replace(/^.*\?\s*/, ""));
    summaries[h] = `You picked: ${facts.join(", ")}.`;
  }
  const own = req.answers["record.own_words"]?.text;
  return JSON.stringify({ summaries, ...(hurdles.includes("record") ? { record: { open: own ?? "I have a record.", next: req.answers["record.now_words"]?.text ?? "" } } : {}) });
}
