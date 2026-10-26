/**
 * The phone number and other names the organization keeps for a person (its
 * own record, migration 105 participant_contact), used by search and the
 * duplicate check.
 *   GET                         { contact, canWrite }
 *   POST { phone, aliases }     save (aliases: up to five other names)
 */
import { NextResponse } from "next/server";
import { getParticipantContact, setParticipantContact } from "@crucible/core";
import { crmGate, refuseCrossOrigin, readJson, UUID } from "@/lib/org-crm-gate";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = await crmGate();
  if (!g.ok) return g.response;
  const contact = UUID.test(id) ? await getParticipantContact(g.actor, id) : null;
  if (!contact) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ contact, canWrite: g.actor.capabilities.has("org.note.write") && !g.actor.viaPlatformAdmin });
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const cross = refuseCrossOrigin(request);
  if (cross) return cross;
  const { id } = await props.params;
  const g = await crmGate("org.note.write");
  if (!g.ok) return g.response;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const b = await readJson(request);
  const res = await setParticipantContact(g.actor, id, { phone: typeof b.phone === "string" ? b.phone : null, aliases: b.aliases });
  return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.error }, { status: 400 });
}
