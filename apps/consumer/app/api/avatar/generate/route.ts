/**
 * Phase 7.7 avatar photo path -- AI headshot generation, GATED.
 *
 *   GET  /api/avatar/generate  -> { enabled, dailyCap, remaining }  (status only)
 *   POST /api/avatar/generate  -> generate a professional headshot from an
 *                                 uploaded original photo (WHEN enabled)
 *
 * Generation is a real PAID image API call, so it is:
 *   - GATED behind isHeadshotGenEnabled() (a feature flag AND a provider key).
 *     When off, POST returns 501 and does NOT touch the daily cap or call any
 *     paid API (both env vars must be set for the route to do real work).
 *   - CAPPED at HEADSHOT_DAILY_CAP/day via an ATOMIC reserve (reserveEndpointSlot)
 *     BEFORE the paid call, and REFUNDED (releaseEndpointSlot) on any failure after
 *     the reserve, so only a successful generation costs the user a slot.
 *
 * ===========================================================================
 * TO ACTIVATE (Troy only -- do NOT set these in code or commit them):
 *   1. Set  OPENAI_API_KEY   = <a real OpenAI key with image access>
 *   2. Set  HEADSHOT_GEN_ENABLED = true
 *   Both in Vercel project env. Missing either keeps the route at 501.
 *
 *   COST: OpenAI gpt-image-1 is priced per IMAGE, roughly $0.02-0.19 each
 *   depending on size/quality (1024x1024 standard is the low end). CONFIRM
 *   current pricing before enabling; the daily hard cap (3) bounds worst-case
 *   spend per user per day.
 * ===========================================================================
 *
 * DOCTRINE: the original photo is ALWAYS retained (a generated headshot is a NEW
 * asset with source_asset_id pointing at the original -- never an overwrite), and
 * a headshot is NEVER auto-added to a resume. NON-impersonatable auth().
 */

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@/auth";
import {
  checkUserRateLimit,
  reserveEndpointSlot,
  releaseEndpointSlot,
  HEADSHOT_GENERATE_ENDPOINT,
  HEADSHOT_DAILY_CAP,
  getAvatarAsset,
  getDecryptedObject,
  makeSecureObjectKey,
  putEncryptedObject,
  createAvatarAsset,
} from "@crucible/core";
import { isHeadshotGenEnabled, headshotGenStatus } from "@/lib/headshot-provider";
import { recordFlatUsage } from "@/lib/ai-usage-log";

export const runtime = "nodejs";
// gpt-image-1 routinely needs 30-90s; 30 was too short and Vercel killed the
// function mid-generation. Pro allows up to 300s.
export const maxDuration = 120;

// Fixed, dignified headshot prompt. Deliberately conservative: it must not alter
// who the person is, only present them cleanly for a resume.
const HEADSHOT_PROMPT =
  "A clean, professional headshot suitable for a resume: neutral background, " +
  "business-casual, natural lighting, respectful and realistic. Preserve the " +
  "person's actual appearance; do not alter identity, age, skin tone, or features.";

// gpt-image-1 pricing ~ $0.02-0.19/image depending on size/quality -- confirm
// before enabling. Logged as an estimate for the cost panel; the atomic daily
// cap is the real spend guard.
const GPT_IMAGE_1_EST_COST_USD = 0.02;

// Map an allowlisted source MIME to a filename the multipart part can carry. The
// extension only labels the part; OpenAI sniffs the actual bytes.
function filenameForMime(mime: string): string {
  if (mime === "image/png") return "source.png";
  if (mime === "image/webp") return "source.webp";
  return "source.jpg";
}

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

  // GATE FIRST -- BEFORE the cap and BEFORE any provider fetch, so a disabled
  // feature never burns a user's allowance and never calls a paid API. With no
  // OPENAI_API_KEY + flag (prod today) this returns 501 and nothing below runs.
  if (!isHeadshotGenEnabled()) {
    return NextResponse.json(
      {
        error: "headshot_generation_unavailable",
        message: "AI headshot generation is not turned on yet.",
      },
      { status: 501 }
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

  // The source must be one of THIS user's original photos (owner-scoped).
  const source = await getAvatarAsset(userId, sourceAssetId);
  if (!source || source.kind !== "original_photo") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Read the original photo bytes (owner-scoped decrypt). A missing/foreign
  // object returns null -> 404. This is NOT a paid step, so no slot is reserved
  // yet -- a decrypt miss must not burn the user's daily cap.
  const original = await getDecryptedObject({ ownerUserId: userId, key: source.object_key });
  if (!original) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // ATOMIC reserve of a daily slot IMMEDIATELY before the paid call. This fixes
  // the TOCTOU that a check-then-increment had: concurrent POSTs each get a
  // DISTINCT post-increment count and only the first HEADSHOT_DAILY_CAP get
  // ok:true. A rejected caller returns 429 and makes NO paid call.
  const reservation = await reserveEndpointSlot(
    userId,
    HEADSHOT_GENERATE_ENDPOINT,
    HEADSHOT_DAILY_CAP
  );
  if (!reservation.ok) {
    return NextResponse.json(
      {
        error: "daily_cap_reached",
        message: `You have reached the limit of ${HEADSHOT_DAILY_CAP} generated headshots for today. Try again tomorrow.`,
      },
      { status: 429 }
    );
  }

  // Any failure AFTER the reserve refunds the slot: a failed attempt (provider
  // error, timeout, or a storage failure) must not cost the user one of their few
  // daily generations. Only a successful headshot keeps the reservation.
  const refundAndFail = async (message: string, status: number) => {
    await releaseEndpointSlot(userId, HEADSHOT_GENERATE_ENDPOINT);
    return NextResponse.json({ error: message }, { status });
  };

  // ---- The paid provider call: OpenAI gpt-image-1 images/edits ----
  // Dep-free: global fetch + FormData + Blob (Node 20). No openai SDK.
  let generated: Buffer;
  try {
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", HEADSHOT_PROMPT);
    form.append("size", "1024x1024");
    // "medium" quality is faster and cheaper than the default and is plenty for a
    // resume headshot preview -- keeps us comfortably under the function timeout.
    form.append("quality", "medium");
    form.append(
      "image",
      new Blob([new Uint8Array(original.buffer)], { type: source.mime_type }),
      filenameForMime(source.mime_type)
    );

    const resp = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      // Fail cleanly (-> catch -> 502) before the 120s function limit rather than
      // a hard Vercel kill, if the provider hangs.
      signal: AbortSignal.timeout(110_000),
    });

    if (!resp.ok) {
      // Read a short error body for the log ONLY -- never surface provider detail
      // or echo the key. gpt-image-1 error bodies do not contain the request key.
      const detail = await resp.text().catch(() => "");
      console.error(
        `headshot gen provider error: status ${resp.status} ${detail.slice(0, 300)}`
      );
      return await refundAndFail("Generation failed. Please try again.", 502);
    }

    const json: unknown = await resp.json();
    const b64 =
      json && typeof json === "object"
        ? (json as { data?: Array<{ b64_json?: unknown }> }).data?.[0]?.b64_json
        : undefined;
    if (typeof b64 !== "string" || b64.length === 0) {
      console.error("headshot gen: provider returned no b64_json image");
      return await refundAndFail("Generation failed. Please try again.", 502);
    }
    generated = Buffer.from(b64, "base64");
  } catch (err: any) {
    // Log the message ONLY -- never the API key or image bytes. Refund the slot:
    // a provider error, network failure, or timeout must not spend a daily slot.
    console.error("headshot gen error:", err?.message || "unknown error");
    return await refundAndFail("Generation failed. Please try again.", 502);
  }

  // Store the result encrypted, RETAINING the original (a NEW asset pointing at
  // it via source_asset_id -- never an overwrite). gpt-image-1 returns PNG.
  try {
    const sha256 = createHash("sha256").update(generated).digest("hex");
    const key = makeSecureObjectKey(userId, "headshot");
    const secure = await putEncryptedObject({
      ownerUserId: userId,
      purpose: "headshot",
      key,
      plaintext: generated,
      mimeType: "image/png",
      sha256,
    });
    const asset = await createAvatarAsset({
      userId,
      secureObjectId: secure.id,
      kind: "generated_headshot",
      sourceAssetId: source.id,
      width: 1024,
      height: 1024,
    });

    // Log the paid call as a flat per-image estimate (image models have no token
    // count). Fire-and-forget; never blocks or fails the response.
    recordFlatUsage("openai", "gpt-image-1", GPT_IMAGE_1_EST_COST_USD, {
      userId,
      endpoint: HEADSHOT_GENERATE_ENDPOINT,
    });

    // Return metadata only -- NEVER the bytes. The image is served through the
    // owner-exclusive proxy.
    return NextResponse.json(
      {
        data: {
          id: asset.id,
          kind: asset.kind,
          source_asset_id: asset.source_asset_id,
          width: asset.width,
          height: asset.height,
          created_at: asset.created_at,
          mime_type: secure.mime_type,
          byte_size: secure.byte_size,
          imageUrl: `/api/avatar/${asset.id}/image`,
        },
      },
      { status: 201 }
    );
  } catch (err: any) {
    // The paid image was generated but could not be stored. Refund the slot so the
    // user can retry without penalty for an infrastructure failure on our side.
    console.error("headshot gen store error:", err?.message || "unknown error");
    return await refundAndFail("Could not save the generated headshot. Please try again.", 500);
  }
}
