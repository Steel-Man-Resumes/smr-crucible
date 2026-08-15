/**
 * Phase 6.2 vault -- single-document metadata edit + delete.
 *
 *   PATCH  /api/vault/documents/[id]  -> edit category/label/note/linked job
 *   DELETE /api/vault/documents/[id]  -> remove the document AND its bytes
 *
 * Owner-exclusive: the user id is taken only from the session; every core call is
 * scoped to it. A foreign or missing id returns 404, never another user's data.
 * Uses the NON-impersonatable auth() (not effectiveAuth) so an admin in an
 * impersonation session cannot edit or delete another person's vault documents.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  updateVaultDocument,
  deleteVaultDocument,
  getOne,
  isVaultCategory,
} from "@crucible/core";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** PATCH -- metadata-only edit. */
export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const patch: {
    category?: any;
    label?: string;
    note?: string | null;
    linkedJobId?: string | null;
  } = {};

  if ("category" in body) {
    if (!isVaultCategory(body.category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    patch.category = body.category;
  }
  if ("label" in body) {
    const label = typeof body.label === "string" ? body.label.trim().slice(0, 200) : "";
    if (!label) {
      return NextResponse.json({ error: "Give this document a short name." }, { status: 400 });
    }
    patch.label = label;
  }
  if ("note" in body) {
    patch.note =
      typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 2000) : null;
  }
  if ("linkedJobId" in body) {
    if (body.linkedJobId === null || body.linkedJobId === "") {
      patch.linkedJobId = null;
    } else if (typeof body.linkedJobId === "string") {
      // Only accept a job this user owns; anything else unlinks.
      const owned = await getOne<{ id: string }>(
        "SELECT id FROM job_application WHERE id = $1 AND user_id = $2",
        [body.linkedJobId.trim(), userId]
      );
      patch.linkedJobId = owned ? owned.id : null;
    }
  }

  const updated = await updateVaultDocument(userId, id, patch);
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ data: updated });
}

/** DELETE -- remove the document and enqueue its encrypted bytes for deletion. */
export async function DELETE(_request: Request, context: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await context.params;
  const result = await deleteVaultDocument(userId, id);
  if (result.status === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
