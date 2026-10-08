/**
 * Word (.docx) builder: the same look and the same page breaks as the PDF.
 *
 * One column. No tables for layout, no header or footer text (job sites drop
 * both). Fonts are named Cambria and Calibri, which Word draws with exactly the
 * metrics of the bundled Caladea and Carlito, so lines wrap where the layout
 * model says. Every paragraph uses exact line spacing taken from the model, and
 * spacing is applied as "before" only (the gap the model computed), so heights
 * do not drift between Word and the PDF.
 *
 * Page 2 and later start with ordinary text: "Name, page 2" (and a DRAFT line
 * when the resume is a draft), placed with a page break from the model.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  LineRuleType,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { COLORS, CREDIT_COLS, CREDIT_GAP, CREDIT_YEAR_COL, PAGE_H, PAGE_W, SHAPE, WORD_FONT, type FaceKey } from "./style";
import type { BlockSpec, Layout, Run } from "./layout";

const tw = (pt: number) => Math.round(pt * 20);
const hex = (c: string) => c.replace("#", "").toUpperCase();

function fontFor(face: FaceKey): string {
  return face.startsWith("serif") ? WORD_FONT.serif : WORD_FONT.sans;
}

function run(r: Run, extra: { break?: number } = {}): TextRun {
  return new TextRun({
    text: r.text,
    font: fontFor(r.face),
    size: Math.round(r.size * 2),
    bold: r.face === "serifBold" || r.face === "sansBold",
    italics: r.face === "serifItalic",
    color: hex(r.color),
    ...(extra.break ? { break: extra.break } : {}),
  });
}

/** Runs of one or more layout rows. Separators become " | "; rows end in a line break. */
function rowsRuns(b: BlockSpec, onlyRankFace?: (r: Run) => boolean): TextRun[] {
  const out: TextRun[] = [];
  b.lines.forEach((line, li) => {
    if (onlyRankFace && !onlyRankFace(line.runs[0])) return;
    line.runs.forEach((r, i) => {
      if (r.sep) {
        out.push(new TextRun({ text: " | ", font: WORD_FONT.sans, size: Math.round(r.size * 2), bold: true, color: hex(COLORS.accent) }));
        return;
      }
      const prev = line.runs[i - 1];
      const text = i > 0 && prev && !prev.sep ? " " + r.text : r.text;
      out.push(run({ ...r, text }, li > 0 && i === 0 && out.length ? { break: 1 } : {}));
    });
  });
  return out;
}

function lineH(b: BlockSpec): number {
  return b.lines[0]?.height ?? 12;
}

export interface DocxInput {
  layout: Layout;
  kind?: "resume" | "letter";
  checklist?: Layout | null;
  title: string;
}

export async function buildDocx(inp: DocxInput): Promise<Buffer> {
  const { layout } = inp;
  const L = layout.level;
  const pageW = layout.page?.w ?? PAGE_W;
  const pageH = layout.page?.h ?? PAGE_H;
  const textW = pageW - 2 * L.marginSide;
  const children: (Paragraph | Table)[] = [];
  const starts = new Set(layout.pageStartBlocks.slice(1));
  const pageOfStart = new Map<number, number>();
  layout.pageStartBlocks.forEach((id, k) => pageOfStart.set(id, k + 1));

  const exact = (h: number) => ({ line: tw(h), lineRule: LineRuleType.EXACT });
  let prevAfter = 0;
  let first = true;

  const extras = (pageNo: number, breakBefore: boolean): Paragraph[] => {
    const out: Paragraph[] = [];
    const lines: string[] = [];
    if (layout.draft) lines.push("DRAFT");
    if (pageNo >= 2) lines.push(layout.name ? `${layout.name}, page ${pageNo}` : `Page ${pageNo}`);
    lines.forEach((t, i) => {
      out.push(
        new Paragraph({
          pageBreakBefore: breakBefore && i === 0,
          spacing: { before: 0, after: i === lines.length - 1 ? tw(6) : 0, ...exact(SHAPE.pageLineSize * 1.3) },
          children: [new TextRun({ text: t, font: WORD_FONT.sans, size: Math.round(SHAPE.pageLineSize * 2), bold: t === "DRAFT", color: hex(COLORS.soft) })],
        })
      );
    });
    return out;
  };

  const flush = (b: BlockSpec, list: (Paragraph | Table)[]) => {
    if (starts.has(b.id)) children.push(...extras(pageOfStart.get(b.id) ?? 2, true));
    else if (first) children.push(...extras(1, false));
    children.push(...list);
  };

  for (const b of layout.blocks) {
    const s = b.src;
    const gap = starts.has(b.id) || first ? 0 : Math.max(prevAfter, b.before);
    const before = tw(gap);
    let list: (Paragraph | Table)[] = [];
    switch (s.kind) {
      case "header": {
        const rows = b.lines;
        const groups: { rank: number; lines: typeof rows }[] = [];
        rows.forEach((l) => {
          const rank = l.readRank ?? 0;
          const g = groups[groups.length - 1];
          if (g && g.rank === rank) g.lines.push(l);
          else groups.push({ rank, lines: [l] });
        });
        // visual order: name, headline, contact, notes (the layout's own line order)
        list = groups.map((g, gi) => {
          const sub: BlockSpec = { ...b, lines: g.lines };
          const isLast = gi === groups.length - 1;
          const f = g.lines[0].runs[0].face;
          const gapAbove = gi === 0 ? before : tw(g.lines[0].gapBefore);
          return new Paragraph({
            spacing: { before: gapAbove, after: isLast ? tw(6) : 0, ...exact(lineH(sub)) },
            border: isLast ? { bottom: { style: BorderStyle.SINGLE, size: Math.round(SHAPE.accentRule * 8), color: hex(COLORS.accent), space: 4 } } : undefined,
            children: f === "serifBold" ? g.lines.map((l, i) => run(l.runs[0], i ? { break: 1 } : {})) : rowsRuns(sub),
          });
        });
        break;
      }
      case "section":
        list = [
          new Paragraph({
            spacing: { before, after: tw(2), ...exact(b.lines[0].height) },
            border: { bottom: { style: BorderStyle.SINGLE, size: Math.round(SHAPE.headingRule * 8), color: hex(COLORS.rule), space: 2 } },
            keepNext: true,
            children: [run(b.lines[0].runs[0])],
          }),
        ];
        break;
      case "para": {
        const r0 = b.lines[0].runs[0];
        list = [
          new Paragraph({
            spacing: { before, after: 0, ...exact(lineH(b)) },
            children: [new TextRun({ text: s.text, font: WORD_FONT.serif, size: Math.round(r0.size * 2), italics: s.role === "overview", color: hex(r0.color) })],
          }),
        ];
        break;
      }
      case "job": {
        const titleRun = b.lines[0].runs[0];
        const yearsRun = b.lines[0].runs.find((r) => r.defer);
        const titleText = s.title;
        list.push(
          new Paragraph({
            spacing: { before, after: 0, ...exact(b.lines[0].height) },
            keepNext: true,
            tabStops: [{ type: TabStopType.RIGHT, position: tw(textW) }],
            children: [
              run({ ...titleRun, text: titleText }),
              ...(yearsRun ? [new TextRun({ children: [new Tab()], font: WORD_FONT.sans, size: Math.round(yearsRun.size * 2) }), run(yearsRun)] : []),
            ],
          })
        );
        if (s.rest.length) {
          const metaLine = b.lines[b.lines.length - 1];
          const meta: TextRun[] = [];
          s.rest.forEach((r, i) => {
            if (i > 0) meta.push(new TextRun({ text: " | ", font: WORD_FONT.sans, size: Math.round(SHAPE.metaSize * 2), bold: true, color: hex(COLORS.accent) }));
            meta.push(new TextRun({ text: r, font: WORD_FONT.sans, size: Math.round(SHAPE.metaSize * 2), bold: true, color: hex(COLORS.soft) }));
          });
          list.push(new Paragraph({ spacing: { before: 0, after: 0, ...exact(metaLine.height) }, keepNext: true, children: meta }));
        }
        break;
      }
      case "bullet":
        list = [
          new Paragraph({
            numbering: { reference: "sq", level: 0 },
            spacing: { before, after: 0, ...exact(lineH(b)) },
            children: [new TextRun({ text: s.text, font: WORD_FONT.serif, size: Math.round(b.lines[0].runs[0].size * 2), color: hex(COLORS.ink) })],
          }),
        ];
        break;
      case "skills":
        list = [new Paragraph({ spacing: { before, after: 0, ...exact(lineH(b)) }, children: rowsRuns(b) })];
        break;
      case "letter-para": {
        const r0 = b.lines[0].runs[0];
        list = [new Paragraph({ spacing: { before, after: 0, ...exact(lineH(b)) }, children: [new TextRun({ text: s.lines.join(" "), font: WORD_FONT.serif, size: Math.round(r0.size * 2), color: hex(COLORS.ink) })] })];
        break;
      }
      case "entry": {
        // Years at the left, a tab, then the entry hanging beside them.
        const size = Math.round((b.lines[0]?.runs.find((r) => r.face !== "sansBold")?.size ?? L.body) * 2);
        const col = tw(64);
        const parts: TextRun[] = [];
        s.parts.forEach((p, i) => {
          parts.push(new TextRun({ text: (i > 0 ? " " : "") + p.text, font: WORD_FONT.serif, size, italics: !!p.italic, color: hex(COLORS.ink) }));
          if (p.after) parts.push(new TextRun({ text: p.after, font: WORD_FONT.serif, size, color: hex(COLORS.ink) }));
        });
        list = [
          new Paragraph({
            spacing: { before, after: 0, ...exact(lineH(b)) },
            indent: { left: col, hanging: col },
            tabStops: [{ type: TabStopType.LEFT, position: col }],
            children: [
              new TextRun({ text: s.years, font: WORD_FONT.sans, size: Math.round(SHAPE.metaSize * 2), bold: true, color: hex(COLORS.ink) }),
              new TextRun({ children: [new Tab()], font: WORD_FONT.serif, size }),
              ...parts,
            ],
          }),
        ];
        break;
      }
      case "credit": {
        // Three columns as a borderless table (the years column first only when shown).
        const size = Math.round(L.body * 2);
        const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
        const share = CREDIT_COLS.reduce((a, b) => a + b, 0);
        const yearsW = s.years ? CREDIT_YEAR_COL : 0;
        const colsW = textW - yearsW;
        const widths = [...(s.years ? [yearsW] : []), ...CREDIT_COLS.map((f) => (colsW * f) / share)];
        const cell = (runs: TextRun[], w: number, last: boolean) =>
          new TableCell({
            width: { size: tw(w), type: WidthType.DXA },
            borders: { top: none, bottom: none, left: none, right: none },
            margins: { top: 0, bottom: 0, left: 0, right: last ? 0 : tw(CREDIT_GAP) },
            children: [new Paragraph({ spacing: { before, after: 0, ...exact(lineH(b)) }, children: runs })],
          });
        const colRuns = (ps: { text: string; italic?: boolean; after?: string }[]) => {
          const out: TextRun[] = [];
          ps.forEach((p, i) => {
            out.push(new TextRun({ text: (i > 0 ? " " : "") + p.text, font: WORD_FONT.serif, size, italics: !!p.italic, color: hex(COLORS.ink) }));
            if (p.after) out.push(new TextRun({ text: p.after, font: WORD_FONT.serif, size, color: hex(COLORS.ink) }));
          });
          return out;
        };
        const cells = [
          ...(s.years ? [cell([new TextRun({ text: s.years, font: WORD_FONT.sans, size: Math.round(SHAPE.metaSize * 2), bold: true, color: hex(COLORS.ink) })], yearsW, false)] : []),
          ...s.cols.map((c, i) => cell(colRuns(c), widths[(s.years ? 1 : 0) + i], i === s.cols.length - 1)),
        ];
        list = [
          new Table({
            layout: TableLayoutType.FIXED,
            width: { size: tw(textW), type: WidthType.DXA },
            columnWidths: widths.map((w) => tw(w)),
            borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
            rows: [new TableRow({ cantSplit: true, children: cells })],
          }),
        ];
        break;
      }
      case "letter-closing":
        list = s.lines.map((t, i) =>
          new Paragraph({
            spacing: { before: i === 0 ? before : i === 1 ? tw(b.lines[1]?.gapBefore ?? 0) : 0, after: 0, ...exact(lineH(b)) },
            keepNext: i < s.lines.length - 1,
            children: [new TextRun({ text: t, font: WORD_FONT.serif, size: Math.round(b.lines[0].runs[0].size * 2), bold: i > 0, color: hex(COLORS.ink) })],
          })
        );
        break;
    }
    flush(b, list);
    first = false;
    prevAfter = b.after;
  }

  if (inp.checklist) {
    const c = inp.checklist;
    const items = c.blocks.filter((x) => x.src.kind === "bullet").map((x) => (x.src as { text: string }).text);
    children.push(
      new Paragraph({ pageBreakBefore: true, spacing: { after: 0, ...exact(SHAPE.pageLineSize * 1.3) }, children: [new TextRun({ text: "DRAFT", font: WORD_FONT.sans, size: Math.round(SHAPE.pageLineSize * 2), bold: true, color: hex(COLORS.soft) })] }),
      new Paragraph({
        spacing: { before: tw(6), after: tw(8), ...exact(17.5) },
        border: { bottom: { style: BorderStyle.SINGLE, size: Math.round(SHAPE.accentRule * 8), color: hex(COLORS.accent), space: 4 } },
        children: [new TextRun({ text: "YOUR TO-DO LIST", font: WORD_FONT.sans, size: 28, bold: true, color: hex(COLORS.accent) })],
      }),
      new Paragraph({
        spacing: { after: tw(8), ...exact(14.85) },
        children: [new TextRun({ text: "This page is not part of your resume. It lists what is left to fix. Take this page out before you send your resume to anyone.", font: WORD_FONT.serif, size: 22, color: hex(COLORS.ink) })],
      }),
      ...items.map(
        (t) =>
          new Paragraph({
            numbering: { reference: "sq", level: 0 },
            spacing: { after: tw(4), ...exact(14.85) },
            children: [new TextRun({ text: t, font: WORD_FONT.serif, size: 22, color: hex(COLORS.ink) })],
          })
      )
    );
  }

  const doc = new Document({
    title: inp.title,
    creator: "",
    description: "",
    styles: { default: { document: { run: { font: WORD_FONT.serif, size: Math.round(L.body * 2), color: hex(COLORS.ink) } } } },
    numbering: {
      config: [
        {
          reference: "sq",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: tw(SHAPE.bulletIndent), hanging: tw(SHAPE.bulletIndent) } },
                run: { color: hex(COLORS.accent), font: WORD_FONT.sans, bold: true },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: tw(pageW), height: tw(pageH) },
            margin: { top: tw(L.marginTop), bottom: tw(L.marginBottom), left: tw(L.marginSide), right: tw(L.marginSide), header: 0, footer: 0 },
          },
        },
        children,
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
