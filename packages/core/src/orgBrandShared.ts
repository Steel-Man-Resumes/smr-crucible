/**
 * Organization brand: the parts with no database, safe for client components.
 *
 * MONOGRAM. When an organization has no logo, its mark is up to two initials
 * from its name (the "(Demo)" suffix stripped) on one of four workshop tones,
 * chosen by a stable hash of the organization id, with bone text. It always
 * has real letters in it. It is never the word "ORG", never a gray box, never
 * a placeholder name. Every tone is checked at 4.5:1 against the bone text by
 * a unit test (apps/consumer/lib/__tests__/org-brand.test.ts).
 *
 * UPLOAD CHECKS. PNG, JPEG or WebP, decided by the bytes and the declared type
 * agreeing (decideAvatarMime). Never SVG: SVG can carry script. 512 KB at most.
 * No more than 2048 px on a side, read from the image header.
 */
import { decideAvatarMime } from "./avatarAssetShared";

export type OrgBrandTier = "standard" | "cobrand" | "full";
export const ORG_BRAND_TIERS: readonly OrgBrandTier[] = ["standard", "cobrand", "full"];
export function isOrgBrandTier(v: unknown): v is OrgBrandTier {
  return typeof v === "string" && (ORG_BRAND_TIERS as readonly string[]).includes(v);
}

/** What the shell, the role payload and /api/partner/org carry. Never bytes, never a URL. */
export interface OrgBrand {
  hasLogo: boolean;
  tier: OrgBrandTier;
}
export const DEFAULT_ORG_BRAND: OrgBrand = { hasLogo: false, tier: "standard" };

/** Workshop bone (tailwind ws-bone), the text color on every monogram tone. */
export const MONOGRAM_TEXT = "#ece7d9";
/**
 * Gold, phos-dark, steel, soft amber (DESIGN.md section 4). The design's gold
 * #b98b32 gives 2.5:1 with bone text, so the gold here is the deeper #7a5a1c
 * (5.1:1). The other three are the design's own values.
 */
export const MONOGRAM_TONES = ["#7a5a1c", "#4f6b57", "#5f665f", "#8a5410"] as const;

const DEMO_SUFFIX = /\s*\(demo\)\s*$/i;
const SMALL_WORDS = new Set(["of", "the", "and", "for", "a", "an", "in", "on", "at", "to", "&"]);

/** Up to two initials. "Hope House (Demo)" -> "HH"; "Northside" -> "NO"; a name with no letters -> "". */
export function orgInitials(name: string | null | undefined): string {
  const clean = String(name ?? "").replace(DEMO_SUFFIX, "").trim();
  const words = clean.split(/[^\p{L}\p{N}&]+/u).filter(Boolean);
  const strong = words.filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
  const use = strong.length > 0 ? strong : words;
  if (use.length === 0) return "";
  if (use.length === 1) {
    const letters = Array.from(use[0].replace(/[^\p{L}\p{N}]/gu, ""));
    return letters.slice(0, 2).join("").toUpperCase();
  }
  return (Array.from(use[0])[0] + Array.from(use[1])[0]).toUpperCase();
}

/** Stable, tiny, non-cryptographic: the same org id always gets the same tone. */
export function orgToneIndex(orgId: string): number {
  let h = 2166136261;
  for (let i = 0; i < orgId.length; i++) {
    h ^= orgId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % MONOGRAM_TONES.length;
}

export function orgMonogram(orgId: string, name: string | null | undefined): { initials: string; background: string; color: string } {
  return { initials: orgInitials(name), background: MONOGRAM_TONES[orgToneIndex(orgId)], color: MONOGRAM_TEXT };
}

/** The display name with the "(Demo)" suffix kept (demo orgs announce themselves), trimmed. */
export function orgDisplayName(name: string | null | undefined): string {
  return String(name ?? "").trim();
}

/** WCAG 2.1 contrast ratio between two #rrggbb colors. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = hex.replace("#", "");
    const ch = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ---------------------------------------------------------------- uploads

export const ORG_LOGO_MAX_BYTES = 512 * 1024;
export const ORG_LOGO_MAX_SIDE = 2048;
export const ORG_LOGO_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;

/** Width and height from the image header, or null when the header cannot be read. */
export function imageDimensions(b: Uint8Array): { width: number; height: number } | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u32be = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  // PNG: IHDR is the first chunk; width and height at 16 and 20.
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52) {
    return { width: u32be(16), height: u32be(20) };
  }
  // JPEG: walk the markers to the first start-of-frame.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker === 0xff) { i++; continue; }
      const len = u16be(i + 2);
      if (len < 2) return null;
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: u16be(i + 5), width: u16be(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  // WebP: RIFF....WEBP then VP8 / VP8L / VP8X.
  if (b.length >= 30 && b[0] === 0x52 && b[8] === 0x57) {
    const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (tag === "VP8X") return { width: u24le(24) + 1, height: u24le(27) + 1 };
    if (tag === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (tag === "VP8 ") return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  return null;
}

export type LogoDecision =
  | { ok: true; mime: (typeof ORG_LOGO_MIMES)[number]; width: number; height: number }
  | { ok: false; status: 400 | 413; error: string };

/**
 * The whole server-side accept decision for a logo. The declared type must be
 * on the list AND the bytes must agree, so an SVG renamed .png (or labeled
 * image/png) is refused: its bytes are text, not a PNG signature.
 */
export function decideOrgLogo(declaredMime: string | null | undefined, bytes: Uint8Array): LogoDecision {
  if (bytes.length === 0) return { ok: false, status: 400, error: "That file is empty." };
  if (bytes.length > ORG_LOGO_MAX_BYTES) return { ok: false, status: 413, error: "That logo is over 512 KB. Save it smaller and try again." };
  const declared = String(declaredMime ?? "").toLowerCase();
  if (declared.includes("svg")) return { ok: false, status: 400, error: "SVG logos are not accepted. Use a PNG, JPEG or WebP file." };
  const mime = decideAvatarMime(declaredMime, bytes);
  if (!mime.ok || !(ORG_LOGO_MIMES as readonly string[]).includes(mime.mime)) {
    return { ok: false, status: 400, error: "That file is not a PNG, JPEG or WebP image." };
  }
  const dims = imageDimensions(bytes);
  if (!dims || dims.width < 1 || dims.height < 1) return { ok: false, status: 400, error: "That image could not be read. Try saving it again as a PNG." };
  if (dims.width > ORG_LOGO_MAX_SIDE || dims.height > ORG_LOGO_MAX_SIDE) {
    return { ok: false, status: 400, error: `That logo is ${dims.width} by ${dims.height} pixels. Keep each side at ${ORG_LOGO_MAX_SIDE} or less.` };
  }
  return { ok: true, mime: mime.mime as (typeof ORG_LOGO_MIMES)[number], width: dims.width, height: dims.height };
}

/** Square-ish guidance for the upload card: a wide logo still shows, just small. */
export function logoShapeNote(width: number, height: number): string | null {
  const r = width / height;
  if (r > 1.6 || r < 0.625) return "This logo is not square, so it shows small inside a square. A square version reads better.";
  return null;
}
