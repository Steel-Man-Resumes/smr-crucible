/**
 * Placements and retention check-ins.
 *   GET  ?clientId=
 *   POST { action: "record", clientId, employer, jobTitle?, startDate, hourlyWage?, hoursPerWeek?, source, verificationMethod? }
 *        { action: "check", outcomeId, dayMark, status, method, note? }
 *        { action: "end", outcomeId, endedOn, reason }
 */
import { NextResponse } from "next/server";
import {
  getOne, listOutcomes, recordOutcome, recordRetentionCheck, endOutcome,
  OUTCOME_SOURCES, OUTCOME_SOURCE_LABELS, VERIFICATION_METHODS, VERIFICATION_METHOD_LABELS, END_REASONS, END_REASON_LABELS,
} from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v: unknown) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

async function gate() {
  const guard = await requireOrgCapability("org.client.view_content");
  if (!guard.ok) return guard;
  const flag = await getOne<{ crm_v2: boolean }>(`SELECT crm_v2 FROM access_code WHERE id = $1`, [guard.actor.orgId]);
  if (!flag?.crm_v2) return { ok: false as const, response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  return guard;
}

export async function GET(request: Request) {
  const g = await gate();
  if (!g.ok) return g.response;
  const clientId = new URL(request.url).searchParams.get("clientId");
  if (clientId && !UUID.test(clientId)) return NextResponse.json({ outcomes: [] });
  return NextResponse.json({
    outcomes: (await listOutcomes(g.actor, clientId ?? undefined)) ?? [],
    canWrite: g.actor.capabilities.has("org.outcome.write"),
    options: {
      sources: OUTCOME_SOURCES.map((s) => ({ value: s, label: OUTCOME_SOURCE_LABELS[s] })),
      methods: VERIFICATION_METHODS.map((m) => ({ value: m, label: VERIFICATION_METHOD_LABELS[m] })),
      endReasons: END_REASONS.map((r) => ({ value: r, label: END_REASON_LABELS[r] })),
    },
  });
}

export async function POST(request: Request) {
  const g = await gate();
  if (!g.ok) return g.response;
  const b = await request.json().catch(() => ({}));
  const bad = () => NextResponse.json({ error: "Not found." }, { status: 404 });
  let res;
  if (b.action === "record") {
    if (!UUID.test(String(b.clientId ?? ""))) return bad();
    res = await recordOutcome(g.actor, { clientId: String(b.clientId), employer: String(b.employer ?? ""), jobTitle: b.jobTitle ? String(b.jobTitle) : null,
      startDate: String(b.startDate ?? ""), hourlyWage: num(b.hourlyWage), hoursPerWeek: num(b.hoursPerWeek), source: String(b.source ?? ""), verificationMethod: b.verificationMethod ? String(b.verificationMethod) : null });
  } else if (b.action === "check") {
    if (!UUID.test(String(b.outcomeId ?? ""))) return bad();
    res = await recordRetentionCheck(g.actor, { outcomeId: String(b.outcomeId), dayMark: Number(b.dayMark), status: String(b.status ?? ""), method: String(b.method ?? ""), note: b.note ? String(b.note) : null });
  } else if (b.action === "end") {
    if (!UUID.test(String(b.outcomeId ?? ""))) return bad();
    res = await endOutcome(g.actor, String(b.outcomeId), String(b.endedOn ?? ""), String(b.reason ?? ""));
  } else return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.error }, { status: 400 });
}
