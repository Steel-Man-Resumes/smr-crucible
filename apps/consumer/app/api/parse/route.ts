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
import { recordTokenUsage } from "@/lib/ai-usage-log";

export const maxDuration = 60;

async function handlePost(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const pastedText = formData.get("text");

    if (!file && typeof pastedText !== "string") {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    let resumeText: string | null;
    let sourceName: string;

    if (file) {
      // File size limit: high enough for phone photos/scanned PDFs, still bounded
      // for serverless memory and OCR runtime.
      if (file.size > 25 * 1024 * 1024) {
        return NextResponse.json(
          { error: "File too large (max 25MB)" },
          { status: 413 }
        );
      }

      // Extract text from file
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      resumeText = await extractTextFromBuffer(buffer, file.name, file.type);
      sourceName = file.name;
    } else {
      // Pasted text path (incl. output copied from the user's own AI).
      // Strip common markdown so ChatGPT/Claude-formatted resumes parse clean.
      resumeText = String(pastedText)
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*\n]+)\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/```[a-z]*\n?/g, "")
        .replace(/^[-*+]\s+/gm, "- ")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
      sourceName = "pasted-text";
    }

    if (resumeText && resumeText.length > 50_000) {
      return NextResponse.json(
        { error: "Text content too large" },
        { status: 400 }
      );
    }

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
    const parsedProfile = (await parseWithAI(cleanedText)) as Record<string, any>;

    // Deterministic contact preservation (F5): the parser must not "normalize"
    // an email -- dropping the "+qasol" tag was the QA failure. If the AI's email
    // is not literally in the source text, restore the verbatim one (or null it),
    // never ship a silently altered address.
    if (typeof parsedProfile.email === "string" && parsedProfile.email) {
      if (!cleanedText.includes(parsedProfile.email)) {
        const found = cleanedText.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i)?.[0];
        parsedProfile.email = found || null;
      }
    }

    return NextResponse.json({
      resumeText: cleanedText,
      profile: parsedProfile,
      charCount: cleanedText.length,
      fileName: sourceName,
    });
  } catch (error: any) {
    console.error("Parse error:", error);
    // A genuinely unreadable document (scanned/image-only PDF, unreadable photo)
    // is not a server fault -- return a friendly 422 and flag the guided builder
    // so the user is never dead-ended on a generic 500.
    if (error?.code === "UNREADABLE_DOCUMENT") {
      return NextResponse.json(
        {
          error:
            error.message ||
            "We couldn't read that file. Paste the text, or use our guided builder instead.",
          guided: true,
        },
        { status: 422 }
      );
    }
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
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

RULES (a dropped or altered field is a failure -- this feeds a real resume):
1. CONTACT VERBATIM: copy email, phone, full_name, city, state EXACTLY as written, character for character. NEVER normalize, "clean up", correct, or drop any part -- keep an email's plus-tag ("name+tag@x.com" stays "name+tag@x.com"), keep the full phone, keep the exact spelling.
2. DATES: if a job shows dates, preserve start_date and end_date exactly as written (e.g. "2019", "Jan 2019", "2019-2022"). Do not drop or reformat them.
3. CITY/STATE: if the contact line shows a city and/or state, capture them. Do not leave them null when they are present.
4. EDUCATION is ONLY real schools, training programs, degrees, GEDs, or credentials. NEVER create an education entry from a section header ("ADDITIONAL", "SKILLS", "SUMMARY"), a narrative sentence, or a date fragment. If a line is not clearly a school/program/credential, leave it out.
5. Capture ALL skills, tools, and certifications mentioned -- do not omit them.
6. NEVER carry any mention of incarceration, prison, jail, parole, probation, "release", "reentry", or justice involvement into ANY field. Omit such phrases entirely; never turn them into an education entry, title, or bullet.
7. Parse only what exists. Use null for missing fields. Do not infer or fabricate.`,
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

  if (data.usage) {
    recordTokenUsage(
      "openai",
      data.model || "gpt-4o-mini",
      {
        inputTokens: data.usage.prompt_tokens || 0,
        outputTokens: data.usage.completion_tokens || 0,
      },
      { endpoint: "parse" }
    );
  }

  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return { raw_text: text };
  }
}

export const POST = withRateLimit(handlePost, { mode: "ip", endpoint: "parse" });
