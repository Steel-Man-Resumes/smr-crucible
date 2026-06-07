/**
 * Coach settings (master plan Section 5, Settings -> "Your Coach").
 *
 * GET  -> { coachName, coachStyle, coachLength, coachFocus, coachCreativity }
 * POST -> same shape; validates enums and clamps creativity to 0-100.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, getOne } from "@crucible/core";

export const maxDuration = 10;

const STYLES = ["supportive", "balanced", "direct"];
const LENGTHS = ["brief", "full"];
const FOCI = ["guide", "answer"];

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const row = await getOne<{
    coach_name: string;
    coach_style: string;
    coach_length: string;
    coach_focus: string;
    coach_creativity: number;
  }>(
    `SELECT coach_name, coach_style, coach_length, coach_focus, coach_creativity
       FROM users WHERE id = $1`,
    [userId]
  );
  return NextResponse.json({
    data: {
      coachName: row?.coach_name || "Guide",
      coachStyle: row?.coach_style || "balanced",
      coachLength: row?.coach_length || "full",
      coachFocus: row?.coach_focus || "guide",
      coachCreativity: row?.coach_creativity ?? 50,
    },
  });
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name =
    typeof body.coachName === "string" && body.coachName.trim()
      ? body.coachName.trim().slice(0, 40)
      : "Guide";
  const style = STYLES.includes(body.coachStyle) ? body.coachStyle : "balanced";
  const length = LENGTHS.includes(body.coachLength) ? body.coachLength : "full";
  const focus = FOCI.includes(body.coachFocus) ? body.coachFocus : "guide";
  const creativityRaw = parseInt(String(body.coachCreativity), 10);
  const creativity = Math.min(Math.max(Number.isFinite(creativityRaw) ? creativityRaw : 50, 0), 100);

  await query(
    `UPDATE users
        SET coach_name = $2, coach_style = $3, coach_length = $4,
            coach_focus = $5, coach_creativity = $6
      WHERE id = $1`,
    [userId, name, style, length, focus, creativity]
  );

  return NextResponse.json({ ok: true });
}
