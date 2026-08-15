/**
 * Document Download API — Converts plain text to TORI-standard DOCX
 *
 * Matches the Meg Sanger TORI reference:
 * - Navy header block with white text (name, headline, contact)
 * - Georgia headers + Arial body (8pt body, 9pt headers)
 * - Tight margins (0.28" top/bot, 0.43" sides) for one-page fit
 * - Bold metrics in bullets for visual anchoring
 * - ATS-parseable text layer, no graphics
 */

import { NextResponse } from "next/server";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  ShadingType,
} from "docx";
import { withRateLimit } from "@/lib/withRateLimit";
import { buildResumeFilename } from "@/lib/resume-filename";
// Phase 2.5: geometry + line classification live in the shared page-fit model so
// the page-fit estimator (estimatePageFit) and this DOCX builder cannot drift --
// single source of truth. Colors stay local (not geometry).
import {
  NAME_SIZE,
  HEADLINE_SIZE,
  CONTACT_SIZE,
  SECTION_SIZE,
  BODY_SIZE,
  BULLET_SIZE,
  COMPETENCY_SIZE,
  JOB_TITLE_SIZE,
  MARGIN_TOP_TWIPS,
  MARGIN_BOTTOM_TWIPS,
  MARGIN_LEFT_TWIPS,
  MARGIN_RIGHT_TWIPS,
  BULLET_INDENT_TWIPS,
  isSectionHeader,
  isBulletLine,
  stripBulletMarker,
  isCompetencyLine,
  isJobTitleLine,
} from "@crucible/core/src/pageFitShared";

export const maxDuration = 30;
const MAX_DOWNLOAD_REQUEST_BYTES = 500_000;
const MAX_DOCUMENT_CHARS = 200_000;

// TORI color palette (matches Meg Sanger reference)
const NAVY = "1B2A4A";       // dark navy — headers, section titles, accent
const WHITE = "FFFFFF";       // white text on navy backgrounds
const DARK = "1a1a1a";       // near-black body text
const MED_GRAY = "333333";   // competency text
const GRAY = "555555";        // secondary text
const LIGHT_BLUE = "B8C9E0"; // headline accent on navy

// Font sizes in half-points (docx spec) are imported from pageFitShared so the
// page-fit model measures the exact sizes this builder renders. See the import
// block above. (NAME_SIZE=36/18pt, BODY_SIZE=16/8pt, etc.)

interface DownloadInput {
  content: string;
  type: "resume" | "cover_letter";
  format?: "docx" | "txt";
  // Optional naming inputs (Phase 2.6). When supplied, the download is named
  // First-Last--Lane--Company--Role.<ext> instead of a generic constant. Any
  // missing piece collapses out cleanly; nothing known falls back to
  // "Resume"/"CoverLetter" -- never a bare "document".
  name?: string;
  firstName?: string;
  lastName?: string;
  lane?: string;
  company?: string;
  role?: string;
  meta?: { targetCompany?: string; targetJob?: string; lane?: string };
}

/**
 * Derive the download filename from whatever naming inputs the caller passed.
 * first/last come from explicit fields or by splitting `name`; company/role
 * fall back to meta.targetCompany / meta.targetJob.
 */
function resolveDownloadFilename(input: DownloadInput, ext: string): string {
  let firstName = input.firstName;
  let lastName = input.lastName;
  if ((!firstName || !lastName) && typeof input.name === "string" && input.name.trim()) {
    const tokens = input.name.trim().split(/\s+/);
    firstName = firstName || tokens[0];
    lastName = lastName || (tokens.length > 1 ? tokens.slice(1).join(" ") : undefined);
  }
  return buildResumeFilename({
    firstName,
    lastName,
    lane: input.lane || input.meta?.lane,
    company: input.company || input.meta?.targetCompany,
    role: input.role || input.meta?.targetJob,
    kind: input.type === "cover_letter" ? "cover_letter" : "resume",
    ext,
  });
}

async function handlePost(request: Request) {
  try {
    const contentLength = request.headers.get("content-length");
    if (
      contentLength &&
      parseInt(contentLength, 10) > MAX_DOWNLOAD_REQUEST_BYTES
    ) {
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }

    const input: DownloadInput = await request.json();

    if (!input.content || !input.type) {
      return NextResponse.json(
        { error: "content and type are required" },
        { status: 400 }
      );
    }
    if (typeof input.content !== "string") {
      return NextResponse.json({ error: "content must be text" }, { status: 400 });
    }
    if (input.content.length > MAX_DOCUMENT_CHARS) {
      return NextResponse.json({ error: "content is too large" }, { status: 413 });
    }
    if (input.type !== "resume" && input.type !== "cover_letter") {
      return NextResponse.json({ error: "invalid document type" }, { status: 400 });
    }

    const format = input.format || "docx";
    if (format !== "docx" && format !== "txt") {
      return NextResponse.json({ error: "invalid format" }, { status: 400 });
    }

    if (format === "txt") {
      const blob = new Blob([input.content], { type: "text/plain" });
      const fileName = resolveDownloadFilename(input, "txt");
      return new Response(blob, {
        headers: {
          "Content-Type": "text/plain",
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    }

    const buffer =
      input.type === "resume"
        ? await buildResumeDocx(input.content)
        : await buildCoverLetterDocx(input.content);

    const fileName = resolveDownloadFilename(input, "docx");

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error: any) {
    console.error("Download error:", error);
    return NextResponse.json(
      { error: "Failed to generate document." },
      { status: 500 }
    );
  }
}

// --- Resume DOCX Builder (TORI Standard) ---

async function buildResumeDocx(text: string): Promise<Buffer> {
  const lines = text.split("\n");
  const children: Paragraph[] = [];
  let lineIndex = 0;
  let headerDone = false;

  // Parse header block: name, headline, contact (first 3 meaningful lines)
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

  // Build navy header block
  const nameLine = headerLines[0] || "";
  const headlineLine = headerLines.length > 2 ? headerLines[1] : "";
  const contactLine = headerLines.find((l) => l.includes("|") || l.includes("@") || l.includes("\u2022")) || headerLines[1] || "";

  // Name (white on navy, centered, 18pt Georgia bold)
  if (nameLine) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 20 },
        shading: { type: ShadingType.CLEAR, fill: NAVY },
        children: [
          new TextRun({
            text: nameLine.toUpperCase(),
            bold: true,
            size: NAME_SIZE,
            font: "Georgia",
            color: WHITE,
          }),
        ],
      })
    );
  }

  // Headline (light blue on navy, centered, 8pt Arial)
  if (headlineLine && headlineLine !== contactLine) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 20 },
        shading: { type: ShadingType.CLEAR, fill: NAVY },
        children: [
          new TextRun({
            text: headlineLine,
            size: HEADLINE_SIZE,
            font: "Arial",
            color: LIGHT_BLUE,
          }),
        ],
      })
    );
  }

  // Contact (white on navy, centered, 8pt Arial)
  if (contactLine) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        shading: { type: ShadingType.CLEAR, fill: NAVY },
        children: [
          new TextRun({
            text: contactLine,
            size: CONTACT_SIZE,
            font: "Arial",
            color: WHITE,
          }),
        ],
      })
    );
  }

  // Skip header lines in the main loop
  const headerSet = new Set(headerLines.map((l) => l.trim()));
  let pastHeader = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip header lines (already rendered above)
    if (!pastHeader) {
      if (headerSet.has(trimmed) || !trimmed) {
        if (headerSet.has(trimmed)) headerSet.delete(trimmed);
        if (headerSet.size === 0) pastHeader = true;
        continue;
      }
      pastHeader = true;
    }

    if (!trimmed) {
      children.push(new Paragraph({ spacing: { after: 30 } }));
      continue;
    }

    // Section headers
    if (isSectionHeader(trimmed)) {
      children.push(sectionHeader(trimmed));
      continue;
    }

    // Bullet points
    if (isBulletLine(trimmed)) {
      const bulletText = stripBulletMarker(trimmed);
      children.push(createBulletParagraph(bulletText));
      continue;
    }

    // Skill/competency lines: 4+ pipe/bullet parts, OR 3 short parts (skill names)
    // Avoids catching job-title lines ("TITLE | Company, Dates") or education lines
    if (isCompetencyLine(trimmed)) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [
            new TextRun({
              text: trimmed,
              bold: true,
              size: COMPETENCY_SIZE,
              font: "Arial",
              color: MED_GRAY,
            }),
          ],
        })
      );
      continue;
    }

        // Job title lines (TITLE | Company | Location | Dates)
    if (isJobTitleLine(trimmed)) {
      const parts = trimmed.split("|").map((p) => p.trim());
      const runs: TextRun[] = [];
      parts.forEach((part, idx) => {
        if (idx === 0) {
          runs.push(new TextRun({ text: part, bold: true, size: JOB_TITLE_SIZE, font: "Arial", color: DARK }));
        } else {
          runs.push(new TextRun({ text: "  |  ", size: JOB_TITLE_SIZE, font: "Arial", color: GRAY }));
          runs.push(new TextRun({ text: part, size: JOB_TITLE_SIZE, font: "Arial", color: GRAY }));
        }
      });
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 30 },
          children: runs,
        })
      );
      continue;
    }

    // Regular text (summary paragraphs, education lines, etc.)
    children.push(
      new Paragraph({
        spacing: { after: 50 },
        children: [
          new TextRun({ text: trimmed, size: BODY_SIZE, font: "Arial", color: DARK }),
        ],
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            // TORI tight margins: 0.28" top/bot, 0.43" sides
            margin: {
              top: MARGIN_TOP_TWIPS,     // 0.28in
              right: MARGIN_RIGHT_TWIPS, // 0.43in
              bottom: MARGIN_BOTTOM_TWIPS,
              left: MARGIN_LEFT_TWIPS,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc).then((b) => Buffer.from(b));
}

// --- Cover Letter DOCX Builder ---

async function buildCoverLetterDocx(text: string): Promise<Buffer> {
  const children: Paragraph[] = [];
  const paragraphs = text.split(/\n\n+/);

  // Navy accent line at top
  children.push(
    new Paragraph({
      spacing: { after: 200 },
      border: {
        bottom: {
          color: NAVY,
          size: 8,
          style: BorderStyle.SINGLE,
          space: 4,
        },
      },
      children: [],
    })
  );

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("Dear ") || trimmed.startsWith("To ")) {
      children.push(
        new Paragraph({
          spacing: { after: 160 },
          children: [
            new TextRun({ text: trimmed, size: 20, font: "Arial", color: DARK }),
          ],
        })
      );
      continue;
    }

    if (/^(sincerely|regards|best regards|respectfully|thank you),?$/i.test(trimmed.split("\n")[0].trim())) {
      const signLines = trimmed.split("\n");
      for (const sl of signLines) {
        const t = sl.trim();
        if (!t) continue;
        children.push(
          new Paragraph({
            spacing: { before: t === signLines[0].trim() ? 160 : 0, after: 20 },
            children: [
              new TextRun({
                text: t,
                size: 20,
                font: "Arial",
                bold: t !== signLines[0].trim(),
                color: DARK,
              }),
            ],
          })
        );
      }
      continue;
    }

    const bodyText = trimmed.split("\n").map((l) => l.trim()).join(" ");
    children.push(
      new Paragraph({
        spacing: { after: 160 },
        children: [
          new TextRun({ text: bodyText, size: 20, font: "Arial", color: DARK }),
        ],
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 864, right: 864, bottom: 864, left: 864 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc).then((b) => Buffer.from(b));
}

// --- Utilities ---
// SECTION_HEADERS + isSectionHeader now live in @crucible/core/src/pageFitShared
// (imported above) so the page-fit model and this builder share one definition.

function sectionHeader(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 160, after: 60 },
    border: {
      bottom: {
        color: NAVY,
        size: 4,
        style: BorderStyle.SINGLE,
        space: 2,
      },
    },
    children: [
      new TextRun({
        text: text.toUpperCase(),
        bold: true,
        size: SECTION_SIZE,
        font: "Georgia",
        color: NAVY,
      }),
    ],
  });
}

function createBulletParagraph(text: string): Paragraph {
  const parts = text.split(/(\d+[%$,.\d]*[KMB]?|\$[\d,.]+\s?[KMB]?)/gi);
  const textRuns: TextRun[] = [
    new TextRun({ text: "\u2022  ", size: BULLET_SIZE, font: "Arial", color: NAVY }),
  ];
  for (const part of parts) {
    if (part && /\d/.test(part)) {
      textRuns.push(
        new TextRun({ text: part, bold: true, size: BULLET_SIZE, font: "Arial", color: DARK })
      );
    } else if (part) {
      textRuns.push(new TextRun({ text: part, size: BULLET_SIZE, font: "Arial", color: DARK }));
    }
  }
  return new Paragraph({
    spacing: { after: 30 },
    indent: { left: BULLET_INDENT_TWIPS },
    children: textRuns,
  });
}

export const POST = withRateLimit(handlePost, {
  mode: "ip",
  endpoint: "forge-download",
});
