/**
 * Consent API -- the user controls their own layered consent.
 * GET  -> the user's current consent records (for the settings toggles).
 * POST -> grant or revoke one layer { layer, action: "grant" | "revoke" }.
 *
 * 'core' is not user-toggleable here (it is essential service operation).
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getUserConsents,
  grantConsent,
  revokeConsent,
  type ConsentLayer,
} from "@crucible/core";

export const maxDuration = 10;

// Layers the user may toggle themselves. 'core' is excluded by design.
const TOGGLEABLE: ConsentLayer[] = [
  "enhanced",
  "research",
  "sharing",
  "outcome_anonymous",
  "outcome_named",
];
const CONSENT_TEXT_VERSION = "2026-06-07-v1";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const consents = await getUserConsents(session.user.id);
  return NextResponse.json({ consents });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { layer?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { layer, action } = body;
  if (!layer || !TOGGLEABLE.includes(layer as ConsentLayer)) {
    return NextResponse.json({ error: "Invalid or non-toggleable consent layer" }, { status: 400 });
  }
  if (action !== "grant" && action !== "revoke") {
    return NextResponse.json({ error: "action must be 'grant' or 'revoke'" }, { status: 400 });
  }

  try {
    const record =
      action === "grant"
        ? await grantConsent(session.user.id, layer as ConsentLayer, CONSENT_TEXT_VERSION, {
            collected_from: "settings",
          })
        : await revokeConsent(session.user.id, layer as ConsentLayer);
    return NextResponse.json({ consent: record });
  } catch (err: any) {
    console.error("Consent update error:", err?.message || err);
    return NextResponse.json({ error: "Could not update consent" }, { status: 500 });
  }
}
