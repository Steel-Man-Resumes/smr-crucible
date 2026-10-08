/**
 * Upload safety for the text extractors (lib/text-extraction.ts): checks a
 * PDF or a Word file's own bytes BEFORE pdf.js or mammoth sees them, so a
 * small upload can never make the server inflate gigabytes. Used by every
 * caller of the shared extractor (lib/text-extraction.ts), the Forge's upload
 * (/api/parse) among them. Security review 3a, rounds 1 and 2, and the hotfix
 * review (2026-10-07): fixes F1-F6 below keep real resumes that main reads.
 *
 * Self-contained on purpose (node:zlib only, no other imports) so it can be
 * lifted into a hotfix on its own.
 *
 * PDF (assertSafePdf). Every object is found by its "obj" keyword in one
 * linear pass (the numbers before it are not read, since pdf.js reads them
 * leniently), then read with pdf.js's own grammar (strings, names with #xx
 * escapes, nesting, PDF whitespace including NUL, comments, pdf.js's short
 * keys, then the `stream` keyword and the data after the next end of line).
 * Round 5 made the scan fail closed and linear by construction:
 *  - anything that cannot be read cleanly and completely is REFUSED
 *    (pdf_malformed), never skipped: a dictionary, array or string that does
 *    not close, a key that is not a name, a value that is a command word, an
 *    object inside another one, a stream inside another stream's data, an
 *    object stream whose header or objects do not read, an inline image whose
 *    dictionary does not read or whose data has no end, and any `stream`
 *    keyword the scan did not check as an object's (a final sweep);
 *  - every byte read goes through one cursor per text (Src) and is charged:
 *    skips, comment jumps, line ends, tokens and search windows. Searches are
 *    bounded windows or forward-only caches, so the work is linear in the file
 *    and in each decoded stream, each with its own budget (pdf_too_complex
 *    past it; lastPdfScanWork() reports it for the tests);
 *  - text codecs (ASCII85, ASCIIHex) decode the way pdf.js does, into a
 *    buffer of exactly their output size, refused as soon as that passes the
 *    stream's cap or what is left of the file's total.
 * Then:
 *  - at most one filter per stream, with two kinds of two-step chain allowed,
 *    neither of which adds amplification: ASCII85 or ASCIIHex then FlateDecode
 *    (decoded exactly, then inflated under the cap; PDF_ALLOW_TEXT_THEN_FLATE),
 *    and FlateDecode, ASCII85 or ASCIIHex then an image codec (DCT, JPX,
 *    CCITTFax, JBIG2), as ReportLab and some scanners write (F3);
 *    the filter must be FlateDecode, an image codec (DCT, JPX, CCITTFax,
 *    JBIG2) or a shrinking text codec (ASCIIHex, ASCII85). LZW, RunLength,
 *    Crypt and anything unknown are refused, and so is a filter given by an
 *    indirect reference (it could name a chain we cannot see);
 *  - every FlateDecode stream is actually inflated, over its own data as pdf.js
 *    finds it (to the first "endstream"; a /Length running past one is
 *    refused), the way pdf.js does it (header checked, then raw deflate). The
 *    input zlib reads is charged to the work budget, and data zlib refuses is
 *    refused (pdf.js's decoder is more lenient and would read on uncapped:
 *    r6). There is a hard output cap: no single stream may
 *    decode past PDF_MAX_STREAM_BYTES, except an image, which may decode to its
 *    own declared size (width x height x 4, at most PDF_MAX_IMAGE_STREAM_BYTES;
 *    F1: lossless photos and scans), and all of them together not past
 *    PDF_MAX_TOTAL_BYTES;
 *  - no more than PDF_MAX_STREAMS streams;
 *  - an image (XObject or inline) may not claim more than PDF_MAX_IMAGE_PIXELS,
 *    and a page box (with /UserUnit) not more than PDF_MAX_PAGE_AREA, in the
 *    file's own objects and in its object streams;
 *  - a stream inside an object stream is refused (the spec forbids it, and
 *    pdf.js would read it past every cap here); object streams and content
 *    streams under ASCII85 or ASCIIHex alone are decoded and checked too. Any
 *    stream with /First is checked as an object stream whatever its /Type or
 *    /Subtype (pdf.js reads labels from nothing but the xref entry), and one
 *    also labelled or coded as an image is refused (r6);
 *  - an encrypted PDF is refused (its streams cannot be checked). Most are
 *    copy-protected, not password-protected, so the message says so (F4).
 *    Follow-up: decrypt with the empty user password and scan as normal.
 *
 * WORD (safeDocxForMammoth). The zip is read from its central directory,
 * walked to the end the directory says it has (never trusting the record
 * count, which some readers ignore), with no gap before the end record (a few
 * trailing bytes after it are allowed, F6), no duplicate names, and every
 * central header matching its local header. The main part named in
 * _rels/.rels must be among the kept parts (F5). Only
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
/** An image stream may decode to its own declared size (up to 4 bytes a pixel), never past this (F1). */
export const PDF_MAX_IMAGE_STREAM_BYTES = 48 * 1024 * 1024;
export const PDF_MAX_TOTAL_BYTES = 96 * 1024 * 1024;
export const PDF_MAX_IMAGE_PIXELS = 40_000_000;
/**
 * Largest page, in square points after /UserUnit (a US letter page is about
 * 0.48 million). The scan path renders pages for OCR, and a giant page is a
 * giant bitmap. 9 million is a 41 by 41 inch page.
 */
export const PDF_MAX_PAGE_AREA = 9_000_000;

export const DOCX_MAX_ENTRIES = 2000;
/** Bytes allowed after the zip's end record (a newline some download paths add, F6). */
export const DOCX_MAX_TRAILING_BYTES = 1024;
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
      | "pdf_too_complex"
      | "pdf_hidden_stream"
      | "pdf_malformed"
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

const TOO_BIG = "That file holds more than a resume. Save it again as a plain PDF or Word file, or paste the text instead.";
const NOT_PLAIN = "That file is packed in a way we don't open. Save it again as a plain PDF or Word file, or paste the text instead.";
/** F4: almost every encrypted resume PDF is copy-protected (opens with no password); never blame a password. */
export const PDF_LOCKED_MESSAGE =
  "This PDF is locked against copying, so we can't read the text. Save it again as a plain PDF, or paste the text instead.";

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

/** PDF whitespace as pdf.js's lexer reads it (NUL and FF included). */
const isWs = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
const isDelim = (c: number) =>
  c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;
/** Byte classes for the lexer's hot loops: 1 whitespace, 2 delimiter. */
const CLS = (() => {
  const t = new Uint8Array(256);
  for (let c = 0; c < 256; c++) t[c] = isWs(c) ? 1 : isDelim(c) ? 2 : 0;
  return t;
})();
/** Whitespace as pdf.js's ASCII85 decoder reads it (no NUL, no FF: those are digits there). */
const isA85Ws = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;

const malformed = () => new UnsafeUploadError("pdf_malformed", NOT_PLAIN);

/*
 * ONE CURSOR, EVERY BYTE CHARGED (security review 3a r5). All reading of one
 * text (the file, or one decoded stream) goes through a Src: whitespace and
 * comment skips, comment jumps, line-end searches, token reads and every
 * search window charge the bytes they touch to that text's budget. Searches
 * are bounded windows (a subarray view, never past its end) or forward-only
 * caches, so no byte is searched twice by the forward scans. The file's budget
 * is sized from the file alone; each decoded stream gets its own budget sized
 * from its own bytes (r5 L1: decoded data no longer funds lexing elsewhere).
 * Spending a budget refuses the file (pdf_too_complex). Real files use a small
 * fraction of it (see the tests).
 */
const BUDGET_PER_BYTE = 12;
const FILE_BUDGET_BASE = 1 << 20;
const CONTENT_BUDGET_BASE = 4096;

/** Total work charged during the last assertSafePdf call, for the work-bound test. */
let lastWork = 0;
let workNow = 0;
export function lastPdfScanWork(): number {
  return lastWork;
}

class Src {
  readonly n: number;
  private left: number;
  // A forward cache of the next end of line (CR or LF): valid for any q in [from, at].
  private le = { from: -1, at: -1 };
  // The last whitespace-and-comment walk, [wsFrom, wsTo). Every CR or LF inside
  // it was passed outside a comment, and the walk from there is the same one, so
  // a later walk that reaches one of them ends at wsTo without walking again.
  // So does one that reaches a "%" inside it: that comment ends at the same
  // line end as the comment (or text) the earlier walk was in there.
  wsFrom = -1;
  wsTo = -1;
  constructor(readonly b: Buffer, base: number) {
    this.n = b.length;
    this.left = base + BUDGET_PER_BYTE * b.length;
  }
  private str: string | null = null;
  /** The bytes as latin1 text, made once (charged once) for fast forward searches. */
  text(): string {
    if (this.str === null) {
      this.charge(this.n);
      this.str = this.b.toString("latin1");
    }
    return this.str;
  }
  charge(k: number) {
    workNow += k;
    this.left -= k;
    if (this.left < 0) throw new UnsafeUploadError("pdf_too_complex", NOT_PLAIN);
  }
  /** First index of `needle` in [from, to), or -1. A bounded window, charged. */
  find(needle: string | number, from: number, to: number = this.n): number {
    if (from >= to) return -1;
    let w: number;
    if (to >= this.n) {
      // To the end of the text: the text's own search, which stops at its end.
      const x = this.text().indexOf(typeof needle === "string" ? needle : String.fromCharCode(needle), from);
      w = x < 0 ? -1 : x - from;
    } else w = this.b.subarray(from, to).indexOf(needle as any); // a bounded view
    this.charge(w < 0 ? to - from : w + (typeof needle === "string" ? needle.length : 1));
    return w < 0 ? -1 : from + w;
  }
  /** Index of the first CR or LF at or after q, or the text's length. */
  lineEnd(q: number): number {
    const c = this.le;
    const b = this.b;
    if (c.from >= 0 && q >= c.from && q <= c.at) return c.at;
    if (c.from >= 0 && q < c.from) {
      // Behind the cache: a bounded window up to where the cache starts.
      let e = q;
      while (e < c.from && b[e] !== 0x0a && b[e] !== 0x0d) e++;
      this.charge(e - q + 1);
      return e < c.from ? e : c.at;
    }
    // Ahead of the cache: new bytes only, so forward searches never overlap.
    let e = q;
    const n = this.n;
    while (e < n && b[e] !== 0x0a && b[e] !== 0x0d) e++;
    this.charge(e - q + 1);
    c.from = q;
    c.at = e;
    return e;
  }
  /** Forgets the caches before a new pass from the start (each pass moves forward). */
  rewind() {
    this.le = { from: -1, at: -1 };
    this.wsFrom = this.wsTo = -1;
  }
  /** Skips PDF whitespace and comments from i (never past `end`); charged. */
  skipWs(i: number, end: number): number {
    const b = this.b;
    const start = i;
    let steps = 0;
    let synced = false;
    for (;;) {
      if (i >= end) break;
      const c = b[i];
      if ((c === 0x0a || c === 0x0d || c === 0x25) && i >= this.wsFrom && i < this.wsTo && this.wsTo <= end) {
        i = this.wsTo;
        synced = true;
        break;
      }
      if (isWs(c)) {
        i++;
        steps++;
        continue;
      }
      if (c === 0x25 /* % */) {
        // A comment runs to the end of its line (the cached search, inlined).
        const le = this.le;
        let e: number;
        if (le.from >= 0 && i >= le.from && i <= le.at) e = le.at;
        else if (le.from < 0 || i > le.at) {
          e = i + 1;
          const n = this.n;
          while (e < n && b[e] !== 0x0a && b[e] !== 0x0d) e++;
          this.charge(e - i);
          le.from = i;
          le.at = e;
        } else e = this.lineEnd(i);
        i = e < end ? e : end;
        steps++;
        continue;
      }
      break;
    }
    this.charge(steps);
    if (synced) this.wsFrom = Math.min(this.wsFrom, start);
    else if (i > start && (i < end || end === this.n)) {
      this.wsFrom = start;
      this.wsTo = i;
    }
    return i;
  }
}

const T_DICT_OPEN = 1;
const T_DICT_CLOSE = 2;
const T_ARR_OPEN = 3;
const T_ARR_CLOSE = 4;
const T_NAME = 5;
const T_NUM = 6;
const T_WORD = 7;
const T_STR = 8;
/** A string or hex string with no end before the text does. */
const T_BAD = 9;

interface Tok {
  t: number;
  /** Name (decoded), word, or number. */
  v: string | number;
  /** Where the token starts and ends. */
  s: number;
  e: number;
}

const MAX_WORD = 64;

function latin1(b: Buffer, from: number, to: number): string {
  return b.toString("latin1", from, Math.min(to, from + MAX_WORD));
}

/** "12", "-3", "+4.5", ".5", "1e-5": pdf.js reads these as numbers (r4: one pass, no regex). */
function isNumberAt(b: Buffer, from: number, to: number): boolean {
  const c0 = b[from];
  if (!((c0 >= 0x30 && c0 <= 0x39) || c0 === 0x2b || c0 === 0x2d || c0 === 0x2e)) return false;
  for (let i = from + 1; i < to; i++) {
    const c = b[i];
    if (!((c >= 0x30 && c <= 0x39) || c === 0x2e || c === 0x2b || c === 0x2d || c === 0x45 || c === 0x65)) return false;
  }
  return true;
}

/** A PDF lexer over one Src, never past `end`. Every byte it reads is charged. */
class Lexer {
  /** The last token read by step(): its kind and where it starts and ends. */
  tt = 0;
  ts = 0;
  te = 0;
  constructor(readonly src: Src, public i: number, readonly end: number = src.n) {}
  /** Reads one token's kind and extent, with no values (no allocation); false at the end. */
  step(): boolean {
    const src = this.src;
    const b = src.b;
    const end = this.end;
    let i = this.i;
    if (i < end && (CLS[b[i]] === 1 || b[i] === 0x25)) i = src.skipWs(i, end);
    if (i >= end) {
      this.i = i;
      return false;
    }
    const s = i;
    const c = b[i];
    let t: number;
    if (c === 0x3c /* < */ && i + 1 < end && b[i + 1] === 0x3c) {
      i += 2;
      t = T_DICT_OPEN;
    } else if (c === 0x3e /* > */ && i + 1 < end && b[i + 1] === 0x3e) {
      i += 2;
      t = T_DICT_CLOSE;
    } else if (c === 0x5b) {
      i++;
      t = T_ARR_OPEN;
    } else if (c === 0x5d) {
      i++;
      t = T_ARR_CLOSE;
    } else if (c === 0x28 /* ( */) {
      let depth = 0;
      t = T_BAD;
      for (; i < end; i++) {
        const ch = b[i];
        if (ch === 0x5c /* \ */) {
          i++;
          continue;
        }
        if (ch === 0x28) depth++;
        else if (ch === 0x29) {
          depth--;
          if (depth === 0) {
            i++;
            t = T_STR;
            break;
          }
        }
      }
      if (i > end) i = end;
    } else if (c === 0x3c) {
      // A hex string, to its ">" (a bounded window; charged below with the token).
      const w = i + 1 < end ? b.subarray(i + 1, end).indexOf(0x3e) : -1;
      i = w < 0 ? end : i + 2 + w;
      t = w < 0 ? T_BAD : T_STR;
    } else if (c === 0x2f /* / */) {
      i++;
      while (i < end && CLS[b[i]] === 0) i++;
      t = T_NAME;
    } else {
      while (i < end && CLS[b[i]] === 0) i++;
      if (i === s) {
        i++; // a stray delimiter: ")", ">", "{", "}"
        t = T_WORD;
      } else t = isNumberAt(b, s, i) ? T_NUM : T_WORD;
    }
    src.charge(i - s);
    this.i = i;
    this.tt = t;
    this.ts = s;
    this.te = i;
    return true;
  }
  /** The last token is the word `w` (ASCII). */
  is(w: string): boolean {
    if (this.tt !== T_WORD || this.te - this.ts !== w.length) return false;
    const b = this.src.b;
    for (let k = 0; k < w.length; k++) if (b[this.ts + k] !== w.charCodeAt(k)) return false;
    return true;
  }
  next(): Tok | null {
    if (!this.step()) return null;
    const b = this.src.b;
    const { tt: t, ts: s, te: e } = this;
    let v: string | number = "";
    if (t === T_NAME) {
      const raw = latin1(b, s + 1, e);
      v = raw.indexOf("#") >= 0 ? raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : raw;
    } else if (t === T_NUM) v = e - s > MAX_WORD ? NaN : Number(latin1(b, s, e));
    else if (t === T_WORD) v = e - s > MAX_WORD ? "\u0000" : latin1(b, s, e);
    return { t, v, s, e };
  }
}

/** Tokens with lookahead (pdf.js reads refs as "num num R" with two tokens of lookahead). */
class Parser {
  private q: Tok[] = [];
  constructor(readonly lx: Lexer) {}
  peek(k = 0): Tok | null {
    while (this.q.length <= k) {
      const t = this.lx.next();
      if (!t) return null;
      this.q.push(t);
    }
    return this.q[k];
  }
  take(): Tok | null {
    const t = this.peek(0);
    if (t) this.q.shift();
    return t;
  }
  /** Where the furthest token read so far ends. */
  get reached(): number {
    return this.lx.i;
  }
}

interface StreamDict {
  keys: Set<string>;
  type: string | null;
  subtype: string | null;
  filters: string[] | "indirect" | "unreadable";
  filterKeys: number;
  isImage: boolean;
  width: number | "indirect" | null;
  height: number | "indirect" | null;
  /** MediaBox / CropBox / etc. as numbers, or "indirect"/"unreadable". */
  boxes: Array<number[] | "indirect" | "unreadable">;
  userUnit: number | "indirect" | null;
  /** An object stream's /N and /First. */
  n: number | "indirect" | null;
  first: number | "indirect" | null;
  /** /Length, when given. */
  length: number | "indirect" | null;
  /** /Predictor (in this dictionary) and the largest one in /DecodeParms or /DP (r7 M1). */
  predictor: number | "indirect" | null;
  decodePredictor: number | "indirect" | null;
  /** A predictor's /Columns, /Colors and /BitsPerComponent (in this dictionary). */
  columns: unknown;
  colors: unknown;
  bpc: unknown;
  /** The largest predictor row size in /DecodeParms, or "bad" when its parameters are not plain positive whole numbers (r8 M1). */
  decodeRow: number | "bad" | null;
}

const newFacts = (): StreamDict => ({
  keys: new Set(),
  type: null,
  subtype: null,
  filters: [],
  filterKeys: 0,
  isImage: false,
  width: null,
  height: null,
  boxes: [],
  userUnit: null,
  n: null,
  first: null,
  length: null,
  predictor: null,
  decodePredictor: null,
  columns: undefined,
  colors: undefined,
  bpc: undefined,
  decodeRow: null,
});

/** A value, as far as the checks need it. */
type Val =
  | { k: "name"; v: string }
  | { k: "num"; v: number }
  | { k: "ref" }
  | { k: "arr"; items: Val[] | null }
  | { k: "dict"; facts: StreamDict | null }
  | { k: "other" };

const MAX_DEPTH = 64;
const KEEP_ITEMS = 8;

/*
 * STRICT GRAMMAR (security review 3a r5 H1). pdf.js reads an object with a
 * recursive grammar; this reads it the same way and REFUSES (pdf_malformed)
 * anything a real writer never produces, instead of guessing where it ends: a
 * key that is not a name, a key with no value, a ">>" or "]" that does not
 * close the innermost open structure, a command word where a value belongs
 * (only true, false, null and the R of a reference are values), a string, an
 * array or a dictionary not closed before the end, or nesting deeper than
 * MAX_DEPTH. A dictionary nested inside another object that is followed by
 * "stream" (pdf.js would read a stream there) is refused too.
 */
function readValue(p: Parser, tok: Tok, depth: number, collect: boolean): Val {
  switch (tok.t) {
    case T_DICT_OPEN: {
      const facts = readDictBody(p, depth + 1, collect);
      return { k: "dict", facts };
    }
    case T_ARR_OPEN: {
      if (depth + 1 > MAX_DEPTH) throw malformed();
      let items: Val[] | null = collect ? [] : null;
      for (;;) {
        const a = p.take();
        if (!a || a.t === T_DICT_CLOSE || a.t === T_BAD) throw malformed();
        if (a.t === T_ARR_CLOSE) return { k: "arr", items };
        const v = readValue(p, a, depth + 1, collect);
        if (items) {
          if (items.length < KEEP_ITEMS) items.push(v);
          else items = null;
        }
      }
    }
    case T_NAME:
      return { k: "name", v: tok.v as string };
    case T_NUM: {
      // r7 H2: a number pdf.js would read some other way ("1-0", "--5", one
      // over 64 characters, or past the float range) is refused, never NaN.
      if (!Number.isFinite(tok.v)) throw malformed();
      const g = p.peek(0);
      if (g && g.t === T_NUM && Number.isInteger(tok.v) && Number.isInteger(g.v)) {
        const r = p.peek(1);
        if (r && r.t === T_WORD && r.v === "R") {
          p.take();
          p.take();
          return { k: "ref" };
        }
      }
      return { k: "num", v: tok.v as number };
    }
    case T_STR:
      return { k: "other" };
    case T_WORD:
      if (tok.v === "true" || tok.v === "false" || tok.v === "null") return { k: "other" };
      throw malformed();
    default:
      throw malformed();
  }
}

/** Reads a dictionary's entries (just past "<<") up to its own ">>". */
function readDictBody(p: Parser, depth: number, collect: boolean): StreamDict | null {
  if (depth > MAX_DEPTH) throw malformed();
  const out = collect ? newFacts() : null;
  let widthShort = false;
  let heightShort = false;
  for (;;) {
    const k = p.take();
    if (!k) throw malformed();
    if (k.t === T_DICT_CLOSE) break;
    if (k.t !== T_NAME) throw malformed();
    const vt = p.take();
    if (!vt) throw malformed();
    const v = readValue(p, vt, depth, !!out);
    if (!out) continue;
    const raw = k.v as string;
    out.keys.add(raw);
    // pdf.js reads a stream's filter as dict.get("F", "Filter") and an image's
    // size as dict.get("W", "Width") / ("H", "Height"): the short keys count
    // like the long ones, and win when both are present (r3, r4 L1).
    const key = raw === "F" ? "Filter" : raw === "W" ? "Width" : raw === "H" ? "Height" : raw;
    if (key === "Filter") {
      out.filterKeys++;
      out.filters = filterNames(v);
    } else if (key === "Subtype") {
      if (v.k === "name") {
        out.subtype = v.v;
        if (v.v === "Image") out.isImage = true;
      }
    } else if (key === "Type") {
      if (v.k === "name") out.type = v.v;
    } else if (key === "Width" || key === "Height") {
      const n = v.k === "num" ? v.v : v.k === "ref" ? "indirect" : null;
      const short = raw === "W" || raw === "H";
      if (key === "Width") {
        if (short || !widthShort) out.width = n;
        if (short) widthShort = true;
      } else {
        if (short || !heightShort) out.height = n;
        if (short) heightShort = true;
      }
    } else if (key === "MediaBox" || key === "CropBox" || key === "BleedBox" || key === "TrimBox" || key === "ArtBox") {
      if (v.k === "ref") out.boxes.push("indirect");
      else if (v.k === "arr" && v.items && v.items.length === 4 && v.items.every((x) => x.k === "num" && Number.isFinite(x.v))) {
        out.boxes.push(v.items.map((x) => (x as { v: number }).v));
      } else out.boxes.push("unreadable");
    } else if (key === "UserUnit") {
      out.userUnit = v.k === "num" ? v.v : v.k === "ref" ? "indirect" : null;
    } else if (key === "N" || key === "First" || key === "Length") {
      const n = v.k === "num" ? v.v : v.k === "ref" ? "indirect" : null;
      if (key === "N") out.n = n;
      else if (key === "First") out.first = n;
      else out.length = n;
    } else if (key === "Predictor") {
      out.predictor = v.k === "num" ? v.v : v.k === "ref" ? "indirect" : null;
    } else if (key === "DecodeParms" || key === "DP") {
      out.decodePredictor = predictorOf(v);
      out.decodeRow = predictorRowOf(v);
    } else if (key === "Columns" || key === "Colors" || key === "BitsPerComponent" || key === "BPC") {
      const n = v.k === "num" ? v.v : v.k === "ref" ? "indirect" : "other";
      if (key === "Columns") out.columns = n;
      else if (key === "Colors") out.colors = n;
      else out.bpc = n;
    }
  }
  // pdf.js reads "stream" after ANY dictionary as a stream (inside arrays and
  // other dictionaries too). Only a top-level object's stream is checked; one
  // anywhere else is refused.
  if (depth > 1) {
    const nx = p.peek(0);
    if (nx && nx.t === T_WORD && nx.v === "stream") throw new UnsafeUploadError("pdf_hidden_stream", NOT_PLAIN);
  }
  return out;
}

/** The largest /Predictor in a /DecodeParms value (a dictionary, an array of them, null, or a reference). */
function predictorOf(v: Val): number | "indirect" | null {
  if (v.k === "ref") return "indirect"; // pdf.js resolves it: unknown here
  if (v.k === "dict") return v.facts ? v.facts.predictor : "indirect";
  if (v.k === "arr") {
    if (!v.items) return "indirect"; // too long to keep: unknown
    let best: number | "indirect" | null = null;
    for (const x of v.items) {
      const p = predictorOf(x);
      if (p === "indirect") return p;
      if (p !== null && (best === null || p > best)) best = p;
    }
    return best;
  }
  return null;
}

/**
 * The largest row a predictor in this /DecodeParms value would allocate, the
 * way pdf.js's PredictorStream sizes it: ceil(Columns * Colors * BPC / 8),
 * with pdf.js's defaults 1, 1 and 8. "bad" when a parameter is not a plain
 * positive whole number (r8 M1). Null when no predictor above 1 is there.
 */
function predictorRowOf(v: Val): number | "bad" | null {
  if (v.k === "dict") {
    const f = v.facts;
    if (!f) return "bad";
    const p = f.predictor;
    if (p === null || (typeof p === "number" && p <= 1)) return null;
    const ok = (x: unknown, dflt: number) => (x === undefined ? dflt : typeof x === "number" && Number.isSafeInteger(x) && x > 0 ? x : NaN);
    const row = Math.ceil((ok(f.columns, 1) * ok(f.colors, 1) * ok(f.bpc, 8)) / 8);
    return Number.isSafeInteger(row) && row > 0 ? row : "bad";
  }
  if (v.k === "arr") {
    if (!v.items) return "bad";
    let best: number | "bad" | null = null;
    for (const x of v.items) {
      const r = predictorRowOf(x);
      if (r === "bad") return r;
      if (r !== null && (best === null || r > best)) best = r;
    }
    return best;
  }
  return v.k === "ref" ? "bad" : null;
}

function filterNames(v: Val): StreamDict["filters"] {
  if (v.k === "name") return [v.v];
  if (v.k === "ref") return "indirect";
  if (v.k === "arr" && v.items) {
    const names: string[] = [];
    for (const x of v.items) {
      if (x.k !== "name") return "unreadable";
      names.push(x.v);
    }
    return names;
  }
  return "unreadable";
}

/**
 * The one chain allowed: a text codec that only SHRINKS (ASCII85 or ASCIIHex)
 * followed by FlateDecode, as old print-to-PDF tools write. It is decoded here
 * exactly, then inflated under the same cap, so it adds no amplification. Any
 * other array longer than one is refused. Set to false to refuse every chain.
 * (One of 86 real local files used it; none of the resumes.)
 */
export const PDF_ALLOW_TEXT_THEN_FLATE = true;

const IMAGE_CODECS = new Set(["DCTDecode", "JPXDecode", "CCITTFaxDecode", "JBIG2Decode"]);

type FilterPlan = {
  decode: string | null;
  pre: "ASCII85Decode" | "ASCIIHexDecode" | null;
  /** The image codec that runs last, if any (its JPEG frame size is checked). */
  codec: string | null;
};

function checkFilters(filters: StreamDict["filters"], filterKeys: number): FilterPlan {
  if (filterKeys > 1 || filters === "indirect" || filters === "unreadable") {
    throw new UnsafeUploadError("pdf_filter", NOT_PLAIN);
  }
  const names = filters.map((f) => INLINE_ABBR[f] ?? f);
  if (names.length === 0) return { decode: null, pre: null, codec: null };
  for (const f of names) if (!ALLOWED_FILTERS.has(f)) throw new UnsafeUploadError("pdf_filter", NOT_PLAIN);
  if (names.length === 1) return { decode: names[0], pre: null, codec: IMAGE_CODECS.has(names[0]) ? names[0] : null };
  // F3: Flate, ASCII85 or ASCIIHex, then an image codec. The first stage is
  // inflated under the same cap (or only shrinks); the codec is one already
  // allowed on its own.
  if (names.length === 2 && IMAGE_CODECS.has(names[1])) {
    if (names[0] === "FlateDecode") return { decode: "FlateDecode", pre: null, codec: names[1] };
    if (names[0] === "ASCII85Decode" || names[0] === "ASCIIHexDecode") {
      return { decode: null, pre: names[0] as FilterPlan["pre"], codec: names[1] };
    }
  }
  if (
    PDF_ALLOW_TEXT_THEN_FLATE &&
    names.length === 2 &&
    (names[0] === "ASCII85Decode" || names[0] === "ASCIIHexDecode") &&
    names[1] === "FlateDecode"
  ) {
    return { decode: "FlateDecode", pre: names[0] as FilterPlan["pre"], codec: null };
  }
  throw new UnsafeUploadError("pdf_filter", NOT_PLAIN);
}

const tooBig = () => new UnsafeUploadError("pdf_stream_too_big", TOO_BIG);

/**
 * "endstream" at `at`, after any whitespace and comments, as pdf.js's
 * makeStream looks for it after /Length (r7 H1). The skip is charged.
 */
function endstreamAfter(src: Src, at: number): boolean {
  if (at >= src.n) return false;
  const i = src.skipWs(at, src.n);
  src.charge(9);
  return src.b.toString("latin1", i, i + 9) === "endstream";
}

/*
 * BOUNDED DECODERS (r5 M3). Each text codec runs twice over its input: once to
 * count exactly what it will write (refused as soon as that passes `limit`),
 * then into a buffer of exactly that size. Both read the bytes the way pdf.js's
 * decoders do (ASCII85: "z" at the start of a group is four zeros, any other
 * byte but pdf.js's four whitespace bytes is a digit, "~" or the end stops it;
 * ASCIIHex: non-hex bytes are skipped, ">" stops it), so the bytes checked are
 * the bytes pdf.js would decode.
 */
function a85Walk(src: Uint8Array, out: Buffer | null, limit: number): { n: number; read: number } {
  const len = src.length;
  let i = 0;
  let n = 0;
  const group = [0, 0, 0, 0, 0];
  while (i < len) {
    const c = src[i];
    if (isA85Ws(c)) {
      i++;
      continue;
    }
    if (c === 0x7e) break;
    if (c === 0x7a) {
      i++;
      if (n + 4 > limit) throw tooBig();
      if (out) out[n] = out[n + 1] = out[n + 2] = out[n + 3] = 0;
      n += 4;
      continue;
    }
    group[0] = c;
    i++;
    let k = 1;
    while (k < 5) {
      while (i < len && isA85Ws(src[i])) i++;
      if (i >= len || src[i] === 0x7e) break;
      group[k++] = src[i++];
    }
    const outBytes = k < 5 ? k - 1 : 4;
    if (n + outBytes > limit) throw tooBig();
    if (out && outBytes > 0) {
      for (let j = k; j < 5; j++) group[j] = 0x21 + 84;
      let t = 0;
      for (let j = 0; j < 5; j++) t = t * 85 + (group[j] - 0x21);
      const u = t >>> 0; // pdf.js keeps the low 32 bits (int32 arithmetic)
      for (let j = 0; j < outBytes; j++) out[n + j] = (u >>> (24 - 8 * j)) & 255;
    }
    n += outBytes;
    if (k < 5) break;
  }
  return { n, read: i };
}

/** ASCII85 to bytes, into a buffer of exactly the decoded size; refused past `limit` bytes. */
export function decodeAscii85(src: Uint8Array, limit: number = PDF_MAX_STREAM_BYTES, owner?: Src): Buffer {
  const count = a85Walk(src, null, limit);
  owner?.charge(count.read);
  const out = Buffer.allocUnsafe(count.n);
  a85Walk(src, out, limit);
  owner?.charge(count.read);
  return out;
}

/**
 * A stream's ASCII85 or ASCIIHex data, decoded under `limit`. Its own end mark
 * ("~" or ">") must be inside the stream's data (r5): real writers always put
 * it there, and then no decode reads past its own stream, so none reads the
 * same bytes as another.
 */
function decodeTextStream(kind: "ASCII85Decode" | "ASCIIHexDecode", data: Buffer, limit: number, owner: Src): Buffer {
  const mark = data.indexOf(kind === "ASCII85Decode" ? 0x7e : 0x3e);
  owner.charge(mark < 0 ? data.length : mark + 1);
  if (mark < 0) throw malformed();
  return kind === "ASCII85Decode" ? decodeAscii85(data, limit, owner) : decodeAsciiHex(data, limit, owner);
}

const hexVal = (c: number) =>
  c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 55 : c >= 0x61 && c <= 0x66 ? c - 87 : -1;

/** ASCIIHex to bytes (half the input), into a buffer of exactly that size; refused past `limit`. */
export function decodeAsciiHex(src: Uint8Array, limit: number = PDF_MAX_STREAM_BYTES, owner?: Src): Buffer {
  const end0 = Buffer.from(src.buffer, src.byteOffset, src.length).indexOf(0x3e);
  const end = end0 < 0 ? src.length : end0;
  let digits = 0;
  for (let i = 0; i < end; i++) if (hexVal(src[i]) >= 0) digits++;
  owner?.charge(end);
  // pdf.js keeps a last odd digit only when ">" ends the data.
  const n = (digits >> 1) + (digits & 1 && end0 >= 0 ? 1 : 0);
  if (n > limit) throw tooBig();
  const out = Buffer.alloc(n);
  let j = 0;
  let hi = -1;
  for (let i = 0; i < end; i++) {
    const d = hexVal(src[i]);
    if (d < 0) continue;
    if (hi < 0) hi = d;
    else {
      out[j++] = (hi << 4) | d;
      hi = -1;
    }
  }
  if (hi >= 0 && j < n) out[j] = hi << 4;
  owner?.charge(end);
  return out;
}

/** Width and height from a JPEG's frame header (SOFn), or null. */
export function jpegFrameSize(b: Buffer): { w: number; h: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  for (let n = 0; n < 1000 && i + 9 < b.length; n++) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

/** F1: the inflate cap for one stream: an image's own declared size (bounded), 8 MB for anything else. */
export function streamCap(d: { isImage: boolean; width: unknown; height: unknown }): number {
  if (!d.isImage || typeof d.width !== "number" || typeof d.height !== "number") return PDF_MAX_STREAM_BYTES;
  const declared = Math.ceil(d.width * d.height * 4 + d.height);
  // r7 H2 backstop: a size that is not a finite positive number gets the plain cap.
  if (!Number.isFinite(declared) || !(declared > 0)) return PDF_MAX_STREAM_BYTES;
  return Math.max(PDF_MAX_STREAM_BYTES, Math.min(PDF_MAX_IMAGE_STREAM_BYTES, declared));
}

function checkPixels(w: unknown, h: unknown) {
  if (w === "indirect" || h === "indirect") throw new UnsafeUploadError("pdf_image_too_big", TOO_BIG);
  // Written so that NaN fails too (r7 H2).
  if (typeof w === "number" && typeof h === "number" && !(w * h <= PDF_MAX_IMAGE_PIXELS)) {
    throw new UnsafeUploadError("pdf_image_too_big", TOO_BIG);
  }
}

/**
 * Inflates a FlateDecode stream the way pdf.js reads one (two header bytes
 * checked, then raw deflate, no checksum), never past `limit` bytes (zlib
 * stops there). Returns the decoded bytes (an empty buffer when pdf.js would
 * refuse the header) and how many input bytes zlib consumed.
 *
 * r6 H1: data zlib refuses is REFUSED (pdf_malformed). pdf.js's own decoder
 * is more lenient than zlib and keeps decoding past where zlib stops, with no
 * cap, so a stream zlib cannot read cannot be checked. Clean truncation (the
 * input ends before the last block) is not an error with Z_SYNC_FLUSH and
 * returns what was decoded.
 */
function inflatePdfStream(data: Buffer, limit: number): { out: Buffer; used: number } {
  if (data.length < 2) return { out: Buffer.alloc(0), used: data.length };
  const cmf = data[0];
  const flg = data[1];
  // pdf.js refuses these headers before decoding anything.
  if ((cmf & 0x0f) !== 0x08 || ((cmf << 8) + flg) % 31 !== 0 || flg & 0x20) return { out: Buffer.alloc(0), used: 2 };
  // r7 H2: zlib reads maxOutputLength NaN as "no cap": only a finite whole number is ever passed.
  if (!Number.isSafeInteger(limit)) throw malformed();
  if (limit <= 0) throw tooBig();
  try {
    const r = inflateRawSync(data.subarray(2), { maxOutputLength: limit, finishFlush: constants.Z_SYNC_FLUSH, info: true }) as unknown as {
      buffer: Buffer;
      engine: { bytesWritten: number };
    };
    return { out: r.buffer, used: 2 + r.engine.bytesWritten };
  } catch (e: any) {
    if (e instanceof RangeError || e?.code === "ERR_BUFFER_TOO_LARGE") throw tooBig();
    throw malformed();
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

/* --------------------------------------------- decoded stream content ---- */

/**
 * Inline image facts: sizes and filters, pdf.js's short keys winning. Read
 * leniently, a filter that is neither a name, an array of names nor a
 * reference is ignored (pdf.js applies no filter for it, or stops on it).
 */
function inlineFacts(entries: Array<[string, Val]>, lenient = false) {
  let w: unknown = null;
  let h: unknown = null;
  let wShort = false;
  let hShort = false;
  let filters: StreamDict["filters"] = [];
  let keys = 0;
  for (const [k, v] of entries) {
    if (k === "W" || k === "Width" || k === "H" || k === "Height") {
      const n = v.k === "num" ? v.v : v.k === "ref" ? "indirect" : null;
      const short = k.length === 1;
      if (k[0] === "W") {
        if (short || !wShort) w = n;
        if (short) wShort = true;
      } else {
        if (short || !hShort) h = n;
        if (short) hShort = true;
      }
    } else if (k === "F" || k === "Filter") {
      const f = filterNames(v);
      if (lenient && f === "unreadable") continue;
      keys++;
      filters = f;
    }
  }
  if (checkFilters(filters, keys).pre) throw new UnsafeUploadError("pdf_filter", NOT_PLAIN);
  checkPixels(w, h);
  return Array.isArray(filters) ? filters.map((f) => INLINE_ABBR[f] ?? f) : [];
}

/**
 * Every inline image in a content stream, read as pdf.js reads them: the
 * content is tokenized from its start, and each BI operator's dictionary is
 * read strictly up to ID. A dictionary that cannot be read cleanly, or an
 * image with no end, is refused (r5). The image data is skipped to the
 * earliest end pdf.js could take, so nothing pdf.js reads as content is
 * skipped here. Returns where the "BI"s it checked are, so the lenient pass
 * below does not read them again (r6 L2).
 *
 * Streams whose type says they are binary (a font, a colour profile) are not
 * tokenized: random bytes spell "BI" there, and refusing on them would refuse
 * real files. The lenient pass reads every "BI" in them instead.
 */
function checkContentTokens(src: Src): number[] {
  const lx = new Lexer(src, 0);
  const b = src.b;
  const checked: number[] = [];
  while (lx.step()) {
    if (lx.tt === T_BAD) return checked; // the rest is one unclosed string to pdf.js too
    if (!lx.is("BI")) continue;
    const at = lx.ts;
    const p = new Parser(lx);
    const entries: Array<[string, Val]> = [];
    let id: Tok;
    for (;;) {
      const k = p.take();
      if (!k) throw malformed();
      if (k.t === T_WORD && k.v === "ID") {
        id = k;
        break;
      }
      if (k.t !== T_NAME) throw malformed();
      const vt = p.take();
      if (!vt || (vt.t === T_WORD && vt.v === "ID")) throw malformed();
      entries.push([k.v as string, readValue(p, vt, 1, true)]);
    }
    const filters = inlineFacts(entries);
    checked.push(at);
    // The data starts one byte after ID.
    let from = id.e + 1;
    const first = filters[0];
    if (first === "ASCII85Decode") {
      const tilde = src.find(0x7e, from);
      if (tilde >= 0) from = tilde + 1;
    } else if (first === "ASCIIHexDecode") {
      const gt = src.find(0x3e, from);
      if (gt >= 0) from = gt + 1;
    }
    // The first "EI" followed by a space or end of line: pdf.js ends the data
    // there or later.
    let ei = -1;
    for (let e = src.find("EI", from); e >= 0; e = src.find("EI", e + 1)) {
      const after = b[e + 2];
      if (e + 2 >= src.n || after === 0x20 || after === 0x0a || after === 0x0d) {
        ei = e;
        break;
      }
    }
    if (ei < 0) throw malformed();
    lx.i = ei + 2;
  }
  return checked;
}

const SIZE_OR_FILTER = new Set(["W", "Width", "H", "Height", "F", "Filter"]);

/** The last token's name (decoded), if it could be one of SIZE_OR_FILTER, else null. */
function sizeOrFilterName(lx: Lexer): string | null {
  const b = lx.src.b;
  let hash = false;
  for (let i = lx.ts + 1; i < lx.te; i++) if (b[i] === 0x23) hash = true;
  const len = lx.te - lx.ts - 1;
  if (!hash && len !== 1 && len !== 5 && len !== 6) return null;
  const raw = latin1(b, lx.ts + 1, lx.te);
  const name = hash ? raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : raw;
  return SIZE_OR_FILTER.has(name) ? name : null;
}

/**
 * Reads one inline image dictionary leniently from `from` (just past BI),
 * never past `end`: the size and filter keys among the first 200 tokens, up
 * to ID. One pass on the lexer's own cursor (r6 L2: no token objects).
 */
function lenientInline(src: Src, from: number, end: number) {
  const lx = new Lexer(src, from, end);
  const b = src.b;
  const entries: Array<[string, Val]> = [];
  for (let n = 0; n < 200 && lx.step(); n++) {
    if (lx.tt === T_BAD || lx.is("ID")) break;
    if (lx.tt !== T_NAME) continue;
    const k = sizeOrFilterName(lx);
    if (!k) continue;
    if (!lx.step()) break;
    n++;
    let v: Val;
    if (lx.tt === T_NAME) v = { k: "name", v: latin1(b, lx.ts + 1, lx.te) };
    else if (lx.tt === T_NUM) {
      const num = Number(latin1(b, lx.ts, lx.te));
      // "n g R" is a reference (pdf.js resolves it): look two tokens ahead.
      const back = lx.i;
      let ref = false;
      if (lx.step() && lx.tt === T_NUM && lx.step() && lx.is("R")) ref = true;
      if (!ref) lx.i = back;
      v = ref ? { k: "ref" } : { k: "num", v: num };
    } else if (lx.tt === T_ARR_OPEN) {
      const items: Val[] = [];
      let ok = true;
      for (let m = 0; m < 50 && lx.step(); m++) {
        if (lx.tt === T_ARR_CLOSE) break;
        if (lx.tt === T_NAME) {
          const raw = latin1(b, lx.ts + 1, lx.te);
          items.push({ k: "name", v: raw.indexOf("#") >= 0 ? raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : raw });
        } else ok = false;
      }
      v = ok ? { k: "arr", items } : { k: "other" };
    } else v = { k: "other" };
    entries.push([k, v]);
  }
  if (entries.length) inlineFacts(entries, true);
}

/** Where the next "BI" standing as its own word is, at or after `from`, or -1. */
function nextBI(src: Src, from: number): number {
  const b = src.b;
  for (let bi = src.find("BI", from); bi >= 0; bi = src.find("BI", bi + 2)) {
    const before = bi === 0 ? 0x20 : b[bi - 1];
    const after = bi + 2 < src.n ? b[bi + 2] : 0x20;
    if ((isWs(before) || isDelim(before)) && (isWs(after) || after === 0x2f)) return bi;
  }
  return -1;
}

/**
 * Every "BI" in decoded content, wherever it stands (inside a string too), is
 * read leniently for its sizes and filters, so an inline image the tokenizer
 * above could miss (it cannot follow pdf.js's image-end rules exactly) is
 * still checked. A size or filter given by reference, or one that is not a
 * plain number or name, is refused. Each read stops at the next "BI", which
 * gets its own read, so no byte is read twice (r5).
 */
function checkInlineImagesAnywhere(src: Src, done: number[] = []) {
  src.rewind();
  let d = 0;
  /** The "BI" at `bi` was already read strictly (checkContentTokens). */
  const strictlyRead = (bi: number) => {
    while (d < done.length && done[d] < bi) d++;
    return d < done.length && done[d] === bi;
  };
  // A read with no "/" in it has no key to check, so the walk goes from "/"
  // to "/", keeping the last "BI" before each (a forward-only cursor): that
  // "BI" starts the read the "/" belongs to, and the read stops at the next
  // "BI". Every byte is searched once.
  let cur = nextBI(src, 0);
  let nxt = cur < 0 ? -1 : nextBI(src, cur + 2);
  for (let slash = cur < 0 ? -1 : src.find("/", cur + 2); slash >= 0; ) {
    while (nxt >= 0 && nxt < slash) {
      cur = nxt;
      nxt = nextBI(src, cur + 2);
    }
    const end = nxt < 0 ? src.n : nxt;
    if (!strictlyRead(cur)) lenientInline(src, cur + 2, end);
    if (nxt < 0) return;
    cur = nxt;
    nxt = nextBI(src, cur + 2);
    slash = src.find("/", cur + 2);
  }
}

/**
 * An object stream, read as pdf.js reads one: /N pairs of object number and
 * offset, then each object parsed strictly from /First plus its offset up to
 * the next one's. Pages there have their boxes checked; a stream there (the
 * spec forbids it, and pdf.js would read it past every cap here, r4 M3) is
 * refused, and so is a header or object that cannot be read cleanly (r5).
 */
function checkObjStm(src: Src, n: unknown, first: unknown) {
  if (typeof n !== "number" || typeof first !== "number" || !Number.isInteger(n) || !Number.isInteger(first) || n < 0 || first < 0) {
    throw malformed();
  }
  if (first > src.n) throw malformed();
  const head = new Parser(new Lexer(src, 0, first));
  const offsets: number[] = [];
  for (let i = 0; i < n; i++) {
    const num = head.take();
    const off = head.take();
    if (!num || !off || num.t !== T_NUM || off.t !== T_NUM || !Number.isInteger(num.v) || !Number.isInteger(off.v)) throw malformed();
    const o = off.v as number;
    if (o < 0 || (offsets.length && o <= offsets[offsets.length - 1]) || first + o >= src.n) throw malformed();
    offsets.push(o);
  }
  for (let i = 0; i < n; i++) {
    const from = first + offsets[i];
    const to = i + 1 < n ? first + offsets[i + 1] : src.n;
    const p = new Parser(new Lexer(src, from, to));
    const t = p.take();
    if (!t) throw malformed();
    const v = t.t === T_DICT_OPEN ? { k: "dict" as const, facts: readDictBody(p, 1, true) } : readValue(p, t, 0, false);
    if (v.k === "dict") {
      const nx = p.peek(0);
      if (nx && nx.t === T_WORD && nx.v === "stream") throw new UnsafeUploadError("pdf_hidden_stream", NOT_PLAIN);
      if (v.facts) {
        checkPageBoxes(v.facts);
        if (v.facts.keys.has("Filter")) checkFilters(v.facts.filters, v.facts.filterKeys);
      }
    }
  }
}

/** Streams whose bytes are binary by type (fonts, colour profiles, files, XML): never content. */
function isBinaryStream(d: StreamDict): boolean {
  if (d.keys.has("Length1") || d.keys.has("Length2") || d.keys.has("Length3") || d.keys.has("N") || d.keys.has("FunctionType")) return true;
  if (d.type === "Metadata" || d.type === "EmbeddedFile" || d.type === "XRef" || d.type === "ObjStm" || d.type === "CMap") return true;
  return d.subtype === "Type1C" || d.subtype === "CIDFontType0C" || d.subtype === "OpenType" || d.subtype === "XML";
}

export interface PdfScan {
  streams: number;
  decodedBytes: number;
  largestStream: number;
}

/*
 * OBJECTS ARE FOUND BY THE "obj" KEYWORD ALONE (security review 3a r3 M1, r4
 * M1 and M2). pdf.js accepts an object at its xref offset when the third token
 * there is the "obj" command; its number lexer is lenient, and between the
 * tokens it allows PDF whitespace (NUL included) and comments. So the scan
 * does not read the numbers at all: one linear pass finds every "obj" that
 * stands as its own token (not part of a longer word such as "endobj" or a
 * name such as "/obj", and ending at PDF whitespace, a delimiter or the end),
 * and whatever follows each one is checked as an object.
 */
function isObjKeywordAt(b: Uint8Array, i: number, word = 3): boolean {
  if (i > 0) {
    const c = b[i - 1];
    const letter = (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
    if (letter || c === 0x2f /* "/" */ || c === 0x23 /* "#" */) return false;
  }
  const j = i + word;
  if (j < b.length) {
    const a = b[j];
    if (!isWs(a) && !isDelim(a)) return false;
  }
  return true;
}

/** Every "obj" keyword in the text: where it is, and where the object after it begins. */
export function findObjectKeywords(s: string): Array<{ at: number; body: number }> {
  const b = Buffer.from(s, "latin1");
  const out: Array<{ at: number; body: number }> = [];
  for (let i = b.indexOf("obj"); i >= 0; i = b.indexOf("obj", i + 3)) {
    if (isObjKeywordAt(b, i)) out.push({ at: i, body: i + 3 });
  }
  return out;
}

/** Throws UnsafeUploadError when the PDF could make a reader inflate too much. */
export function assertSafePdf(buf: Buffer): PdfScan {
  const outer = workNow;
  workNow = 0;
  try {
    return scanPdf(buf);
  } finally {
    lastWork = workNow;
    workNow = outer + workNow;
  }
}

function scanPdf(buf: Buffer): PdfScan {
  const src = new Src(buf, FILE_BUDGET_BASE);
  const n = src.n;
  const locked = () => new UnsafeUploadError("pdf_encrypted", PDF_LOCKED_MESSAGE);

  // An encryption entry in any trailer (classic cross-reference tables). Each
  // trailer dictionary is read strictly; one inside another is refused.
  let trailerTo = 0;
  for (let at = src.find("trailer", 0); at >= 0; at = src.find("trailer", at + 7)) {
    const k = src.skipWs(at + 7, n);
    if (buf[k] !== 0x3c || buf[k + 1] !== 0x3c) continue;
    if (at < trailerTo) throw malformed();
    const p = new Parser(new Lexer(src, k));
    p.take(); // "<<"
    const d = readDictBody(p, 1, true);
    trailerTo = p.reached;
    if (d?.keys.has("Encrypt")) throw locked();
  }

  const scan: PdfScan = { streams: 0, decodedBytes: 0, largestStream: 0 };
  /** End of the furthest object read so far: an object starting inside it is refused. */
  let parsedTo = 0;
  /** Each checked stream: its "stream" keyword and its data, [start, end). */
  const kw: number[] = [];
  const dataStart: number[] = [];
  const dataEnd: number[] = [];
  let regionEnd = 0;
  let endstreamFrom = -1;
  let endstreamAt = -1;

  const text = src.text();
  let searched = 0;
  for (let at = text.indexOf("obj"); ; at = text.indexOf("obj", at + 3)) {
    // The search itself, charged in batches (it only moves forward).
    const reach = at < 0 ? n : at + 3;
    if (reach - searched > 65536 || at < 0) {
      src.charge(reach - searched);
      searched = reach;
    }
    if (at < 0) break;
    if (!isObjKeywordAt(buf, at)) continue;
    // Only "<<" or "[" (after whitespace and comments) can start an object
    // that holds a stream. The skip is charged and cached (r5 M1).
    let k = at + 3;
    let c0 = buf[k];
    if (CLS[c0] === 1 || c0 === 0x25) {
      let sp = 0;
      while (c0 === 0x20 || c0 === 0x00 || c0 === 0x09 || c0 === 0x0c) c0 = buf[k + ++sp];
      src.charge(sp);
      k += sp;
      if (c0 === 0x0a || c0 === 0x0d || c0 === 0x25) {
        // An end of line or "%" already passed by an earlier skip: same answer (see Src).
        if (k >= src.wsFrom && k < src.wsTo) k = src.wsTo;
        else k = src.skipWs(k, n);
      }
    } else if (c0 !== 0x3c && c0 !== 0x5b) continue;
    const c = buf[k];
    const isDict = c === 0x3c && buf[k + 1] === 0x3c;
    if (!isDict && c !== 0x5b) continue;
    // An object found inside another one already read (inside its strings,
    // say) is malformed, never real; refusing it keeps every byte read once.
    if (at < parsedTo) throw malformed();
    const p = new Parser(new Lexer(src, k));
    const open = p.take()!;
    if (!isDict) {
      readValue(p, open, 0, false); // an array: any stream inside is refused
      parsedTo = p.reached;
      continue;
    }
    const dict = readDictBody(p, 1, true)!;
    checkPageBoxes(dict);
    const nx = p.peek(0);
    parsedTo = p.reached;
    if (!nx || nx.t !== T_WORD || nx.v !== "stream") continue;

    // A stream object.
    scan.streams++;
    if (scan.streams > PDF_MAX_STREAMS) throw new UnsafeUploadError("pdf_too_many_streams", TOO_BIG);
    // Streams follow one another: one whose keyword is inside an earlier
    // stream's data is malformed (r5: nothing hides in data, and no data is
    // read twice).
    if (nx.s < regionEnd) throw malformed();
    // The data starts after the next end of line, wherever it is, as pdf.js
    // finds it (skipToNextLine): "stream" may be followed by other bytes first.
    const eol = src.lineEnd(nx.e);
    let start = eol;
    if (eol < n) start = buf[eol] === 0x0d && buf[eol + 1] === 0x0a ? eol + 2 : eol + 1;
    // Its data runs to the next "endstream" (a forward-only search).
    let end: number;
    if (endstreamFrom >= 0 && start >= endstreamFrom && start <= endstreamAt) end = endstreamAt;
    else {
      const e = src.find("endstream", start);
      end = e < 0 ? n : e;
      endstreamFrom = start;
      endstreamAt = end;
    }
    kw.push(nx.s);
    dataStart.push(start);
    dataEnd.push(end);
    regionEnd = Math.max(regionEnd, end);
    parsedTo = Math.max(parsedTo, nx.e);

    // An encryption entry in a cross-reference stream.
    if (dict.type === "XRef" && dict.keys.has("Encrypt")) throw locked();
    const plan = checkFilters(dict.filters, dict.filterKeys);
    const filter = plan.decode;
    if (dict.isImage) checkPixels(dict.width, dict.height);
    // r7 M1: a /Predictor changes the bytes pdf.js reads after Flate, so the
    // checks below would read the wrong bytes. Allowed only where nothing is
    // checked after decoding: cross-reference streams (where predictors are
    // normal) and images not passed to an image codec (no content checks run
    // on them, and a predictor never makes the output larger, so the cap holds).
    const pred = dict.decodePredictor;
    if (pred !== null && !(typeof pred === "number" && pred <= 1)) {
      // r8 M2: never on a stream with /First (it is checked as an object stream).
      const allowed = !dict.keys.has("First") && (dict.type === "XRef" || (dict.isImage && !plan.codec));
      if (!allowed) throw malformed();
      // r8 M1: pdf.js sizes a buffer from the predictor's row, whatever data
      // backs it: the row must be plain and within the stream's own cap.
      const row = dict.decodeRow;
      if (row === "bad" || row === null || row > streamCap(dict)) throw malformed();
    }
    const cap = streamCap(dict);
    const room = () => Math.min(cap, PDF_MAX_TOTAL_BYTES - scan.decodedBytes);
    // Flate reads from the start to the end of the file (more than any reader
    // takes: a lying /Length changes nothing); a text codec reads to its own
    // end mark, which must be in this stream's data.
    const raw = buf.subarray(start);
    const data = buf.subarray(start, end);
    let pre: Buffer | null = null;
    if (plan.pre) {
      pre = decodeTextStream(plan.pre, data, room(), src);
      // Before an image codec, the text codec's output is what the codec reads: count it.
      if (filter !== "FlateDecode") scan.decodedBytes += pre.length;
    }
    let content: Buffer | null = null;
    if (filter === "FlateDecode") {
      const limit = room();
      let input: Buffer;
      if (pre) input = pre;
      else {
        // r6 M1: only the stream's own data, as pdf.js finds it, never the
        // rest of the file. pdf.js takes /Length when an "endstream" follows
        // it, else the first "endstream" (our `end`). Real deflate data ends
        // before that (the line end before "endstream" is left over); bytes
        // past it would only feed the word "endstream" to zlib. A /Length that
        // runs past an "endstream" in the data is refused.
        if (typeof dict.length === "number" && start + dict.length > end && endstreamAfter(src, start + dict.length)) throw malformed();
        input = buf.subarray(start, end);
      }
      const r = inflatePdfStream(input, limit);
      src.charge(r.used); // the input zlib actually read (r6 M1)
      // Deflate data still going at the stream's first "endstream": pdf.js
      // stops there too only when /Length says so, a direct whole number that
      // ends there or earlier. Anything else (no /Length, an indirect one, or
      // one past it) could send pdf.js further, uncapped: refused (r7 H1).
      if (!pre && r.used >= input.length && end < n) {
        const L = dict.length;
        if (!(typeof L === "number" && Number.isSafeInteger(L) && L >= 0 && start + L <= end)) throw malformed();
      }
      content = r.out;
      scan.decodedBytes += content.length;
      scan.largestStream = Math.max(scan.largestStream, content.length);
      if (scan.decodedBytes > PDF_MAX_TOTAL_BYTES) throw tooBig();
    } else if (filter === "ASCII85Decode" || filter === "ASCIIHexDecode") {
      // L2 (r4): a text codec alone only shrinks (ASCII85's "z" aside, which
      // the limit covers); decode it so the content is checked like any other.
      content = decodeTextStream(filter, data, room(), src);
      scan.decodedBytes += content.length;
      scan.largestStream = Math.max(scan.largestStream, content.length);
    } else if (filter === null && !plan.pre) {
      content = buf.subarray(start, end);
    }
    // A JPEG's own frame size decides what a reader allocates, whatever the
    // dictionary says: check it wherever DCTDecode runs last.
    if (plan.codec === "DCTDecode") {
      const jpeg = filter === "FlateDecode" ? content : pre ?? raw;
      const size = jpeg ? jpegFrameSize(jpeg) : null;
      if (size) checkPixels(size.w, size.h);
    }
    // r6 H2: pdf.js reads any stream the xref names as an object stream,
    // whatever its /Type or /Subtype, if it has /N and /First. One with
    // /First is checked as one here (an ICC profile has /N alone, and pdf.js
    // cannot use a stream without /First). If it is labelled or coded as an
    // image, it is refused: real files never do that.
    const objStm = dict.keys.has("First");
    if (objStm) {
      if (dict.isImage || plan.codec || (!content && filter !== null)) throw malformed();
      if (!content || !content.length) throw malformed();
      checkObjStm(new Src(content, CONTENT_BUDGET_BASE), dict.n, dict.first);
    }
    if (content && content.length && !dict.isImage && !plan.codec) {
      // Each stream's content is read with its own budget, from its own size
      // (r5 L1). Unfiltered data is a slice of the file, and slices never
      // overlap (above), so no file byte is read twice this way.
      const csrc = new Src(content, CONTENT_BUDGET_BASE);
      if (dict.type === "ObjStm" && !objStm) checkObjStm(csrc, dict.n, dict.first); // no /First: refused there
      const strictlyRead = dict.type !== "ObjStm" && dict.type !== "XRef" && !objStm && !isBinaryStream(dict) ? checkContentTokens(csrc) : [];
      checkInlineImagesAnywhere(csrc, strictlyRead);
    }
  }

  // FINAL SWEEP (r5): every "stream" keyword standing as its own token, outside
  // the data of the streams checked above, must be one of theirs. A keyword
  // anywhere else (after a dictionary this scan did not read as an object's)
  // is refused.
  let r = 0;
  let q = 0;
  for (let at = src.find("stream", 0); at >= 0; at = src.find("stream", at + 6)) {
    while (r < dataStart.length && dataEnd[r] <= at) r++;
    if (r < dataStart.length && at >= dataStart[r]) {
      at = dataEnd[r] - 6; // skip the rest of this stream's data
      continue;
    }
    if (!isObjKeywordAt(buf, at, 6)) continue;
    while (q < kw.length && kw[q] < at) q++;
    if (kw[q] !== at) throw malformed();
  }
  return scan;
}

/* ------------------------------------------------------------------ ZIP -- */

/** The Word main part: the officeDocument target in _rels/.rels, else word/document.xml. */
export function mainPartName(parts: Array<{ name: string; data: Buffer }>): string {
  const rels = parts.find((p) => p.name === "_rels/.rels");
  if (rels) {
    // Plain string search (each tag read once), no backtracking regex.
    const xml = rels.data.toString("utf8");
    let close = 0;
    for (let at = xml.indexOf("<Relationship"); at >= 0; at = xml.indexOf("<Relationship", close + 1)) {
      close = xml.indexOf(">", at);
      if (close < 0) break;
      const tag = xml.slice(at, close);
      const type = attr(tag, "Type");
      if (!type || !type.endsWith("/officeDocument")) continue;
      const target = attr(tag, "Target");
      if (target) return target.startsWith("./") ? target.slice(2) : target.startsWith("/") ? target.slice(1) : target;
    }
  }
  return "word/document.xml";
}

/** The value of name="..." in one XML tag, or null. */
function attr(tag: string, name: string): string | null {
  const key = name + '="';
  let at = tag.indexOf(key);
  while (at > 0 && !/\s/.test(tag[at - 1])) at = tag.indexOf(key, at + 1);
  if (at < 0) return null;
  const end = tag.indexOf('"', at + key.length);
  return end < 0 ? null : tag.slice(at + key.length, end);
}

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
  // F6: a few bytes after the end record (a trailing newline) are allowed.
  const tail = b.length - (eocd + 22 + commentLen);
  if (tail < 0 || tail > DOCX_MAX_TRAILING_BYTES) throw malformed();

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
  // F5: the main part is the one _rels/.rels names (mammoth finds it the same
  // way), not always word/document.xml.
  const main = mainPartName(kept);
  if (!kept.some((e) => e.name === main)) {
    throw new UnsafeUploadError("zip_malformed", "That file is not a Word document.");
  }
  return { zip: storedZip(kept), kept: kept.map((e) => e.name), dropped };
}
