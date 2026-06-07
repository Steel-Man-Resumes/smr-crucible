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

// Font sizes in half-points (docx spec)
const NAME_SIZE = 36;       // 18pt
const HEADLINE_SIZE = 16;   // 8pt
const CONTACT_SIZE = 16;    // 8pt
const SECTION_SIZE = 18;    // 9pt
const BODY_SIZE = 16;       // 8pt
const BULLET_SIZE = 16;     // 8pt
const COMPETENCY_SIZE = 16; // 8pt
const JOB_TITLE_SIZE = 17;  // 8.5pt

interface DownloadInput {
  content: string;
  type: "resume" | "cover_letter";
  format?: "docx" | "txt";
}

export async function POST(request: Request) {
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
      const fileName =
        input.type === "resume"
          ? "My_Resume_SteelMan.txt"
          : "My_CoverLetter_SteelMan.txt";
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

    const fileName =
      input.type === "resume"
        ? "My_Resume_SteelMan.docx"
        : "My_CoverLetter_SteelMan.docx";

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
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("\u2022 ")) {
      const bulletText = trimmed.replace(/^[-*\u2022]\s*/, "");
      children.push(createBulletParagraph(bulletText));
      continue;
    }

    // Skill/competency lines (3+ pipe separators or bullet separators)
    if ((trimmed.includes(" | ") || trimmed.includes(" \u2022 ")) && trimmed.split(/[|•]/).length >= 3) {
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
    if (trimmed.includes("|") && !trimmed.includes("@")) {
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
              top: 403,   // 0.28" = 403 twips
              right: 619,  // 0.43" = 619 twips
              bottom: 403,
              left: 619,
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

const SECTION_HEADERS = new Set([
  "PROFESSIONAL SUMMARY", "CAREER SUMMARY", "SUMMARY",
  "CORE COMPETENCIES", "CORE SKILLS", "KEY QUALIFICATIONS", "AREAS OF EXPERTISE", "TECHNICAL SKILLS",
  "PROFESSIONAL EXPERIENCE", "EXPERIENCE", "WORK HISTORY", "RELEVANT EXPERIENCE",
  "EDUCATION", "EDUCATION & CREDENTIALS", "EDUCATION & CERTIFICATIONS",
  "CERTIFICATIONS", "LICENSES & CERTIFICATIONS",
  "SKILLS", "MILITARY SERVICE", "VOLUNTEER EXPERIENCE",
  "JUSTICE ADVOCACY & COMMUNITY IMPACT", "COMMUNITY IMPACT",
]);

function isSectionHeader(text: string): boolean {
  const upper = text.toUpperCase().replace(/[^A-Z\s&]/g, "").trim();
  return SECTION_HEADERS.has(upper);
}

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
    indent: { left: 280 },
    children: textRuns,
  });
}
