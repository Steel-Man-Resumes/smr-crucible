import { NextResponse } from "next/server";
import {
  BIO_LENGTHS,
  bioFactEntries,
  bioFactLines,
  bioSystemPrompt,
  bioVocabulary,
  draftBioFromFacts,
  parseBioDraft,
  type BioLength,
} from "@crucible/core";
import { withRateLimit } from "@/lib/withRateLimit";
import { callAI, AI_MODEL } from "@/lib/ai-call";
import { isMockEnabled } from "@/lib/mock-ai";
import { sanitizeForPrompt } from "@/lib/sanitize";
import { creativeLane, gate, laneNotFound, loadCreativeContext, readJson } from "@/lib/creative-server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/creative/bio-draft { laneId, length }
 *
 * t.ROY drafts a third-person bio of one length from the person's CONFIRMED
 * record facts only (decision C3). Every sentence comes back unapproved; the
 * person keeps or cuts each one. A model sentence that names anything the
 * facts do not hold is dropped here, before the person sees it. With the
 * model off or failing, the draft is built from the facts alone.
 */
async function handlePost(request: Request) {
  const g = await gate(request, { write: true, bucket: "creative-draft-write" });
  if (!g.ok) return g.res;
  const body = await readJson(request, 4_000);
  const lane = await creativeLane(g.userId, body?.laneId);
  if (!lane) return laneNotFound();
  const length: BioLength = (BIO_LENGTHS as readonly string[]).includes(body?.length as string) ? (body!.length as BioLength) : "short";
  const c = await loadCreativeContext(g.userId, lane);
  const facts = bioFactEntries(c.entries, c.settings.bioDisclosure);
  const vocab = bioVocabulary(facts, c.settings);

  let sentences: string[] = [];
  let dropped = 0;
  let source: "model" | "facts" = "facts";
  const canCallModel = !isMockEnabled() && (!!process.env.ANTHROPIC_API_KEY || !!process.env.OPENAI_API_KEY);
  if (canCallModel && facts.length) {
    try {
      const lines = bioFactLines(c.entries, c.settings).map((l) => sanitizeForPrompt(l, 400));
      const raw = await callAI(
        bioSystemPrompt(length, c.settings.bioPronoun),
        [{ role: "user", content: `FACTS (the only source):\n${lines.join("\n")}` }],
        900,
        AI_MODEL,
        { userId: g.userId, endpoint: "creative-bio" }
      );
      const r = parseBioDraft(raw, vocab);
      sentences = r.kept;
      dropped = r.dropped;
      if (sentences.length) source = "model";
    } catch (err) {
      console.error("Bio draft model call failed; using the facts-only draft:", (err as Error)?.message);
    }
  }
  if (!sentences.length) sentences = draftBioFromFacts(c.entries, c.settings, length);

  const stamp = Date.now().toString(36);
  return NextResponse.json({
    length,
    source,
    dropped,
    sentences: sentences.map((text, i) => ({ id: `d${stamp}${i}`, text, origin: "draft", approved: false })),
  });
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "creative-bio", requiredTier: "client" });
