/**
 * Server helpers shared by the creative lane routes. Every read runs AS the
 * person (core uses queryAsUser), so another person's lane is simply not
 * found.
 */

import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import {
  getOpenLane,
  incrementUserUsage,
  isUuid,
  laneKindOf,
  PRACTICE_WRITES_PER_DAY,
  type CareerLane,
} from "@crucible/core";
import {
  listPracticeEntries,
  listCreativeDocs,
  getLane,
  readKindSettings,
  readBio,
  readStatement,
  readPlan,
  buildArtistResumeModel,
  buildWorkSampleList,
  getCreativeStatus,
  revOf,
  type PracticeEntry,
  type CreativeKindSettings,
  type BioContent,
  type StatementContent,
  type ArtistResumeModel,
  type WorkSampleRow,
  type CreativeStatus,
  type PairPlan,
  type RefineryArtifact,
} from "@crucible/core";

export type Gate = { ok: true; userId: string; impersonating: boolean } | { ok: false; res: NextResponse };

/** Signed in, and (for writes) a same-origin JSON request under the daily write cap. */
export async function gate(request: Request, opts: { write?: boolean; bucket?: string; cap?: number } = {}): Promise<Gate> {
  if (opts.write && !isSameOriginJsonPost(request.headers)) {
    return { ok: false, res: NextResponse.json({ error: "Not allowed" }, { status: 403 }) };
  }
  const session = await auth();
  const userId = session?.user?.id as string | undefined;
  if (!userId) return { ok: false, res: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (opts.write) {
    const n = await incrementUserUsage(userId, opts.bucket ?? "practice-write").catch(() => 0);
    if (n > (opts.cap ?? PRACTICE_WRITES_PER_DAY)) {
      return {
        ok: false,
        res: NextResponse.json({ error: "too_many_writes", message: "That's a lot of changes for one day. Try again tomorrow." }, { status: 429 }),
      };
    }
  }
  return { ok: true, userId, impersonating: !!(session as { impersonation?: unknown } | null)?.impersonation };
}

/** Record entries and facility choices are the person's alone too. */
export function ownerOnlyRecord(): NextResponse {
  return NextResponse.json(
    { error: "owner_only", message: "Only the person can change their own record, not an assist session." },
    { status: 403 }
  );
}

/** Writes that put words in the person's mouth are theirs alone: never under an assist session. */
export function ownerOnly(): NextResponse {
  return NextResponse.json(
    { error: "owner_only", message: "Only the person can save their own statement or bio, not an assist session." },
    { status: 403 }
  );
}

/** An open creative lane of this person's, or null. */
export async function creativeLane(userId: string, laneId: unknown): Promise<CareerLane | null> {
  if (!isUuid(laneId)) return null;
  const lane = await getOpenLane(userId, laneId.toLowerCase());
  return lane && laneKindOf(lane) === "creative" ? lane : null;
}

export function laneNotFound(): NextResponse {
  return NextResponse.json({ error: "not_found", message: "That lane isn't there anymore. Refresh the page." }, { status: 404 });
}

/** Read a JSON object body, refusing anything over maxBytes even when it arrives without a Content-Length. */
export async function readJson(request: Request, maxBytes = 200_000): Promise<Record<string, unknown> | null> {
  const len = request.headers.get("content-length");
  if (len && parseInt(len, 10) > maxBytes) return null;
  const text = await request.text().catch(() => null);
  if (text === null || Buffer.byteLength(text, "utf8") > maxBytes) return null;
  try {
    const body = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------- the lane's context --


export interface CreativeContext {
  lane: CareerLane;
  partner: CareerLane | null;
  entries: PracticeEntry[];
  settings: CreativeKindSettings;
  bio: BioContent;
  bioRev: number | null;
  statement: StatementContent;
  statementRev: number | null;
  sampleOrder: string[];
  sampleRev: number | null;
  model: ArtistResumeModel;
  samples: WorkSampleRow[];
  status: CreativeStatus;
  plan: PairPlan | null;
  docs: Partial<Record<string, RefineryArtifact>>;
}

/**
 * Everything a creative lane's screens and exports read, from the database,
 * as the person. Every document is built with the lane's CURRENT choices;
 * nothing stored with a document overrides them.
 */
export async function loadCreativeContext(userId: string, lane: CareerLane, pages?: number): Promise<CreativeContext> {
  const [entries, docRows, partnerRow] = await Promise.all([
    listPracticeEntries(userId),
    listCreativeDocs(userId, lane.id),
    lane.pair_lane_id ? getLane(userId, lane.pair_lane_id) : Promise.resolve(null),
  ]);
  const partner = partnerRow && !partnerRow.archived_at ? partnerRow : null;
  const docs: Partial<Record<string, RefineryArtifact>> = {};
  for (const d of docRows) docs[d.artifact_type] = d;
  const settings = readKindSettings(lane.kind_settings ?? {});
  const bio = readBio(docs.artist_bio?.content);
  const statement = readStatement(docs.artist_statement?.content);
  const rawOrder = (docs.work_sample_list?.content as { order?: unknown } | undefined)?.order;
  const sampleOrder = Array.isArray(rawOrder) ? rawOrder.filter((x): x is string => typeof x === "string") : [];
  const model = buildArtistResumeModel(entries, settings);
  const samples = buildWorkSampleList(entries, sampleOrder, settings);
  const status = getCreativeStatus({ entries, settings, artistResume: { model, pages }, bio, statement, workSamples: samples });
  const dream = lane.path === "dream" ? lane : partner?.path === "dream" ? partner : null;
  const plan = partner ? readPlan(dream?.pair_plan ?? {}) : null;
  return {
    lane, partner, entries, settings, bio, statement, sampleOrder, model, samples, status, plan, docs,
    bioRev: revOf(docs.artist_bio), statementRev: revOf(docs.artist_statement), sampleRev: revOf(docs.work_sample_list),
  };
}
