/**
 * Upload safety for the text extractors (lib/text-extraction.ts): checks a
 * PDF or a Word file's own bytes BEFORE pdf.js or mammoth sees them, so a
 * small upload can never make the server inflate gigabytes. Used by every
 * caller of the extractors: the Forge's upload (/api/parse) and the free
 * checker (/api/check/extract). Security review 3a, rounds 1 and 2.
 *
 * Self-contained on purpose (node:zlib only, no other imports) so it can be
 * lifted into a hotfix on its own.
 *
 * PDF (assertSafePdf). Every indirect object that is a stream is found by
 * reading the file the way a PDF reader does (object header, dictionary with
 * strings, names with #xx escapes, nesting and comments, then the `stream`
 * keyword), never by searching for a filter name. Then:
 *  - at most one filter per stream (no chains, no arrays longer than one; the
 *    one exception, ASCII85 or ASCIIHex then FlateDecode, is decoded exactly
 *    and capped like any other: see PDF_ALLOW_TEXT_THEN_FLATE);
 *    the filter must be FlateDecode, an image codec (DCT, JPX, CCITTFax,
 *    JBIG2) or a shrinking text codec (ASCIIHex, ASCII85). LZW, RunLength,
 *    Crypt and anything unknown are refused, and so is a filter given by an
 *    indirect reference (it could name a chain we cannot see);
 *  - every FlateDecode stream is actually inflated, from its start to the end
 *    of the file (more than any reader takes), the way pdf.js does it (header
 *    checked, then raw deflate), with a hard output cap: no single stream may
 *    decode past PDF_MAX_STREAM_BYTES, and all of them together past
 *    PDF_MAX_TOTAL_BYTES;
 *  - no more than PDF_MAX_STREAMS streams;
 *  - an image (XObject or inline) may not claim more than PDF_MAX_IMAGE_PIXELS,
 *    and a page box (with /UserUnit) not more than PDF_MAX_PAGE_AREA, in the
 *    file's own objects and in its object streams;
 *  - an encrypted PDF is refused (its streams cannot be checked).
 *
 * WORD (safeDocxForMammoth). The zip is read from its central directory,
 * walked to the end the directory says it has (never trusting the record
 * count, which some readers ignore), with no gap before the end record, no
 * duplicate names, and every central header matching its local header. Only
 * the parts mammoth needs for text (.xml and .rels) are kept; each is inflated
 * under a hard cap. Then a NEW zip is built in memory from those checked bytes
 * alone (stored, no compression) and that is what mammoth gets, never the
 * upload. Pictures and other parts are dropped unread.
 *
 * Limits were set against the repo's own rendered resumes (PDF and Word, in
 * the tests) and a local set of real resumes and long reentry guides
 * (not in the repo): all pass with wide margins; the review's bombs fail
 * in milliseconds.
 */
import { constants, inflateRawSync } from "node:zlib";

export const PDF_MAX_STREAMS = 5000;
export const PDF_MAX_STREAM_BYTES = 8 * 1024 * 1024;
export const PDF_MAX_TOTAL_BYTES = 96 * 1024 * 1024;
export const PDF_MAX_IMAGE_PIXELS = 40_000_000;
/**
 * Largest page, in square points after /UserUnit (a US letter page is about
 * 0.48 million). The scan path renders pages for OCR, and a giant page is a
 * giant bitmap. 9 million is a 41 by 41 inch page.
 */
export const PDF_MAX_PAGE_AREA = 9_000_000;

export const DOCX_MAX_ENTRIES = 2000;
export const DOCX_MAX_PART_BYTES = 8 * 1024 * 1024;
export const DOCX_MAX_TEXT_PARTS_BYTES = 24 * 1024 * 1024;

export class UnsafeUploadError extends Error {
  constructor(
    readonly reason:
      | "pdf_filter"
      | "pdf_stream_too_big"
      | "pdf_too_many_streams"
      | "pdf_image_too_big"
      | "pdf_page_too_big"
      | "pdf_encrypted"
      | "zip_malformed"
      | "zip_too_big"
      | "zip_duplicate"
      | "zip_mismatch",
    message: string
  ) {
    super(message);
    this.name = "UnsafeUploadError";
  }
}

const TOO_BIG = "That file holds more than a resume. Save it again as a plain PDF or Word file.";
const NOT_PLAIN = "That file is packed in a way we don't open. Save it again as a plain PDF or Word file.";

/* ------------------------------------------------------------------ PDF -- */

const ALLOWED_FILTERS = new Set([
  "FlateDecode",
  "DCTDecode",
  "JPXDecode",
  "CCITTFaxDecode",
  "JBIG2Decode",
  "ASCIIHexDecode",
  "ASCII85Decode",
]);
// Abbreviations used for inline images.
const INLINE_ABBR: Record<string, string> = {
  Fl: "FlateDecode",
  DCT: "DCTDecode",
  CCF: "CCITTFaxDecode",
  AHx: "ASCIIHexDecode",
  A85: "ASCII85Decode",
  LZW: "LZWDecode",
  RL: "RunLengthDecode",
};

const isWs = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
const isDelim = (c: number) =>
  c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;

type Tok =
  | { t: "dict-open" }
  | { t: "dict-close" }
  | { t: "arr-open" }
  | { t: "arr-close" }
  | { t: "name"; v: string }
  | { t: "num"; v: number }
  | { t: "word"; v: string }
  | { t: "str" };

/** A minimal PDF lexer over latin1 text (strings, hex strings, names with #xx, comments). */
class Lexer {
  constructor(readonly s: string, public i: number) {}
  skipWsAndComments() {
    const s = this.s;
    for (;;) {
      while (this.i < s.length && isWs(s.charCodeAt(this.i))) this.i++;
      if (s[this.i] === "%") {
        while (this.i < s.length && s[this.i] !== "\n" && s[this.i] !== "\r") this.i++;
        continue;
      }
      return;
    }
  }
  next(): Tok | null {
    this.skipWsAndComments();
    const s = this.s;
    if (this.i >= s.length) return null;
    const c = s[this.i];
    if (c === "<" && s[this.i + 1] === "<") {
      this.i += 2;
      return { t: "dict-open" };
    }
    if (c === ">" && s[this.i + 1] === ">") {
      this.i += 2;
      return { t: "dict-close" };
    }
    if (c === "[") {
      this.i++;
      return { t: "arr-open" };
    }
    if (c === "]") {
      this.i++;
      return { t: "arr-close" };
    }
    if (c === "(") {
      let depth = 0;
      for (; this.i < s.length; this.i++) {
        const ch = s[this.i];
        if (ch === "\\") {
          this.i++;
          continue;
        }
        if (ch === "(") depth++;
        else if (ch === ")") {
          depth--;
          if (depth === 0) {
            this.i++;
            break;
          }
        }
      }
      return { t: "str" };
    }
    if (c === "<") {
      const end = s.indexOf(">", this.i + 1);
      this.i = end < 0 ? s.length : end + 1;
      return { t: "str" };
    }
    if (c === "/") {
      this.i++;
      let raw = "";
      while (this.i < s.length) {
        const code = s.charCodeAt(this.i);
        if (isWs(code) || isDelim(code)) break;
        raw += s[this.i++];
      }
      return { t: "name", v: raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) };
    }
    let w = "";
    while (this.i < s.length) {
      const code = s.charCodeAt(this.i);
      if (isWs(code) || isDelim(code)) break;
      w += s[this.i++];
    }
    if (!w) {
      this.i++; // a stray delimiter (")", ">", "{", "}")
      return { t: "word", v: c };
    }
    return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(w) ? { t: "num", v: Number(w) } : { t: "word", v: w };
  }
}

interface StreamDict {
  keys: Set<string>;
  type: string | null;
  filters: string[] | "indirect" | "unreadable";
  filterKeys: number;
  isImage: boolean;
  width: number | "indirect" | null;
  height: number | "indirect" | null;
  /** MediaBox / CropBox / etc. as numbers, or "indirect"/"unreadable". */
  boxes: Array<number[] | "indirect" | "unreadable">;
  userUnit: number | "indirect" | null;
}

/** Reads one dictionary (lexer just past "<<"); returns its top-level facts. */
function readDict(lx: Lexer): StreamDict | null {
  const out: StreamDict = { keys: new Set(), type: null, filters: [], filterKeys: 0, isImage: false, width: null, height: null, boxes: [], userUnit: null };
  let depth = 1;
  let key: string | null = null;
  for (;;) {
    const tok = lx.next();
    if (!tok) return null;
    if (tok.t === "dict-open") {
      depth++;
      key = null;
      continue;
    }
    if (tok.t === "dict-close") {
      depth--;
      if (depth === 0) return out;
      key = null;
      continue;
    }
    if (depth !== 1) continue;
    if (key === null) {
      if (tok.t === "name") {
        key = tok.v;
        out.keys.add(tok.v);
      }
      continue;
    }
    // A value for `key` at the top level.
    const k = key;
    key = null;
    const indirect = () => {
      // "<num> <num> R": peek two more tokens.
      const save = lx.i;
      const g = lx.next();
      const r = lx.next();
      if (g && g.t === "num" && r && r.t === "word" && r.v === "R") return true;
      lx.i = save;
      return false;
    };
    if (k === "Filter") {
      out.filterKeys++;
      if (tok.t === "name") out.filters = [tok.v];
      else if (tok.t === "arr-open") {
        const names: string[] = [];
        for (;;) {
          const a = lx.next();
          if (!a) return null;
          if (a.t === "arr-close") break;
          if (a.t === "name") names.push(a.v);
          else out.filters = "unreadable";
        }
        if (out.filters !== "unreadable") out.filters = names;
      } else if (tok.t === "num" && indirect()) out.filters = "indirect";
      else out.filters = "unreadable";
      continue;
    }
    if (k === "Subtype" && tok.t === "name" && tok.v === "Image") out.isImage = true;
    if (k === "Type" && tok.t === "name") out.type = tok.v;
    if (k === "Width" || k === "Height") {
      const v = tok.t === "num" ? (indirect() ? "indirect" : tok.v) : null;
      if (k === "Width") out.width = v;
      else out.height = v;
      continue;
    }
    if (k === "MediaBox" || k === "CropBox" || k === "BleedBox" || k === "TrimBox" || k === "ArtBox") {
      if (tok.t === "num" && indirect()) out.boxes.push("indirect");
      else if (tok.t === "arr-open") {
        const nums: number[] = [];
        for (;;) {
          const a = lx.next();
          if (!a) return null;
          if (a.t === "arr-close") break;
          if (a.t === "num") nums.push(a.v);
          else nums.push(NaN);
        }
        out.boxes.push(nums.length === 4 && nums.every(Number.isFinite) ? nums : "unreadable");
      } else out.boxes.push("unreadable");
      continue;
    }
    if (k === "UserUnit") {
      out.userUnit = tok.t === "num" ? (indirect() ? "indirect" : tok.v) : null;
      continue;
    }
    if (tok.t === "num") indirect();
    else if (tok.t === "arr-open") {
      let d = 1;
      while (d > 0) {
        const a = lx.next();
        if (!a) return null;
        if (a.t === "arr-open") d++;
        else if (a.t === "arr-close") d--;
      }
    }
    // (A dictionary value is handled at the top of the loop, by depth.)
  }
}

/**
 * The one chain allowed: a text codec that only SHRINKS (ASCII85 or ASCIIHex)
 * followed by FlateDecode, as old print-to-PDF tools write. It is decoded here
 * exactly, then inflated under the same cap, so it adds no amplification. Any
 * other array longer than one is refused. Set to false to refuse every chain.
 * (One of 86 real local files used it; none of the resumes.)
 */
export const PDF_ALLOW_TEXT_THEN_FLATE = true;

type FilterPlan = { decode: string | null; pre: "ASCII85Decode" | "ASCIIHexDecode" | null };

function checkFilters(filters: StreamDict["filters"], filterKeys: number): FilterPlan {
  if (filterKeys > 1 || filters === "indirect" || filters === "unreadable") {
    throw new UnsafeUploadError("pdf_filter", NOT_PLAIN);
  }
  const names = filters.map((f) => INLINE_ABBR[f] ?? f);
  if (names.length === 0) return { decode: null, pre: null };
  for (const f of names) if (!ALLOWED_FILTERS.has(f)) throw new UnsafeUploadError("pdf_filter", NOT_PLAIN);
  if (names.length === 1) return { decode: names[0], pre: null };
  if (
    PDF_ALLOW_TEXT_THEN_FLATE &&
    names.length === 2 &&
    (names[0] === "ASCII85Decode" || names[0] === "ASCIIHexDecode") &&
    names[1] === "FlateDecode"
  ) {
    return { decode: "FlateDecode", pre: names[0] as FilterPlan["pre"] };
  }
  throw new UnsafeUploadError("pdf_filter", NOT_PLAIN);
}

/** ASCII85 to bytes (output is always smaller than the input). Stops at "~>". */
export function decodeAscii85(src: Buffer): Buffer {
  const out: number[] = [];
  let group: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === 0x7e) break; // "~>"
    if (isWs(c)) continue;
    if (c === 0x7a && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (c < 0x21 || c > 0x75) break;
    group.push(c - 33);
    if (group.length === 5) {
      let v = 0;
      for (const g of group) v = v * 85 + g;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      group = [];
    }
  }
  if (group.length > 1) {
    const n = group.length;
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const g of group) v = v * 85 + g;
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...bytes.slice(0, n - 1));
  }
  return Buffer.from(out);
}

/** ASCIIHex to bytes (half the input). Stops at ">". */
export function decodeAsciiHex(src: Buffer): Buffer {
  const s = src.toString("latin1");
  const end = s.indexOf(">");
  const hex = (end < 0 ? s : s.slice(0, end)).replace(/[^0-9a-fA-F]/g, "");
  return Buffer.from(hex.length % 2 ? hex + "0" : hex, "hex");
}

function checkPixels(w: unknown, h: unknown) {
  if (w === "indirect" || h === "indirect") throw new UnsafeUploadError("pdf_image_too_big", TOO_BIG);
  if (typeof w === "number" && typeof h === "number" && w * h > PDF_MAX_IMAGE_PIXELS) {
    throw new UnsafeUploadError("pdf_image_too_big", TOO_BIG);
  }
}

/**
 * Inflates a FlateDecode stream the way pdf.js reads one (two header bytes
 * checked, then raw deflate, no checksum), under a hard cap. Returns the
 * decoded bytes; an empty buffer when pdf.js would refuse the header; null
 * when the data is bad part way (pdf.js stops there too, at an unknown size).
 */
function inflatePdfStream(data: Buffer, cap: number): Buffer | null {
  if (data.length < 2) return Buffer.alloc(0);
  const cmf = data[0];
  const flg = data[1];
  // pdf.js refuses these headers before decoding anything.
  if ((cmf & 0x0f) !== 0x08 || ((cmf << 8) + flg) % 31 !== 0 || flg & 0x20) return Buffer.alloc(0);
  try {
    return inflateRawSync(data.subarray(2), { maxOutputLength: cap, finishFlush: constants.Z_SYNC_FLUSH });
  } catch (e: any) {
    if (e instanceof RangeError || e?.code === "ERR_BUFFER_TOO_LARGE") {
      throw new UnsafeUploadError("pdf_stream_too_big", TOO_BIG);
    }
    // Bad data: pdf.js stops at the same place, short of the cap. How far it
    // got is not known, so the caller counts the whole cap against the total.
    return null;
  }
}

/** Inline images in decoded content: dimensions and filters. */
function checkInlineImages(content: Buffer) {
  const s = content.toString("latin1");
  let at = 0;
  for (;;) {
    const bi = s.indexOf("BI", at);
    if (bi < 0) return;
    at = bi + 2;
    const before = bi === 0 ? 0x20 : s.charCodeAt(bi - 1);
    const after = s.charCodeAt(bi + 2);
    if (!(isWs(before) || isDelim(before)) || !(isWs(after) || after === 0x2f)) continue;
    const lx = new Lexer(s, bi + 2);
    let w: unknown = null;
    let h: unknown = null;
    let filters: string[] = [];
    let keys = 0;
    for (let n = 0; n < 200; n++) {
      const tok = lx.next();
      if (!tok || (tok.t === "word" && tok.v === "ID")) break;
      if (tok.t !== "name") continue;
      if (tok.v === "W" || tok.v === "Width" || tok.v === "H" || tok.v === "Height") {
        const v = lx.next();
        const num = v && v.t === "num" ? v.v : null;
        if (tok.v[0] === "W") w = num;
        else h = num;
      } else if (tok.v === "F" || tok.v === "Filter") {
        keys++;
        const v = lx.next();
        if (v?.t === "name") filters = [v.v];
        else if (v?.t === "arr-open") {
          filters = [];
          for (let m = 0; m < 50; m++) {
            const a = lx.next();
            if (!a || a.t === "arr-close") break;
            if (a.t === "name") filters.push(a.v);
          }
        }
      }
    }
    if (checkFilters(filters, keys).pre) throw new UnsafeUploadError("pdf_filter", NOT_PLAIN);
    checkPixels(w, h);
    at = lx.i;
  }
}

/** A page box (after UserUnit) no bigger than PDF_MAX_PAGE_AREA. */
function checkPageBoxes(d: StreamDict) {
  if (!d.boxes.length && d.userUnit === null) return;
  const big = () => new UnsafeUploadError("pdf_page_too_big", TOO_BIG);
  if (d.userUnit === "indirect") throw big();
  const uu = typeof d.userUnit === "number" ? d.userUnit : 1;
  if (!(uu > 0) || uu > 10) throw big();
  for (const b of d.boxes) {
    if (b === "indirect" || b === "unreadable") throw big();
    const area = Math.abs(b[2] - b[0]) * Math.abs(b[3] - b[1]) * uu * uu;
    if (!(area <= PDF_MAX_PAGE_AREA)) throw big();
  }
}

/** Every dictionary inside decoded object-stream content (pages can live there). */
function checkDictsIn(content: Buffer) {
  const s = content.toString("latin1");
  for (let at = s.indexOf("<<"); at >= 0; at = s.indexOf("<<", at + 2)) {
    const lx = new Lexer(s, at + 2);
    const d = readDict(lx);
    if (d) {
      checkPageBoxes(d);
      if (d.keys.has("Filter")) checkFilters(d.filters, d.filterKeys);
    }
  }
}

export interface PdfScan {
  streams: number;
  decodedBytes: number;
  largestStream: number;
}

/** Throws UnsafeUploadError when the PDF could make a reader inflate too much. */
export function assertSafePdf(buf: Buffer): PdfScan {
  const s = buf.toString("latin1");
  const locked = () => new UnsafeUploadError("pdf_encrypted", "That PDF is locked. Save it again without a password.");
  // An encryption entry in any trailer (classic cross-reference tables).
  for (let at = s.indexOf("trailer"); at >= 0; at = s.indexOf("trailer", at + 7)) {
    const lx = new Lexer(s, at + 7);
    const open = lx.next();
    if (open?.t !== "dict-open") continue;
    const d = readDict(lx);
    if (d?.keys.has("Encrypt")) throw locked();
  }
  const scan: PdfScan = { streams: 0, decodedBytes: 0, largestStream: 0 };
  const objRe = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(s))) {
    const lx = new Lexer(s, m.index + m[0].length);
    const first = lx.next();
    if (!first || first.t !== "dict-open") continue;
    const dict = readDict(lx);
    if (!dict) continue;
    checkPageBoxes(dict);
    lx.skipWsAndComments();
    if (s.slice(lx.i, lx.i + 6) !== "stream") continue;
    // A stream object.
    scan.streams++;
    if (scan.streams > PDF_MAX_STREAMS) throw new UnsafeUploadError("pdf_too_many_streams", TOO_BIG);
    let start = lx.i + 6;
    if (s[start] === "\r") start++;
    if (s[start] === "\n") start++;
    // An encryption entry in a cross-reference stream.
    if (dict.type === "XRef" && dict.keys.has("Encrypt")) throw locked();
    const plan = checkFilters(dict.filters, dict.filterKeys);
    const filter = plan.decode;
    if (dict.isImage) checkPixels(dict.width, dict.height);
    let content: Buffer | null = null;
    if (filter === "FlateDecode") {
      let raw = buf.subarray(start);
      if (plan.pre) {
        // From the start to the codec's own end mark ("~>" or ">"), never to
        // the first "endstream": those letters are valid ASCII85, and a reader
        // using /Length reads past them.
        const text = buf.subarray(start);
        raw = plan.pre === "ASCII85Decode" ? decodeAscii85(text) : decodeAsciiHex(text);
      }
      content = inflatePdfStream(raw, PDF_MAX_STREAM_BYTES);
      const n = content ? content.length : PDF_MAX_STREAM_BYTES;
      scan.decodedBytes += n;
      scan.largestStream = Math.max(scan.largestStream, n);
      if (scan.decodedBytes > PDF_MAX_TOTAL_BYTES) throw new UnsafeUploadError("pdf_stream_too_big", TOO_BIG);
    } else if (filter === null) {
      const end = s.indexOf("endstream", start);
      content = buf.subarray(start, end < 0 ? buf.length : end);
    }
    if (content && !dict.isImage && content.length) {
      checkInlineImages(content);
      if (dict.type === "ObjStm") checkDictsIn(content);
    }
  }
  return scan;
}

/* ------------------------------------------------------------------ ZIP -- */

/** The parts mammoth reads for text. Everything else (pictures, fonts) is dropped unread. */
function isTextPart(name: string): boolean {
  return /\.(xml|rels)$/i.test(name);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A plain zip of stored entries (no compression, no extras): the only thing mammoth is given. */
export function storedZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, e.data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(e.data.length, 20);
    c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + e.data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

export interface DocxRebuild {
  zip: Buffer;
  kept: string[];
  dropped: number;
}

/**
 * Checks a Word file from its own directory and returns a NEW zip holding
 * only its checked text parts. Throws UnsafeUploadError otherwise.
 */
export function safeDocxForMammoth(b: Buffer): DocxRebuild {
  const malformed = () => new UnsafeUploadError("zip_malformed", NOT_PLAIN);
  const big = () => new UnsafeUploadError("zip_too_big", TOO_BIG);
  if (b.length < 22) throw malformed();
  // The end record: the LAST signature in the final 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw malformed();
  const diskEntries = b.readUInt16LE(eocd + 8);
  const totalEntries = b.readUInt16LE(eocd + 10);
  const cdSize = b.readUInt32LE(eocd + 12);
  const cdOffset = b.readUInt32LE(eocd + 16);
  const commentLen = b.readUInt16LE(eocd + 20);
  if (b.readUInt16LE(eocd + 4) !== 0 || b.readUInt16LE(eocd + 6) !== 0) throw malformed(); // multi-disk
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw big(); // zip64
  if (diskEntries !== totalEntries) throw malformed();
  // No gap: the directory ends exactly where the end record starts (readers
  // that shift offsets by a gap would otherwise read a different directory).
  if (cdOffset + cdSize !== eocd) throw malformed();
  if (eocd + 22 + commentLen !== b.length) throw malformed();

  const seen = new Set<string>();
  const kept: Array<{ name: string; data: Buffer }> = [];
  let dropped = 0;
  let textBytes = 0;
  let walked = 0;
  let p = cdOffset;
  // Walk to the end of the directory, whatever the record says the count is.
  while (p < cdOffset + cdSize) {
    if (p + 46 > eocd || b.readUInt32LE(p) !== 0x02014b50) throw malformed();
    walked++;
    if (walked > DOCX_MAX_ENTRIES) throw big();
    const flags = b.readUInt16LE(p + 8);
    const method = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const csize = b.readUInt32LE(p + 20);
    const usize = b.readUInt32LE(p + 24);
    const nlen = b.readUInt16LE(p + 28);
    const elen = b.readUInt16LE(p + 30);
    const clen = b.readUInt16LE(p + 32);
    const disk = b.readUInt16LE(p + 34);
    const local = b.readUInt32LE(p + 42);
    if (p + 46 + nlen + elen + clen > cdOffset + cdSize) throw malformed();
    const nameBytes = b.subarray(p + 46, p + 46 + nlen);
    const name = nameBytes.toString("utf8");
    p += 46 + nlen + elen + clen;

    const key = name.toLowerCase();
    if (seen.has(key)) throw new UnsafeUploadError("zip_duplicate", NOT_PLAIN);
    seen.add(key);
    if (disk !== 0 || flags & 0x1 || csize === 0xffffffff || usize === 0xffffffff) throw malformed();
    if (method !== 0 && method !== 8) throw malformed();

    // The local header must agree with the directory.
    if (local + 30 > cdOffset || b.readUInt32LE(local) !== 0x04034b50) throw new UnsafeUploadError("zip_mismatch", NOT_PLAIN);
    const lflags = b.readUInt16LE(local + 6);
    const lmethod = b.readUInt16LE(local + 8);
    const lnlen = b.readUInt16LE(local + 26);
    const lelen = b.readUInt16LE(local + 28);
    if (lmethod !== method || lnlen !== nlen || !b.subarray(local + 30, local + 30 + lnlen).equals(nameBytes)) {
      throw new UnsafeUploadError("zip_mismatch", NOT_PLAIN);
    }
    if (!(lflags & 0x8)) {
      if (b.readUInt32LE(local + 14) !== crc || b.readUInt32LE(local + 18) !== csize || b.readUInt32LE(local + 22) !== usize) {
        throw new UnsafeUploadError("zip_mismatch", NOT_PLAIN);
      }
    }
    const start = local + 30 + lnlen + lelen;
    if (start + csize > cdOffset) throw new UnsafeUploadError("zip_mismatch", NOT_PLAIN);

    if (!isTextPart(name)) {
      dropped++;
      continue;
    }
    if (usize > DOCX_MAX_PART_BYTES) throw big();
    textBytes += usize;
    if (textBytes > DOCX_MAX_TEXT_PARTS_BYTES) throw big();
    const raw = b.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) {
      if (csize !== usize) throw new UnsafeUploadError("zip_mismatch", NOT_PLAIN);
      data = Buffer.from(raw);
    } else {
      try {
        data = inflateRawSync(raw, { maxOutputLength: usize + 1 });
      } catch {
        throw big();
      }
      if (data.length !== usize) throw big();
    }
    if (crc32(data) !== crc) throw new UnsafeUploadError("zip_mismatch", NOT_PLAIN);
    kept.push({ name, data });
  }
  if (p !== cdOffset + cdSize) throw malformed();
  if (walked !== totalEntries) throw malformed();
  if (!kept.some((e) => e.name === "word/document.xml")) {
    throw new UnsafeUploadError("zip_malformed", "That file is not a Word document.");
  }
  return { zip: storedZip(kept), kept: kept.map((e) => e.name), dropped };
}
