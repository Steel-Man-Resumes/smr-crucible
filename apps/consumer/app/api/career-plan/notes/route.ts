/**
 * "Still deciding": the person's own career planner notes, kept in
 * consumer_profile.profile_data.careerPlanNotes (row-level security, owner
 * only; exported with the rest of the profile and deleted with the account).
 *
 * The note is built on the server from validated pieces only: catalogue
 * directions, the person's multiple-choice answers and the next small step.
 * Free text from the conversation is never saved (AGENTS rule 9: what a
 * person said is stored only through conversationStore).
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { queryAsUser, incrementUserUsage, refundUserUsage } from "@crucible/core";
import { revisionCaller } from "@/lib/revision-route";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { readPlanAnswers } from "@/lib/career-plan/questions";
import { buildPlanNote, NOTES_MAX } from "@/lib/career-plan/plan";
import { loadCareerContext } from "@/lib/career-plan/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const NOTES = `CASE WHEN jsonb_typeof(consumer_profile.profile_data->'careerPlanNotes') = 'array' THEN consumer_profile.profile_data->'careerPlanNotes' ELSE '[]'::jsonb END`;

export async function GET() {
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status, headers });
  try { return NextResponse.json({ notes: (await loadCareerContext(caller.userId)).notes }, { headers }); }
  catch { return NextResponse.json({ error: "Your notes couldn't be loaded. Try again." }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Open this page from the Refinery." }, { status: 403, headers });
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status, headers });
  const raw = await request.text().catch(() => "");
  if (raw.length > 8000) return NextResponse.json({ error: "That note is too big to save." }, { status: 413, headers });
  let body: { directionIds?: unknown; answers?: unknown } | null = null;
  try { body = JSON.parse(raw); } catch { /* handled below */ }
  const answers = readPlanAnswers(body?.answers) ?? {};
  const note = buildPlanNote({ id: randomUUID(), now: new Date(), directionIds: body?.directionIds, answers });
  if (!note) return NextResponse.json({ error: "Nothing to save yet. Get your three directions first." }, { status: 400, headers });
  const userId = caller.userId;
  let counted = false;
  try {
    const used = await incrementUserUsage(userId, "career-plan-note");
    counted = true;
    if (used > 30) return NextResponse.json({ error: "You've saved a lot of notes today. Your earlier ones are safe. Try again tomorrow." }, { status: 429, headers });
    const rows = await queryAsUser(userId,
      `INSERT INTO consumer_profile (user_id, profile_data) VALUES ($1, jsonb_build_object('careerPlanNotes', jsonb_build_array($2::jsonb)))
       ON CONFLICT (user_id) DO UPDATE SET
         profile_data = COALESCE(consumer_profile.profile_data, '{}'::jsonb) || jsonb_build_object('careerPlanNotes',
           (SELECT COALESCE(jsonb_agg(e ORDER BY n), '[]'::jsonb) FROM (
              SELECT e, n FROM jsonb_array_elements(jsonb_build_array($2::jsonb) || ${NOTES}) WITH ORDINALITY AS t(e, n)
              ORDER BY n LIMIT ${NOTES_MAX}) kept)),
         updated_at = now()
       RETURNING user_id`, [userId, JSON.stringify(note)]);
    if (!rows.length) throw new Error("no row");
    return NextResponse.json({ note }, { headers });
  } catch {
    // A failed save does not use up one of today's saves.
    if (counted) await refundUserUsage(userId, "career-plan-note").catch(() => {});
    return NextResponse.json({ error: "Your note wasn't saved. Try again." }, { status: 503, headers });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Open this page from the Refinery." }, { status: 403, headers });
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status, headers });
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const id = typeof body?.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: "Pick a note to delete." }, { status: 400, headers });
  try {
    await queryAsUser(caller.userId,
      `UPDATE consumer_profile SET profile_data = profile_data || jsonb_build_object('careerPlanNotes',
         (SELECT COALESCE(jsonb_agg(e ORDER BY n), '[]'::jsonb) FROM jsonb_array_elements(${NOTES}) WITH ORDINALITY AS t(e, n) WHERE e->>'id' IS DISTINCT FROM $2)),
         updated_at = now()
       WHERE user_id = $1`, [caller.userId, id]);
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json({ error: "That note wasn't deleted. Try again." }, { status: 503, headers });
  }
}
