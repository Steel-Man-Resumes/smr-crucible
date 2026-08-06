/**
 * Grounding verifier -- the post-generation truth gate (F2, 2026-08-06).
 *
 * The generation prompts already carry a hard TRUTH GATE, but the model overrides
 * it under thin inputs and invents SEMANTIC facts (Sol's QA run: "buffers and
 * scrubbers", "clean safety record", "zero on-site supervision" -- none supplied).
 * A deterministic string-tracer can't catch semantic invention, so this is a
 * cheap-model AI pass that claim-traces every concrete assertion in the OUTPUT
 * back to the user's SOURCE, then strips/generalizes what isn't supported.
 *
 * Doctrine:
 * - Cheap model only (gpt-4o-mini). One metered call per document. Measured in the
 *   cost trial before this is public.
 * - FAIL-OPEN: any error, timeout, missing key, unparseable response, or a
 *   suspiciously short rewrite returns the ORIGINAL text unchanged. A verifier
 *   outage must never block or mangle a real user's resume.
 * - Only CONCRETE, background-checkable facts are stripped. Strong verbs, general
 *   framing, and reasonable summaries of stated duties are left alone.
 */

import { recordTokenUsage } from "@/lib/ai-usage-log";

export type GroundingKind = "resume" | "cover_letter" | "report" | "summary";

export interface GroundingFlag {
  claim: string;
  why: string;
}

export interface GroundingVerifyResult {
  /** The text to ship: the grounded rewrite when applied, else the original. */
  text: string;
  /** True when the model reported invented claims (even if the rewrite wasn't applied). */
  hasFabrication: boolean;
  /** Whether the grounded rewrite was actually applied to `text`. */
  applied: boolean;
  /** Invented claims for user-facing honesty ("we kept it to only what you told us"). */
  flags: GroundingFlag[];
}

const VERIFY_TIMEOUT_MS = 15000;
const VERIFY_MODEL = "gpt-4o-mini";

function kindLabel(kind: GroundingKind): string {
  switch (kind) {
    case "cover_letter": return "cover letter";
    case "report": return "career report";
    case "summary": return "resume summary";
    default: return "resume";
  }
}

/**
 * Verify one generated document against the user's real source material.
 * Returns the grounded text (or the original on any failure) plus the flags.
 */
export async function verifyGrounding(params: {
  sourceText: string;
  output: string;
  kind: GroundingKind;
}): Promise<GroundingVerifyResult> {
  const { sourceText, output, kind } = params;
  const original: GroundingVerifyResult = {
    text: output,
    hasFabrication: false,
    applied: false,
    flags: [],
  };

  const apiKey = process.env.OPENAI_API_KEY;
  // Fail-open: no cheap-model key, nothing to verify against, or trivial output.
  if (!apiKey) return original;
  if (!output || output.trim().length < 20) return original;
  const source = (sourceText || "").trim();
  // With no source at all the model can't distinguish grounded from invented;
  // don't risk a destructive rewrite. (The gauge already warns the user here.)
  if (source.length < 15) return original;

  const label = kindLabel(kind);
  const system = `You are a fact-grounding auditor for Steel Man Resumes. The product's promise to justice-impacted job seekers is absolute: a ${label} states ONLY what the person actually told us -- it must survive a background-checked interview.

You are given SOURCE (everything the person provided about themselves) and OUTPUT (an AI-generated ${label}). Find every CONCRETE factual claim in OUTPUT that SOURCE does not support: invented tools, equipment, or software; specific numbers, metrics, or percentages; safety or performance records; scope claims (supervision, headcount, budget, "zero X"); certifications, licenses, awards; employers, job titles, or dates; or an assumed gender/pronoun the source never states.

Scrutinize section headers and the employer/date/location lines too, not only the bullets -- a specific employer name, city, or date range the source never gives is just as much a fabrication as an invented metric.

Do NOT flag: strong action verbs, general professional framing, or a reasonable summary of a duty the source states. Only flag assertions of specific fact a background check could disprove. The job posting (if referenced) is a TARGET, never a source of grantable facts -- never let the OUTPUT claim something just because a posting asked for it.

Then rewrite OUTPUT so every remaining statement is grounded in SOURCE: remove each invented specific, or generalize it to exactly what the source supports. Thin source means a shorter, sparser document -- that is correct and required, never a reason to invent. Preserve the structure, section headers, formatting, tone, and every grounded line. Introduce NO new facts. If nothing needs changing, return OUTPUT verbatim.

Return ONLY a JSON object:
{"hasFabrication": boolean, "flags": [{"claim": "the exact invented phrase from OUTPUT", "why": "short reason"}], "cleaned": "the full corrected OUTPUT text"}`;

  const user = `SOURCE (everything the person told us about themselves):
"""
${source.slice(0, 8000)}
"""

OUTPUT (the generated ${label} to audit):
"""
${output.slice(0, 8000)}
"""`;

  let data: any;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: VERIFY_MODEL,
          response_format: { type: "json_object" },
          temperature: 0,
          max_tokens: 3000,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      console.error(`Grounding verify HTTP ${res.status}`);
      return original;
    }
    data = await res.json();
  } catch (err) {
    console.error("Grounding verify failed (fail-open):", err);
    return original;
  }

  if (data?.usage) {
    recordTokenUsage(
      "openai",
      data.model || VERIFY_MODEL,
      {
        inputTokens: data.usage.prompt_tokens || 0,
        outputTokens: data.usage.completion_tokens || 0,
      },
      { endpoint: `grounding-verify:${kind}` }
    );
  }

  let parsed: any;
  try {
    parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
  } catch {
    return original;
  }

  const flags: GroundingFlag[] = Array.isArray(parsed.flags)
    ? parsed.flags
        .filter((f: any) => f && typeof f.claim === "string")
        .slice(0, 25)
        .map((f: any) => ({ claim: String(f.claim), why: String(f.why || "") }))
    : [];
  const hasFabrication = parsed.hasFabrication === true || flags.length > 0;
  const cleaned = typeof parsed.cleaned === "string" ? parsed.cleaned.trim() : "";

  // Guard the rewrite: only apply when the model actually returned something and
  // it isn't a suspicious collapse of the document (a broken/over-aggressive
  // rewrite must never reach the user). Below the floor we still surface flags.
  const lengthFloor = Math.floor(output.trim().length * 0.4);
  const applyRewrite =
    hasFabrication && cleaned.length >= Math.max(40, lengthFloor);

  return {
    text: applyRewrite ? cleaned : output,
    hasFabrication,
    applied: applyRewrite,
    flags,
  };
}
