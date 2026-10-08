import { NextResponse } from "next/server";
import { BIO_LENGTHS, draftBioFromFacts, type BioLength } from "@crucible/core";
import { creativeLane, gate, laneNotFound, loadCreativeContext, readJson } from "@/lib/creative-server";

export const runtime = "nodejs";

/**
 * POST /api/creative/bio-draft { laneId, length }
 *
 * Decision C3, v1: the draft is fixed templates filled from the person's
 * confirmed record, ONE entry per sentence, with this lane's facility choices
 * applied. No model writes any of it. Every sentence comes back unapproved;
 * the person keeps, cuts or rewrites each one. The save route decides each
 * sentence's origin again from the record (nothing here is trusted later).
 */
export async function POST(request: Request) {
  const g = await gate(request, { write: true, bucket: "creative-draft-write" });
  if (!g.ok) return g.res;
  const body = await readJson(request, 4_000);
  const lane = await creativeLane(g.userId, body?.laneId);
  if (!lane) return laneNotFound();
  const length: BioLength = (BIO_LENGTHS as readonly string[]).includes(body?.length as string) ? (body!.length as BioLength) : "short";
  const c = await loadCreativeContext(g.userId, lane);
  const drafted = draftBioFromFacts(c.entries, c.settings, length);
  return NextResponse.json({
    length,
    sentences: drafted.map((t) => ({ id: `${length}:${t.key}`, text: t.text, origin: "fact", sourceEntryId: t.sourceEntryId, approved: false })),
  });
}
