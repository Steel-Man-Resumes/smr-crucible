/**
 * Job Search API
 *
 * Finds fair-chance employers and job listings based on
 * user's target role, location, skills, and record status.
 * Uses Claude to generate contextually relevant listings
 * from known fair-chance employers.
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";
import { sanitizeForPrompt, sanitizeArray } from "@/lib/sanitize";

export const maxDuration = 30;

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const { targetRole, location, skills, hasRecord, recordType } =
      await request.json();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ jobs: [] });
    }

    const sanitizedRole = sanitizeForPrompt(targetRole);
    const sanitizedLocation = sanitizeForPrompt(location);
    const sanitizedSkills = sanitizeArray(skills);
    const sanitizedRecordType = sanitizeForPrompt(recordType, 200);

    const prompt = `You are a reentry employment specialist. Find 8-12 real job opportunities for someone looking for ${sanitizedRole || "employment"} work${location ? ` in or near ${sanitizedLocation}` : ""}.

CANDIDATE CONTEXT:
- Target role: ${sanitizedRole || "open to options"}
- Location: ${sanitizedLocation || "United States (flexible)"}
- Skills: ${sanitizedSkills || "general"}
- Has criminal record: ${hasRecord ? "yes" : "not specified"}
${hasRecord && recordType ? `- Record type: ${sanitizedRecordType}` : ""}

Return JSON:
{
  "jobs": [
    {
      "title": "Specific job title",
      "company": "Real company name",
      "location": "City, State",
      "salary": "$XX/hr or $XX,XXX/yr range if known",
      "url": "Company careers page URL if known",
      "description": "What the job involves and why this company is a good fit. 1-2 sentences.",
      "second_chance": true,
      "posted": "Recent or Ongoing"
    }
  ],
  "fair_chance_info": "1-2 sentences about fair-chance hiring laws and resources in their area, if location specified."
}

RULES:
- PRIORITIZE companies known to hire people with records: Walmart, Target, Amazon, FedEx, UPS, Goodwill, Salvation Army, Dave's Hot Chicken, Home Depot, Lowe's, Tyson Foods, Koch Industries, JP Morgan Chase, Bank of America, Starbucks, Greyston Bakery, Nehemiah Manufacturing, etc.
- Include companies that have signed the Fair Chance Business Pledge or Ban the Box
- Mix national chains with local employers if location is provided
- Mark second_chance: true for known fair-chance employers
- Use real company career page URLs where possible
- Keep descriptions actionable — what the job is and how to apply
- 6th grade reading level
- If location is provided, note relevant ban-the-box laws in fair_chance_info
- JSON only`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ jobs: [] });
    }

    const data = await response.json();
    const text = data.content[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ jobs: [] });

    const result = JSON.parse(jsonMatch[0]);

    // Log decision for JBS compliance
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "job-search",
        modelProvider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        input: JSON.stringify({ targetRole, location, skills, hasRecord }).slice(0, 500),
        explanation: `Generated job listings for ${targetRole || "general"} roles${location ? ` in ${location}` : ""}. Record: ${hasRecord ? "yes" : "not specified"}.`,
        outputSummary: {
          type: "job_search",
          jobs_count: result.jobs?.length ?? 0,
          second_chance_count: result.jobs?.filter((j: any) => j.second_chance)?.length ?? 0,
        },
      });
    } catch (err) {
      console.error("Decision log failed (job-search):", err);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Job search error:", error);
    return NextResponse.json({ jobs: [] });
  }
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "jobs", requiredTier: "client" });
