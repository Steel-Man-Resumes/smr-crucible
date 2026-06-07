/**
 * AssistantChat — The chat UI that lives inside the AssistantDrawer.
 *
 * Simple, clean conversation interface with quick-tap suggestion buttons.
 * The AI behavioral rules are enforced at the API level (system prompt), not here.
 */

"use client";

import { useRef, useEffect, useCallback } from "react";
import { useAssistant } from "@/lib/use-assistant";
import type { AssistantContext } from "@/lib/assistant-prompt";

interface AssistantChatProps {
  context: AssistantContext;
  sessionId?: string;
  /** Use the profile-aware Refinery coach instead of t.ROY */
  coach?: boolean;
}

/** Page-aware quick prompts — buttons users can tap instead of typing */
function getQuickPrompts(context: AssistantContext): string[] {
  const page = context.currentPage;
  const isDemo = context.isDemo;

  if (isDemo) {
    return [
      "What am I looking at?",
      "How does this help my clients?",
      "Show me a different scenario",
      "What's the research behind this?",
    ];
  }

  switch (page) {
    case "intro":
      return [
        "What is this?",
        "Is it really free?",
        "Who sees my data?",
      ];
    case "welcome":
      return [
        "What should I pick?",
        "Does this change my results?",
        "I'm not sure I'm ready",
      ];
    case "resume":
      return [
        "I don't have a resume",
        "Can I use a photo?",
        "My resume is old",
      ];
    case "goals":
      return [
        "I don't know what I want",
        "Does this matter?",
        "I just need money right now",
      ];
    case "story":
      return [
        "Who sees this?",
        "Do I have to share my record?",
        "I'm not comfortable with this",
      ];
    case "preferences":
      return [
        "I'm flexible on everything",
        "I don't have a car",
        "Can I change this later?",
      ];
    case "processing":
      return [
        "How long does this take?",
        "What's it doing right now?",
      ];
    case "output":
      return [
        "What do I do with this?",
        "Is this accurate?",
        "What's The Refinery?",
      ];
    case "rush":
      return [
        "Is this as good as the full version?",
        "What if my resume is bad?",
        "I have an interview tomorrow",
      ];
    case "dashboard":
      return [
        "What should I do first?",
        "How do I build a resume?",
        "What's the disclosure planner?",
      ];
    default:
      return [
        "Help me with this page",
        "What should I do next?",
        "Talk to a real person",
      ];
  }
}

export function AssistantChat({ context, sessionId, coach }: AssistantChatProps) {
  const { messages, input, setInput, handleSubmit, isLoading, error } = useAssistant({
    context,
    sessionId,
    coach,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Auto-scroll to bottom on new messages or loading state
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Send a quick prompt as if the user typed it
  const sendQuickPrompt = useCallback(
    (text: string) => {
      setInput(text);
      // Submit on next tick after state updates
      setTimeout(() => {
        formRef.current?.requestSubmit();
      }, 0);
    },
    [setInput]
  );

  const quickPrompts = getQuickPrompts(context);
  const showQuickPrompts = messages.length === 0 && !isLoading;

  return (
    <div className="flex flex-col h-full">
      {/* Messages — min-h-0 lets flex-1 actually shrink so overflow scrolls */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-4">
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

        <div ref={messagesEndRef} />
      </div>

      {/* Quick prompt buttons — shown before first message */}
      {showQuickPrompts && (
        <div className="flex flex-wrap gap-2 pb-3 flex-shrink-0">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => sendQuickPrompt(prompt)}
              className="px-3 py-2 text-xs font-medium rounded-full border-2 border-sage-200 text-sage-700 hover:bg-sage-50 hover:border-sage-400 transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Input — shrink-0 keeps it pinned at bottom always */}
      <form ref={formRef} onSubmit={handleSubmit} className="flex gap-2 pt-4 border-t border-border flex-shrink-0">
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
