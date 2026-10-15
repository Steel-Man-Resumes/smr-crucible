/**
 * HTML builder: the same look as the PDF, from the same layout model.
 *
 * Used three ways:
 *  - the on-screen page (ResumePage) injects resumeCss() and the page markup;
 *  - the HTML download wraps both in a self-contained file with the fonts
 *    embedded as data URIs, so it prints the same anywhere;
 *  - the old print window can open the same file.
 *
 * Page breaks come from the layout model, not from the browser, so the pages
 * match the PDF. Lines that carry separators ("|") are emitted one layout line
 * at a time so a separator never dangles at a line end.
 *
 * Pure string building. No fs here; fonts arrive as a url or data-URI map.
 */

import { escapeHtml as esc } from "../escape-html";
import { COLORS, CREDIT_COLS, CREDIT_GAP, CREDIT_YEAR_COL, FACE_CSS, PAGE_H, PAGE_W, SHAPE, fontFaceCss, type FaceKey, type Level } from "./style";
import type { BlockSpec, Layout, PageSize, Run } from "./layout";

function pt(n: number): string {
  return `${Math.round(n * 100) / 100}pt`;
}

/** CSS for the resume pages, scoped under .rr. */
export function resumeCss(level: Level, opts: { fontUrls: (face: FaceKey) => string; standalone?: boolean; page?: PageSize }): string {
  const L = level;
  const PW = opts.page?.w ?? PAGE_W;
  const PH = opts.page?.h ?? PAGE_H;
  const serif = "ResumeSerif,Cambria,Caladea,Georgia,serif";
  const sans = "ResumeSans,Calibri,Carlito,Arial,sans-serif";
  const body = L.body;
  const css = `
${fontFaceCss(opts.fontUrls)}
.rr{font-family:${serif};font-size:${pt(body)};line-height:${L.lineHeight};color:${COLORS.ink};font-kerning:none;font-variant-ligatures:none;text-rendering:optimizeSpeed;-webkit-print-color-adjust:exact;print-color-adjust:exact;hyphens:manual;-webkit-text-size-adjust:100%}
.rr *{box-sizing:border-box}
.rr .page{background:#fff;width:${pt(PW)};min-height:${pt(PH)};padding:${pt(L.marginTop)} ${pt(L.marginSide)} ${pt(L.marginBottom)} ${pt(L.marginSide)};margin:0 auto 14px auto;box-shadow:0 1px 6px rgba(0,0,0,.18)}
.rr p,.rr h1,.rr h2,.rr h3,.rr ul{margin:0;padding:0}
.rr header{padding-bottom:6pt;border-bottom:${SHAPE.accentRule}pt solid ${COLORS.accent};margin-bottom:4pt}
.rr h1{font:700 ${pt(L.nameSize)}/1.12 ${serif}}
.rr .headline{font:700 ${pt(SHAPE.headlineSize)}/1.25 ${sans};color:${COLORS.accent};margin-top:4pt}
.rr .contact{font:400 ${pt(SHAPE.contactSize)}/1.25 ${sans};color:${COLORS.soft};margin-top:3pt}
.rr .notes{font:400 ${pt(SHAPE.contactSize)}/1.25 ${serif};color:${COLORS.soft};margin-top:3pt}
.rr .ln{display:block}
.rr .sep{color:${COLORS.accent};font-family:${sans};font-weight:700;margin:0 ${SHAPE.sepMargin}em}
.rr .i{white-space:nowrap}
.rr .lab{font-family:${sans};font-weight:700;color:${COLORS.accent}}
.rr h2{font:700 ${pt(SHAPE.headingSize)}/1.25 ${sans};color:${COLORS.accent};margin:${pt(L.sectionBefore)} 0 ${pt(L.sectionAfter)} 0;padding-bottom:2pt;border-bottom:${SHAPE.headingRule}pt solid ${COLORS.rule};break-after:avoid}
.rr .jh{display:grid;grid-template-columns:1fr auto;grid-template-areas:"t y" "m m";column-gap:${pt(SHAPE.jobGap)};margin:${pt(L.jobBefore)} 0 1.5pt 0;break-after:avoid}
.rr .jh h3{grid-area:t;font:700 ${pt(body + 0.5)}/${L.lineHeight - 0.04} ${serif}}
.rr .jm{grid-area:m;font:700 ${pt(SHAPE.metaSize)}/${L.lineHeight - 0.06} ${sans};color:${COLORS.soft}}
.rr .jy{grid-area:y;font:700 ${pt(SHAPE.metaSize)}/${L.lineHeight - 0.04} ${sans};color:${COLORS.ink};white-space:nowrap;text-align:right;align-self:start}
.rr .jo{font-style:italic;color:${COLORS.soft};font-size:${pt(Math.max(10, body - 0.25))};margin:1.5pt 0 2pt 0;break-after:avoid}
.rr .para{margin:0 0 ${pt(L.paraAfter)} 0}
.rr .skills{margin:0 0 ${pt(L.paraAfter)} 0}
.rr ul{list-style:none}
.rr li{padding-left:${pt(SHAPE.bulletIndent)};text-indent:-${pt(SHAPE.bulletIndent)};margin:0 0 ${pt(L.bulletAfter)} 0;break-inside:avoid}
.rr li::before{content:"";display:inline-block;width:${pt(SHAPE.bulletSquare)};height:${pt(SHAPE.bulletSquare)};background:${COLORS.accent};margin:0 ${pt(SHAPE.bulletIndent - SHAPE.bulletSquare - 1)} 0 1pt;vertical-align:${pt(body * 0.12)}}
.rr .pageline{font:400 ${pt(SHAPE.pageLineSize)}/1.3 ${sans};color:${COLORS.soft};margin:0 0 6pt 0}
.rr .pageline.draft{font-weight:700}
.rr .page.dmp{position:relative}
.rr .pageline.dm{position:absolute;top:${pt(Math.max(4, L.marginTop - SHAPE.pageLineSize * 1.3 - 4))};left:${pt(L.marginSide)};margin:0}
.rr .letter p{margin:0 0 ${pt((body + 0.5) * 0.75)} 0;font-size:${pt(body + 0.5)};line-height:${L.lineHeight + 0.03}}
.rr .letter .closing .ln:nth-child(2){margin-top:${pt((body + 0.5) * 1.2)};font-weight:700}
.rr .checklist h2{margin-top:0}
.rr .en{display:grid;grid-template-columns:${pt(64)} 1fr;margin:0 0 ${pt(L.bulletAfter + 1.5)} 0;break-inside:avoid}
.rr .ey{font:700 ${pt(SHAPE.metaSize)}/${L.lineHeight} ${sans};color:${COLORS.ink};white-space:nowrap;padding-top:${pt(Math.max(0, (body - SHAPE.metaSize) * 0.6))}}
.rr .et{margin:0}
.rr .et i{font-style:italic}
.rr .cr{display:grid;grid-template-columns:${CREDIT_COLS.map((f) => `${f}fr`).join(" ")};column-gap:${pt(CREDIT_GAP)};margin:0 0 ${pt(L.bulletAfter + 1.5)} 0;break-inside:avoid}
.rr .cr.y{grid-template-columns:${pt(CREDIT_YEAR_COL)} ${CREDIT_COLS.map((f) => `${f}fr`).join(" ")};column-gap:${pt(CREDIT_GAP)}}
.rr .cr span{display:block}
.rr .cr i{font-style:italic}
${opts.standalone ? `@page{size:${opts.page ? `${pt(PW)} ${pt(PH)}` : "Letter"};margin:${pt(L.marginTop)} ${pt(L.marginSide)} ${pt(Math.max(0, L.marginBottom - 5))} ${pt(L.marginSide)}}\n` : ""}@media print{
.rr .page{width:auto;min-height:0;padding:0;margin:0;box-shadow:none;break-after:page}
.rr .page:last-child{break-after:auto}
.rr .pageline.dm{top:0;left:auto;right:0}
}
${opts.standalone ? "html,body{margin:0;background:#e9edf1}\n@media print{html,body{background:#fff}}" : ""}`;
  return css.trim();
}

function runsHtml(runs: Run[]): string {
  let out = "";
  runs.forEach((r, i) => {
    if (r.sep) {
      out += `<span class="sep" aria-hidden="true">|</span>`;
      return;
    }
    const prev = runs[i - 1];
    const needSpace = i > 0 && prev && !prev.sep && prev.face !== undefined;
    if (needSpace) out += " ";
    const cls = r.face === "sansBold" && r.color === COLORS.accent ? "lab" : "i";
    out += `<span class="${cls}">${esc(r.text)}</span>`;
  });
  return out;
}

function lineRows(b: BlockSpec): string {
  return b.lines.map((l) => `<span class="ln">${runsHtml(l.runs)}</span>`).join("");
}

function plain(b: BlockSpec): string {
  return b.lines.map((l) => l.runs.map((r) => r.text).join("")).join(" ");
}

function pageLines(layout: Layout, pageNo: number): string {
  const out: string[] = [];
  if (layout.draft) out.push(`<p class="pageline draft${layout.draftInMargin ? " dm" : ""}">DRAFT</p>`);
  if (pageNo >= 2) out.push(`<p class="pageline">${esc(layout.name ? `${layout.name}, page ${pageNo}` : `Page ${pageNo}`)}</p>`);
  return out.join("");
}

function blockHtml(b: BlockSpec, letter: boolean): string {
  const s = b.src;
  switch (s.kind) {
    case "header": {
      // Visual order: name, headline, contact, notes. Runs carry their kind by face and colour.
      const rows = b.lines;
      const name = rows.filter((l) => l.runs[0]?.face === "serifBold").map((l) => l.runs[0].text).join(" ");
      const head = rows.filter((l) => l.runs[0]?.face === "sansBold" && l.runs[0].color === COLORS.accent);
      const contact = rows.filter((l) => l.runs[0]?.face === "sans");
      const notes = rows.filter((l) => l.runs[0]?.face === "serif");
      const mk = (cls: string, ls: typeof rows) => (ls.length ? `<p class="${cls}">${ls.map((l) => `<span class="ln">${runsHtml(l.runs)}</span>`).join("")}</p>` : "");
      return `<header>${name ? `<h1>${esc(name)}</h1>` : ""}${mk("headline", head)}${mk("contact", contact)}${mk("notes", notes)}</header>`;
    }
    case "section":
      return `<h2>${esc(s.text)}</h2>`;
    case "job": {
      const meta = s.rest.length
        ? `<div class="jm">${s.rest.map((r) => `<span>${esc(r)}</span>`).join(`<span class="sep" aria-hidden="true">|</span>`)}</div>`
        : "";
      return `<div class="jh"><h3>${esc(s.title)}</h3>${meta}${s.years ? `<div class="jy">${esc(s.years)}</div>` : ""}</div>`;
    }
    case "para":
      return s.role === "overview" ? `<p class="jo">${esc(s.text)}</p>` : `<p class="para">${esc(s.text)}</p>`;
    case "bullet":
      return `<li>${esc(s.text)}</li>`;
    case "skills":
      return `<p class="skills">${lineRows(b)}</p>`;
    case "letter-para":
      return `<p>${esc(plain(b))}</p>`;
    case "letter-closing":
      return `<p class="closing">${s.lines.map((l) => `<span class="ln">${esc(l)}</span>`).join("")}</p>`;
    case "entry": {
      // Years in their own column; titles of works and shows in italics.
      const text = s.parts
        .map((p) => (p.italic ? `<i>${esc(p.text)}</i>` : esc(p.text)) + (p.after ? esc(p.after) : ""))
        .join(" ");
      return `<div class="en"><span class="ey">${esc(s.years)}</span><p class="et">${text}</p></div>`;
    }
    case "credit": {
      // Three columns; the years column only when the lane shows years.
      const col = (ps: { text: string; italic?: boolean; after?: string }[]) =>
        ps.map((p) => (p.italic ? `<i>${esc(p.text)}</i>` : esc(p.text)) + (p.after ? esc(p.after) : "")).join(" ");
      const cells = s.cols.map((c) => `<span>${col(c)}</span>`).join("");
      return s.years ? `<div class="cr y"><span class="ey">${esc(s.years)}</span>${cells}</div>` : `<div class="cr">${cells}</div>`;
    }
    default:
      return letter ? "" : "";
  }
}

/** The page markup for one layout (resume or letter): one <section class="page"> per page. */
export function pagesHtml(layout: Layout, kind: "resume" | "letter" = "resume"): string {
  const letter = kind === "letter";
  const pages: string[] = [];
  const nBlocks = layout.blocks.length;
  layout.pageStartBlocks.forEach((start, k) => {
    const end = k + 1 < layout.pageStartBlocks.length ? layout.pageStartBlocks[k + 1] : nBlocks;
    let html = pageLines(layout, k + 1);
    let inList = false;
    for (let i = start; i < end; i++) {
      const b = layout.blocks[i];
      if (!b) continue;
      const isLi = b.src.kind === "bullet";
      if (isLi && !inList) {
        html += "<ul>";
        inList = true;
      }
      if (!isLi && inList) {
        html += "</ul>";
        inList = false;
      }
      html += blockHtml(b, letter);
    }
    if (inList) html += "</ul>";
    pages.push(`<section class="page${letter ? " letter" : ""}${layout.draftInMargin ? " dmp" : ""}" aria-label="Page ${k + 1}">${html}</section>`);
  });
  return pages.join("\n");
}

/** The to-do page for a DRAFT. Clearly the person's list, not part of the resume. */
export function checklistHtml(layout: Layout): string {
  const items = layout.blocks.filter((b) => b.src.kind === "bullet").map((b) => `<li>${esc((b.src as { text: string }).text)}</li>`).join("");
  return `<section class="page checklist" aria-label="Your to-do list"><p class="pageline draft">DRAFT</p><h2>YOUR TO-DO LIST</h2><p class="para">This page is not part of your resume. It lists what is left to fix. Take this page out before you send your resume to anyone.</p><ul>${items}</ul></section>`;
}

export interface StandaloneInput {
  title: string;
  layout: Layout;
  kind?: "resume" | "letter";
  checklist?: Layout | null;
  fontDataUris: (face: FaceKey) => string;
}

export function standaloneHtml(inp: StandaloneInput): string {
  const css = resumeCss(inp.layout.level, { fontUrls: inp.fontDataUris, standalone: true, page: inp.layout.page });
  const pages = pagesHtml(inp.layout, inp.kind ?? "resume") + (inp.checklist ? "\n" + checklistHtml(inp.checklist) : "");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(inp.title)}</title>
<style>
${css}
</style></head><body>
<div class="rr">
${pages}
</div>
</body></html>
`;
}

export { FACE_CSS };
