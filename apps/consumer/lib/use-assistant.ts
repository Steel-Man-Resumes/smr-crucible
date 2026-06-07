/**
 * useAssistant — Client-side hook for the AI assistant.
 *
 * Wraps Vercel AI SDK's useChat with our context system.
 * Sends current page context with every message so the AI
 * knows where the user is and what they've entered.
 */

"use client";

import { useChat } from "ai/react";
import type { AssistantContext } from "./assistant-prompt";

interface UseAssistantOptions {
  /** Current page context */
  context: AssistantContext;
  /** Anonymous session ID (for decision logging) */
  sessionId?: string;
  /** Use the profile-aware Refinery coach (/api/coach) instead of t.ROY (/api/assistant) */
  coach?: boolean;
}

export function useAssistant({ context, sessionId, coach }: UseAssistantOptions) {
  const chat = useChat({
    api: coach ? "/api/coach" : "/api/assistant",
    body: {
      context,
      sessionId,
    },
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
