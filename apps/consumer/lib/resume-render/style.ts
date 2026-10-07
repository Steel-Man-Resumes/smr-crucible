/**
 * Resume page style: one source of truth for the PDF, Word and HTML builders
 * and the on-screen page. Pure data, safe to import from the browser.
 *
 * The look follows the styled sample pages: one column, one deep steel-blue
 * accent, serif body, sans labels and dates, title left with years right on
 * the job row, square bullets drawn as shapes, no icons, bars, photos or
 * sidebars. Everything prints cleanly in black and white.
 *
 * Fonts are Caladea (metric twin of Cambria) and Carlito (metric twin of
 * Calibri). Word renders the names Cambria and Calibri with those exact
 * metrics, so the same layout holds in all three formats.
 */

export const PAGE_W = 612; // US Letter, points
export const PAGE_H = 792;

export const COLORS = {
  ink: "#1d2430",
  soft: "#556070",
  accent: "#1f4e79", // deep steel blue, the one accent
  rule: "#cfd6de",
} as const;

export type FaceKey = "serif" | "serifBold" | "serifItalic" | "sans" | "sansBold";

export const FACE_FILES: Record<FaceKey, string> = {
  serif: "Caladea-Regular.ttf",
  serifBold: "Caladea-Bold.ttf",
  serifItalic: "Caladea-Italic.ttf",
  sans: "Carlito-Regular.ttf",
  sansBold: "Carlito-Bold.ttf",
};

/** CSS family names: the Word names first so a machine with Office uses them. */
export const FACE_CSS: Record<FaceKey, { family: string; weight: number; style: "normal" | "italic" }> = {
  serif: { family: "ResumeSerif", weight: 400, style: "normal" },
  serifBold: { family: "ResumeSerif", weight: 700, style: "normal" },
  serifItalic: { family: "ResumeSerif", weight: 400, style: "italic" },
  sans: { family: "ResumeSans", weight: 400, style: "normal" },
  sansBold: { family: "ResumeSans", weight: 700, style: "normal" },
};

/** Word font names (Word draws these with the same metrics as the bundled fonts). */
export const WORD_FONT = { serif: "Cambria", sans: "Calibri" } as const;

/**
 * Fit levels, loosest first. The dial order is margins, then line height, then
 * spacing, then body size (never below 10 pt, margins never below 0.45 in).
 * The renderer picks the loosest level that gives the fewest pages. It never
 * cuts, merges or reorders a word to fit.
 */
export interface Level {
  id: number;
  body: number; // pt
  nameSize: number;
  marginTop: number;
  marginBottom: number;
  marginSide: number;
  lineHeight: number; // multiple of the font size
  sectionBefore: number;
  sectionAfter: number;
  jobBefore: number;
  bulletAfter: number;
  paraAfter: number;
}

const IN = 72;
export const LEVELS: Level[] = [
  { id: 0, body: 10.5, nameSize: 26, marginTop: 0.65 * IN, marginBottom: 0.6 * IN, marginSide: 0.75 * IN, lineHeight: 1.32, sectionBefore: 13, sectionAfter: 4, jobBefore: 7, bulletAfter: 2, paraAfter: 3 },
  { id: 1, body: 10.5, nameSize: 26, marginTop: 0.5 * IN, marginBottom: 0.5 * IN, marginSide: 0.7 * IN, lineHeight: 1.32, sectionBefore: 13, sectionAfter: 4, jobBefore: 7, bulletAfter: 2, paraAfter: 3 },
  { id: 2, body: 10.5, nameSize: 26, marginTop: 0.5 * IN, marginBottom: 0.5 * IN, marginSide: 0.7 * IN, lineHeight: 1.27, sectionBefore: 13, sectionAfter: 4, jobBefore: 7, bulletAfter: 2, paraAfter: 3 },
  { id: 3, body: 10.5, nameSize: 26, marginTop: 0.5 * IN, marginBottom: 0.5 * IN, marginSide: 0.7 * IN, lineHeight: 1.27, sectionBefore: 9, sectionAfter: 3, jobBefore: 4.5, bulletAfter: 1, paraAfter: 2 },
  { id: 4, body: 10, nameSize: 24, marginTop: 0.45 * IN, marginBottom: 0.45 * IN, marginSide: 0.65 * IN, lineHeight: 1.27, sectionBefore: 9, sectionAfter: 3, jobBefore: 4.5, bulletAfter: 1, paraAfter: 2 },
];

/** Fixed shape numbers (points). */
export const SHAPE = {
  bulletIndent: 11,
  bulletSquare: 3.6,
  jobGap: 12, // minimum gap between title and years on a job row
  headingSize: 10.5,
  metaSize: 10,
  headlineSize: 11.5,
  contactSize: 10,
  accentRule: 2.25,
  headingRule: 0.6,
  pageLineSize: 10, // "Name, page 2" and DRAFT lines
  sepMargin: 0.4, // em on each side of a "|"
} as const;

export const SECTION_SKILLS_RE = /COMPETENC|SKILL|QUALIFICATION|EXPERTISE/;

/** CSS for @font-face, given a url for each face. */
export function fontFaceCss(urlFor: (face: FaceKey) => string): string {
  return (Object.keys(FACE_FILES) as FaceKey[])
    .map((k) => {
      const c = FACE_CSS[k];
      return `@font-face{font-family:'${c.family}';font-weight:${c.weight};font-style:${c.style};src:url(${urlFor(k)}) format('truetype');font-display:block}`;
    })
    .join("\n");
}
