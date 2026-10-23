import { NextResponse } from "next/server";
import { getOneAsUser, queryAsUser } from "@crucible/core";
import { revisionCaller } from "@/lib/revision-route";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { readJobFit } from "@/lib/job-fit";

export async function GET() {
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const row = await getOneAsUser<{ job_fit: unknown }>(caller.userId,
    "SELECT preferences->'jobFit' AS job_fit FROM consumer_profile WHERE user_id=$1", [caller.userId]);
  return NextResponse.json({ preferences: readJobFit(row?.job_fit) }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const raw = await request.text();
  if (raw.length > 4096) return NextResponse.json({ error: "Too much text" }, { status: 413 });
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid preferences" }, { status: 400 }); }
  const preferences = readJobFit(value);
  await queryAsUser(caller.userId,
    `INSERT INTO consumer_profile (user_id, preferences) VALUES ($1, jsonb_build_object('jobFit', $2::jsonb))
     ON CONFLICT (user_id) DO UPDATE SET preferences=COALESCE(consumer_profile.preferences, '{}'::jsonb) || jsonb_build_object('jobFit', $2::jsonb), updated_at=now()`,
    [caller.userId, JSON.stringify(preferences)]);
  return NextResponse.json({ preferences });
}
