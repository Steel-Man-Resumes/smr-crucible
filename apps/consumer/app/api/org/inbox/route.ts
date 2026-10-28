/**
 * The staff inbox (staff side lane S4, migration 109). Only ever the caller's
 * own items: core names the session as the recipient, and so does the
 * database policy.
 *   GET  ?count=1                          { unread } for the nav
 *   GET  ?filter=all|talk|tasks|changes|reviews&unread=1&before=<iso>
 *   POST { action: "read" | "unread", ids: [...] } | { action: "read_all" }
 */
import { NextResponse } from "next/server";
import { requireOrgCapability } from "@/lib/org-guard";
import { listInbox, inboxUnreadCount, markInbox, INBOX_FILTERS } from "@crucible/core";
import { withCrm, refuseCrossOrigin, readJson } from "@/lib/org-crm-gate";

export const dynamic = "force-dynamic";

async function gate(request: Request) {
  return withCrm(await requireOrgCapability("org.cohort.view", { request }));
}

export async function GET(request: Request) {
  const g = await gate(request);
  if (!g.ok) return g.response;
  const u = new URL(request.url);
  if (u.searchParams.get("count") === "1") return NextResponse.json({ unread: await inboxUnreadCount(g.actor) });
  const page = await listInbox(g.actor, { filter: u.searchParams.get("filter"), unreadOnly: u.searchParams.get("unread") === "1", before: u.searchParams.get("before") });
  if (!page) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  return NextResponse.json({ ...page, filters: INBOX_FILTERS.map((f) => ({ key: f.key, label: f.label })), canMark: !g.actor.viewedBy });
}

export async function POST(request: Request) {
  const cross = refuseCrossOrigin(request);
  if (cross) return cross;
  const g = await gate(request);
  if (!g.ok) return g.response;
  const b = await readJson(request);
  const changed =
    b.action === "read_all" ? await markInbox(g.actor, { all: true, read: true })
    : b.action === "read" || b.action === "unread" ? await markInbox(g.actor, { ids: b.ids, read: b.action === "read" })
    : undefined;
  if (changed === undefined) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  if (changed === null) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  return NextResponse.json({ ok: true, changed, unread: await inboxUnreadCount(g.actor) });
}
