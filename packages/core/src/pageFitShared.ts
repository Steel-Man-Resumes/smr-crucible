/**
 * Phase 2.5 page-fit engine -- PURE, deterministic model of the exact DOCX
 * geometry produced by apps/consumer/app/api/forge/download/route.ts.
 *
 * WHY a deterministic DOCX model instead of a browser render: the artifact the
 * user actually downloads is a .docx built by the `docx` npm lib, not HTML/PDF.
 * So the most faithful page-fit answer is a model of THAT builder's exact
 * geometry -- same margins, fonts, half-point sizes, and per-paragraph spacing.
 * Zero new infra, no headless browser. Decision A (serverless chromium) stays a
 * documented, dependency-free, feature-flagged stub (see apps/consumer/lib/
 * pagefit-renderer.ts) for a future cross-check, but is NOT wired in.
 *
 * DOCTRINE: TRUTH WINS. This engine NEVER fabricates content and NEVER silently
 * drops real content. It only ESTIMATES how many pages the download will be and
 * how full the last page is, and REPORTS. A human decides what to cut. The
 * numbers here are an approximation of Word's own pagination (see the accuracy
 * note at the bottom), deliberately rounded UP so the estimate does not
 * under-count pages.
 *
 * No db/pg/aws imports -- client-safe. Deep import as
 * `@crucible/core/src/pageFitShared`. The download route imports the geometry
 * constants and classifiers from HERE so there is a single source of truth and
 * the model cannot drift from the builder.
 */

// ---------------------------------------------------------------------------
// Geometry -- must match forge/download/route.ts buildResumeDocx exactly.
// 1440 twips per inch; 20 twips per point; docx font `size` is in half-points
// so half-points -> twips = *10 (half-point/2 = pt, pt*20 = twips).
// ---------------------------------------------------------------------------

export const TWIPS_PER_INCH = 1440;

/** US Letter, portrait. */
export const PAGE_WIDTH_TWIPS = Math.round(8.5 * TWIPS_PER_INCH); // 12240
export const PAGE_HEIGHT_TWIPS = Math.round(11 * TWIPS_PER_INCH); // 15840

/** TORI tight margins from the route: 0.28" top/bottom, 0.43" left/right. */
export const MARGIN_TOP_TWIPS = 403; // 0.28in
export const MARGIN_BOTTOM_TWIPS = 403; // 0.28in
export const MARGIN_LEFT_TWIPS = 619; // 0.43in
export const MARGIN_RIGHT_TWIPS = 619; // 0.43in

/** Usable text box: 7.64in wide x 10.44in tall. */
export const USABLE_WIDTH_TWIPS =
  PAGE_WIDTH_TWIPS - MARGIN_LEFT_TWIPS - MARGIN_RIGHT_TWIPS; // 11002 (~7.64in)
export const USABLE_HEIGHT_TWIPS =
  PAGE_HEIGHT_TWIPS - MARGIN_TOP_TWIPS - MARGIN_BOTTOM_TWIPS; // 15034 (~10.44in)

// Font sizes in half-points (docx spec) -- identical to the route's constants.
export const NAME_SIZE = 36; // 18pt Georgia bold
export const HEADLINE_SIZE = 16; // 8pt Arial
export const CONTACT_SIZE = 16; // 8pt Arial
export const SECTION_SIZE = 18; // 9pt Georgia
export const BODY_SIZE = 16; // 8pt Arial
export const BULLET_SIZE = 16; // 8pt Arial
export const COMPETENCY_SIZE = 16; // 8pt Arial bold
export const JOB_TITLE_SIZE = 17; // 8.5pt Arial

/** Bullet paragraphs are indented left 280 twips (route: indent.left = 280). */
export const BULLET_INDENT_TWIPS = 280;

// ---------------------------------------------------------------------------
// Calibration constants (the two numbers that make this an ESTIMATE, not a
// pixel-perfect Word render). Chosen conservatively so we round UP.
// ---------------------------------------------------------------------------

/**
 * Line-height multiple for docx "single" spacing (no explicit spacing.line is
 * set by the route, so Word uses font-metric single spacing). Arial/Georgia
 * single-line height is ~1.13-1.15x the point size. 1.15 is the conservative
 * end so the estimate does not under-count vertical space.
 */
export const LINE_HEIGHT_MULTIPLE = 1.15;

/**
 * Average glyph advance for the body font, expressed in twips per half-point of
 * font size. 8pt Arial (16 half-points) -> 16 * 5.75 = 92 twips/char = 4.6pt,
 * a conservative average advance for 8pt Arial (real average ~4.4-4.8pt). The
 * larger fonts scale proportionally. Conservative (slightly wide) so wrapped
 * line counts round UP, never under-count.
 */
export const CHAR_ADVANCE_TWIPS_PER_HALFPOINT = 5.75;

/**
 * An empty paragraph (the route's blank-line spacer) has no run, so its height
 * is the document default font's line height. Word's default is ~11pt; we model
 * a blank at 22 half-points (11pt) so blank spacers are not under-counted.
 */
export const DEFAULT_BLANK_HALFPOINT = 22;

/**
 * Bump this whenever the geometry or calibration above changes. Used as part of
 * any cache key so a stale estimate is never served after a model change.
 */
export const RENDERER_VERSION = "pagefit-1.0.0";

// ---------------------------------------------------------------------------
// Line classification -- the SAME predicates buildResumeDocx uses. The download
// route imports these so the two cannot drift. (Header parsing needs multi-line
// context and lives in parseResumeBlocks below.)
// ---------------------------------------------------------------------------

/** Canonical section-header labels (route: SECTION_HEADERS). */
export const SECTION_HEADERS: ReadonlySet<string> = new Set([
  "PROFESSIONAL SUMMARY", "CAREER SUMMARY", "SUMMARY",
  "CORE COMPETENCIES", "CORE SKILLS", "KEY QUALIFICATIONS", "AREAS OF EXPERTISE", "TECHNICAL SKILLS",
  "PROFESSIONAL EXPERIENCE", "EXPERIENCE", "WORK HISTORY", "RELEVANT EXPERIENCE",
  "EDUCATION", "EDUCATION & CREDENTIALS", "EDUCATION & CERTIFICATIONS",
  "CERTIFICATIONS", "LICENSES & CERTIFICATIONS",
  "SKILLS", "MILITARY SERVICE", "VOLUNTEER EXPERIENCE",
  "JUSTICE ADVOCACY & COMMUNITY IMPACT", "COMMUNITY IMPACT",
]);

export function isSectionHeader(text: string): boolean {
  const upper = text.toUpperCase().replace(/[^A-Z\s&]/g, "").trim();
  return SECTION_HEADERS.has(upper);
}

/** Bullet line: starts with "- ", "* ", or "• " (route bullet detection). */
export function isBulletLine(text: string): boolean {
  return (
    text.startsWith("- ") ||
    text.startsWith("* ") ||
    text.startsWith("• ")
  );
}

/** Strip the leading bullet marker, matching the route's bullet replace. */
export function stripBulletMarker(text: string): string {
  return text.replace(/^[-*•]\s*/, "");
}

/**
 * Competency/skills line: 4+ pipe/bullet parts, OR exactly 3 short parts. Mirrors
 * the route's isCompetencyLine so a job-title line ("TITLE | Company, Dates") is
 * NOT caught.
 */
export function isCompetencyLine(text: string): boolean {
  const pipeParts = text.split(/[|•]/).map((p) => p.trim()).filter(Boolean);
  return (
    (text.includes(" | ") || text.includes(" • ")) &&
    (pipeParts.length >= 4 ||
      (pipeParts.length === 3 && pipeParts.every((p) => p.length <= 22)))
  );
}

/** Job-title line: contains a pipe and is not a contact line (route). */
export function isJobTitleLine(text: string): boolean {
  return text.includes("|") && !text.includes("@");
}

// ---------------------------------------------------------------------------
// Block model
// ---------------------------------------------------------------------------

export type BlockType =
  | "name"
  | "headline"
  | "contact"
  | "section"
  | "bullet"
  | "competency"
  | "jobTitle"
  | "body"
  | "blank";

export interface Block {
  type: BlockType;
  /** The text as it will be rendered (bullet marker already stripped for bullets). */
  text: string;
  /** A short human label for the ledger/report (never the raw content for blanks). */
  label: string;
}

/**
 * Classify a single POST-HEADER line the way buildResumeDocx does, in the same
 * order (section -> bullet -> competency -> jobTitle -> body). Empty -> "blank".
 * Header lines (name/headline/contact) need multi-line context and are produced
 * by parseResumeBlocks, not here.
 */
export function classifyResumeLine(line: string): BlockType {
  const t = line.trim();
  if (!t) return "blank";
  if (isSectionHeader(t)) return "section";
  if (isBulletLine(t)) return "bullet";
  if (isCompetencyLine(t)) return "competency";
  if (isJobTitleLine(t)) return "jobTitle";
  return "body";
}

/**
 * Parse plain resume text into ordered blocks, mirroring buildResumeDocx's two
 * passes: (1) collect the header block (first up-to-4 meaningful lines, stopping
 * at a blank or the first section header) and emit name/headline/contact; then
 * (2) walk the remaining lines, skipping the already-rendered header lines, and
 * classify each.
 */
export function parseResumeBlocks(content: string): Block[] {
  const lines = content.split("\n");
  const blocks: Block[] = [];

  // --- Pass 1: header block (route: buildResumeDocx header parse) ---
  const headerLines: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (headerLines.length > 0) break; // end of header block
      continue;
    }
    if (isSectionHeader(t)) break; // hit first section
    if (headerLines.length < 4) {
      headerLines.push(t);
    } else {
      break;
    }
  }

  const nameLine = headerLines[0] || "";
  const headlineLine = headerLines.length > 2 ? headerLines[1] : "";
  const contactLine =
    headerLines.find(
      (l) => l.includes("|") || l.includes("@") || l.includes("•")
    ) || headerLines[1] || "";

  if (nameLine) {
    // Route uppercases the name; height is length-invariant so keep as-is.
    blocks.push({ type: "name", text: nameLine, label: "Name" });
  }
  if (headlineLine && headlineLine !== contactLine) {
    blocks.push({ type: "headline", text: headlineLine, label: "Headline" });
  }
  if (contactLine) {
    blocks.push({ type: "contact", text: contactLine, label: "Contact line" });
  }

  // --- Pass 2: body (route: main loop, skipping header lines) ---
  const headerSet = new Set(headerLines.map((l) => l.trim()));
  let pastHeader = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!pastHeader) {
      if (headerSet.has(trimmed) || !trimmed) {
        if (headerSet.has(trimmed)) headerSet.delete(trimmed);
        if (headerSet.size === 0) pastHeader = true;
        continue;
      }
      pastHeader = true;
    }

    if (!trimmed) {
      blocks.push({ type: "blank", text: "", label: "Spacing" });
      continue;
    }

    const type = classifyResumeLine(trimmed);
    if (type === "section") {
      blocks.push({ type, text: trimmed, label: trimmed.toUpperCase() });
    } else if (type === "bullet") {
      const bulletText = stripBulletMarker(trimmed);
      blocks.push({ type, text: bulletText, label: shortLabel(bulletText) });
    } else {
      blocks.push({ type, text: trimmed, label: shortLabel(trimmed) });
    }
  }

  return blocks;
}

function shortLabel(text: string): string {
  const t = text.trim();
  return t.length <= 60 ? t : t.slice(0, 57) + "...";
}

// ---------------------------------------------------------------------------
// Height model
// ---------------------------------------------------------------------------

/** Per-block-type spacing (twips) exactly as the route sets spacing.before/after. */
export const BLOCK_SPACING: Record<BlockType, { before: number; after: number }> = {
  name: { before: 60, after: 20 },
  headline: { before: 0, after: 20 },
  contact: { before: 0, after: 60 },
  section: { before: 160, after: 60 },
  bullet: { before: 0, after: 30 },
  competency: { before: 0, after: 40 },
  jobTitle: { before: 120, after: 30 },
  body: { before: 0, after: 50 },
  blank: { before: 0, after: 30 },
};

/** Font half-point size the route uses for each block type. */
export const BLOCK_FONT_HALFPOINT: Record<BlockType, number> = {
  name: NAME_SIZE,
  headline: HEADLINE_SIZE,
  contact: CONTACT_SIZE,
  section: SECTION_SIZE,
  bullet: BULLET_SIZE,
  competency: COMPETENCY_SIZE,
  jobTitle: JOB_TITLE_SIZE,
  body: BODY_SIZE,
  blank: DEFAULT_BLANK_HALFPOINT,
};

/** Single-line height in twips for a given docx half-point font size. */
export function lineHeightTwips(fontHalfPoint: number): number {
  return Math.round(fontHalfPoint * 10 * LINE_HEIGHT_MULTIPLE);
}

/**
 * Estimate wrapped line count for `text` at `fontHalfPoint` within `widthTwips`.
 * Conservative: rounds UP so a long line never under-counts its height.
 */
export function wrappedLineCount(
  text: string,
  fontHalfPoint: number,
  widthTwips: number
): number {
  if (!text) return 1;
  const charAdvance = fontHalfPoint * CHAR_ADVANCE_TWIPS_PER_HALFPOINT;
  const charsPerLine = Math.max(1, Math.floor(widthTwips / charAdvance));
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

/** Total vertical cost of a block: wrapped lines * line height + before + after. */
export function estimateBlockHeightTwips(block: Block): number {
  const font = BLOCK_FONT_HALFPOINT[block.type];
  const spacing = BLOCK_SPACING[block.type];
  const width =
    block.type === "bullet"
      ? USABLE_WIDTH_TWIPS - BULLET_INDENT_TWIPS
      : USABLE_WIDTH_TWIPS;
  // jobTitle and competency lines are, by construction, single lines in the
  // reference resumes; still estimate a wrap so an unusually long one counts.
  const lines =
    block.type === "blank" ? 1 : wrappedLineCount(block.text, font, width);
  return lines * lineHeightTwips(font) + spacing.before + spacing.after;
}

// ---------------------------------------------------------------------------
// Page fit
// ---------------------------------------------------------------------------

export type FitBand = "under" | "ok" | "over" | "empty";

export interface PageFitOptions {
  /** Max acceptable page count for "ok" (the locked redline target: 1 or 2). */
  maxPages?: number;
  /** Min fraction the FINAL page must be filled to be "ok" (redline: 0.70). */
  minFinalFullness?: number;
}

export interface PerPageFill {
  index: number; // 0-based
  filledTwips: number;
  fullnessFraction: number; // filledTwips / usableHeight, clamped 0..1
}

export interface PageFitBlock {
  type: BlockType;
  label: string;
  heightTwips: number;
  page: number; // 0-based page the block STARTS on
}

export interface PageFitResult {
  pageCount: number;
  usableHeightTwips: number;
  totalHeightTwips: number;
  perPage: PerPageFill[];
  finalPageFullness: number;
  band: FitBand;
  blocks: PageFitBlock[];
  rendererVersion: string;
}

export const DEFAULT_MAX_PAGES = 2;
export const DEFAULT_MIN_FINAL_FULLNESS = 0.7;

/**
 * Deterministic page-fit estimate for the DOCX the download route would build
 * from `content`. Content flows continuously down the usable text box; page
 * count is total height / usable height (rounded up). A block's `page` is the
 * page its start offset falls on. See the accuracy note at the top of the file.
 */
export function estimatePageFit(
  content: string,
  opts: PageFitOptions = {}
): PageFitResult {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const minFinalFullness = opts.minFinalFullness ?? DEFAULT_MIN_FINAL_FULLNESS;
  const usable = USABLE_HEIGHT_TWIPS;

  const parsed = parseResumeBlocks(content);

  const blocks: PageFitBlock[] = [];
  let running = 0;
  // "Meaningful" height ignores leading/trailing blank spacers so an empty or
  // whitespace-only input is reported as "empty", not a thin 1-pager.
  let meaningfulHeight = 0;
  for (const b of parsed) {
    const h = estimateBlockHeightTwips(b);
    const startPage = Math.floor(running / usable);
    blocks.push({ type: b.type, label: b.label, heightTwips: h, page: startPage });
    running += h;
    if (b.type !== "blank") meaningfulHeight += h;
  }

  const totalHeight = running;
  const pageCount = Math.max(1, Math.ceil(totalHeight / usable));

  const perPage: PerPageFill[] = [];
  for (let i = 0; i < pageCount; i++) {
    const filled = Math.max(0, Math.min(usable, totalHeight - i * usable));
    perPage.push({
      index: i,
      filledTwips: filled,
      fullnessFraction: Math.max(0, Math.min(1, filled / usable)),
    });
  }

  const finalPageFullness = perPage[perPage.length - 1].fullnessFraction;

  let band: FitBand;
  if (meaningfulHeight === 0) {
    band = "empty";
  } else if (pageCount > maxPages) {
    band = "over";
  } else if (finalPageFullness < minFinalFullness) {
    band = "under";
  } else {
    band = "ok";
  }

  return {
    pageCount,
    usableHeightTwips: usable,
    totalHeightTwips: totalHeight,
    perPage,
    finalPageFullness,
    band,
    blocks,
    rendererVersion: RENDERER_VERSION,
  };
}
