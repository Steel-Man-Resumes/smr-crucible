import { NextResponse } from "next/server";
import {
  saveCreativeDoc,
  readBio,
  bioVocabulary,
  bioFactEntries,
  checkBioSave,
  checkStatementSave,
  currentStatementText,
  printsBefore,
  artistResumePlainText,
  STATEMENT_SAVE_COPY,
  MAX_STATEMENT_VERSIONS,
  isUuid,
  marksStillInText,
  type SpellingMark,
  type StatementVersion,
} from "@crucible/core";
import { creativeLane, gate, laneNotFound, loadCreativeContext, readJson } from "@/lib/creative-server";

interface RouteContext {
  params: Promise<{ laneId: string }>;
}

/**
 * PUT /api/creative/[laneId]/docs { type, ... }
 *
 *   artist_bio        { bio }                  every drafted sentence must still trace to the record
 *   artist_statement  { text, acceptedMark? }  the person's own words only (CR-03):
 *                                               a typed save may not add words a model wrote;
 *                                               a spelling save swaps exactly one offered word
 *   work_sample_list  { order: [workId] }      the person's order, of their own works
 *   artist_resume     {}                       a dated copy of the page as built from the record now
 *
 * This is the only write path for these documents. The generic artifact
 * write refuses them.
 */
export async function PUT(request: Request, context: RouteContext) {
  const g = await gate(request, { write: true });
  if (!g.ok) return g.res;
  const { laneId } = await context.params;
  const lane = await creativeLane(g.userId, laneId);
  if (!lane) return laneNotFound();
  const body = await readJson(request, 120_000);
  if (!body) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  const c = await loadCreativeContext(g.userId, lane);
  const now = new Date().toISOString();

  switch (body.type) {
    case "artist_bio": {
      const bio = readBio(body.bio);
      // The disclosure mode is recorded with the bio, as the person set it for this lane.
      if (c.settings.bioDisclosure) bio.disclosure = c.settings.bioDisclosure;
      const vocab = bioVocabulary(bioFactEntries(c.entries, bio.disclosure), c.settings);
      const check = checkBioSave(bio, vocab);
      if (!check.ok) {
        return NextResponse.json(
          {
            error: check.error,
            message: "A drafted sentence says something your record doesn't. Cut it or write it your own way.",
            sentence: "sentence" in check ? check.sentence : undefined,
          },
          { status: 422 }
        );
      }
      const saved = await saveCreativeDoc(g.userId, lane.id, "artist_bio", { ...bio, savedAt: now });
      return NextResponse.json({ bio: readBio(saved?.content) });
    }

    case "artist_statement": {
      const text = typeof body.text === "string" ? body.text.replace(/\r\n/g, "\n") : null;
      if (text === null) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
      const st = c.statement;
      const previousText = currentStatementText(st);
      const m = body.acceptedMark as Partial<SpellingMark> | undefined;
      const acceptedMark =
        m && typeof m.word === "string" && typeof m.suggestion === "string" ? { word: m.word, suggestion: m.suggestion } : null;
      const verdict = checkStatementSave({
        previousText,
        nextText: text,
        acceptedMark,
        offeredMarks: st.offeredMarks,
        modelPrints: printsBefore(st),
      });
      if (!verdict.ok) {
        return NextResponse.json({ error: verdict.reason, message: STATEMENT_SAVE_COPY[verdict.reason] }, { status: 422 });
      }
      if (text === previousText) return NextResponse.json({ statement: { versions: st.versions, offeredMarks: marksStillInText(st.offeredMarks, text) } });
      const version: StatementVersion = acceptedMark
        ? { text, savedAt: now, via: "spelling", mark: acceptedMark }
        : { text, savedAt: now, via: "typed" };
      const versions = [...st.versions, version].slice(-MAX_STATEMENT_VERSIONS);
      // Offered marks stay on file (the history audit checks each accepted one
      // against them); the screen only shows marks whose word is still there.
      const saved = await saveCreativeDoc(g.userId, lane.id, "artist_statement", {
        versions,
        offeredMarks: st.offeredMarks,
        modelPrints: st.modelPrints,
      });
      const out = saved?.content as { versions?: StatementVersion[] } | undefined;
      const offeredMarks = marksStillInText(st.offeredMarks, text);
      return NextResponse.json({ statement: { versions: out?.versions ?? versions, offeredMarks } });
    }

    case "work_sample_list": {
      const works = new Set(c.entries.filter((e) => e.section === "work").map((e) => e.id.toLowerCase()));
      const order = Array.isArray(body.order)
        ? Array.from(new Set(body.order.filter((x): x is string => isUuid(x)).map((x) => x.toLowerCase()))).filter((x) => works.has(x))
        : [];
      await saveCreativeDoc(g.userId, lane.id, "work_sample_list", { order, savedAt: now });
      return NextResponse.json({ order });
    }

    case "artist_resume": {
      // Built here from the record, never taken from the request.
      await saveCreativeDoc(g.userId, lane.id, "artist_resume", {
        savedAt: now,
        text: artistResumePlainText(c.model),
        state: c.status.state,
        blockCount: c.status.blockCount,
        rulesVersion: c.status.rulesVersion,
      });
      return NextResponse.json({ savedAt: now, state: c.status.state });
    }

    default:
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }
}
