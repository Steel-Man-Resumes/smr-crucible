/**
 * The brand routes' real handlers (lib/org-brand-http.ts) with fake database
 * calls: no oracle on the logo GET, the serving headers, the platform admin
 * refusal, the body cap (411 / 413 / streamed count), and the role payload's
 * brand fields.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  handleLogoGet, handleLogoUpload, handleLogoRemove, readBodyCapped, roleBrandFields, UPLOAD_BODY_MAX, WRITE_REFUSED,
} from "../org-brand-http";

const ORG = "6b1f2c3a-0000-4000-8000-000000000001";
const OTHER = "6b1f2c3a-0000-4000-8000-000000000002";
const MEMBER = "u-member", OUTSIDER = "u-outsider";
const PNG = (() => {
  const head = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const dims = Buffer.alloc(8); dims.writeUInt32BE(64, 0); dims.writeUInt32BE(64, 4);
  return Buffer.concat([head, dims, Buffer.from("08060000", "hex"), Buffer.alloc(64, 1)]);
})();

/** The database answer RLS gives: bytes only for a member of ORG, and only if ORG has a logo. */
const fakeRead = (hasLogo: Record<string, boolean>) => async (userId: string, orgId: string) =>
  userId === MEMBER && orgId === ORG && hasLogo[orgId] ? { bytes: PNG, mime: "image/png", sha256: "ab".repeat(32) } : null;
const get = (headers: Record<string, string> = {}) => new Request("http://x/api/org/brand/x/logo", { headers });

async function snapshot(r: Response) {
  return { status: r.status, body: await r.text(), headers: [...r.headers.entries()].sort() };
}

describe("logo GET", () => {
  it("serves a member with the stored type, nosniff, sandbox CSP, private cache", async () => {
    const r = await handleLogoGet(get(), MEMBER, ORG, { readOrgLogo: fakeRead({ [ORG]: true }) });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/png");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("content-security-policy"), "default-src 'none'; sandbox");
    assert.equal(r.headers.get("cache-control"), "private, max-age=3600");
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(PNG));
  });
  it("answers 304 to a matching ETag", async () => {
    const first = await handleLogoGet(get(), MEMBER, ORG, { readOrgLogo: fakeRead({ [ORG]: true }) });
    const r = await handleLogoGet(get({ "if-none-match": first.headers.get("etag")! }), MEMBER, ORG, { readOrgLogo: fakeRead({ [ORG]: true }) });
    assert.equal(r.status, 304);
  });
  it("no oracle: a non-member, no logo, a malformed id and a read error give the identical 404", async () => {
    const nonMember = await snapshot(await handleLogoGet(get(), OUTSIDER, ORG, { readOrgLogo: fakeRead({ [ORG]: true }) }));
    const noLogo = await snapshot(await handleLogoGet(get(), MEMBER, ORG, { readOrgLogo: fakeRead({ [ORG]: false }) }));
    const otherOrg = await snapshot(await handleLogoGet(get(), MEMBER, OTHER, { readOrgLogo: fakeRead({ [ORG]: true, [OTHER]: true }) }));
    const badId = await snapshot(await handleLogoGet(get(), MEMBER, "not-a-uuid", { readOrgLogo: fakeRead({ [ORG]: true }) }));
    const err = await snapshot(await handleLogoGet(get(), MEMBER, ORG, { readOrgLogo: async () => { throw new Error("db down"); } }));
    assert.equal(nonMember.status, 404);
    for (const other of [noLogo, otherOrg, badId, err]) assert.deepEqual(other, nonMember);
  });
  it("signed out is 401 and never reads", async () => {
    let read = false;
    const r = await handleLogoGet(get(), null, ORG, { readOrgLogo: async () => { read = true; return null; } });
    assert.equal(r.status, 401); assert.equal(read, false);
  });
});

const owner = { orgId: ORG, userId: "u-owner", role: "owner" as const, viaPlatformAdmin: false };
const viaAdmin = { ...owner, userId: "u-admin", viaPlatformAdmin: true };
function upload(file: Buffer, type: string, opts: { length?: string | null } = {}) {
  const boundary = "----c3test";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: ${type}\r\n\r\n`),
    file, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const headers: Record<string, string> = { "content-type": `multipart/form-data; boundary=${boundary}` };
  if (opts.length !== null) headers["content-length"] = opts.length ?? String(body.length);
  return new Request("http://x/api/org/brand", { method: "POST", headers, body });
}

describe("upload and remove", () => {
  const calls: string[] = [];
  const deps = {
    setOrgLogo: async (_a: unknown, l: { mime: string }) => { calls.push(`set ${l.mime}`); return { ok: true as const }; },
    removeOrgLogo: async () => { calls.push("remove"); return { ok: true as const }; },
    getOrgBrand: async () => ({ hasLogo: true, tier: "standard" as const }),
  };
  it("the owner uploads a PNG", async () => {
    const r = await handleLogoUpload(upload(PNG, "image/png"), owner, deps);
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(calls.splice(0), ["set image/png"]);
  });
  it("a platform admin acting for the org is refused, upload and remove, before any write", async () => {
    const up = await handleLogoUpload(upload(PNG, "image/png"), viaAdmin, deps);
    const rm = await handleLogoRemove(viaAdmin, deps);
    assert.equal(up.status, 403); assert.equal(rm.status, 403);
    assert.equal((await up.json()).error, WRITE_REFUSED);
    assert.deepEqual(calls.splice(0), []);
  });
  it("no Content-Length is 411 and nothing is read", async () => {
    const r = await handleLogoUpload(upload(PNG, "image/png", { length: null }), owner, deps);
    assert.equal(r.status, 411);
    assert.deepEqual(calls.splice(0), []);
  });
  it("a declared length over the cap is 413 before reading", async () => {
    const r = await handleLogoUpload(upload(PNG, "image/png", { length: String(UPLOAD_BODY_MAX + 1) }), owner, deps);
    assert.equal(r.status, 413);
  });
  it("a body longer than it declares is cut off at the cap while streaming", async () => {
    const big = new Uint8Array(UPLOAD_BODY_MAX + 4096);
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { if (pulled >= big.length) { c.close(); return; } const n = Math.min(65536, big.length - pulled); c.enqueue(big.subarray(pulled, pulled + n)); pulled += n; },
    });
    const req = { headers: new Headers({ "content-length": "100" }), body: stream } as unknown as Request;
    const out = await readBodyCapped(req, UPLOAD_BODY_MAX);
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.response.status, 413);
    assert.ok(pulled < big.length + 1 && pulled <= UPLOAD_BODY_MAX + 65536, `stopped near the cap (pulled ${pulled})`);
  });
  it("an SVG labeled image/png is refused and never written", async () => {
    const r = await handleLogoUpload(upload(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/png"), owner, deps);
    assert.equal(r.status, 400);
    assert.deepEqual(calls.splice(0), []);
  });
  it("a database refusal surfaces as 403 with the owner message", async () => {
    const r = await handleLogoUpload(upload(PNG, "image/png"), { ...owner, role: "staff" }, { ...deps, setOrgLogo: async () => ({ ok: false as const, reason: "not_owner" as const }) });
    assert.equal(r.status, 403);
  });
});

describe("role payload brand fields", () => {
  const deps = {
    getOrgBrand: async () => ({ hasLogo: true, tier: "full" as const }),
    getParticipantCoBrand: async () => ({ orgId: ORG, name: "Hope House (Demo)", hasLogo: true, tier: "cobrand" } as never),
  };
  it("staff never get coBrand, even when they also joined a co-brand org", async () => {
    const f = await roleBrandFields({ userId: "s", orgId: ORG, hasOrgRole: true }, deps);
    assert.equal(f.coBrand, null);
    assert.deepEqual(f.orgBrand, { hasLogo: true, tier: "full" });
    assert.equal(f.orgId, ORG);
  });
  it("a participant gets the chip's three fields only: no tier, no orgBrand", async () => {
    const f = await roleBrandFields({ userId: "p", orgId: null, hasOrgRole: false }, deps);
    assert.deepEqual(f, { orgId: null, orgBrand: null, coBrand: { orgId: ORG, name: "Hope House (Demo)", hasLogo: true } });
    assert.doesNotMatch(JSON.stringify(f), /tier|cobrand|full/);
  });
  it("a solo participant gets nothing", async () => {
    const f = await roleBrandFields({ userId: "p", orgId: null, hasOrgRole: false }, { ...deps, getParticipantCoBrand: async () => null });
    assert.deepEqual(f, { orgId: null, orgBrand: null, coBrand: null });
  });
});
