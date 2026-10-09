/**
 * POST /api/check/extract
 *
 * The free checker's file reader (public page /check, no sign-in). Takes one
 * file, returns its text and whether a machine could read it as text. The
 * checks themselves run in the browser.
 *
 * - No AI call. Text extraction only (OCR for a scan or a photo).
 * - Nothing stored: the file and its text are not written anywhere and not
 *   logged (the extractor is handed the file's kind, never its name). The only
 *   write is the per-IP daily counter every open route keeps.
 * - On the Forge's signed-out allowlist (lib/forge-access.ts), with a per-IP
 *   daily limit ("check-extract" in FORGE_IP_LIMITS).
 * - The file's bytes decide what it is and whether it is small enough to open
 *   (lib/check-file-guard.ts): never its name or declared type. One time
 *   budget for the whole read.
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";
import { ReadAbortedError, extractTextForCheck } from "@/lib/text-extraction";
import { CheckFileRefused, withinBudget } from "@/lib/check-file-guard";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** A resume file is small; 10 MB covers a phone photo or a scanned page. */
const CHECK_MAX_BYTES = 10 * 1024 * 1024;
/** More text than any resume: refuse rather than send it back. */
const CHECK_MAX_CHARS = 50_000;

async function handlePost(request: Request): Promise<Response> {
  // A browser upload always says its size; a body that does not is refused
  // before it is read.
  const declared = request.headers.get("content-length");
  if (declared === null) {
    return NextResponse.json({ error: "Choose a file to check." }, { status: 411 });
  }
  const contentLength = Number(declared);
  if (!Number.isFinite(contentLength) || contentLength > CHECK_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "That file is too big. The limit is 10 MB." }, { status: 413 });
  }
  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    file = null;
  }
  if (!file) {
    return NextResponse.json({ error: "Choose a file to check." }, { status: 400 });
  }
  if (file.size > CHECK_MAX_BYTES) {
    return NextResponse.json({ error: "That file is too big. The limit is 10 MB." }, { status: 413 });
  }
  try {
    const { text, read } = await withinBudget(extractTextForCheck(Buffer.from(await file.arrayBuffer())));
    const clean = (text || "").replace(/\r\n?/g, "\n").trim();
    if (clean.length < 20) {
      return NextResponse.json({ text: "", read: "none" });
    }
    if (clean.length > CHECK_MAX_CHARS) {
      return NextResponse.json({ error: "That file has more text than a resume. Check the resume on its own." }, { status: 422 });
    }
    return NextResponse.json({ text: clean, read });
  } catch (err) {
    if (err instanceof CheckFileRefused) {
      const status =
        err.reason === "unknown_kind" || err.reason === "bad_zip" ? 415 : err.reason === "too_many_pages" ? 422 : 413;
      return NextResponse.json({ error: err.message }, { status });
    }
    // The worker ran out of time or memory and was stopped (lib/extract-worker.ts),
    // or the whole read passed the route's budget.
    if (err instanceof ReadAbortedError || (err instanceof Error && err.message === "check time budget")) {
      return NextResponse.json(
        { error: "That file took too long to read. Try a PDF or Word file, or paste the text." },
        { status: 422 }
      );
    }
    // Unreadable or OCR gave up: that IS the answer to "can a machine read it".
    return NextResponse.json({ text: "", read: "none" });
  }
}

export const POST = withRateLimit(handlePost, { mode: "forge", endpoint: "check-extract" });
