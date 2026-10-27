/**
 * Staff rewards (migration 111, lane S6): the Wins page and the switches.
 *
 *   GET                                   everything the Wins page shows
 *   PUT { rewardsOn?, boardOk? }          my own switch (only mine; default off)
 *   PUT { program: { teamBoardOn?, recognitionNotesOn?, programRewards? } }
 *                                         owner or org admin
 *   POST { action: "seen", keys: [...] }  celebrations I have seen
 *
 * Wins are private: a platform admin viewing as a staff member sees the off
 * state, never their milestones. Every write is the person's own.
 */
import { NextResponse } from "next/server";
import { getWins, setRewardsSettings, setProgramRewards, markMilestonesSeen, listMyContributions, approvedInWindow, monthWindow, DEFAULT_REWARDS_SETTINGS } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";
import { effectiveAuth } from "@/lib/effective-auth";
import { mayWrite, VIEWING_REFUSAL } from "@/lib/staff-rewards-route";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return guard.response;
  const { actor } = guard;
  if (guard.viewing || actor.viaPlatformAdmin) {
    return NextResponse.json({ viewing: true, settings: DEFAULT_REWARDS_SETTINGS }, { headers: NO_STORE });
  }
  const now = Date.now();
  const month = monthWindow(now);
  const mine = await listMyContributions(actor).catch(() => []);
  const wins = await getWins(actor, now, approvedInWindow(mine, month.fromMs, month.toMs));
  return NextResponse.json({ viewing: false, isManager: actor.role === "owner" || actor.role === "org_admin", ...wins }, { headers: NO_STORE });
}

async function writer(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return { response: guard.response } as const;
  const session = await effectiveAuth();
  if (!mayWrite({ viewing: guard.viewing, viaPlatformAdmin: guard.actor.viaPlatformAdmin, actorUserId: guard.actor.userId, sessionUserId: session?.user?.id })) {
    return { response: NextResponse.json({ error: VIEWING_REFUSAL }, { status: 403 }) } as const;
  }
  return { actor: guard.actor } as const;
}

export async function PUT(request: Request) {
  const w = await writer(request);
  if ("response" in w) return w.response;
  const body = await request.json().catch(() => ({}));
  if (body && typeof body.program === "object" && body.program) {
    const p = body.program as Record<string, unknown>;
    const res = await setProgramRewards(w.actor, {
      teamBoardOn: typeof p.teamBoardOn === "boolean" ? p.teamBoardOn : undefined,
      recognitionNotesOn: typeof p.recognitionNotesOn === "boolean" ? p.recognitionNotesOn : undefined,
      programRewards: p.programRewards === undefined ? undefined : (p.programRewards === null ? null : String(p.programRewards)),
    });
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 403 });
    return NextResponse.json({ program: res.value });
  }
  const next = await setRewardsSettings(w.actor, {
    rewardsOn: typeof body?.rewardsOn === "boolean" ? body.rewardsOn : undefined,
    boardOk: typeof body?.boardOk === "boolean" ? body.boardOk : undefined,
  });
  if (!next) return NextResponse.json({ error: VIEWING_REFUSAL }, { status: 403 });
  return NextResponse.json({ settings: next });
}

export async function POST(request: Request) {
  const w = await writer(request);
  if ("response" in w) return w.response;
  const body = await request.json().catch(() => ({}));
  if (body?.action !== "seen" || !Array.isArray(body.keys)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const n = await markMilestonesSeen(w.actor, body.keys.map((k: unknown) => String(k)));
  return NextResponse.json({ ok: true, marked: n });
}
