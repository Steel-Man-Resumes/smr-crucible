/**
 * Consent API -- the user controls their own layered consent.
 * GET  -> the user's current consent records (for the settings toggles).
 * POST -> grant or revoke one layer { layer, action: "grant" | "revoke" }.
 *         { layer: "sharing", action: "grant", source: "join_prompt" } is the
 *         same grant, answered from the one-time prompt after joining an
 *         organization. It is recorded with the prompt's own wording version.
 *
 * 'core' is not user-toggleable here (it is essential service operation).
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getUserConsents,
  grantConsent,
  revokeConsent,
  getJoinSharingPrompt,
  type ConsentLayer,
} from "@crucible/core";
import { consentGrantRecord } from "@/lib/join-sharing-prompt";

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

  let body: { layer?: string; action?: string; source?: string };
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
    // Mutual exclusivity: outcome_anonymous and outcome_named are two
    // answers to the same question ("can we publish your success story, and
    // how"). Granting one first force-revokes the other so a user can never
    // hold both at once -- the revoke is recorded as its own history event so
    // "why did this turn off" is answerable later.
    const OPPOSING: Partial<Record<ConsentLayer, ConsentLayer>> = {
      outcome_named: "outcome_anonymous",
      outcome_anonymous: "outcome_named",
    };
    if (action === "grant" && OPPOSING[layer as ConsentLayer]) {
      const opposing = OPPOSING[layer as ConsentLayer]!;
      await revokeConsent(session.user.id, opposing, {
        collectionMethod: "settings",
        context: { reason: "mutual_exclusivity" },
      });
    }

    // Where the yes came from decides which words are on record for it. The
    // organization is looked up here, never taken from the request, and a
    // "join_prompt" grant is refused unless that prompt really applies.
    let joinOrgId: string | null = null;
    if (body.source === "join_prompt") {
      const prompt = layer === "sharing" && action === "grant" ? await getJoinSharingPrompt(session.user.id) : { show: false as const };
      if (!prompt.show) {
        return NextResponse.json({ error: "There is nothing to answer. Use Settings to change sharing." }, { status: 409 });
      }
      joinOrgId = prompt.orgId;
    }
    const grant = consentGrantRecord(joinOrgId ? "join_prompt" : "settings", CONSENT_TEXT_VERSION, joinOrgId);

    const record =
      action === "grant"
        ? await grantConsent(
            session.user.id,
            layer as ConsentLayer,
            grant.textVersion,
            grant.context,
            { collectionMethod: grant.collectionMethod, context: grant.eventContext }
          )
        : await revokeConsent(session.user.id, layer as ConsentLayer, {
            collectionMethod: "settings",
          });
    return NextResponse.json({ consent: record });
  } catch (err: any) {
    console.error("Consent update error:", err?.message || err);
    return NextResponse.json({ error: "Could not update consent" }, { status: 500 });
  }
}
