/**
 * What the free checker will open, decided from the file's own bytes
 * (security review 3a r1, M3). /api/check/extract is public and signed out,
 * so the file name and the declared type are never trusted, and nothing is
 * handed to an extractor until the work it would do is known to be small:
 *
 *  - the kind comes from the magic bytes (%PDF, a zip, an image signature,
 *    plain text); a file that is none of these is refused;
 *  - a Word file (a zip) is checked from its central directory: no more than
 *    CHECK_ZIP_MAX_UNCOMPRESSED in all, no entry compressed more than
 *    CHECK_ZIP_MAX_RATIO to 1, no zip64, no encryption, deflate or stored only.
 *    Then every entry is actually inflated with a hard output cap, so a
 *    directory that lies about its sizes is caught before mammoth sees it;
 *  - a photo must say how big it is, and no bigger than CHECK_IMAGE_MAX_PIXELS;
 *  - PDFs are capped by pages and by the OCR pages read (text-extraction.ts),
 *    and the whole read has a time budget (the route).
 *
 * Node only (Buffer, zlib). Pure otherwise: unit tested with built files.
 */
import { inflateRawSync } from "node:zlib";

export const CHECK_ZIP_MAX_UNCOMPRESSED = 5 * 1024 * 1024;
export const CHECK_ZIP_MAX_RATIO = 100;
export const CHECK_ZIP_MAX_ENTRIES = 1000;
export const CHECK_IMAGE_MAX_PIXELS = 25_000_000;
export const CHECK_PDF_MAX_PAGES = 10;
export const CHECK_PDF_OCR_PAGES = 2;
export const CHECK_TIME_BUDGET_MS = 25_000;

export type SniffedKind = "pdf" | "word" | "doc" | "png" | "jpeg" | "gif" | "webp" | "bmp" | "text";

export class CheckFileRefused extends Error {
  constructor(
    readonly reason: "unknown_kind" | "too_big_inside" | "bad_zip" | "too_many_pixels" | "too_many_pages",
    message: string
  ) {
    super(message);
    this.name = "CheckFileRefused";
  }
}

const startsWith = (b: Buffer, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** The file's kind from its bytes, or null. */
export function sniffKind(b: Buffer): SniffedKind | null {
  if (b.length < 8) return null;
  // PDF: "%PDF-" within the first 1 KB (some writers put junk before it).
  if (b.subarray(0, 1024).includes(Buffer.from("%PDF-"))) return "pdf";
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) return "word";
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "doc";
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return "gif";
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  if (startsWith(b, [0x42, 0x4d])) return "bmp";
  // Plain text (or RTF): no NUL byte and mostly printable in the first 4 KB.
  const head = b.subarray(0, 4096);
  if (!head.includes(0)) {
    let printable = 0;
    for (const c of head) if (c === 9 || c === 10 || c === 13 || c >= 32) printable++;
    if (printable / head.length > 0.95) return "text";
  }
  return null;
}

/**
 * Refuses a zip whose contents would be too big to open, from the central
 * directory, then proves the sizes by inflating each entry with a hard cap.
 * Returns the entry names (for the document check).
 */
export function assertSmallZip(b: Buffer): string[] {
  const bad = (msg: string) => new CheckFileRefused("bad_zip", msg);
  const big = () =>
    new CheckFileRefused("too_big_inside", "That file holds more than a resume. Save it again as a plain PDF or Word file.");
  // End of central directory: the last 22 bytes plus up to 64 KB of comment.
  const from = Math.max(0, b.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = b.length - 22; i >= from; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad("That file is not a complete Word file.");
  const entries = b.readUInt16LE(eocd + 10);
  const cdSize = b.readUInt32LE(eocd + 12);
  const cdOffset = b.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw big(); // zip64
  if (entries > CHECK_ZIP_MAX_ENTRIES) throw big();
  if (cdOffset + cdSize > b.length) throw bad("That file is not a complete Word file.");

  const names: string[] = [];
  let total = 0;
  let p = cdOffset;
  for (let i = 0; i < entries; i++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) throw bad("That file is not a complete Word file.");
    const flags = b.readUInt16LE(p + 8);
    const method = b.readUInt16LE(p + 10);
    const csize = b.readUInt32LE(p + 20);
    const usize = b.readUInt32LE(p + 24);
    const nlen = b.readUInt16LE(p + 28);
    const elen = b.readUInt16LE(p + 30);
    const clen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString("utf8");
    if (flags & 0x1) throw bad("That file is locked with a password.");
    if (method !== 0 && method !== 8) throw bad("That file uses a kind of packing we don't open.");
    if (csize === 0xffffffff || usize === 0xffffffff) throw big();
    total += usize;
    if (total > CHECK_ZIP_MAX_UNCOMPRESSED) throw big();
    if (usize > 0 && usize / Math.max(csize, 1) > CHECK_ZIP_MAX_RATIO) throw big();

    // Prove the declared size: inflate this entry with a hard cap.
    if (local + 30 > b.length || b.readUInt32LE(local) !== 0x04034b50) throw bad("That file is not a complete Word file.");
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    if (start + csize > b.length) throw bad("That file is not a complete Word file.");
    const raw = b.subarray(start, start + csize);
    let out: Buffer;
    if (method === 0) {
      out = raw;
    } else {
      try {
        out = inflateRawSync(raw, { maxOutputLength: usize + 1 });
      } catch {
        throw big();
      }
    }
    if (out.length !== usize) throw big();
    names.push(name);
    p += 46 + nlen + elen + clen;
  }
  return names;
}

/** A Word file small enough to open, with its document part. */
export function assertSmallDocx(b: Buffer): void {
  const names = assertSmallZip(b);
  if (!names.includes("word/document.xml")) {
    throw new CheckFileRefused("unknown_kind", "That file is not a Word document.");
  }
}

/** Width and height a photo says it has, or null when it does not say. */
export function imageSize(b: Buffer, kind: SniffedKind): { w: number; h: number } | null {
  try {
    if (kind === "png") return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (kind === "gif") return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
    if (kind === "bmp") return { w: Math.abs(b.readInt32LE(18)), h: Math.abs(b.readInt32LE(22)) };
    if (kind === "webp") {
      const chunk = b.subarray(12, 16).toString("latin1");
      if (chunk === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      if (chunk === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (chunk === "VP8L") {
        const bits = b.readUInt32LE(21);
        return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    if (kind === "jpeg") {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1];
        const len = b.readUInt16BE(i + 2);
        // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

/** A photo that says its size, and is no bigger than the cap. */
export function assertSmallImage(b: Buffer, kind: SniffedKind): void {
  const size = imageSize(b, kind);
  if (!size || size.w <= 0 || size.h <= 0 || size.w * size.h > CHECK_IMAGE_MAX_PIXELS) {
    throw new CheckFileRefused("too_many_pixels", "That photo is too big to read. Take a smaller photo, or use a PDF or Word file.");
  }
}

/** Runs `work`, or gives up after `ms` (the time budget for one check). */
export function withinBudget<T>(work: Promise<T>, ms: number = CHECK_TIME_BUDGET_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("check time budget")), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
