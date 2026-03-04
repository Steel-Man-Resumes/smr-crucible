/**
 * AssistantChat — The chat UI that lives inside the AssistantDrawer.
 *
 * Simple, clean conversation interface. The AI behavioral rules
 * are enforced at the API level (system prompt), not here.
 */

"use client";

import { useAssistant } from "@/lib/use-assistant";
import type { AssistantContext } from "@/lib/assistant-prompt";

interface AssistantChatProps {
  context: AssistantContext;
  sessionId?: string;
}

export function AssistantChat({ context, sessionId }: AssistantChatProps) {
  const { messages, input, setInput, handleSubmit, isLoading, error } = useAssistant({
    context,
    sessionId,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 && (
          <div className="text-muted text-sm">
            <p className="mb-2">
              I&apos;m t.ROY. Ask me anything about this page, or just talk
              through what you&apos;re thinking.
            </p>
            <p>There are no wrong questions.</p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                message.role === "user"
                  ? "bg-sage-600 text-white rounded-br-sm"
                  : "bg-gray-100 text-foreground rounded-bl-sm"
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}

        {error && (
          <div className="bg-amber-50 rounded-xl p-3 border border-amber-200">
            <p className="text-sm text-amber-800">
              {error.message?.includes("429")
                ? "You've used all your free AI calls for today. Come back tomorrow, or enter a partner code in Settings for more."
                : "Something went wrong. Try again in a moment."}
            </p>
          </div>
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div
              className="bg-gray-100 text-foreground px-4 py-3 rounded-2xl rounded-bl-sm"
              role="status"
              aria-label="Assistant is thinking"
            >
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-muted rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-muted rounded-full animate-bounce [animation-delay:0.1s]" />
                <span className="w-2 h-2 bg-muted rounded-full animate-bounce [animation-delay:0.2s]" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2 pt-4 border-t border-border">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 transition-colors min-h-touch"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="px-4 py-3 bg-sage-600 text-white rounded-xl hover:bg-sage-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-touch"
          aria-label="Send message"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 10L17 3L10 17L9 11L3 10Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>
    </div>
  );
}
