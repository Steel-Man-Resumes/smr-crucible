/**
 * AI wording for the hurdle plan (PURE pipeline; the model call is injected).
 *
 * The model gets only the person's own answers (picked labels and words they
 * typed) and returns a short "t.ROY's reading" per hurdle. It NEVER writes the
 * record opening or follow-up: those are the person's own words (DEC-46).
 * Each sentence is then checked against that hurdle's own answers only, and
 * any sentence with a fact the answers do not hold is removed and counted.
 *
 * Record content (record hurdle answers, and sensitive choices like "time
 * inside") goes to the model only when the server found the person's stored
 * record planner consent at the current version (route.ts sets recordConsent;
 * the request body cannot).
 */

import { HURDLES, getNode, isHurdleId, type HurdleId } from "./graph";
import { stripUnsupported } from "./fact-check";
import { activeHurdles, cleanText, reachedAnswers, type Answer } from "./reducer";

export interface PhraseRequest {
  selected: HurdleId[];
  answers: Record<string, Answer>;
  /** Set by the server from the stored consent, never from the request body. */
  recordConsent: boolean;
  targetJob?: string;
  strengths?: string[];
}

export interface Phrasing {
  summaries: Partial<Record<HurdleId, string>>;
}

export interface PhraseResult {
  status: "phrased" | "nothing_to_phrase";
  phrasing: Phrasing;
  stripped: string[];
}

/** Parse an untrusted request body into a clean PhraseRequest (consent off), or null. */
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
    selected, answers, recordConsent: false,
    targetJob: str(b.targetJob, 120) || undefined,
    strengths: Array.isArray(b.strengths) ? b.strengths.map((s) => str(s, 80)).filter(Boolean).slice(0, 6) : undefined,
  };
}

/** True when the request carries any record answer or sensitive choice. */
export function hasRecordContent(req: Pick<PhraseRequest, "answers">): boolean {
  for (const [id, a] of Object.entries(req.answers)) {
    const node = getNode(id);
    if (!node || a.skipped) continue;
    if (node.hurdle === "record" || node.sensitive) return true;
    if ((node.choices ?? []).some((c) => c.sensitive && a.choices?.includes(c.id))) return true;
  }
  return false;
}

/** The answer lines the model may use, per hurdle, and the per-hurdle source text the checker trusts. */
export function phraseSources(req: PhraseRequest): {
  lines: Partial<Record<HurdleId, string[]>>; picked: Partial<Record<HurdleId, string[]>>;
  sources: Partial<Record<HurdleId, string[]>>; hurdles: HurdleId[];
} {
  const answers = reachedAnswers({ selected: req.selected, answers: req.answers });
  const active = activeHurdles(req.selected, answers);
  const lines: Partial<Record<HurdleId, string[]>> = {};
  const picked: Partial<Record<HurdleId, string[]>> = {};
  const sources: Partial<Record<HurdleId, string[]>> = {};
  const allowed = active.filter((h) => h !== "not_sure" && (h !== "record" || req.recordConsent));
  const common = [req.targetJob ?? "", ...(req.strengths ?? [])];
  for (const [id, a] of Object.entries(answers)) {
    const node = getNode(id)!;
    const h = node.hurdle;
    if (!allowed.includes(h) || a.skipped) continue;
    if (node.sensitive && !req.recordConsent) continue;
    const out = (lines[h] ??= []), src = (sources[h] ??= [HURDLES[h].label, ...common]), pk = (picked[h] ??= []);
    if (node.kind === "text") {
      if (a.text) { out.push(`${node.question} ${a.text}`); pk.push(a.text); src.push(a.text); }
      continue;
    }
    for (const c of node.choices ?? []) if (a.choices?.includes(c.id)) {
      if (c.sensitive && !req.recordConsent) continue;
      out.push(`${node.question} ${c.label}`);
      pk.push(c.label);
      src.push(c.label, c.fact ?? "");
    }
  }
  return { lines, picked, sources, hurdles: allowed.filter((h) => (lines[h]?.length ?? 0) > 0) };
}

export function buildPhrasePrompt(req: PhraseRequest): { system: string; user: string; hurdles: HurdleId[]; sources: Partial<Record<HurdleId, string[]>> } {
  const { lines, sources, hurdles } = phraseSources(req);
  const blocks = hurdles.map((h) => `HURDLE ${h} (${HURDLES[h].label}):\n${(lines[h] ?? []).map((l) => `- ${l}`).join("\n")}`);
  const system = `You read a job seeker's own answers back to them in plain, warm sentences for their private plan. You are a careful writer, not an advisor.

RULES:
- Use ONLY what is in their answers for that hurdle. Add no fact: no number, name, place, employer, program, date, diagnosis, outcome or claim they did not give.
- Never say a hurdle is solved, handled, resolved or in place unless their answer says exactly that. If something is not sure, say it is still open.
- Never predict what will happen and never promise what an employer will do.
- Never write words for them to say. Never label the person. Never guess their feelings or motives.
- No legal statements.
- Second person ("you"), 6th grade reading level, two or three short sentences per hurdle.
- Never use a dash as punctuation (no em dash, no "--"). No emojis.
- Return JSON only.`;
  const user = `${req.targetJob ? `TARGET JOB: ${req.targetJob}\n` : ""}THEIR ANSWERS:
${blocks.join("\n\n")}

Return exactly this JSON shape:
{"summaries": {${hurdles.map((h) => `"${h}": "..."`).join(", ")}}}`;
  return { system, user, hurdles, sources };
}

function plainDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ", ").replace(/\s+--\s+/g, ", ");
}

/** Parse and check the model's reply against each hurdle's own answers. */
export function checkPhraseReply(raw: string, hurdles: HurdleId[], sources: Partial<Record<HurdleId, string[]>>): PhraseResult {
  const stripped: string[] = [];
  const phrasing: Phrasing = { summaries: {} };
  const m = typeof raw === "string" ? raw.match(/\{[\s\S]*\}/) : null;
  let parsed: any = null;
  try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
  if (!parsed || typeof parsed !== "object") throw new Error("unparseable");
  for (const h of hurdles) {
    const v = parsed.summaries?.[h];
    if (typeof v !== "string") continue;
    const r = stripUnsupported(plainDashes(v).slice(0, 600), sources[h] ?? []);
    stripped.push(...r.stripped);
    if (r.text) phrasing.summaries[h] = r.text;
  }
  return { status: "phrased", phrasing, stripped };
}

export async function phraseHurdlePlan(req: PhraseRequest, callModel: (system: string, user: string) => Promise<string>): Promise<PhraseResult> {
  const prompt = buildPhrasePrompt(req);
  if (!prompt.hurdles.length) return { status: "nothing_to_phrase", phrasing: { summaries: {} }, stripped: [] };
  const raw = await callModel(prompt.system, prompt.user);
  return checkPhraseReply(raw, prompt.hurdles, prompt.sources);
}

/** MOCK_AI reply: built only from the answers, so it always passes the checker. */
export function mockPhraseReply(req: PhraseRequest): string {
  const { picked, hurdles } = phraseSources(req);
  const summaries: Record<string, string> = {};
  for (const h of hurdles) summaries[h] = `You picked: ${(picked[h] ?? []).slice(0, 2).join(", ").replace(/[.!?]+$/, "")}.`;
  return JSON.stringify({ summaries });
}

/** The answers with every record answer and sensitive choice removed (what the page sends without consent). */
export function withoutRecordContent(answers: Record<string, Answer>): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const [id, a] of Object.entries(answers)) {
    const node = getNode(id);
    if (!node || node.hurdle === "record" || node.sensitive) continue;
    if (a.choices) {
      const keep = a.choices.filter((c) => !(node.choices ?? []).find((x) => x.id === c)?.sensitive);
      if (keep.length) out[id] = { choices: keep };
      continue;
    }
    out[id] = a;
  }
  return out;
}
