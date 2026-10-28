/**
 * Change your OWN view, one change at a time (staff build S3). The same typed
 * action layer t.ROY's view tools call (core viewActions.ts), so the checks
 * are the same whoever asks: the organization's customization policy for
 * your role (108), the allowlists, never a platform admin acting for an org,
 * never under view-as (the guard refuses every write there).
 *
 *   POST { action, ...input }   action is one of VIEW_ACTIONS (setTodayOrder,
 *                               foldSection, hideSection, setColumns,
 *                               setColumnWidth, setGridLayout, setDensity,
 *                               setPeopleMode, setDefaultView, saveMyView,
 *                               updateMyView, deleteMyView, setPersonTabsOrder,
 *                               undoViewChange)
 * Answers { ok, changeId, summary, prefs?, view? } or { error, reason }.
 * Every change lands in your view change log (Undo on My setup).
 */
import { NextResponse } from "next/server";
import { dispatchViewAction, VIEW_ACTIONS } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = { policy: 403, access: 403, missing: 404, invalid: 400, unchanged: 409, failed: 500 };

export async function POST(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  if (!(VIEW_ACTIONS as readonly string[]).includes(body?.action)) return NextResponse.json({ error: "Unknown change.", reason: "invalid" }, { status: 400 });
  const { action, ...input } = body;
  const res = await dispatchViewAction(guard.actor, action, input, { byAi: false });
  if (!res.ok) return NextResponse.json({ error: res.error, reason: res.reason }, { status: STATUS[res.reason] ?? 400 });
  return NextResponse.json(res);
}
