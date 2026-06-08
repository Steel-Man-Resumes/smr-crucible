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

  // Disclosure page always gets the full disclosure coaching file
  if (page === "disclosure" || page === "disclosure-rehearsal") {
    files.push("disclosure-coaching.md");
  }

  // Interview prep also gets disclosure coaching (same doctrine applies)
  if (page === "interview") {
    files.push("disclosure-coaching.md");
  }

  // Justice-impacted users get disclosure context on resume + dashboard pages too
  if (hasCriminalRecord && (page === "dashboard" || page === "resume-builder" || page === "jobs")) {
    files.push("disclosure-coaching.md");
  }

  if (files.length === 0) return "";

  const sections: string[] = [];
  for (const file of files) {
    const filePath = path.join(SKILLS_DIR, file);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        sections.push(`\n\n## SKILL LIBRARY: ${file.replace(".md", "").toUpperCase().replace(/-/g, " ")}\n\n${content}`);
      }
    } catch {
      // Non-fatal -- skill files are enhancements, not required
    }
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

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: systemPrompt,
    messages,
    maxTokens: 200,
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
          modelId: "claude-sonnet-4-20250514",
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
