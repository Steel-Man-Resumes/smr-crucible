/**
 * Creative lane pages, laid out (POST /api/creative/layout) and exported
 * (GET /api/creative/[laneId]/export). Same page model, fonts and builders as
 * the resume.
 *
 * The layout route is pure compute (no AI, no database), like the resume
 * layout route: it draws the structured model the screen already holds. The
 * export route builds the model from the database itself and decides DRAFT
 * from the open items, so a download is never "finished" with a BLOCK open.
 */

import { NextResponse } from "next/server";
import { renderCreativeScreen, type CreativeRenderRequest } from "./resume-render";
import { FACE_FILES } from "./resume-render/style";
import type { ArtistResumeInput, BioCardInput } from "./resume-render/creative";
import { cleanOpenItems } from "./resume-render";

const MAX_ROWS = 400;
const MAX_TEXT = 600;

function str(v: unknown, max = MAX_TEXT): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/** Rebuild a render request from untrusted JSON: known fields only, bounded. */
export function cleanCreativeRequest(body: unknown): CreativeRenderRequest | null {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const draft = b.draft === true;
  const openItems = cleanOpenItems(b.openItems);
  if (b.doc === "artist_resume") {
    const m = (b.model && typeof b.model === "object" ? b.model : {}) as Record<string, unknown>;
    const h = (m.header && typeof m.header === "object" ? m.header : {}) as Record<string, unknown>;
    let rows = 0;
    const sections = (Array.isArray(m.sections) ? m.sections : []).slice(0, 20).map((s) => {
      const sec = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      return {
        heading: str(sec.heading, 80),
        rows: (Array.isArray(sec.rows) ? sec.rows : [])
          .filter(() => rows++ < MAX_ROWS)
          .map((r) => {
            const row = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
            return {
              years: str(row.years, 20),
              parts: (Array.isArray(row.parts) ? row.parts : []).slice(0, 12).map((p) => {
                const part = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
                return { text: str(part.text), italic: part.italic === true, after: str(part.after, 3) || undefined };
              }),
            };
          }),
      };
    });
    const model: ArtistResumeInput = {
      header: {
        name: str(h.name, 120),
        discipline: str(h.discipline, 120),
        contact: (Array.isArray(h.contact) ? h.contact : []).slice(0, 6).map((x) => str(x, 200)).filter(Boolean),
      },
      sections,
    };
    return { doc: "artist_resume", model, draft, openItems };
  }
  if (b.doc === "bio") {
    const cd = (b.card && typeof b.card === "object" ? b.card : {}) as Record<string, unknown>;
    const card: BioCardInput = {
      name: str(cd.name, 120),
      discipline: str(cd.discipline, 120),
      bios: (Array.isArray(cd.bios) ? cd.bios : []).slice(0, 3).map((x) => {
        const bio = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
        const text = str(bio.text, 5000);
        return { label: str(bio.label, 40), text, words: text.trim() ? text.trim().split(/\s+/).length : 0, chars: Array.from(text).length };
      }),
    };
    return { doc: "bio", card, draft, openItems };
  }
  return null;
}

export async function handleCreativeLayoutPost(request: Request): Promise<Response> {
  try {
    const len = request.headers.get("content-length");
    if (len && parseInt(len, 10) > 400_000) return NextResponse.json({ error: "Request too large" }, { status: 413 });
    const req = cleanCreativeRequest(await request.json().catch(() => null));
    if (!req) return NextResponse.json({ error: "Pick the artist resume or the bio" }, { status: 400 });
    const s = renderCreativeScreen(req, (face) => `/fonts/resume/${FACE_FILES[face]}`);
    return NextResponse.json({ pages: s.pages, words: s.fit.words, pagesHtml: s.pagesHtml, css: s.css });
  } catch (error) {
    console.error("Creative layout error:", error);
    return NextResponse.json({ error: "Could not lay out the page right now. Please try again." }, { status: 500 });
  }
}
