import { NextResponse } from "next/server";
import {
  saveCreativeDoc,
  classifyBio,
  checkStatementSave,
  currentStatementText,
  allPrints,
  STATEMENT_SAVE_COPY,
  MAX_STATEMENT_VERSIONS,
  isUuid,
  artistResumePlainText,
  type StatementVersion,
} from "@crucible/core";
// The word list loads only in the routes that need it (not via the package index).
import { isValidSpellingMark } from "@crucible/core/src/creativeSpelling";
import { creativeLane, gate, laneNotFound, loadCreativeContext, ownerOnly, readJson } from "@/lib/creative-server";

interface RouteContext {
  params: Promise<{ laneId: string }>;
}

const CHANGED = { error: "changed_elsewhere", message: "This changed in another tab or window. Refresh the page, then save again." };

/**
 * The revision the browser loaded (null: it loaded none). A save without one
 * is refused: an old cached screen must never overwrite newer work.
 */
function revFrom(body: Record<string, unknown>): number | null | "missing" {
  if (body.rev === null) return null;
  return typeof body.rev === "number" && Number.isInteger(body.rev) && body.rev >= 0 ? body.rev : "missing";
}

/**
 * PUT /api/creative/[laneId]/docs { type, rev?, ... }
 *
 *   artist_bio        { bio }                  origin of every sentence is decided HERE, against
 *                                               the record's templates; the request's labels are ignored
 *   artist_statement  { text, acceptedMark? }  the person's own words; a spelling save must be
 *                                               exactly the fix the server's word list offers
 *   work_sample_list  { order: [workId] }      the person's order, of their own works
 *   artist_resume     {}                       a dated copy of the page as built from the record now
 *
 * The only write path for these documents (the generic artifact writes,
 * forks and lane moves refuse them). Bio and statement writes are the
 * person's alone: refused under an assist session. A save lands only on the
 * revision it was based on.
 */
export async function PUT(request: Request, context: RouteContext) {
  const g = await gate(request, { write: true });
  if (!g.ok) return g.res;
  const { laneId } = await context.params;
  const lane = await creativeLane(g.userId, laneId);
  if (!lane) return laneNotFound();
  const body = await readJson(request, 120_000);
  if (!body) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  const rev = revFrom(body);
  if (rev === "missing" && body.type !== "artist_resume") return NextResponse.json(CHANGED, { status: 409 });
  const c = await loadCreativeContext(g.userId, lane);
  const now = new Date().toISOString();
  const readRev = rev === "missing" ? null : rev;

  switch (body.type) {
    case "artist_bio": {
      if (g.impersonating) return ownerOnly();
      const bio = classifyBio(body.bio, c.entries, c.settings);
      const r = await saveCreativeDoc(g.userId, lane.id, "artist_bio", { ...bio, savedAt: now }, readRev);
      if (r.status !== "ok") return NextResponse.json(CHANGED, { status: 409 });
      return NextResponse.json({ bio, rev: (r.doc.content as { rev?: number }).rev ?? null });
    }

    case "artist_statement": {
      if (g.impersonating) return ownerOnly();
      const text = typeof body.text === "string" ? body.text.replace(/\r\n/g, "\n") : null;
      if (text === null) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
      const st = c.statement;
      const previousText = currentStatementText(st);
      const m = body.acceptedMark as { word?: unknown; suggestion?: unknown } | undefined;
      const acceptedMark = m && typeof m.word === "string" && typeof m.suggestion === "string" ? { word: m.word, suggestion: m.suggestion } : null;
      const verdict = checkStatementSave({
        previousText,
        nextText: text,
        acceptedMark,
        validMark: isValidSpellingMark,
        modelPrints: allPrints(st),
      });
      if (!verdict.ok) {
        return NextResponse.json({ error: verdict.reason, message: STATEMENT_SAVE_COPY[verdict.reason] }, { status: 422 });
      }
      if (text === previousText) return NextResponse.json({ statement: { versions: st.versions }, rev: c.statementRev });
      const version: StatementVersion = acceptedMark
        ? { text, savedAt: now, via: "spelling", mark: acceptedMark }
        : { text, savedAt: now, via: "typed" };
      const versions = [...st.versions, version].slice(-MAX_STATEMENT_VERSIONS);
      const r = await saveCreativeDoc(g.userId, lane.id, "artist_statement", { versions, modelPrints: st.modelPrints }, readRev);
      if (r.status !== "ok") return NextResponse.json(CHANGED, { status: 409 });
      return NextResponse.json({ statement: { versions }, rev: (r.doc.content as { rev?: number }).rev ?? null });
    }

    case "work_sample_list": {
      // Only works this lane shows (the lane's facility choices apply here too).
      const works = new Set(c.samples.map((r) => r.entryId.toLowerCase()));
      const order = Array.isArray(body.order)
        ? Array.from(new Set(body.order.filter((x): x is string => isUuid(x)).map((x) => x.toLowerCase()))).filter((x) => works.has(x))
        : [];
      const r = await saveCreativeDoc(g.userId, lane.id, "work_sample_list", { order, savedAt: now }, readRev);
      if (r.status !== "ok") return NextResponse.json(CHANGED, { status: 409 });
      return NextResponse.json({ order, rev: (r.doc.content as { rev?: number }).rev ?? null });
    }

    case "artist_resume": {
      // Built here from the record, never taken from the request.
      const prev = c.docs.artist_resume ? Number((c.docs.artist_resume.content as { rev?: number }).rev ?? 0) : null;
      const r = await saveCreativeDoc(g.userId, lane.id, "artist_resume", {
        savedAt: now,
        text: artistResumePlainText(c.model),
        state: c.status.state,
        blockCount: c.status.blockCount,
        rulesVersion: c.status.rulesVersion,
      }, prev);
      if (r.status !== "ok") return NextResponse.json(CHANGED, { status: 409 });
      return NextResponse.json({ savedAt: now, state: c.status.state });
    }

    default:
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }
}
