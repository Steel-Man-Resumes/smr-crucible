/**
 * Organization brand (C3): the monogram, the upload checks, and the "ORG"
 * placeholder gone from every render path.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MONOGRAM_TONES, MONOGRAM_TEXT, contrastRatio, orgInitials, orgMonogram, orgToneIndex,
  decideOrgLogo, imageDimensions, logoShapeNote, ORG_LOGO_MAX_BYTES,
} from "@crucible/core/src/orgBrandShared";
import { OrgMark } from "../../components/org/OrgMark";
import { MemberCoBrandChip } from "../../components/brand/BrandMarks";

// The components use the classic JSX runtime under tsx.
(globalThis as { React?: unknown }).React = React;

const APP = new URL("../../", import.meta.url).pathname;

function png(w: number, h: number, pad = 64): Buffer {
  const head = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const dims = Buffer.alloc(8); dims.writeUInt32BE(w, 0); dims.writeUInt32BE(h, 4);
  return Buffer.concat([head, dims, Buffer.from("08060000", "hex"), Buffer.alloc(pad, 1)]);
}
function jpeg(w: number, h: number): Buffer {
  // SOI, an APP0 segment, then SOF0 with height and width.
  const app0 = Buffer.from("ffe000104a46494600010100000100010000", "hex");
  const sof = Buffer.alloc(19); sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(17, 2); sof[4] = 8; sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from("ffd8", "hex"), app0, sof, Buffer.alloc(32, 0)]);
}
function webpVp8x(w: number, h: number): Buffer {
  const b = Buffer.alloc(40);
  b.write("RIFF", 0); b.writeUInt32LE(32, 4); b.write("WEBP", 8); b.write("VP8X", 12); b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
}

describe("monogram", () => {
  it("every tone clears 4.5:1 with the bone text", () => {
    for (const tone of MONOGRAM_TONES) {
      const r = contrastRatio(tone, MONOGRAM_TEXT);
      assert.ok(r >= 4.5, `${tone} on ${MONOGRAM_TEXT} is ${r.toFixed(2)}:1`);
    }
  });
  it("contrastRatio matches known values", () => {
    assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
    assert.equal(contrastRatio("#777777", "#777777"), 1);
  });
  it("initials: two words, one word, (Demo) stripped, small words skipped", () => {
    assert.equal(orgInitials("Hope House"), "HH");
    assert.equal(orgInitials("Northside"), "N");
    assert.equal(orgInitials("Hope House (Demo)"), "HH");
    assert.equal(orgInitials("Northside (demo)"), "N");
    assert.equal(orgInitials("The Center for Second Starts"), "CS");
    assert.equal(orgInitials("  "), "");
    for (const n of ["Hope House", "Northside", "Hope House (Demo)", "A", "Org"]) {
      assert.notEqual(orgInitials(n), "ORG");
      assert.ok(orgInitials(n).length <= 2);
    }
  });
  it("tone is stable per org id and spreads across the four", () => {
    assert.equal(orgToneIndex("00000000-0000-0000-0000-000000000001"), orgToneIndex("00000000-0000-0000-0000-000000000001"));
    const seen = new Set(Array.from({ length: 40 }, (_, i) => orgToneIndex(`org-${i}`)));
    assert.equal(seen.size, 4);
    assert.ok(MONOGRAM_TONES.includes(orgMonogram("x", "Hope House").background as never));
  });
});

describe("OrgMark", () => {
  const html = (p: Parameters<typeof OrgMark>[0]) => renderToStaticMarkup(React.createElement(OrgMark, p));
  it("renders the member-only logo route when there is a logo, never an external URL", () => {
    const out = html({ orgId: "00000000-0000-0000-0000-000000000009", name: "Hope House", hasLogo: true, size: 40 });
    assert.match(out, /src="\/api\/org\/brand\/00000000-0000-0000-0000-000000000009\/logo"/);
    assert.doesNotMatch(out, /https?:\/\//);
  });
  it("renders the monogram for a two-word, one-word and (Demo) name, never ORG", () => {
    for (const [name, initials] of [["Hope House", "HH"], ["Northside", "N"], ["Hope House (Demo)", "HH"]] as const) {
      const out = html({ orgId: "o1", name, hasLogo: false });
      assert.match(out, new RegExp(`>${initials}<`));
      assert.doesNotMatch(out, />ORG</);
      assert.match(out, /data-org-mark="monogram"/);
    }
  });
  it("a name with no letters still renders a mark, not an empty box", () => {
    const out = html({ orgId: "o1", name: "", hasLogo: false });
    assert.match(out, /<svg/);
  });
  it("the participant chip says With {name} and links to Settings", () => {
    const out = renderToStaticMarkup(React.createElement(MemberCoBrandChip, { orgId: "o1", name: "Hope House (Demo)", hasLogo: false }));
    assert.match(out, /With Hope House \(Demo\)/);
    assert.match(out, /href="\/dashboard\/settings"/);
    assert.doesNotMatch(out, /Powered by|>ORG<|Example partner/);
  });
});

describe("C1 stub compatibility (crm-shell.test.ts:132-143, unchanged)", () => {
  it("the aliases C1's test imports agree with this file", async () => {
    const { orgMonogram: mono, ORG_MARK_TONES } = await import("../../components/org/OrgMark");
    assert.equal(mono("Lakeshore Works (Demo)"), "LW");
    assert.equal(mono("Northside"), "N");
    assert.equal(mono(""), "?");
    for (const t of ORG_MARK_TONES) assert.ok(contrastRatio(t.bg, t.fg) >= 4.5, `${t.fg} on ${t.bg}`);
    assert.match(renderToStaticMarkup(React.createElement(OrgMark, { orgId: "x", name: "Lakeshore Works", hasLogo: false })), />LW</);
  });
});

describe("logo upload checks", () => {
  it("accepts a small square PNG, JPEG and WebP", () => {
    assert.deepEqual(decideOrgLogo("image/png", png(256, 256)), { ok: true, mime: "image/png", width: 256, height: 256 });
    const j = decideOrgLogo("image/jpeg", jpeg(300, 200));
    assert.ok(j.ok && j.width === 300 && j.height === 200, JSON.stringify(j));
    const w = decideOrgLogo("image/webp", webpVp8x(512, 512));
    assert.ok(w.ok && w.width === 512, JSON.stringify(w));
  });
  it("refuses an SVG renamed .png, an SVG by type, and a lying type", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.equal(decideOrgLogo("image/png", svg).ok, false, "SVG bytes labeled image/png");
    assert.equal(decideOrgLogo("image/svg+xml", svg).ok, false);
    assert.equal(decideOrgLogo("image/jpeg", png(64, 64)).ok, false, "PNG bytes labeled JPEG");
    assert.equal(decideOrgLogo("image/gif", Buffer.from("GIF89a")).ok, false);
  });
  it("refuses over 512 KB with 413, empty with 400, over 2048 px a side", () => {
    const big = png(100, 100, ORG_LOGO_MAX_BYTES);
    const r = decideOrgLogo("image/png", big);
    assert.ok(!r.ok && r.status === 413);
    const e = decideOrgLogo("image/png", new Uint8Array());
    assert.ok(!e.ok && e.status === 400);
    assert.equal(decideOrgLogo("image/png", png(4096, 100)).ok, false);
    assert.equal(decideOrgLogo("image/png", png(2048, 2048)).ok, true);
  });
  it("reads dimensions and gives square-ish guidance", () => {
    assert.deepEqual(imageDimensions(png(10, 20)), { width: 10, height: 20 });
    assert.equal(imageDimensions(Buffer.from("not an image at all, just text")), null);
    assert.equal(logoShapeNote(200, 200), null);
    assert.match(String(logoShapeNote(800, 200)), /not square/);
  });
});

describe('the "ORG" placeholder is gone from every render path', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      if (f === "node_modules" || f === ".next" || f === "__tests__") continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx|ts)$/.test(f)) files.push(p);
    }
  };
  walk(join(APP, "app")); walk(join(APP, "components")); walk(join(APP, "lib"));
  it("no source renders ORG, Example partner branding, Your Organization or CoBrandLockup", () => {
    const hits: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      if (/>\s*ORG\s*</.test(s)) hits.push(`${f}: >ORG<`);
      if (/Example partner/i.test(s)) hits.push(`${f}: Example partner`);
      if (/["'`]Your Organization["'`]/.test(s)) hits.push(`${f}: "Your Organization"`);
      if (/CoBrandLockup/.test(s)) hits.push(`${f}: CoBrandLockup`);
      if (/Powered by/.test(s) && /BrandMarks|RefineryShell|\(auth\)/.test(f)) hits.push(`${f}: Powered by`);
    }
    assert.deepEqual(hits, []);
  });
  it("the sign-in layout header has only the product family brand", () => {
    const s = readFileSync(join(APP, "app/(auth)/layout.tsx"), "utf8");
    assert.doesNotMatch(s, /CoBrand|OrgMark|partner/i);
  });
  it("the Refinery top bar shows an org mark only for a co-brand participant", () => {
    const s = readFileSync(join(APP, "app/(dashboard)/RefineryShell.tsx"), "utf8");
    const slots = s.split("\n").filter((l) => /MemberCoBrandChip|OrgMark/.test(l) && !/^import /.test(l.trim()));
    assert.equal(slots.length, 1, slots.join("\n"));
    assert.match(slots[0], /!isOrgPartner && effectiveRole\?\.coBrand \?/);
    // The role payload sets coBrand only from getParticipantCoBrand, and only with no org role.
    const role = readFileSync(join(APP, "app/api/user/role/route.ts"), "utf8");
    assert.match(role, /roleBrandFields\(\s*\{ userId, orgId: [^}]+, hasOrgRole: !!org \}/);
  });
  it("the tenant config carries no placeholder partner name", () => {
    const s = readFileSync(join(APP, "lib/tenant-config.ts"), "utf8");
    assert.doesNotMatch(s, /Your Organization|Example partner/);
  });
});
