/**
 * Pick a listing to refer to: GET ?q=&state=. Checked public listings only
 * (resource_app_v). Staff type a place or a need; nothing about the
 * participant goes into this search.
 */
import { NextResponse } from "next/server";
import { findDirectoryListings, listingName } from "@crucible/core";
import { crmGate } from "@/lib/org-crm-gate";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const g = await crmGate("org.task.write");
  if (!g.ok) return g.response;
  const u = new URL(request.url);
  const rows = await findDirectoryListings(u.searchParams.get("q") ?? "", u.searchParams.get("state"));
  return NextResponse.json({ listings: rows.map((r) => ({ ...r, label: listingName(r) })) });
}
