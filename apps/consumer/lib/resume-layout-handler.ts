/**
 * Resume layout handler (used by app/api/resume/layout/route.ts): the page count and the on-screen page, both from the same
 * layout model that builds the PDF, so what the person sees is what downloads.
 *
 * POST { text, kind?, headerText?, screen? }
 *   -> { pages, words, spillLines, lastPageFill }
 *   -> with screen: true also { pagesHtml, css } for the on-screen page
 *
 * Pure compute, no AI and no database. Works signed out (the Forge is
 * anonymous). IP rate limited with a generous cap because the page asks once
 * per change of text.
 */

import { NextResponse } from "next/server";
import { renderScreen } from "./resume-render";
import { fitFor } from "./resume-render";
import { FACE_FILES } from "./resume-render/style";

const MAX_CHARS = 200_000;

interface Body {
  text?: unknown;
  kind?: unknown;
  headerText?: unknown;
  screen?: unknown;
  draft?: unknown;
}

export async function handleLayoutPost(request: Request) {
  try {
    const len = request.headers.get("content-length");
    if (len && parseInt(len, 10) > 500_000) {
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }
    const body = (await request.json()) as Body;
    if (typeof body.text !== "string") {
      return NextResponse.json({ error: "text must be text" }, { status: 400 });
    }
    if (body.text.length > MAX_CHARS) {
      return NextResponse.json({ error: "text is too large" }, { status: 413 });
    }
    const kind = body.kind === "cover_letter" ? "cover_letter" : "resume";
    const headerText = typeof body.headerText === "string" ? body.headerText.slice(0, MAX_CHARS) : undefined;
    const req = { text: body.text, kind, headerText } as const;

    if (body.screen === true) {
      const s = renderScreen({ ...req, draft: body.draft === true }, (face) => `/fonts/resume/${FACE_FILES[face]}`);
      return NextResponse.json({
        pages: s.fit.pages,
        words: s.fit.words,
        spillLines: s.fit.spillLines,
        lastPageFill: s.fit.lastPageFill,
        pagesHtml: s.pagesHtml,
        css: s.css,
      });
    }
    const fit = fitFor(req);
    return NextResponse.json({ pages: fit.pages, words: fit.words, spillLines: fit.spillLines, lastPageFill: fit.lastPageFill });
  } catch (error) {
    console.error("Resume layout error:", error);
    return NextResponse.json({ error: "Could not lay out the page right now. Please try again." }, { status: 500 });
  }
}

