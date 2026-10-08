import { NextResponse } from "next/server";
import {
  COACH_QUESTIONS,
  readBackQuestions,
  dictionaryMarks,
  parseCoachOutput,
  modelFingerprints,
  saveCreativeDoc,
  marksStillInText,
  MAX_MODEL_PRINT_SETS,
  STATEMENT_MAX_CHARS,
  type SpellingMark,
} from "@crucible/core";
import { withRateLimit } from "@/lib/withRateLimit";
import { callAI, AI_MODEL } from "@/lib/ai-call";
import { isMockEnabled } from "@/lib/mock-ai";
import { creativeLane, gate, laneNotFound, loadCreativeContext, readJson } from "@/lib/creative-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const COACH_SYSTEM = [
  "You coach an artist who is writing their own artist statement. You never write any part of it.",
  "Do not rewrite, suggest sentences, complete sentences, or offer wording of any kind.",
  "Ask at most three short questions, one sentence each, ending in a question mark, that help the artist say more in their own words.",
  "Also list words that are misspelled, with the correct spelling. One word each. Do not list style changes.",
  'Return JSON only: {"questions": ["...?"], "spelling": [{"word": "...", "suggestion": "..."}]}',
].join("\n");

/**
 * POST /api/creative/coach { laneId, text }
 *
 * The statement coach (CR-03). Returns the fixed questions, the read-back
 * questions about the person's own draft, up to three model questions, and
 * spelling marks. Nothing else a model says ever leaves this route: the reply
 * is cut down to questions and one-word spelling fixes, and fingerprints of
 * the whole raw reply are stored so no save can ever carry its words.
 * The text sent is not saved here; only the person's own save does that.
 */
async function handlePost(request: Request) {
  const g = await gate(request, { write: true, bucket: "creative-draft-write" });
  if (!g.ok) return g.res;
  const body = await readJson(request, 60_000);
  const lane = await creativeLane(g.userId, body?.laneId);
  if (!lane) return laneNotFound();
  const text = typeof body?.text === "string" ? body.text.slice(0, STATEMENT_MAX_CHARS) : "";

  let modelQuestions: string[] = [];
  let modelMarks: SpellingMark[] = [];
  let raw = "";
  const canCallModel = !isMockEnabled() && (!!process.env.ANTHROPIC_API_KEY || !!process.env.OPENAI_API_KEY);
  if (canCallModel && text.trim()) {
    try {
      raw = await callAI(COACH_SYSTEM, [{ role: "user", content: `THE ARTIST'S DRAFT (read only):\n${text}` }], 600, AI_MODEL, {
        userId: g.userId,
        endpoint: "creative-coach",
      });
      const parsed = parseCoachOutput(raw, text);
      modelQuestions = parsed.questions;
      modelMarks = parsed.marks;
    } catch (err) {
      console.error("Statement coach model call failed; fixed questions only:", (err as Error)?.message);
    }
  }

  const marks: SpellingMark[] = [];
  for (const mk of [...dictionaryMarks(text), ...modelMarks]) {
    if (!marks.some((x) => x.word === mk.word)) marks.push(mk);
  }

  // Record what was offered and fingerprint the raw reply, on the lane's statement.
  const c = await loadCreativeContext(g.userId, lane);
  const st = c.statement;
  const offered = [...st.offeredMarks];
  for (const mk of marks) if (!offered.some((x) => x.word === mk.word && x.suggestion === mk.suggestion)) offered.push(mk);
  const prints = raw ? [...st.modelPrints, { at: new Date().toISOString(), prints: modelFingerprints(raw, text) }].slice(-MAX_MODEL_PRINT_SETS) : st.modelPrints;
  await saveCreativeDoc(g.userId, lane.id, "artist_statement", {
    versions: st.versions,
    offeredMarks: offered.slice(-200),
    modelPrints: prints,
  });

  return NextResponse.json({
    fixed: COACH_QUESTIONS,
    readBack: readBackQuestions(text),
    questions: modelQuestions,
    marks: marksStillInText(marks, text),
  });
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "creative-coach", requiredTier: "client" });
