/**
 * Phase 7.7 avatar photo path -- AI headshot generation, GATED.
 *
 *   GET  /api/avatar/generate  -> { enabled, dailyCap, remaining }  (status only)
 *   POST /api/avatar/generate  -> generate a professional headshot from an
 *                                 uploaded original photo (WHEN enabled)
 *
 * Generation is a real PAID image API call, so it is:
 *   - GATED behind isHeadshotGenEnabled() (a feature flag AND a provider key).
 *     When off, POST returns 501 and does NOT touch the daily cap. No paid image
 *     API is called anywhere yet -- the provider call is a marked stub below.
 *   - CAPPED at HEADSHOT_DAILY_CAP per day via checkUserRateLimit against the
 *     "headshot_generate" endpoint, which is a HARD cap for every tier (see
 *     USER_ENDPOINT_HARD_CAPS). This endpoint is NOT excluded from
 *     getUserDailyUsage, so generation DOES count toward displayed AI usage.
 *
 * DOCTRINE: the original photo is ALWAYS retained (a generated headshot is a NEW
 * asset with source_asset_id pointing at the original -- never an overwrite), and
 * a headshot is NEVER auto-added to a resume. NON-impersonatable auth().
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  checkUserRateLimit,
  HEADSHOT_GENERATE_ENDPOINT,
  HEADSHOT_DAILY_CAP,
  getAvatarAsset,
} from "@crucible/core";
import { isHeadshotGenEnabled, headshotGenStatus } from "@/lib/headshot-provider";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET -- status the UI reads to decide whether to show the generate control. */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const status = headshotGenStatus();
  let remaining = HEADSHOT_DAILY_CAP;
  if (status.enabled) {
    const rl = await checkUserRateLimit(userId, HEADSHOT_GENERATE_ENDPOINT);
    remaining = rl.remaining;
  }

  return NextResponse.json({
    data: {
      enabled: status.enabled,
      dailyCap: HEADSHOT_DAILY_CAP,
      remaining,
    },
  });
}

/** POST -- generate a headshot from an uploaded original. Gated + capped. */
export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // GATE FIRST -- and BEFORE the cap, so a disabled feature never burns a user's
  // daily generation allowance.
  if (!isHeadshotGenEnabled()) {
    return NextResponse.json(
      {
        error: "headshot_generation_unavailable",
        message: "AI headshot generation is not turned on yet.",
      },
      { status: 501 }
    );
  }

  // Hard daily cap (applies to every tier, even unlimited).
  const rl = await checkUserRateLimit(userId, HEADSHOT_GENERATE_ENDPOINT);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: "daily_cap_reached",
        message: `You have reached the limit of ${HEADSHOT_DAILY_CAP} generated headshots for today. Try again tomorrow.`,
      },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => null);
  const sourceAssetId =
    body && typeof (body as { sourceAssetId?: unknown }).sourceAssetId === "string"
      ? (body as { sourceAssetId: string }).sourceAssetId.trim()
      : "";
  if (!sourceAssetId) {
    return NextResponse.json({ error: "Choose a photo to generate from." }, { status: 400 });
  }

  // The source must be one of THIS user's original photos.
  const source = await getAvatarAsset(userId, sourceAssetId);
  if (!source || source.kind !== "original_photo") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // ---------------------------------------------------------------------------
  // TODO(troy-gate): wire provider (e.g. OpenAI gpt-image-1) once Troy picks a
  // provider + confirms per-image spend. When enabled, this block would:
  //   1. Read the source original photo bytes:
  //        const src = await getDecryptedObject({ ownerUserId: userId, key: source.object_key });
  //   2. Call the paid image API to produce a professional headshot (edit/variation).
  //   3. Store the result encrypted, RETAINING the original (never overwrite):
  //        const key = makeSecureObjectKey(userId, "headshot");
  //        const secure = await putEncryptedObject({ ownerUserId: userId, purpose: "headshot",
  //          key, plaintext: generatedBytes, mimeType, sha256 });
  //        const asset = await createAvatarAsset({ userId, secureObjectId: secure.id,
  //          kind: "generated_headshot", sourceAssetId: source.id, width, height });
  //   4. Count the AI call:  await incrementUserUsage(userId, HEADSHOT_GENERATE_ENDPOINT);
  //   5. Log AI usage:       recordTokenUsage(provider, model, usage, { userId, endpoint: HEADSHOT_GENERATE_ENDPOINT });
  //   6. Return { data: { id: asset.id, kind: "generated_headshot", imageUrl: `/api/avatar/${asset.id}/image`, ... } }.
  // No paid image SDK/dependency is added in this pass. Until the block above is
  // wired, POST is unreachable past the gate (isHeadshotGenEnabled() is false),
  // so this fallthrough is defensive only.
  // ---------------------------------------------------------------------------
  return NextResponse.json(
    {
      error: "headshot_generation_unavailable",
      message: "AI headshot generation is not turned on yet.",
    },
    { status: 501 }
  );
}
