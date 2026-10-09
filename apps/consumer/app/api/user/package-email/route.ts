/**
 * The finished-package email switch (078, users.forge_package_email).
 * GET  -> { on, email, proven }
 * POST -> { on: boolean } (same-origin JSON, signed in)
 * Sends nothing.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { forgeSessionUser } from "@/lib/session-policy";
import { isSameOriginJsonPost } from "@/lib/same-origin";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = forgeSessionUser(await auth());
  if (!user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { getPackageEmailTarget } = await import("@crucible/core");
  const t = await getPackageEmailTarget(user.id);
  return NextResponse.json({ data: { on: t?.on !== false, email: t?.email ?? null, proven: t?.proven === true } });
}

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  const user = forgeSessionUser(await auth());
  if (!user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.on !== "boolean") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { setPackageEmailPref } = await import("@crucible/core");
  const ok = await setPackageEmailPref(user.id, body.on);
  if (!ok) return NextResponse.json({ error: "This setting isn't available yet." }, { status: 503 });
  return NextResponse.json({ ok: true, on: body.on });
}
