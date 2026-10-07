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
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";
import { checkFileKind, extractTextForCheck } from "@/lib/text-extraction";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** A resume file is small; 10 MB covers a phone photo or a scanned page. */
const CHECK_MAX_BYTES = 10 * 1024 * 1024;
/** More text than any resume: refuse rather than send it back. */
const CHECK_MAX_CHARS = 50_000;

async function handlePost(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > CHECK_MAX_BYTES + 64 * 1024) {
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
  const kind = checkFileKind(file.name || "", file.type || "");
  if (!kind) {
    return NextResponse.json(
      { error: "Use a PDF, a Word file, a text file, or a photo of your resume." },
      { status: 415 }
    );
  }
  try {
    const { text, read } = await extractTextForCheck(Buffer.from(await file.arrayBuffer()), kind, file.type || "");
    const clean = (text || "").replace(/\r\n?/g, "\n").trim();
    if (clean.length < 20) {
      return NextResponse.json({ text: "", read: "none", kind });
    }
    if (clean.length > CHECK_MAX_CHARS) {
      return NextResponse.json({ error: "That file has more text than a resume. Check the resume on its own." }, { status: 422 });
    }
    return NextResponse.json({ text: clean, read, kind });
  } catch {
    // Unreadable or OCR gave up: that IS the answer to "can a machine read it".
    return NextResponse.json({ text: "", read: "none", kind });
  }
}

export const POST = withRateLimit(handlePost, { mode: "forge", endpoint: "check-extract" });
