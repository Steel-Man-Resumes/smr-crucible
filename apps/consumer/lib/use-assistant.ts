/**
 * useAssistant — Client-side hook for the AI assistant.
 *
 * Wraps Vercel AI SDK's useChat with our context system.
 * Sends current page context with every message so the AI
 * knows where the user is and what they've entered.
 *
 * 10x wave: maxSteps + onToolCall enable client-executed tools
 * (take_me_there, highlight_element). When onToolCall returns a result for
 * every pending invocation, useChat auto-resubmits so the model can narrate
 * what just happened.
 */

"use client";

import { useChat } from "ai/react";
import type { AssistantContext } from "./assistant-prompt";

export interface AssistantToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

interface UseAssistantOptions {
  /** Current page context */
  context: AssistantContext;
  /** Anonymous session ID (for decision logging) */
  sessionId?: string;
  /** Use the profile-aware Refinery coach (/api/coach) instead of t.ROY (/api/assistant) */
  coach?: boolean;
  /** Client-side executor for browser tools; its return value becomes the tool result */
  onToolCall?: (info: { toolCall: AssistantToolCall }) => unknown | Promise<unknown>;
}

export function useAssistant({ context, sessionId, coach, onToolCall }: UseAssistantOptions) {
  const chat = useChat({
    api: coach ? "/api/coach" : "/api/assistant",
    body: {
      context,
      sessionId,
    },
    maxSteps: 4,
    onToolCall: onToolCall as never,
  });

  return {
    messages: chat.messages,
    input: chat.input,
    setInput: chat.setInput,
    handleSubmit: chat.handleSubmit,
    isLoading: chat.isLoading,
    error: chat.error,
  };
}
