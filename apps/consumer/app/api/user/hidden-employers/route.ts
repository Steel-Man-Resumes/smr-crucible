/**
 * N1: manage the user's hidden employers.
 *   GET    -> { employers: HiddenEmployer[] }
 *   POST   { name, reason? } -> hide an employer  -> { employer }
 *   DELETE { id }            -> un-hide           -> { success }
 * Auth required (the list is private per user).
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  hideEmployer,
  unhideEmployer,
  listHiddenEmployers,
} from "@crucible/core";

export const maxDuration = 10;

async function userId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function GET() {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const employers = await listHiddenEmployers(uid);
  return NextResponse.json({ employers });
}

export async function POST(request: Request) {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason : undefined;
  if (!name) return NextResponse.json({ error: "Employer name required" }, { status: 400 });
  if (name.length > 200) return NextResponse.json({ error: "Name too long" }, { status: 400 });
  const employer = await hideEmployer(uid, name, reason);
  if (!employer) return NextResponse.json({ error: "Could not hide that employer" }, { status: 400 });
  return NextResponse.json({ employer }, { status: 201 });
}

export async function DELETE(request: Request) {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = await unhideEmployer(uid, id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
