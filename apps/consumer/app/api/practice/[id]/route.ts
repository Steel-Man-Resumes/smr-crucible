import { NextResponse } from "next/server";
import { updatePracticeEntry, deletePracticeEntry, isUuid, PRACTICE_ERROR_COPY } from "@crucible/core";
import { gate, ownerOnlyRecord, readJson } from "@/lib/creative-server";
import { isSameOriginRequest } from "@/lib/same-origin";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** PATCH /api/practice/[id]: change an entry. Its section never changes. */
export async function PATCH(request: Request, context: RouteContext) {
  const g = await gate(request, { write: true });
  if (!g.ok) return g.res;
  if (g.impersonating) return ownerOnlyRecord();
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found", message: PRACTICE_ERROR_COPY.not_found }, { status: 404 });
  const body = await readJson(request, 20_000);
  if (!body) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  const r = await updatePracticeEntry(g.userId, id, body);
  if (r.status === "ok") return NextResponse.json({ entry: r.entry });
  const code = r.status === "invalid" ? r.error : r.status;
  return NextResponse.json({ error: code, message: PRACTICE_ERROR_COPY[code] ?? PRACTICE_ERROR_COPY.failed }, { status: r.status === "not_found" ? 404 : 400 });
}

/** DELETE /api/practice/[id]: the person removes their own entry. */
export async function DELETE(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request.headers)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const g = await gate(request);
  if (!g.ok) return g.res;
  if (g.impersonating) return ownerOnlyRecord();
  const { id } = await context.params;
  if (!isUuid(id) || !(await deletePracticeEntry(g.userId, id))) {
    return NextResponse.json({ error: "not_found", message: PRACTICE_ERROR_COPY.not_found }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
