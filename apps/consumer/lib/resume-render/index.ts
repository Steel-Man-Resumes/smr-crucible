/**
 * Server entry for the resume renderer: one call per output format, all from
 * the same layout model. See README-ish notes at the top of layout.ts.
 *
 *   renderResumeLayout(req)  -> { fit, pagesHtml, css } for the on-screen page
 *   renderPdf(req)           -> PDF bytes (pdf-lib, embedded fonts)
 *   renderDocx(req)          -> Word bytes
 *   renderHtml(req)          -> self-contained HTML (fonts embedded)
 *
 * The request carries { text, kind, draft, openItems }. The renderer never
 * decides draft versus finished: the caller (the finish page, via the engine's
 * getResumeStatus) does, and passes the flag.
 */

import { fontBytes, fontMeasurer } from "./fonts";
import { layoutChecklist, layoutLetter, layoutResume, type FitInfo, type Layout } from "./layout";
import { parseLetter, parseResume, plainDashes } from "./model";
import { buildPdf } from "./pdf";
import { buildDocx } from "./docx";
import { checklistHtml, pagesHtml, resumeCss, standaloneHtml } from "./html";
import type { FaceKey } from "./style";

export interface RenderRequest {
  text: string;
  kind?: "resume" | "cover_letter";
  /** True: every page carries a small DRAFT line and a to-do page follows. */
  draft?: boolean;
  /** Plain-words list of what is left to fix. Only used when draft is true. */
  openItems?: string[];
  /** For a cover letter: the resume text, used for the name and contact header. */
  headerText?: string;
}

export const MAX_OPEN_ITEMS = 30;
export const MAX_OPEN_ITEM_CHARS = 300;

export function cleanOpenItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i): i is string => typeof i === "string")
    .map((i) => plainDashes(i.replace(/\s+/g, " ").trim()).slice(0, MAX_OPEN_ITEM_CHARS))
    .filter(Boolean)
    .slice(0, MAX_OPEN_ITEMS);
}

interface Built {
  layout: Layout;
  fit: FitInfo;
  checklist: Layout | null;
  kind: "resume" | "letter";
  title: string;
}

export function build(req: RenderRequest): Built {
  const m = fontMeasurer();
  const draft = !!req.draft;
  const items = cleanOpenItems(req.openItems);
  const isLetter = req.kind === "cover_letter";
  const checklist = draft && items.length ? layoutChecklist(items, m) : null;
  if (isLetter) {
    const model = parseLetter(req.text, req.headerText);
    const { layout, fit } = layoutLetter(model, m, { draft });
    const who = model.header.name;
    return { layout, fit, checklist, kind: "letter", title: who ? `${who} cover letter` : "Cover letter" };
  }
  const model = parseResume(req.text);
  const { layout, fit } = layoutResume(model, m, { draft });
  const who = model.header.name;
  return { layout, fit, checklist, kind: "resume", title: who ? `${who} resume` : "Resume" };
}

export function fitFor(req: RenderRequest): FitInfo {
  return build({ ...req, draft: false, openItems: [] }).fit;
}

export async function renderPdf(req: RenderRequest): Promise<Uint8Array> {
  const b = build(req);
  return buildPdf({ layouts: b.checklist ? [b.layout, b.checklist] : [b.layout], title: b.title });
}

export async function renderDocx(req: RenderRequest): Promise<Buffer> {
  const b = build(req);
  return buildDocx({ layout: b.layout, kind: b.kind, checklist: b.checklist, title: b.title });
}

const dataUriCache = new Map<FaceKey, string>();
function fontDataUri(face: FaceKey): string {
  let u = dataUriCache.get(face);
  if (!u) {
    u = `data:font/ttf;base64,${Buffer.from(fontBytes(face)).toString("base64")}`;
    dataUriCache.set(face, u);
  }
  return u;
}

export function renderHtml(req: RenderRequest): string {
  const b = build(req);
  return standaloneHtml({ title: b.title, layout: b.layout, kind: b.kind, checklist: b.checklist, fontDataUris: fontDataUri });
}

/** What the on-screen page needs: markup per page and the CSS (fonts by url). */
export function renderScreen(req: RenderRequest, fontUrl: (face: FaceKey) => string): { fit: FitInfo; pagesHtml: string; css: string; pages: number } {
  const b = build(req);
  const pages = pagesHtml(b.layout, b.kind) + (b.checklist ? "\n" + checklistHtml(b.checklist) : "");
  return { fit: b.fit, pagesHtml: pages, css: resumeCss(b.layout.level, { fontUrls: fontUrl }), pages: b.layout.pages.length };
}

export { type FitInfo } from "./layout";
