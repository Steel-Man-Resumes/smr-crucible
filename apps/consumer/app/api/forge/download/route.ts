/**
 * Document Download API — Converts plain text to DOCX
 *
 * Accepts document content + type (resume/cover_letter) + format (docx/txt).
 * Returns file as download with Content-Disposition: attachment.
 * No rate limiting (no AI calls, just formatting).
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  HeadingLevel,
} from "docx";

export const maxDuration = 30;

const GOLD = "D4A84B";
const DARK = "1a1a1a";
const GRAY = "666666";

interface DownloadInput {
  content: string;
  type: "resume" | "cover_letter";
  format?: "docx" | "txt";
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const input: DownloadInput = await request.json();

    if (!input.content || !input.type) {
      return NextResponse.json(
        { error: "content and type are required" },
        { status: 400 }
      );
    }

    const format = input.format || "docx";

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

    // Build DOCX
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

// --- Resume DOCX Builder ---

async function buildResumeDocx(text: string): Promise<Buffer> {
  const lines = text.split("\n");
  const children: Paragraph[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      children.push(new Paragraph({ spacing: { after: 80 } }));
      continue;
    }

    // Section headers (ALL CAPS lines or lines ending with common section headers)
    if (isSectionHeader(trimmed)) {
      children.push(sectionHeader(trimmed));
      continue;
    }

    // First non-empty line is likely the name
    if (children.length === 0) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [
            new TextRun({
              text: trimmed.toUpperCase(),
              bold: true,
              size: 44,
              font: "Calibri",
              color: DARK,
            }),
          ],
        })
      );
      continue;
    }

    // Bullet points
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("\u2022 ")) {
      const bulletText = trimmed.replace(/^[-*\u2022]\s*/, "");
      children.push(createBulletParagraph(bulletText));
      continue;
    }

    // Skill lines with | separators (core competencies)
    if (trimmed.includes(" | ") && !trimmed.includes(":")) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [
            new TextRun({
              text: trimmed,
              size: 21,
              font: "Calibri",
              color: DARK,
            }),
          ],
        })
      );
      continue;
    }

    // Regular text
    children.push(
      new Paragraph({
        spacing: { after: 100 },
        children: [
          new TextRun({ text: trimmed, size: 22, font: "Calibri" }),
        ],
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 576, right: 720, bottom: 576, left: 720 },
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

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i].trim();
    if (!para) continue;

    // First paragraph — if it looks like "Dear..." it's the greeting
    if (para.startsWith("Dear ") || para.startsWith("To ")) {
      children.push(
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: para,
              size: 22,
              font: "Calibri",
              color: DARK,
            }),
          ],
        })
      );
      continue;
    }

    // "Sincerely," or similar sign-off
    if (
      /^(sincerely|regards|best regards|respectfully|thank you),?$/i.test(
        para.split("\n")[0].trim()
      )
    ) {
      const signLines = para.split("\n");
      for (const sl of signLines) {
        const t = sl.trim();
        if (!t) continue;
        children.push(
          new Paragraph({
            spacing: { before: t === signLines[0].trim() ? 200 : 0, after: 40 },
            children: [
              new TextRun({
                text: t,
                size: 22,
                font: "Calibri",
                bold: t !== signLines[0].trim(),
              }),
            ],
          })
        );
      }
      continue;
    }

    // Body paragraphs
    const subLines = para.split("\n");
    const bodyText = subLines.map((l) => l.trim()).join(" ");
    children.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [
          new TextRun({ text: bodyText, size: 22, font: "Calibri" }),
        ],
      })
    );
  }

  // Gold accent line at top
  const accentLine = new Paragraph({
    spacing: { after: 300 },
    border: {
      bottom: {
        color: GOLD,
        size: 8,
        style: BorderStyle.SINGLE,
        space: 4,
      },
    },
    children: [],
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
          },
        },
        children: [accentLine, ...children],
      },
    ],
  });

  return Packer.toBuffer(doc).then((b) => Buffer.from(b));
}

// --- Utilities ---

function isSectionHeader(text: string): boolean {
  const headers = [
    "PROFESSIONAL SUMMARY",
    "CORE COMPETENCIES",
    "PROFESSIONAL EXPERIENCE",
    "EDUCATION",
    "CERTIFICATIONS",
    "SKILLS",
    "EXPERIENCE",
    "WORK HISTORY",
    "EDUCATION & CERTIFICATIONS",
    "CORE SKILLS",
    "KEY QUALIFICATIONS",
    "AREAS OF EXPERTISE",
    "TECHNICAL SKILLS",
    "RELEVANT EXPERIENCE",
    "MILITARY SERVICE",
    "VOLUNTEER EXPERIENCE",
  ];
  const upper = text.toUpperCase().replace(/[^A-Z\s&]/g, "").trim();
  return headers.includes(upper);
}

function sectionHeader(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 300, after: 140 },
    border: {
      bottom: {
        color: GOLD,
        size: 12,
        style: BorderStyle.SINGLE,
        space: 2,
      },
    },
    children: [
      new TextRun({
        text: text.toUpperCase(),
        bold: true,
        size: 26,
        font: "Calibri",
        color: GOLD,
      }),
    ],
  });
}

function createBulletParagraph(text: string): Paragraph {
  const parts = text.split(/(\d+[%$,.\d]*[KMB]?|\$[\d,.]+\s?[KMB]?)/gi);
  const textRuns: TextRun[] = [
    new TextRun({ text: "\u2022 ", size: 21, font: "Calibri" }),
  ];
  for (const part of parts) {
    if (part && /\d/.test(part)) {
      textRuns.push(
        new TextRun({ text: part, bold: true, size: 21, font: "Calibri" })
      );
    } else if (part) {
      textRuns.push(new TextRun({ text: part, size: 21, font: "Calibri" }));
    }
  }
  return new Paragraph({
    spacing: { after: 80 },
    indent: { left: 360 },
    children: textRuns,
  });
}
