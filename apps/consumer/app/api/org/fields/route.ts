/**
 * The organization's custom fields (migration 104).
 *   GET  ?entity=participant|enrollment&retired=1   definitions, in order
 *   POST { action: "create", label, entity, type, required?, help?, sensitive?, options? }
 *        { action: "update", id, label?, help?, required?, sensitive?, options? }
 *        { action: "retire" | "restore", id }
 *        { action: "reorder", entity, ids: [...] }
 * Reading needs org.cohort.view; every change needs org.settings.manage
 * (checked here, again in core, and by the database policy).
 */
import { NextResponse } from "next/server";
import {
  canManageFields, createFieldDef, isCustomFieldEntity, listFieldDefs, reorderFieldDefs, setFieldRetired, updateFieldDef,
} from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view");
  if (!guard.ok) return guard.response;
  const sp = new URL(request.url).searchParams;
  const entity = sp.get("entity");
  const defs = await listFieldDefs(guard.actor, {
    entity: isCustomFieldEntity(entity) ? entity : undefined,
    includeRetired: sp.get("retired") === "1",
  });
  return NextResponse.json({ defs, canManage: canManageFields(guard.actor) });
}

export async function POST(request: Request) {
  const guard = await requireOrgCapability("org.settings.manage");
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  let res;
  switch (body.action) {
    case "create": res = await createFieldDef(guard.actor, body); break;
    case "update": res = await updateFieldDef(guard.actor, id, body); break;
    case "retire": res = await setFieldRetired(guard.actor, id, true); break;
    case "restore": res = await setFieldRetired(guard.actor, id, false); break;
    case "reorder": {
      const ok = isCustomFieldEntity(body.entity) && Array.isArray(body.ids) && (await reorderFieldDefs(guard.actor, body.entity, body.ids));
      return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "The new order did not save. Try again." }, { status: 400 });
    }
    default: return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  return res.ok ? NextResponse.json(res) : NextResponse.json({ error: res.error }, { status: 400 });
}
