/**
 * Site language (i18n/locale.ts).
 *
 * GET  -> { locale, explicit, account }: the language this browser renders in,
 *         whether a cookie set it, and the signed-in account's own setting.
 * POST -> { locale: "en" | "es" } sets the cookie. Signed in, it also saves the
 *         choice to the account (users.coach_language, the same column the
 *         coach has always read), through the same refusal rules as every
 *         other preference write. Signed out, only the cookie changes.
 *
 * Nothing here reads protected data to pick a language; the cookie is enough.
 */
import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { settingsRefusal } from "@/lib/settings-guard";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { getOne, query } from "@crucible/core";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, isLocale, langCookieValue, resolveLocale, type Locale } from "@/i18n/locale";

export const maxDuration = 10;

function cookieOptions() {
  return {
    name: LANG_COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LANG_COOKIE_MAX_AGE,
  };
}

export async function GET(request: Request) {
  const raw = langCookieValue(request.headers.get("cookie"));
  const session = await auth();
  const userId = session?.user?.id;
  let account: Locale | null = null;
  if (userId) {
    const row = await getOne<{ coach_language: string | null }>(`SELECT coach_language FROM users WHERE id = $1`, [userId]).catch(() => null);
    account = isLocale(row?.coach_language) ? row.coach_language : null;
  }
  return NextResponse.json(
    { locale: resolveLocale(raw), explicit: isLocale(raw), account },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) {
    return NextResponse.json({ error: "Refused." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const locale = (body as { locale?: unknown })?.locale;
  if (!isLocale(locale)) {
    return NextResponse.json({ error: "Unknown language." }, { status: 400 });
  }
  const session = await auth();
  const userId = session?.user?.id;
  if (userId) {
    const refused = settingsRefusal(session, "preference", "write");
    if (refused) return refused;
    await query(`UPDATE users SET coach_language = $2 WHERE id = $1`, [userId, locale]);
  }
  const res = NextResponse.json({ ok: true, locale }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set({ ...cookieOptions(), value: locale });
  return res;
}
