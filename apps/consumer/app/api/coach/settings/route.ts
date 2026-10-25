/**
 * Coach settings (master plan Section 5, Settings -> "Your Coach").
 *
 * GET  -> { coachName, coachStyle, coachLength, coachFocus, coachCreativity,
 *           coachVoice, coachPlainLanguage, coachLanguage }
 * POST -> PARTIAL update: only the fields present in the body change (the
 *         chat gear panel posts single toggles; posting a full shape still
 *         works). Enums validated, creativity clamped to 0-100. A key
 *         that is absent or invalid changes nothing.
 */

import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { settingsRefusal } from "@/lib/settings-guard";
import { query, getOne } from "@crucible/core";
import { coachSettingsPatch } from "@/lib/coach-settings";

export const maxDuration = 10;


export async function GET() {
  const session = await auth();
  { const refused = settingsRefusal(session, "preference", "read"); if (refused) return refused; }
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
  { const refused = settingsRefusal(session, "preference", "write"); if (refused) return refused; }
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  // Partial update: only the fields the caller sent, and sent valid, change.
  // An absent key is never given a default (lib/coach-settings.ts).
  const patch = coachSettingsPatch(body);
  const params: unknown[] = [userId, ...patch.map(([, v]) => v)];
  const sets = patch.map(([column], i) => `${column} = $${i + 2}`);

  if (!sets.length) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  await query(`UPDATE users SET ${sets.join(", ")} WHERE id = $1`, params);

  return NextResponse.json({ ok: true });
}
