import { NextResponse } from "next/server";
import { listPracticeEntries, createPracticeEntry, PRACTICE_ERROR_COPY } from "@crucible/core";
import { gate, readJson } from "@/lib/creative-server";

/**
 * The practice record (migration 075): the person's shows, programs, awards
 * and works, in their own words. Owner only; every statement runs as the
 * person.
 *
 * GET  /api/practice  -> { entries }
 * POST /api/practice  -> create { section, title, venue?, city?, state?, year, endYear?, details?, proof?, namesFacility? }
 */
export async function GET(request: Request) {
  const g = await gate(request);
  if (!g.ok) return g.res;
  return NextResponse.json({ entries: await listPracticeEntries(g.userId) });
}

export async function POST(request: Request) {
  const g = await gate(request, { write: true });
  if (!g.ok) return g.res;
  const body = await readJson(request, 20_000);
  if (!body) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  const r = await createPracticeEntry(g.userId, body);
  if (r.status === "ok") return NextResponse.json({ entry: r.entry }, { status: 201 });
  const code = r.status === "invalid" ? r.error : r.status;
  return NextResponse.json({ error: code, message: PRACTICE_ERROR_COPY[code] ?? PRACTICE_ERROR_COPY.failed }, { status: r.status === "too_many" ? 429 : 400 });
}
