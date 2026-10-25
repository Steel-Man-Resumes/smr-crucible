/**
 * The organization brand routes' logic, with its dependencies passed in so
 * the tests (lib/__tests__/org-brand-routes.test.ts) run the real handlers:
 * app/api/org/brand/route.ts and app/api/org/brand/[orgId]/logo/route.ts are
 * thin wrappers that supply the session, the guard and the database calls.
 */
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  decideOrgLogo,
  logoShapeNote,
  ORG_LOGO_MAX_BYTES,
  DEFAULT_ORG_BRAND,
  type OrgBrand,
} from "@crucible/core/src/orgBrandShared";

type Actor = { orgId: string; userId: string; role: "owner" | "org_admin" | "staff"; viaPlatformAdmin: boolean };
type WriteResult = { ok: true } | { ok: false; reason: "not_owner" | "not_migrated" | "failed" };

export const WRITE_REFUSED = "Only the organization's owner can change its logo.";
const NOT_READY = "Logos are not switched on yet. Try again after the next update.";
const TOO_BIG = "That logo is over 512 KB. Save it smaller and try again.";
/** Multipart framing around the file: boundary lines and part headers. */
export const MULTIPART_ALLOWANCE = 16 * 1024;
export const UPLOAD_BODY_MAX = ORG_LOGO_MAX_BYTES + MULTIPART_ALLOWANCE;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "private, no-store" };

/** A platform admin acting for an organization never writes its logo. */
export function refusePlatformAdmin(actor: Actor): NextResponse | null {
  return actor.viaPlatformAdmin ? NextResponse.json({ error: WRITE_REFUSED }, { status: 403 }) : null;
}

/**
 * Read the request body, never more than `max` bytes. A missing
 * Content-Length is answered 411 (no chunked uploads), a declared length over
 * the cap 413, and the bytes are counted as they stream, so a body longer than
 * it declared is cut off at the cap rather than buffered.
 */
export async function readBodyCapped(request: Request, max: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; response: NextResponse }> {
  const raw = request.headers.get("content-length");
  if (raw === null || raw.trim() === "" || !/^\d+$/.test(raw.trim())) {
    return { ok: false, response: NextResponse.json({ error: "Upload the logo as a file from the page." }, { status: 411 }) };
  }
  if (Number(raw) > max) return { ok: false, response: NextResponse.json({ error: TOO_BIG }, { status: 413 }) };
  if (!request.body) return { ok: true, bytes: new Uint8Array() };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return { ok: false, response: NextResponse.json({ error: TOO_BIG }, { status: 413 }) };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  return { ok: true, bytes };
}

export async function handleLogoUpload(
  request: Request,
  actor: Actor,
  deps: {
    setOrgLogo: (actor: Actor, logo: { bytes: Uint8Array; mime: string; sha256: string }) => Promise<WriteResult>;
    getOrgBrand: (userId: string, orgId: string) => Promise<OrgBrand>;
  }
): Promise<NextResponse> {
  const refused = refusePlatformAdmin(actor);
  if (refused) return refused;

  const body = await readBodyCapped(request, UPLOAD_BODY_MAX);
  if (!body.ok) return body.response;

  let form: FormData;
  try {
    form = await new Response(body.bytes.buffer as ArrayBuffer, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return NextResponse.json({ error: "Choose an image file to upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an image file to upload." }, { status: 400 });
  if (file.size > ORG_LOGO_MAX_BYTES) return NextResponse.json({ error: TOO_BIG }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const decision = decideOrgLogo(file.type, bytes);
  if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const written = await deps.setOrgLogo(actor, { bytes, mime: decision.mime, sha256 });
  if (!written.ok) return writeFailure(written.reason, "The logo did not save. Try again.");
  return NextResponse.json({
    ok: true,
    brand: await deps.getOrgBrand(actor.userId, actor.orgId).catch(() => ({ hasLogo: true, tier: "standard" as const })),
    width: decision.width,
    height: decision.height,
    note: logoShapeNote(decision.width, decision.height),
  });
}

export async function handleLogoRemove(
  actor: Actor,
  deps: { removeOrgLogo: (actor: Actor) => Promise<WriteResult>; getOrgBrand: (userId: string, orgId: string) => Promise<OrgBrand> }
): Promise<NextResponse> {
  const refused = refusePlatformAdmin(actor);
  if (refused) return refused;
  const removed = await deps.removeOrgLogo(actor);
  if (!removed.ok) return writeFailure(removed.reason, "The logo was not removed. Try again.");
  return NextResponse.json({ ok: true, brand: await deps.getOrgBrand(actor.userId, actor.orgId).catch(() => ({ ...DEFAULT_ORG_BRAND })) });
}

function writeFailure(reason: "not_owner" | "not_migrated" | "failed", failed: string): NextResponse {
  const status = reason === "not_owner" ? 403 : reason === "not_migrated" ? 503 : 500;
  const error = reason === "not_owner" ? WRITE_REFUSED : reason === "not_migrated" ? NOT_READY : failed;
  return NextResponse.json({ error }, { status });
}

/**
 * GET the logo. One 404, byte for byte the same, for "no logo" and for "not
 * yours to see" (and for a malformed id), so the route is not an oracle for
 * whether a stranger's organization has a logo.
 */
export async function handleLogoGet(
  request: Request,
  userId: string | null | undefined,
  orgId: string,
  deps: { readOrgLogo: (userId: string, orgId: string) => Promise<{ bytes: Uint8Array; mime: string; sha256: string } | null> }
): Promise<NextResponse> {
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401, headers: noStore });
  const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
  if (!UUID.test(orgId)) return notFound();
  const logo = await deps.readOrgLogo(userId, orgId).catch((err: unknown) => {
    console.error("[org logo] read failed:", (err as Error)?.message || err);
    return null;
  });
  if (!logo) return notFound();

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
  return new NextResponse(body, { status: 200, headers: { ...headers, "Content-Type": logo.mime, "Content-Length": String(body.length) } });
}

/**
 * The brand fields of /api/user/role. Staff (anyone with an org role) get
 * orgId and orgBrand { hasLogo, tier } for the identity block and never a
 * coBrand. Everyone else gets coBrand { orgId, name, hasLogo } (no tier: the
 * chip only needs to exist) or null, and never orgBrand.
 */
export async function roleBrandFields(
  input: { userId: string; orgId: string | null; hasOrgRole: boolean },
  deps: {
    getOrgBrand: (userId: string, orgId: string) => Promise<OrgBrand>;
    getParticipantCoBrand: (userId: string) => Promise<{ orgId: string; name: string; hasLogo: boolean } | null>;
  }
): Promise<{ orgId: string | null; orgBrand: OrgBrand | null; coBrand: { orgId: string; name: string; hasLogo: boolean } | null }> {
  if (input.hasOrgRole) {
    const orgBrand = input.orgId
      ? await deps.getOrgBrand(input.userId, input.orgId).catch(() => ({ ...DEFAULT_ORG_BRAND }))
      : null;
    return { orgId: input.orgId, orgBrand: orgBrand ? { hasLogo: !!orgBrand.hasLogo, tier: orgBrand.tier } : null, coBrand: null };
  }
  const found = await deps.getParticipantCoBrand(input.userId).catch(() => null);
  return { orgId: null, orgBrand: null, coBrand: found ? { orgId: found.orgId, name: found.name, hasLogo: !!found.hasLogo } : null };
}
