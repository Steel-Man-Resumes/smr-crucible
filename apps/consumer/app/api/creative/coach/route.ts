import { NextResponse } from "next/server";
import { COACH_QUESTIONS, readBackQuestions, STATEMENT_MAX_CHARS } from "@crucible/core";
// The word list loads only in the routes that need it (not via the package index).
import { spellingMarksFor } from "@crucible/core/src/creativeSpelling";
import { creativeLane, gate, laneNotFound, readJson } from "@/lib/creative-server";

export const runtime = "nodejs";

/**
 * POST /api/creative/coach { laneId, text }
 *
 * The statement coach (CR-03), v1: fixed code only. No model is called and
 * the text goes nowhere: it is read here and dropped. Returns the fixed
 * question bank, a read-back of the person's own sentences as questions, and
 * spelling marks from the bundled word list (a token that is not a word, the
 * one closest word, shown with its sentence). Writes nothing.
 */
export async function POST(request: Request) {
  const g = await gate(request, { write: true, bucket: "creative-coach" });
  if (!g.ok) return g.res;
  const body = await readJson(request, 60_000);
  const lane = await creativeLane(g.userId, body?.laneId);
  if (!lane) return laneNotFound();
  const text = typeof body?.text === "string" ? body.text.slice(0, STATEMENT_MAX_CHARS) : "";
  return NextResponse.json({
    fixed: COACH_QUESTIONS,
    readBack: readBackQuestions(text),
    marks: spellingMarksFor(text),
  });
}
