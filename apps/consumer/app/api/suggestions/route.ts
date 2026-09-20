/**
 * The participant's side of staff suggestions. GET the open ones; POST { suggestionId, answer: "saved" | "dismissed" }.
 * Saving a suggested JOB is done by the page first, through /api/applications with the participant's own session --
 * the same path as a job they found themselves. This route only records their answer.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMySuggestions, answerSuggestion } from "@crucible/core";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ suggestions: await getMySuggestions(session.user.id) });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!UUID.test(String(body.suggestionId ?? "")) || !["saved", "dismissed"].includes(body.answer)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return (await answerSuggestion(session.user.id, String(body.suggestionId), body.answer)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found." }, { status: 404 });
}
