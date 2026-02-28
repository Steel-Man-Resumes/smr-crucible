/**
 * Resume Parse API Route
 *
 * Accepts file upload, extracts text (PDF/DOCX/image/OCR),
 * then parses structured profile data using GPT-4o-mini.
 *
 * Ported from smr-forge/app/api/parse/route.ts
 */

import { NextResponse } from "next/server";
import { extractTextFromBuffer } from "@/lib/text-extraction";
import { withRateLimit } from "@/lib/withRateLimit";

export const maxDuration = 60;

async function handlePost(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Extract text from file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const resumeText = await extractTextFromBuffer(
      buffer,
      file.name,
      file.type
    );

    if (!resumeText || resumeText.trim().length < 20) {
      return NextResponse.json(
        {
          error:
            "We couldn't read enough text from that file. Try a different format, or use our guided builder instead.",
        },
        { status: 422 }
      );
    }

    // Clean text: normalize unicode, standardize line breaks
    const cleanedText = resumeText
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2013/g, "-")
      .replace(/\u2014/g, "--")
      .replace(/\u2026/g, "...")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\t/g, " ")
      .replace(/ {3,}/g, "  ")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();

    // Parse structured profile using GPT-4o-mini
    const parsedProfile = await parseWithAI(cleanedText);

    return NextResponse.json({
      resumeText: cleanedText,
      profile: parsedProfile,
      charCount: cleanedText.length,
      fileName: file.name,
    });
  } catch (error: any) {
    console.error("Parse error:", error);
    return NextResponse.json(
      {
        error:
          error.message || "Something went wrong reading your file. Try again?",
      },
      { status: 500 }
    );
  }
}

async function parseWithAI(
  text: string
): Promise<Record<string, unknown>> {
  // Use OpenAI for structured extraction (cheaper, fast, reliable for parsing)
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // If no OpenAI key, return raw text without structured parsing
    console.warn("OPENAI_API_KEY not set, skipping structured parsing");
    return { raw_text: text };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a resume parser. Extract structured data from resume text.
Return a JSON object with:
{
  "full_name": string or null,
  "email": string or null,
  "phone": string or null,
  "city": string or null,
  "state": string or null,
  "work_history": [{ "company": string, "title": string, "start_date": string, "end_date": string, "bullets": string[] }],
  "education": [{ "institution": string, "credential": string, "field": string, "year": string }],
  "certifications": string[],
  "military": { "branch": string, "rank": string, "years": string } or null,
  "skills_mentioned": string[]
}
Parse what exists. Use null for missing fields. Do not infer or fabricate.`,
        },
        {
          role: "user",
          content: text.slice(0, 8000), // Limit input size
        },
      ],
      max_tokens: 2000,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    console.error("OpenAI parse failed:", response.status);
    return { raw_text: text };
  }

  const data = await response.json();
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return { raw_text: text };
  }
}

export const POST = withRateLimit(handlePost, { mode: "ip", endpoint: "parse" });
