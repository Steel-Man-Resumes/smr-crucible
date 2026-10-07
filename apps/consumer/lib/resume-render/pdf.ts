/**
 * PDF builder: draws the layout model with pdf-lib and the embedded Carlito and
 * Caladea fonts. Real selectable text, one column, no images, no header or
 * footer regions. Text is drawn in reading order: for a job row, title, then
 * employer and place, then years.
 */

import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { PAGE_H, PAGE_W, type FaceKey } from "./style";
import type { Layout, PlacedLine, Run } from "./layout";
import { FONT_FEATURES, fontBytes } from "./fonts";

function hex(c: string) {
  const n = parseInt(c.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export interface PdfInput {
  layouts: Layout[]; // resume pages first, then any checklist pages
  title: string;
}

export async function buildPdf(input: PdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit);
  // Only the faces this document draws are embedded. Carlito is embedded whole:
  // fontkit's subsetter drops glyphs from it (letters vanish), so it cannot be
  // subset safely. Caladea subsets fine.
  const used = new Set<FaceKey>();
  for (const l of input.layouts) for (const p of l.pages) for (const ln of p.lines) for (const r of ln.runs) used.add(r.face);
  const fonts = {} as Record<FaceKey, Awaited<ReturnType<PDFDocument["embedFont"]>>>;
  for (const f of used) {
    const subset = f === "serif" || f === "serifBold" || f === "serifItalic";
    fonts[f] = await pdf.embedFont(fontBytes(f), { subset, features: FONT_FEATURES as never });
  }
  pdf.setTitle(input.title);
  pdf.setProducer("");
  pdf.setCreator("");
  pdf.setAuthor("");
  pdf.setSubject("");
  pdf.setKeywords([]);

  for (const layout of input.layouts) {
    for (const p of layout.pages) {
      const page = pdf.addPage([PAGE_W, PAGE_H]);
      // group lines by block so deferred runs (years) are drawn after the block's other text
      let i = 0;
      while (i < p.lines.length) {
        let j = i;
        while (j + 1 < p.lines.length && p.lines[j + 1].blockId === p.lines[i].blockId && p.lines[i].blockId !== -1) j++;
        const group = p.lines.slice(i, j + 1);
        const drawOrder = [...group].sort((a, b) => (a.readRank ?? 0) - (b.readRank ?? 0));
        const deferred: { run: Run; line: PlacedLine }[] = [];
        for (const line of drawOrder) {
          for (const run of line.runs) {
            if (run.defer) deferred.push({ run, line });
            else draw(run, line);
          }
        }
        for (const d of deferred) draw(d.run, d.line);
        for (const line of group) {
          if (line.rule) {
            page.drawLine({
              start: { x: line.rule.x1, y: PAGE_H - line.rule.y },
              end: { x: line.rule.x2, y: PAGE_H - line.rule.y },
              thickness: line.rule.w,
              color: hex(line.rule.color),
            });
          }
          if (line.square) {
            page.drawRectangle({
              x: line.square.x,
              y: PAGE_H - line.square.y - line.square.size,
              width: line.square.size,
              height: line.square.size,
              color: hex("#1f4e79"),
            });
          }
        }
        i = j + 1;
      }
      function draw(run: Run, line: PlacedLine) {
        page.drawText(run.text, { x: run.x, y: PAGE_H - line.y, size: run.size, font: fonts[run.face], color: hex(run.color) });
      }
    }
  }
  return pdf.save();
}
