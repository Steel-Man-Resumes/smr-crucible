/**
 * The organization's logo, managed by its owner (C3 brand, migration 099).
 *
 *   GET    -> { orgId, name, brand: { hasLogo, tier }, canManage }   any staff member
 *   POST   multipart "file" -> sets the logo                         owner only
 *   DELETE -> removes the logo (the branding tier stays)              owner only
 *
 * Owner only means `org.settings.manage`, which only the owner's role bundle
 * carries and which is not delegable, and never a platform admin acting for
 * an organization. The database refuses anyone else too (the 099 guard checks
 * access_code.partner_user_id), so this check is the friendly answer and the
 * table is the control.
 *
 * The file is checked here, server side, whatever the browser said: PNG, JPEG
 * or WebP by its bytes, never SVG, 512 KB at most, 2048 px a side at most.
 * Every set and removal lands in org_audit through the table's trigger.
 */
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { requireOrgCapability } from "@/lib/org-guard";
import {
  decideOrgLogo,
  getOrgBrand,
  removeOrgLogo,
  setOrgLogo,
  logoShapeNote,
  ORG_LOGO_MAX_BYTES,
  DEFAULT_ORG_BRAND,
} from "@crucible/core";

export const runtime = "nodejs";
export const maxDuration = 15;

const WRITE_REFUSED = "Only the organization's owner can change its logo.";
const NOT_READY = "Logos are not switched on yet. Try again after the next update.";

export async function GET() {
  const guard = await requireOrgCapability("org.staff.view");
  if (!guard.ok) return guard.response;
  const { actor } = guard;
  const brand = await getOrgBrand(actor.userId, actor.orgId).catch(() => ({ ...DEFAULT_ORG_BRAND }));
  return NextResponse.json(
    {
      orgId: actor.orgId,
      name: actor.orgName,
      brand,
      canManage: actor.capabilities.has("org.settings.manage") && !actor.viaPlatformAdmin,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

async function ownerActor() {
  const guard = await requireOrgCapability("org.settings.manage");
  if (!guard.ok) return guard;
  if (guard.actor.viaPlatformAdmin) {
    return { ok: false as const, response: NextResponse.json({ error: WRITE_REFUSED }, { status: 403 }) };
  }
  return guard;
}

export async function POST(request: Request) {
  const guard = await ownerActor();
  if (!guard.ok) return guard.response;
  const { actor } = guard;

  // Refuse an oversized body before buffering it (multipart adds a little).
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > ORG_LOGO_MAX_BYTES + 16 * 1024) {
    return NextResponse.json({ error: "That logo is over 512 KB. Save it smaller and try again." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Choose an image file to upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose an image file to upload." }, { status: 400 });
  }
  if (file.size > ORG_LOGO_MAX_BYTES) {
    return NextResponse.json({ error: "That logo is over 512 KB. Save it smaller and try again." }, { status: 413 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decision = decideOrgLogo(file.type, bytes);
  if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const written = await setOrgLogo(actor, { bytes, mime: decision.mime, sha256 });
  if (!written.ok) {
    const status = written.reason === "not_owner" ? 403 : written.reason === "not_migrated" ? 503 : 500;
    const error = written.reason === "not_owner" ? WRITE_REFUSED : written.reason === "not_migrated" ? NOT_READY : "The logo did not save. Try again.";
    return NextResponse.json({ error }, { status });
  }
  return NextResponse.json({
    ok: true,
    brand: await getOrgBrand(actor.userId, actor.orgId).catch(() => ({ hasLogo: true, tier: "standard" as const })),
    width: decision.width,
    height: decision.height,
    note: logoShapeNote(decision.width, decision.height),
  });
}

export async function DELETE() {
  const guard = await ownerActor();
  if (!guard.ok) return guard.response;
  const { actor } = guard;
  const removed = await removeOrgLogo(actor);
  if (!removed.ok) {
    const status = removed.reason === "not_owner" ? 403 : removed.reason === "not_migrated" ? 503 : 500;
    const error = removed.reason === "not_owner" ? WRITE_REFUSED : removed.reason === "not_migrated" ? NOT_READY : "The logo was not removed. Try again.";
    return NextResponse.json({ error }, { status });
  }
  return NextResponse.json({ ok: true, brand: await getOrgBrand(actor.userId, actor.orgId).catch(() => ({ ...DEFAULT_ORG_BRAND })) });
}
