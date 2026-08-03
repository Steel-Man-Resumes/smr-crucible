/**
 * Coach settings (master plan Section 5, Settings -> "Your Coach").
 *
 * GET  -> { coachName, coachStyle, coachLength, coachFocus, coachCreativity,
 *           coachVoice, coachPlainLanguage, coachLanguage }
 * POST -> PARTIAL update: only the fields present in the body change (the
 *         chat gear panel posts single toggles; posting a full shape still
 *         works). Enums validated, creativity clamped to 0-100.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, getOne } from "@crucible/core";

export const maxDuration = 10;

const STYLES = ["supportive", "balanced", "direct"];
const LENGTHS = ["brief", "full"];
const FOCI = ["guide", "answer"];
const LANGUAGES = ["en", "es"];

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
    coach_voice: boolean;
    coach_plain_language: boolean;
    coach_language: string;
  }>(
    `SELECT coach_name, coach_style, coach_length, coach_focus, coach_creativity,
            coach_voice, coach_plain_language, coach_language
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
      coachVoice: !!row?.coach_voice,
      coachPlainLanguage: !!row?.coach_plain_language,
      coachLanguage: row?.coach_language === "es" ? "es" : "en",
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

  // Partial update: collect only the fields the caller actually sent.
  const sets: string[] = [];
  const params: unknown[] = [userId];

  function set(column: string, value: unknown) {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }

  if (typeof body.coachName === "string" && body.coachName.trim()) {
    set("coach_name", body.coachName.trim().slice(0, 40));
  }
  if (STYLES.includes(body.coachStyle)) set("coach_style", body.coachStyle);
  if (LENGTHS.includes(body.coachLength)) set("coach_length", body.coachLength);
  if (FOCI.includes(body.coachFocus)) set("coach_focus", body.coachFocus);
  if (body.coachCreativity !== undefined) {
    const raw = parseInt(String(body.coachCreativity), 10);
    set("coach_creativity", Math.min(Math.max(Number.isFinite(raw) ? raw : 50, 0), 100));
  }
  if (typeof body.coachVoice === "boolean") set("coach_voice", body.coachVoice);
  if (typeof body.coachPlainLanguage === "boolean") {
    set("coach_plain_language", body.coachPlainLanguage);
  }
  if (LANGUAGES.includes(body.coachLanguage)) set("coach_language", body.coachLanguage);

  if (!sets.length) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  await query(`UPDATE users SET ${sets.join(", ")} WHERE id = $1`, params);

  return NextResponse.json({ ok: true });
}
