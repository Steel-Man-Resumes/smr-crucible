/**
 * Phase 2.5 page-fit engine -- the FIT LOOP over the pure page model in
 * pageFitShared.ts.
 *
 * DOCTRINE: TRUTH WINS, and this loop is ADVISORY ONLY. It NEVER returns a
 * mutated resume and NEVER fabricates content. For a too-long resume it lists,
 * lowest-priority-first, the real blocks whose removal or tightening would bring
 * the document into band, with their measured height cost -- so a HUMAN can
 * decide what to cut. For a too-short resume it suggests where real content
 * could be added. Selection/spacing levers only, always within legibility
 * bounds (never drops the 8pt body font).
 *
 * Pure and deterministic. Deep import as `@crucible/core/src/pageFit`.
 */

import {
  Block,
  BlockType,
  PageFitOptions,
  PageFitResult,
  estimatePageFit,
  estimateBlockHeightTwips,
  parseResumeBlocks,
  lineHeightTwips,
  BODY_SIZE,
  BLOCK_SPACING,
} from "./pageFitShared";

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Priority rank for a block. LOWER number = HIGHER priority (keep). The omission
 * ledger suggests removing HIGHER numbers first. Priority order (locked redline):
 *   header/contact > career summary > professional experience (roles + bullets)
 *   > core competencies > education > certifications > everything else.
 *
 * Because the flat block stream has no section nesting, we assign priority by
 * the current section context as we walk the document (see rankBlocks). This
 * function is the base per-type rank used before section context is applied.
 */
const TYPE_BASE_RANK: Record<BlockType, number> = {
  name: 0,
  contact: 0,
  headline: 1,
  section: 2,
  jobTitle: 5, // professional experience role line
  bullet: 6, // role achievement
  competency: 7, // core competencies
  body: 8, // summary / education / other prose
  blank: 99, // spacing -- lowest priority, tightened first
};

/** Section-context priority: which section a block sits under shifts its rank. */
const SECTION_RANK: { match: RegExp; rank: number }[] = [
  { match: /SUMMARY/, rank: 3 },
  { match: /EXPERIENCE|WORK HISTORY/, rank: 5 },
  { match: /COMPETENC|SKILL|QUALIFICATION|EXPERTISE/, rank: 7 },
  { match: /EDUCATION|CREDENTIAL/, rank: 8 },
  { match: /CERTIFICATION|LICENSE/, rank: 9 },
];

export interface RankedBlock {
  block: Block;
  index: number; // original position in the document
  rank: number; // lower = higher priority (keep); higher = drop-first
  heightTwips: number;
  section: string; // the section label this block sits under ("" = header)
}

/**
 * Rank blocks for the omission ledger. Ranking is ADVISORY: it never reorders
 * the resume and never mutates a role's bullets. It only annotates each block
 * with a keep-priority so the ledger can suggest lowest-priority items first.
 * Within a role, bullets keep their document order (newest-role-first is the
 * natural authoring order); we do not reorder destructively.
 */
export function rankBlocks(blocks: Block[]): RankedBlock[] {
  const ranked: RankedBlock[] = [];
  let currentSection = "";
  let currentSectionRank = 8;

  blocks.forEach((block, index) => {
    if (block.type === "section") {
      currentSection = block.label;
      const hit = SECTION_RANK.find((s) => s.match.test(block.label.toUpperCase()));
      currentSectionRank = hit ? hit.rank : 8;
    }

    let rank: number;
    if (block.type === "name" || block.type === "contact" || block.type === "headline") {
      rank = TYPE_BASE_RANK[block.type];
    } else if (block.type === "section") {
      // A section header inherits its section's rank so an entire low-priority
      // section (header + body) clusters together in the ledger.
      rank = currentSectionRank;
    } else if (block.type === "blank") {
      rank = TYPE_BASE_RANK.blank;
    } else {
      // Body/bullet/jobTitle/competency take the max (lower priority) of their
      // type rank and their section context, so an item in a low-priority
      // section is offered for omission before the same type in experience.
      rank = Math.max(TYPE_BASE_RANK[block.type], currentSectionRank);
    }

    ranked.push({
      block,
      index,
      rank,
      heightTwips: estimateBlockHeightTwips(block),
      section: currentSection,
    });
  });

  return ranked;
}

// ---------------------------------------------------------------------------
// Fit plan
// ---------------------------------------------------------------------------

export type FitStatus = "fits" | "too_short" | "too_long";

export type LedgerKind = "omit" | "tighten" | "add";

export interface LedgerEntry {
  kind: LedgerKind;
  /** Plain, blunt guidance for a justice-impacted audience. No jargon. */
  message: string;
  /** For "omit"/"tighten": the height recovered if applied (twips). */
  recoverableTwips?: number;
  /** For "omit": the block label being suggested for removal. */
  label?: string;
  /** The document index of the block, when the entry points at one. */
  index?: number;
}

export interface FitPlan {
  result: PageFitResult;
  status: FitStatus;
  ledger: LedgerEntry[];
  /**
   * True when the allowed levers (omit lowest-priority items, tighten spacing
   * within bounds) cannot reach the target band. Observable failure state -- the
   * copy says so plainly rather than silently pretending it fits.
   */
  cannotReachBandByLevers?: boolean;
}

/** Round twips to whole recovered lines of 8pt body text, for human-readable copy. */
function twipsToBodyLines(twips: number): number {
  const per = lineHeightTwips(BODY_SIZE);
  return Math.max(0, Math.round(twips / per));
}

function pct(fraction: number): number {
  return Math.round(fraction * 100);
}

/**
 * Total spacing that COULD be recovered by tightening inter-block spacing within
 * legibility bounds. We model a bounded tighten: shave the `after` spacing of
 * blank spacers and reduce section `before` spacing, never touching font size or
 * line height. This is a suggestion only; the route does not apply it.
 */
function tightenableTwips(blocks: Block[]): number {
  let recover = 0;
  for (const b of blocks) {
    if (b.type === "blank") {
      // A blank spacer can be removed entirely (its whole height is recoverable).
      recover += estimateBlockHeightTwips(b);
    } else if (b.type === "section") {
      // Halve the generous 160-twip "before" lead on section headers.
      recover += Math.floor(BLOCK_SPACING.section.before / 2);
    }
  }
  return recover;
}

/**
 * Compute the advisory fit plan for `content`. Bounded work, no mutation, honest
 * failure state.
 */
export function computeFitPlan(content: string, opts: PageFitOptions = {}): FitPlan {
  const result = estimatePageFit(content, opts);
  const blocks = parseResumeBlocks(content);
  const ledger: LedgerEntry[] = [];

  // --- Fits ---
  if (result.band === "ok" || result.band === "empty") {
    return { result, status: "fits", ledger };
  }

  // --- Too short (thin final page) ---
  if (result.band === "under") {
    const fullness = pct(result.finalPageFullness);
    if (result.pageCount === 1) {
      ledger.push({
        kind: "add",
        message: `This resume fills about ${fullness}% of one page. That fits comfortably on a single page. If you want it fuller, add real achievements to your most recent role -- do not pad it.`,
      });
    } else {
      ledger.push({
        kind: "add",
        message: `The last page is only about ${fullness}% full. Add real achievements to your most recent role, or trim slightly so it fits on ${result.pageCount - 1} page${result.pageCount - 1 === 1 ? "" : "s"}. Never invent content to fill space.`,
      });
    }
    return { result, status: "too_short", ledger };
  }

  // --- Too long (over target pages) ---
  // How much height must come off the last page to drop a page. Bringing the
  // document to exactly `maxPages` full pages needs to remove everything past
  // the maxPages boundary.
  const maxPages = opts.maxPages ?? result.perPage.length; // DEFAULT handled in estimatePageFit
  const targetPages = Math.min(maxPages, 2);
  const overflowTwips = Math.max(
    0,
    result.totalHeightTwips - targetPages * result.usableHeightTwips
  );

  ledger.push({
    kind: "omit",
    message: `This resume renders about ${result.pageCount} pages. To bring it to ${targetPages} page${targetPages === 1 ? "" : "s"}, about ${twipsToBodyLines(overflowTwips)} lines of content need to come off. You choose what to cut -- nothing is removed for you. Lowest-priority items first:`,
  });

  // Rank and offer lowest-priority (highest rank) removable items first. Never
  // suggest header/contact/name (rank 0-1) and never suggest section headers
  // alone. Accumulate until the overflow would be covered.
  const ranked = rankBlocks(blocks)
    .filter((r) => r.rank >= 3 && r.block.type !== "blank" && r.block.type !== "section")
    .sort((a, b) => b.rank - a.rank || b.heightTwips - a.heightTwips);

  let accumulated = 0;
  for (const r of ranked) {
    if (accumulated >= overflowTwips) break;
    ledger.push({
      kind: "omit",
      label: r.block.label,
      index: r.index,
      recoverableTwips: r.heightTwips,
      message: `Consider cutting: "${r.block.label}"${r.section ? ` (under ${r.section})` : ""} -- recovers about ${twipsToBodyLines(r.heightTwips)} line${twipsToBodyLines(r.heightTwips) === 1 ? "" : "s"}.`,
    });
    accumulated += r.heightTwips;
  }

  // Spacing lever, as a bounded suggestion (within legibility bounds -- never
  // shrinks font below 8pt).
  const tighten = tightenableTwips(blocks);
  if (tighten > 0) {
    ledger.push({
      kind: "tighten",
      recoverableTwips: tighten,
      message: `Tightening the spacing between sections recovers about ${twipsToBodyLines(tighten)} lines without changing any font size.`,
    });
  }

  // Observable failure: if omitting every offered low-priority item PLUS the
  // spacing lever still cannot cover the overflow, say so plainly.
  const cannotReachBandByLevers = accumulated + tighten < overflowTwips;
  if (cannotReachBandByLevers) {
    ledger.push({
      kind: "omit",
      message: `Even after trimming every lower-priority item above and tightening spacing, this still runs long. The core experience itself is too much for ${targetPages} page${targetPages === 1 ? "" : "s"}. Decide which roles or achievements matter most for this job -- a person, not the tool, makes that call.`,
    });
  }

  return { result, status: "too_long", ledger, cannotReachBandByLevers };
}
