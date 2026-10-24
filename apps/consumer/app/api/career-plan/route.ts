/**
 * The career planner (magnum B6): "I don't know what I want yet".
 *
 * GET  -> the person's own saved facts (Master Draft, Forge run), their place
 *         and their saved "still deciding" notes. Server rows only.
 * POST { answers } -> three directions.
 *
 * The plan is assembled in lib/career-plan/plan.ts. The model only ranks
 * three catalogue directions and attaches quotes; every quote is checked
 * against the facts and stripped if it is not there, with a visible note.
 * The model call runs through withRateLimit -> runAiOperation
 * (beginAiOperation admission, allowance and accounting) and callAI
 * (Anthropic first, OpenAI failover, `.find(b => b.type === "text")`).
 * Mock mode, no key, an allowance refusal or any failure falls back to the
 * same plan built by word matching, so a person is never left with nothing.
 */

import { NextResponse } from "next/server";
import { revisionCaller } from "@/lib/revision-route";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { withRateLimit } from "@/lib/withRateLimit";
import { isMockEnabled } from "@/lib/mock-ai";
import { callAI, AI_PROVIDER } from "@/lib/ai-call";
import { MODEL_CHAT } from "@/lib/ai/models";
import { plainPunctuation, logDashSwaps } from "@/lib/legal-sanitize";
import { readPlanAnswers } from "@/lib/career-plan/questions";
import { todayFacts } from "@/lib/career-plan/facts";
import { allowedDirections, assemblePlan, buildPlanPrompt, parseModelPlan, rankDirections, PLAN_SYSTEM, NO_AI_NOTE, ALLOWANCE_NOTE } from "@/lib/career-plan/plan";
import { loadCareerContext } from "@/lib/career-plan/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "Cache-Control": "no-store" };
const ENDPOINT = "career-plan";


export async function GET() {
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status, headers });
  try {
    const ctx = await loadCareerContext(caller.userId);
    return NextResponse.json(ctx, { headers });
  } catch {
    return NextResponse.json({ error: "Your saved work couldn't be loaded. Try again. Nothing was changed." }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Open this page from the Refinery." }, { status: 403, headers });
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status, headers });
  const raw = await request.text().catch(() => "");
  if (raw.length > 8000) return NextResponse.json({ error: "That's a lot. Keep each answer short and try again." }, { status: 413, headers });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Something went wrong sending your answers. Try again." }, { status: 400, headers }); }
  const answers = readPlanAnswers((body as { answers?: unknown } | null)?.answers);
  if (!answers) return NextResponse.json({ error: "Something went wrong sending your answers. Try again." }, { status: 400, headers });

  let ctx;
  try { ctx = await loadCareerContext(caller.userId); }
  catch { return NextResponse.json({ error: "Your saved work couldn't be loaded. Try again. Nothing was changed." }, { status: 503, headers }); }
  // Taps can only point at facts the server just loaded.
  if (answers.liked) answers.liked = { ...answers.liked, factIds: answers.liked.factIds.filter((id) => ctx.facts.some((f) => f.id === id)) };
  const facts = [...ctx.facts, ...todayFacts(answers)];
  const base = { facts, answers, location: ctx.location };

  if (isMockEnabled() || (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY)) {
    return NextResponse.json({ plan: assemblePlan(base), location: ctx.location }, { headers });
  }

  const candidates = rankDirections(allowedDirections(answers), facts, answers).slice(0, 8);
  const prompt = buildPlanPrompt(facts, answers, candidates);
  const userId = caller.userId;
  const ai = withRateLimit(async () => {
    const text = await callAI(PLAN_SYSTEM, [{ role: "user", content: prompt }], 900, MODEL_CHAT, { userId, endpoint: ENDPOINT });
    return NextResponse.json({ text });
  }, { mode: "user", endpoint: ENDPOINT });

  let note: string | null = null;
  let model;
  try {
    const res = await ai(request);
    if (res.ok) {
      const { text } = (await res.json()) as { text?: string };
      model = parseModelPlan(typeof text === "string" ? text : "").map((d) => ({ ...d, link: typeof d.link === "string" ? plainPunctuation(d.link, logDashSwaps(ENDPOINT)) : d.link }));
      if (!model.length) note = NO_AI_NOTE;
    } else {
      note = res.status === 429 ? ALLOWANCE_NOTE : NO_AI_NOTE;
    }
  } catch (err) {
    console.error("[career-plan] AI failed, using rules:", err instanceof Error ? err.message : "unknown");
    note = NO_AI_NOTE;
  }

  const plan = assemblePlan({ ...base, model });
  if (note) plan.notes.unshift(note);
  if (plan.method === "ai") {
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        userId, contextPage: ENDPOINT, modelProvider: AI_PROVIDER, modelId: MODEL_CHAT,
        input: `${facts.length} facts, ${Object.keys(answers).length} answers`,
        explanation: "Ranked three catalogue directions and quoted the person's own facts; quotes not found in the facts were stripped.",
        outputSummary: { directions: plan.directions.map((d) => d.id), notes: plan.notes.length },
      });
    } catch { console.error("Decision log failed (career-plan)"); }
  }
  return NextResponse.json({ plan, location: ctx.location }, { headers });
}
