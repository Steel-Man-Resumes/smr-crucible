/**
 * AssistantChat — The chat UI that lives inside the AssistantDrawer.
 *
 * Simple, clean conversation interface with quick-tap suggestion buttons.
 * The AI behavioral rules are enforced at the API level (system prompt), not here.
 *
 * 10x wave: executes t.ROY's browser tools (take_me_there via router.push --
 * the drawer is layout-mounted so the conversation survives navigation;
 * highlight_element via the highlight bus) and renders tool activity as
 * human activity lines, never raw tool JSON.
 */

"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAssistant, type AssistantToolCall } from "@/lib/use-assistant";
import type { AssistantContext } from "@/lib/assistant-prompt";
import { resolveAssistantPage } from "@/lib/tools/assistant-tool-defs";
import { requestHighlight } from "@/lib/highlight-bus";
import SpeechInputButton from "@/components/SpeechInputButton";
import { Send, Check, Loader2, Settings2 } from "lucide-react";

interface ChatSettings {
  coachLength: "brief" | "full";
  coachVoice: boolean;
  coachPlainLanguage: boolean;
  coachLanguage: "en" | "es";
}

interface AssistantChatProps {
  context: AssistantContext;
  sessionId?: string;
  /** Use the profile-aware Refinery coach instead of t.ROY */
  coach?: boolean;
}

/** Human-friendly activity lines per tool -- shown instead of raw tool output */
const TOOL_ACTIVITY: Record<string, string> = {
  get_my_live_status: "Checking your real progress",
  search_jobs: "Searching live jobs",
  save_job: "Saving that job",
  add_follow_up_reminder: "Setting your reminder",
  take_me_there: "Taking you there",
  highlight_element: "Pointing at it",
  web_search: "Checking current facts",
};

/** Page-aware quick prompts — buttons users can tap instead of typing */
function getQuickPrompts(context: AssistantContext, coach?: boolean): string[] {
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
    case "jobs":
      return [
        "Find me jobs that fit me",
        "What should I do next?",
        "Explain this page",
      ];
    case "applications":
      return [
        "What needs a follow-up?",
        "What should I do next?",
        "Explain this page",
      ];
    case "application-tailor":
      return [
        "Do it with me",
        "What should I do next?",
        "Explain this page",
      ];
    case "dashboard":
      return coach
        ? [
            "What should I do next?",
            "Take me there",
            "Do it with me",
          ]
        : [
            "What should I do first?",
            "How do I build a resume?",
            "What's the disclosure planner?",
          ];
    default:
      return coach
        ? [
            "What should I do next?",
            "Take me there",
            "Explain this page",
          ]
        : [
            "Help me with this page",
            "What should I do next?",
            "Talk to a real person",
          ];
  }
}

export function AssistantChat({ context, sessionId, coach }: AssistantChatProps) {
  const router = useRouter();

  // Browser-executed tools. The return value becomes the tool result the
  // model narrates over -- keep results short and honest.
  const onToolCall = useCallback(
    async ({ toolCall }: { toolCall: AssistantToolCall }) => {
      if (toolCall.toolName === "take_me_there") {
        const args = (toolCall.args ?? {}) as { page?: string; jobApplicationId?: string };
        const href = args.page ? resolveAssistantPage(args.page, args.jobApplicationId) : null;
        if (!href) {
          return "That page name is not valid here. Name the page for the user instead of navigating.";
        }
        router.push(href);
        return { ok: true, nowOn: args.page };
      }
      if (toolCall.toolName === "highlight_element") {
        const args = (toolCall.args ?? {}) as { target?: string; note?: string };
        if (!args.target) return "element-not-found";
        const found = await requestHighlight(args.target, args.note ?? "");
        return found ? "highlighted" : "element-not-found";
      }
      return "Unknown tool.";
    },
    [router]
  );

  const { messages, input, setInput, handleSubmit, isLoading, error } = useAssistant({
    context,
    sessionId,
    coach,
    onToolCall,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Auto-scroll to bottom on new messages or loading state
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Coach speaks first: fetch a proactive opener when there is no conversation yet
  const [proactive, setProactive] = useState<string | null>(null);
  useEffect(() => {
    if (!coach) return;
    let cancelled = false;
    fetch("/api/coach/proactive")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.data?.message) setProactive(j.data.message as string);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [coach]);

  // Chat settings (coach mode): loaded once, saved as partial patches
  const [showSettings, setShowSettings] = useState(false);
  const [chatSettings, setChatSettings] = useState<ChatSettings | null>(null);
  useEffect(() => {
    if (!coach) return;
    let cancelled = false;
    fetch("/api/coach/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.data) return;
        setChatSettings({
          coachLength: j.data.coachLength === "brief" ? "brief" : "full",
          coachVoice: !!j.data.coachVoice,
          coachPlainLanguage: !!j.data.coachPlainLanguage,
          coachLanguage: j.data.coachLanguage === "es" ? "es" : "en",
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [coach]);

  const saveSettings = useCallback((patch: Partial<ChatSettings>) => {
    setChatSettings((s) => (s ? { ...s, ...patch } : s));
    fetch("/api/coach/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }, []);

  // Message Troy escalation (lives in the gear panel)
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportText, setSupportText] = useState("");
  const [supportStatus, setSupportStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");

  const sendSupportRequest = useCallback(async () => {
    if (!supportText.trim() || supportStatus === "sending") return;
    setSupportStatus("sending");
    // Attach the last 6 turns (text only) so Troy sees the context
    const excerpt = messages
      .slice(-6)
      .map((m) => {
        const parts = (m as { parts?: Array<{ type?: string; text?: string }> }).parts;
        const text = Array.isArray(parts)
          ? parts
              .filter((p) => p.type === "text" && typeof p.text === "string")
              .map((p) => p.text)
              .join(" ")
          : m.content;
        return text ? `${m.role === "user" ? "User" : "Assistant"}: ${text}` : null;
      })
      .filter(Boolean)
      .join("\n");
    try {
      const res = await fetch("/api/support-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: supportText.trim(),
          threadExcerpt: excerpt,
          page: context.currentPage,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSupportStatus("sent");
      setSupportText("");
    } catch {
      setSupportStatus("error");
    }
  }, [supportText, supportStatus, messages, context.currentPage]);

  // Voice out: read the finished assistant reply aloud (browser TTS, free)
  const spokenRef = useRef<string | null>(null);
  const voiceOn = !!chatSettings?.coachVoice;
  useEffect(() => {
    if (!voiceOn || isLoading) return;
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (!last) return;
    const parts = (last as { parts?: Array<{ type?: string; text?: string }> }).parts;
    const text = Array.isArray(parts)
      ? parts
          .filter((p) => p.type === "text" && typeof p.text === "string")
          .map((p) => p.text)
          .join(" ")
      : last.content;
    const clean = (text || "").replace(/https?:\/\/\S+/g, "").trim();
    if (!clean) return;
    const key = `${last.id}:${clean.length}`;
    if (spokenRef.current === key) return;
    spokenRef.current = key;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = chatSettings?.coachLanguage === "es" ? "es-US" : "en-US";
    window.speechSynthesis.speak(utterance);
  }, [messages, isLoading, voiceOn, chatSettings?.coachLanguage]);

  // Stop speaking when voice is switched off or the chat unmounts
  useEffect(() => {
    if (!voiceOn) window.speechSynthesis?.cancel();
  }, [voiceOn]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

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

  const quickPrompts = getQuickPrompts(context, coach);
  const showQuickPrompts = messages.length === 0 && !isLoading;

  return (
    <div className="flex flex-col h-full">
      {/* Chat settings (coach only): quiet gear, opens an inline panel */}
      {coach && (
        <div className="flex items-center justify-end pb-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className="flex items-center gap-1.5 rounded-[5px] px-2 py-1.5 text-xs text-muted transition-colors hover:bg-gray-100 hover:text-foreground"
            aria-label="Chat settings"
            aria-expanded={showSettings}
          >
            <Settings2 size={14} aria-hidden="true" />
            <span>Chat settings</span>
          </button>
        </div>
      )}

      {coach && showSettings && chatSettings && (
        <div className="mb-3 flex-shrink-0 space-y-3 rounded-[7px] border border-border bg-[#fafbf9] p-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-foreground">Response length</span>
            <div className="flex gap-1">
              {(["brief", "full"] as const).map((len) => (
                <button
                  key={len}
                  type="button"
                  onClick={() => saveSettings({ coachLength: len })}
                  className={`rounded-[5px] border px-3 py-1.5 text-xs font-medium transition-colors ${
                    chatSettings.coachLength === len
                      ? "border-sage-600 bg-sage-600 text-white"
                      : "border-border bg-white text-foreground hover:bg-gray-50"
                  }`}
                >
                  {len === "brief" ? "Short" : "Normal"}
                </button>
              ))}
            </div>
          </div>
          {(
            [
              ["Plain language", "coachPlainLanguage"],
              ["Read replies aloud", "coachVoice"],
            ] as const
          ).map(([label, key]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-foreground">{label}</span>
              <button
                type="button"
                role="switch"
                aria-checked={chatSettings[key]}
                onClick={() => saveSettings({ [key]: !chatSettings[key] } as Partial<ChatSettings>)}
                className={`rounded-[5px] border px-3 py-1.5 text-xs font-medium transition-colors ${
                  chatSettings[key]
                    ? "border-sage-600 bg-sage-600 text-white"
                    : "border-border bg-white text-foreground hover:bg-gray-50"
                }`}
              >
                {chatSettings[key] ? "On" : "Off"}
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <span className="text-foreground">Reply in Spanish</span>
            <button
              type="button"
              role="switch"
              aria-checked={chatSettings.coachLanguage === "es"}
              onClick={() =>
                saveSettings({
                  coachLanguage: chatSettings.coachLanguage === "es" ? "en" : "es",
                })
              }
              className={`rounded-[5px] border px-3 py-1.5 text-xs font-medium transition-colors ${
                chatSettings.coachLanguage === "es"
                  ? "border-sage-600 bg-sage-600 text-white"
                  : "border-border bg-white text-foreground hover:bg-gray-50"
              }`}
            >
              {chatSettings.coachLanguage === "es" ? "On" : "Off"}
            </button>
          </div>
          {/* Escalate to a human */}
          <div className="border-t border-border pt-3">
            {!supportOpen ? (
              <button
                type="button"
                onClick={() => {
                  setSupportOpen(true);
                  setSupportStatus("idle");
                }}
                className="w-full rounded-[5px] border border-[#b9cdbd] bg-white px-3 py-2 text-xs font-medium text-[#344b38] transition-colors hover:bg-[#e3ede5]"
              >
                Message Troy
              </button>
            ) : supportStatus === "sent" ? (
              <p className="text-xs text-[#344b38]">
                Sent. Troy reads these himself -- his reply goes to your email.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted">
                  This goes to Troy, a real person. Your last few chat messages
                  ride along so he has context.
                </p>
                <textarea
                  value={supportText}
                  onChange={(e) => setSupportText(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="What do you need a human for?"
                  className="w-full rounded-[6px] border border-border px-3 py-2 text-sm transition-colors focus:border-sage-600"
                />
                {supportStatus === "error" && (
                  <p className="text-xs text-amber-800">
                    That did not go through. Try again in a moment.
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={sendSupportRequest}
                    disabled={!supportText.trim() || supportStatus === "sending"}
                    className="rounded-[5px] bg-sage-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-sage-700 disabled:bg-gray-300"
                  >
                    {supportStatus === "sending" ? "Sending..." : "Send to Troy"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSupportOpen(false)}
                    className="rounded-[5px] border border-border bg-white px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowSettings(false)}
            className="w-full rounded-[5px] border border-[#b9cdbd] bg-white px-3 py-2 text-xs font-medium text-[#344b38] transition-colors hover:bg-[#e3ede5]"
          >
            Done
          </button>
        </div>
      )}

      {/* Messages — min-h-0 lets flex-1 actually shrink so overflow scrolls */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 && coach &&
          (proactive ? (
            // Proactive nudge: computed from live data, tappable. Tapping
            // sends a VISIBLE user message (no hidden prompts) so the model
            // knows exactly which suggestion the user accepted.
            <div className="flex justify-start">
              <button
                type="button"
                onClick={() =>
                  sendQuickPrompt(
                    `Yes, let's do that -- you suggested: "${proactive}"`
                  )
                }
                className="max-w-[85%] rounded-[7px] rounded-bl-sm border border-[#b9cdbd] bg-[#f5f6f4] px-4 py-3 text-left text-sm leading-relaxed text-foreground transition-colors hover:bg-[#e3ede5]"
              >
                {proactive}
                <span className="mt-2 block text-xs font-medium text-[#344b38]">
                  Tap to do it with me
                </span>
              </button>
            </div>
          ) : (
            <div className="text-muted text-sm">
              <p className="mb-2">
                I&apos;m your coach. Ask me anything, or I&apos;ll point you to your
                next move.
              </p>
            </div>
          ))}

        {messages.length === 0 && !coach && (
          <div className="text-muted text-sm">
            <p className="mb-2">
              I&apos;m t.ROY. Ask me anything about this page, or just talk
              through what you&apos;re thinking.
            </p>
            <p>There are no wrong questions.</p>
          </div>
        )}

        {messages.map((message) => {
          const parts = (message as { parts?: Array<Record<string, unknown>> }).parts;
          const hasParts = Array.isArray(parts) && parts.length > 0;

          if (message.role === "user" || !hasParts) {
            // User bubbles and legacy assistant messages: plain content
            if (!message.content) return null;
            return (
              <div
                key={message.id}
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] px-4 py-3 rounded-[7px] text-sm leading-relaxed ${
                    message.role === "user"
                      ? "bg-sage-600 text-white rounded-br-sm"
                      : "bg-gray-100 text-foreground rounded-bl-sm"
                  }`}
                >
                  {message.content}
                </div>
              </div>
            );
          }

          // Assistant message with parts: text bubbles + tool activity lines
          return (
            <div key={message.id} className="space-y-2">
              {parts.map((part, i) => {
                if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
                  return (
                    <div key={i} className="flex justify-start">
                      <div className="max-w-[85%] px-4 py-3 rounded-[7px] rounded-bl-sm text-sm leading-relaxed bg-gray-100 text-foreground">
                        {part.text}
                      </div>
                    </div>
                  );
                }
                if (part.type === "tool-invocation") {
                  const inv = part.toolInvocation as
                    | { toolName?: string; state?: string }
                    | undefined;
                  const label = TOOL_ACTIVITY[inv?.toolName ?? ""] ?? "Working on it";
                  const done = inv?.state === "result";
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 pl-1 text-xs text-muted"
                      role="status"
                    >
                      {done ? (
                        <Check size={14} className="text-sage-600" aria-hidden="true" />
                      ) : (
                        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                      )}
                      <span>
                        {label}
                        {done ? "" : "..."}
                      </span>
                    </div>
                  );
                }
                return null;
              })}
            </div>
          );
        })}

        {error && (
          <div className="bg-amber-50 rounded-[6px] p-3 border border-amber-200">
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
              className="bg-gray-100 text-foreground px-4 py-3 rounded-[7px] rounded-bl-sm"
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
              className="rounded-[5px] border border-[#b9cdbd] bg-[#f5f6f4] px-3 py-2 text-xs font-medium text-[#344b38] transition-colors hover:bg-[#e3ede5]"
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
          className="min-h-touch min-w-0 flex-1 rounded-[6px] border border-border px-4 py-3 text-sm transition-colors focus:border-sage-600"
          disabled={isLoading}
        />
        <SpeechInputButton
          compact
          onText={(text) =>
            setInput((prev: string) => (prev ? `${prev} ${text}` : text))
          }
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="px-4 py-3 bg-sage-600 text-white rounded-[6px] hover:bg-sage-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-touch"
          aria-label="Send message"
        >
          <Send size={20} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
