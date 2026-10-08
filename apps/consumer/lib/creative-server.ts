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
  cleanKindSettings,
  readBio,
  readStatement,
  readPlan,
  buildArtistResumeModel,
  buildWorkSampleList,
  getCreativeStatus,
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

export type Gate = { ok: true; userId: string } | { ok: false; res: NextResponse };

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
  return { ok: true, userId };
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

export async function readJson(request: Request, maxBytes = 200_000): Promise<Record<string, unknown> | null> {
  const len = request.headers.get("content-length");
  if (len && parseInt(len, 10) > maxBytes) return null;
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

// ------------------------------------------------------- the lane's context --


export interface CreativeContext {
  lane: CareerLane;
  partner: CareerLane | null;
  entries: PracticeEntry[];
  settings: CreativeKindSettings;
  bio: BioContent;
  statement: StatementContent;
  sampleOrder: string[];
  model: ArtistResumeModel;
  samples: WorkSampleRow[];
  status: CreativeStatus;
  plan: PairPlan | null;
  docs: Partial<Record<string, RefineryArtifact>>;
}

/** Everything a creative lane's screens and exports read, from the database, as the person. */
export async function loadCreativeContext(userId: string, lane: CareerLane, pages?: number): Promise<CreativeContext> {
  const [entries, docRows, partner] = await Promise.all([
    listPracticeEntries(userId),
    listCreativeDocs(userId, lane.id),
    lane.pair_lane_id ? getLane(userId, lane.pair_lane_id) : Promise.resolve(null),
  ]);
  const docs: Partial<Record<string, RefineryArtifact>> = {};
  for (const d of docRows) docs[d.artifact_type] = d;
  const settings = cleanKindSettings(lane.kind_settings ?? {});
  const bio = readBio(docs.artist_bio?.content);
  const statement = readStatement(docs.artist_statement?.content);
  const rawOrder = (docs.work_sample_list?.content as { order?: unknown } | undefined)?.order;
  const sampleOrder = Array.isArray(rawOrder) ? rawOrder.filter((x): x is string => typeof x === "string") : [];
  const model = buildArtistResumeModel(entries, settings);
  const samples = buildWorkSampleList(entries, sampleOrder);
  const status = getCreativeStatus({
    entries,
    settings,
    artistResume: { model, pages },
    bio,
    statement,
    workSamples: samples,
  });
  const dream = lane.path === "dream" ? lane : partner?.path === "dream" ? partner : null;
  const plan = lane.pair_lane_id && partner ? readPlan(dream?.pair_plan ?? {}) : null;
  return { lane, partner, entries, settings, bio, statement, sampleOrder, model, samples, status, plan, docs };
}
