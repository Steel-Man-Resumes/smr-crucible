/**
 * AI Assistant API Route — "The Ghost"
 *
 * Dual-mode rate limiting:
 * - Forge flow (pre-auth): IP-rate-limited, generous limit (20/day — it's the hook)
 * - Refinery (post-auth): user-rate-limited, counts toward daily AI quota
 *
 * Streaming conversational AI using Vercel AI SDK.
 * Every response logged to decision_log for observability.
 */

import { NextResponse } from "next/server";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { auth } from "@/auth";
import { buildSystemPrompt } from "@/lib/assistant-prompt";
import type { AssistantContext } from "@/lib/assistant-prompt";
import { sanitizeForPrompt } from "@/lib/sanitize";
import { MODEL_CHAT } from "@/lib/ai/models";
import fs from "fs";
import path from "path";
import {
  getUserDailyLimit,
  incrementUserUsage,
  incrementIpUsage,
  FORGE_IP_LIMITS,
} from "@crucible/core";

export const maxDuration = 30;

const SKILLS_DIR = path.join(process.cwd(), "lib", "skills");

// Maps pages + states to the skill files most relevant for that context.
// Files are loaded once per request, never cached across requests (content evolves).
function loadSkillsForContext(page: string, hasCriminalRecord: boolean): string {
  const files: string[] = [];

  // Career narrative is the philosophical foundation -- load on dashboard + narrative-heavy pages
  if (["dashboard", "output", "jobs", "resume-builder"].includes(page)) {
    files.push("career-narrative.md");
  }

  // Disclosure page gets full disclosure coaching + career narrative (they're deeply connected)
  if (page === "disclosure" || page === "disclosure-rehearsal") {
    files.push("disclosure-coaching.md");
    files.push("career-narrative.md");
  }

  // Interview prep gets both (disclosure doctrine + narrative arc both apply)
  if (page === "interview") {
    files.push("disclosure-coaching.md");
    files.push("career-narrative.md");
  }

  // Justice-impacted users get disclosure context on resume + overview pages too
  if (hasCriminalRecord && (page === "dashboard" || page === "resume-builder")) {
    if (!files.includes("disclosure-coaching.md")) files.push("disclosure-coaching.md");
  }

  if (files.length === 0) return "";

  const sections: string[] = [];
  const missing: string[] = [];
  for (const file of files) {
    const filePath = path.join(SKILLS_DIR, file);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        sections.push(`\n\n## SKILL LIBRARY: ${file.replace(".md", "").toUpperCase().replace(/-/g, " ")}\n\n${content}`);
      } else {
        missing.push(file);
      }
    } catch (err) {
      missing.push(file);
      console.error(`[skills] read failed for ${file}:`, err instanceof Error ? err.message : err);
    }
  }

  // Loud, not silent: if the doctrine files are not on disk in production, the
  // whole intelligence layer is coaching blind. Surface it in the runtime logs
  // instead of returning "" as if nothing was expected.
  if (missing.length > 0) {
    console.error(
      `[skills] MISSING ${missing.length}/${files.length} skill file(s) under ${SKILLS_DIR}: ${missing.join(", ")}. ` +
        `t.ROY is coaching WITHOUT this doctrine -- check next.config outputFileTracingIncludes.`
    );
  }

  return sections.join("\n");
}

const RATE_LIMIT_MESSAGE =
  "You've used all your free AI calls for today. Come back tomorrow, or enter a partner code in Settings for more.";

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  // Detect auth state for dual-mode rate limiting
  const session = await auth();
  const userId = session?.user?.id;

  if (userId) {
    // Authenticated: user-rate-limited (atomic increment-then-check)
    const limit = await getUserDailyLimit(userId);
    const newCount = await incrementUserUsage(userId, "assistant");
    if (limit !== 0 && newCount > limit) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }
  } else {
    // Pre-auth (Forge flow): IP-rate-limited (atomic increment-then-check)
    // Use x-real-ip (Vercel edge, not spoofable), fall back to last x-forwarded-for value
    const realIp = request.headers.get("x-real-ip")?.trim();
    const forwarded = request.headers.get("x-forwarded-for");
    const lastForwarded = forwarded ? forwarded.split(",").pop()?.trim() : undefined;
    const ip = realIp || lastForwarded || "unknown";

    const limit = FORGE_IP_LIMITS["assistant"] ?? 20;
    const newCount = await incrementIpUsage(ip, "assistant");
    if (newCount > limit) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
    }
  }

  const body = await request.json();

  const { messages, context, systemOverride, sessionId } = body as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    context: AssistantContext;
    systemOverride?: string;
    sessionId?: string;
  };

  if (!Array.isArray(messages) || !messages.length) {
    return new Response("No messages provided", { status: 400 });
  }
  if (!context?.currentPage) {
    return new Response("No context provided", { status: 400 });
  }

  const hasCriminalRecord = !!(context as any).hasCriminalRecord || !!(context as any).userFullContext?.forge?.hasCriminalRecord;
  const skillsContext = loadSkillsForContext(context.currentPage, hasCriminalRecord);
  const baseSystemPrompt = buildSystemPrompt(context) + skillsContext;
  const allowRoleplayOverride =
    !!userId &&
    context.currentPage === "disclosure-rehearsal" &&
    typeof systemOverride === "string" &&
    systemOverride.trim().length > 0;

  const systemPrompt = allowRoleplayOverride
    ? `${baseSystemPrompt}

## DISCLOSURE REHEARSAL ROLEPLAY
${sanitizeForPrompt(systemOverride, 4_000)}

## ROLEPLAY SAFETY BOUNDARIES
- This override is only for authenticated disclosure rehearsal.
- Keep the base assistant rules in force.
- Do not give legal advice beyond practical interview preparation.
- Do not promise any hiring outcome.`
    : baseSystemPrompt;

  const startTime = Date.now();

  // Depth on demand: client coaching stays text-message short (the format rules
  // still cap it), but partner/observer evidence mode needs room for full
  // citations. A flat 200 truncated those answers mid-citation.
  const responseMaxTokens =
    context.audience === "observer" || context.audience === "partner" ? 1200 : 400;

  const result = streamText({
    model: anthropic(MODEL_CHAT),
    system: systemPrompt,
    messages,
    maxTokens: responseMaxTokens,
    temperature: 0.7,
    async onFinish({ text, usage }) {
      const latencyMs = Date.now() - startTime;

      try {
        const { logDecision } = await import("@crucible/core");
        await logDecision({
          userId: userId ?? null,
          sessionId: sessionId ?? null,
          contextPage: context.currentPage,
          modelProvider: "anthropic",
          modelId: MODEL_CHAT,
          input: messages[messages.length - 1]?.content ?? "",
          explanation: `Assistant responded on ${context.currentPage} page. ${
            context.readinessStage
              ? `User readiness: ${context.readinessStage}.`
              : ""
          }`,
          outputSummary: {
            response_length: text.length,
            word_count: text.split(/\s+/).length,
          },
          tokenCount: usage?.totalTokens ?? null,
          latencyMs,
        });
      } catch (err) {
        console.error("Decision log failed:", err);
      }
    },
  });

  return result.toDataStreamResponse();
}
