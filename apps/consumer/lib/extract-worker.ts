/**
 * Runs pdf.js and mammoth in a worker thread with a heap limit and a time
 * budget that really stops the work (security review 3a r2, H1 (c)). A
 * Promise.race only stops waiting: the parse would keep running and keep its
 * memory. Here the worker is terminated when the budget fires, and V8 kills it
 * when it passes its heap limit, without touching the server process or the
 * other requests it is serving.
 *
 * The pre-scans in lib/upload-safety.ts still run first: resourceLimits bounds
 * the JavaScript heap, not ArrayBuffer memory, which is where most of a
 * decompression bomb lives.
 *
 * The worker is built from a string (eval), so there is no worker file for the
 * build to miss. It loads pdf.js and mammoth by absolute path, resolved here
 * with Node's own require from the server bundle's location; both packages are
 * external to the bundle (next.config.mjs serverExternalPackages) and traced
 * into the function by the static imports text-extraction.ts keeps.
 *
 * OCR is not in here: tesseract.js already runs in its own worker, which its
 * own timeout terminates.
 */
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const EXTRACT_WORKER_HEAP_MB = 256;
/** Below this V8 cannot even start the worker, and that failure takes the whole process down. */
export const EXTRACT_WORKER_MIN_HEAP_MB = 32;

export class ExtractAborted extends Error {
  constructor(readonly why: "time" | "memory" | "worker") {
    super(why === "time" ? "extraction time budget" : why === "memory" ? "extraction memory limit" : "extraction worker failed");
    this.name = "ExtractAborted";
  }
}

export class ExtractPdfTooLong extends Error {
  constructor() {
    super("PDF has more pages than the limit");
    this.name = "ExtractPdfTooLong";
  }
}

/** Node's real require, from where this code runs (the server bundle, or tests). */
function nodeRequire(): NodeRequire {
  try {
    // eslint-disable-next-line no-eval
    const r = eval("require");
    if (typeof r === "function" && typeof r.resolve === "function") return r as NodeRequire;
  } catch {
    // ESM test runner: no require in scope
  }
  return createRequire(process.cwd() + "/");
}

let resolved: { pdfjsUrl: string; mammothPath: string } | null = null;
function modulePaths() {
  if (!resolved) {
    const req = nodeRequire();
    resolved = {
      pdfjsUrl: pathToFileURL(req.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href,
      mammothPath: req.resolve("mammoth"),
    };
  }
  return resolved;
}

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
function polyfills() {
  const g = globalThis;
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class DOMMatrix {
      constructor(init) { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; if (Array.isArray(init)) [this.a, this.b, this.c, this.d, this.e, this.f] = init; }
      multiplySelf() { return this; } preMultiplySelf() { return this; } translateSelf() { return this; } scaleSelf() { return this; }
      multiply() { return this; } translate() { return this; } scale() { return this; } inverse() { return this; }
    };
  }
  if (typeof g.Path2D === "undefined") g.Path2D = class Path2D { addPath() {} moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} rect() {} };
  if (typeof g.ImageData === "undefined") g.ImageData = class ImageData { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray((w || 1) * (h || 1) * 4); } };
  if (typeof Promise.withResolvers === "undefined") {
    Promise.withResolvers = function () { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
  }
}
(async () => {
  const d = workerData;
  try {
    if (d.kind === "docx") {
      const mammoth = require(d.mammothPath);
      const r = await mammoth.extractRawText({ buffer: Buffer.from(d.bytes) });
      parentPort.postMessage({ ok: true, text: r.value || "" });
      return;
    }
    polyfills();
    const pdfjs = await import(d.pdfjsUrl);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(d.bytes), useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
    const numPages = doc.numPages;
    if (d.maxPages != null && numPages > d.maxPages) { await doc.destroy(); parentPort.postMessage({ ok: false, code: "too_long" }); return; }
    let out = "";
    for (let i = 1; i <= numPages; i++) {
      if (d.maxChars != null && out.length > d.maxChars) break;
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      for (const item of tc.items) { if (!("str" in item)) continue; out += item.str + (item.hasEOL ? "\\n" : " "); }
      out += "\\n";
      page.cleanup();
    }
    await doc.destroy();
    parentPort.postMessage({ ok: true, text: out, pages: numPages });
  } catch (e) {
    parentPort.postMessage({ ok: false, code: "error", message: String((e && e.message) || e) });
  }
})();
`;

/**
 * Text from a PDF or Word file, read in a worker with a heap limit, stopped
 * (terminated) when `budgetMs` runs out. Rejects with ExtractAborted on time,
 * memory or a worker failure, ExtractPdfTooLong past maxPages, or an Error
 * with the reader's own message.
 */
export function extractInWorker(
  kind: "pdf" | "docx",
  bytes: Buffer,
  opts: { budgetMs: number; maxPages?: number; maxChars?: number; heapMb?: number }
): Promise<string> {
  const { pdfjsUrl, mammothPath } = modulePaths();
  return new Promise((resolve, reject) => {
    let settled = false;
    const copy = new Uint8Array(bytes); // a copy the worker owns
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { kind, bytes: copy, pdfjsUrl, mammothPath, maxPages: opts.maxPages ?? null, maxChars: opts.maxChars ?? null },
      transferList: [copy.buffer],
      resourceLimits: {
        maxOldGenerationSizeMb: Math.max(EXTRACT_WORKER_MIN_HEAP_MB, opts.heapMb ?? EXTRACT_WORKER_HEAP_MB),
        maxYoungGenerationSizeMb: 16,
      },
      stdout: false,
      stderr: false,
    });
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new ExtractAborted("time"))), opts.budgetMs);
    worker.on("message", (m: { ok: boolean; text?: string; code?: string; message?: string }) => {
      finish(() => {
        if (m.ok) resolve(m.text ?? "");
        else if (m.code === "too_long") reject(new ExtractPdfTooLong());
        else reject(new Error(m.message || "extraction failed"));
      });
    });
    worker.on("error", (e: any) => {
      finish(() => reject(new ExtractAborted(e?.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memory" : "worker")));
    });
    worker.on("exit", (code) => {
      finish(() => reject(new ExtractAborted("worker")));
    });
  });
}
