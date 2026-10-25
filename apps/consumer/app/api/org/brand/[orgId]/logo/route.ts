/**
 * GET /api/org/brand/{orgId}/logo -- an organization's logo, to the people
 * who belong to it.
 *
 * Who gets bytes is decided by the database: org_brand is row-level protected
 * and readLogo runs as the signed-in user, so the row is visible only to the
 * organization's owner, its staff, a member who joined with its code, or a
 * platform admin. Everyone else, and an organization with no logo, gets the
 * same 404, so the answer never says whether a stranger's organization has
 * one. The bytes were checked on upload (PNG, JPEG or WebP; never SVG) and are
 * served with nosniff and a sandboxing CSP all the same.
 *
 * effectiveAuth so a platform admin's view-as shows what that person sees;
 * impersonation is admin-only and a platform admin may read any logo anyway.
 */
import { NextResponse } from "next/server";
import { effectiveAuth } from "@/lib/effective-auth";
import { readOrgLogo } from "@crucible/core";

export const runtime = "nodejs";
export const maxDuration = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = () => NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const session = await effectiveAuth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });

  const { orgId } = await context.params;
  if (!UUID.test(orgId)) return NOT_FOUND();

  const logo = await readOrgLogo(userId, orgId).catch((err: unknown) => {
    console.error("[org logo] read failed:", (err as Error)?.message || err);
    return null;
  });
  if (!logo) return NOT_FOUND();

  const etag = `"${logo.sha256.slice(0, 32)}"`;
  const headers: Record<string, string> = {
    "Cache-Control": "private, max-age=3600",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": "inline",
    Vary: "Cookie",
  };
  if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });

  const body = new Uint8Array(logo.bytes);
  return new NextResponse(body, {
    status: 200,
    headers: { ...headers, "Content-Type": logo.mime, "Content-Length": String(body.length) },
  });
}
