"use client";

/**
 * Interview Practice — Refinery Tool 3
 *
 * AI mock interviews: industry-specific, role-specific.
 * Includes disclosure practice scenarios.
 * Feedback on content, not judgment.
 */

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CardSelect } from "@crucible/consumer-ui";
import { TierGate } from "@/components/TierGate";

type InterviewStep = "setup" | "practice" | "feedback";

interface InterviewConfig {
  targetRole: string;
  interviewType: string;
  includeDisclosure: boolean;
}

const INTERVIEW_TYPES = [
  {
    id: "general",
    label: "General Interview",
    description: "Common questions for any role. Good starting point.",
  },
  {
    id: "behavioral",
    label: "Behavioral (STAR)",
    description:
      '"Tell me about a time when..." Practice with real scenarios.',
  },
  {
    id: "industry",
    label: "Industry-Specific",
    description: "Questions tailored to your target field.",
  },
  {
    id: "disclosure",
    label: "Disclosure Practice",
    description: "Practice talking about your record with an interviewer.",
  },
];

export default function InterviewPracticePageWrapper() {
  return (
    <TierGate requiredTier="client">
      <Suspense><InterviewPracticePage /></Suspense>
    </TierGate>
  );
}

function InterviewPracticePage() {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<InterviewStep>("setup");
  const [config, setConfig] = useState<InterviewConfig>({
    targetRole: "",
    interviewType: "",
    includeDisclosure: false,
  });
  const [messages, setMessages] = useState<
    Array<{ role: string; content: string }>
  >([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [exchangeCount, setExchangeCount] = useState(0);
  const [feedback, setFeedback] = useState<any>(null);
  const [rateLimitError, setRateLimitError] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  // Forge context for richer AI interaction
  const [forgeContext, setForgeContext] = useState<{
    skills: string[];
    strengths: string[];
    narrative: string;
  } | null>(null);

  // Load target role and context from Forge session
  useEffect(() => {
    try {
      const stored = localStorage.getItem("forge_session");
      if (stored) {
        const session = JSON.parse(stored);
        if (session.forgeOutput?.careerPaths?.[0]?.title) {
          setConfig((prev) => ({
            ...prev,
            targetRole: session.forgeOutput.careerPaths[0].title,
          }));
        }
        const ctx: { skills: string[]; strengths: string[]; narrative: string } = {
          skills: [],
          strengths: [],
          narrative: "",
        };
        if (session.forgeOutput?.skills) {
          ctx.skills = session.forgeOutput.skills.map((s: any) => s.name).slice(0, 10);
        }
        if (session.forgeOutput?.narrative?.strengths) {
          ctx.strengths = session.forgeOutput.narrative.strengths.map((s: any) => s.title);
        }
        if (session.forgeOutput?.narrative?.summary) {
          ctx.narrative = session.forgeOutput.narrative.summary;
        }
        if (ctx.skills.length || ctx.strengths.length || ctx.narrative) {
          setForgeContext(ctx);
        }
      }
    } catch {}
  }, []);

  // Load URL params (from dashboard CTA)
  useEffect(() => {
    const role = searchParams.get("role");
    const company = searchParams.get("company");
    if (role) {
      setConfig((prev) => ({ ...prev, targetRole: role }));
    }
    // If company provided, append to targetRole for context
    if (company && !config.targetRole.includes(" at ")) {
      setConfig((prev) => ({
        ...prev,
        targetRole: prev.targetRole ? `${prev.targetRole} at ${company}` : role || "",
      }));
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll chat
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  function startInterview() {
    const isDisclosure =
      config.interviewType === "disclosure" || config.includeDisclosure;

    const openingMessage = isDisclosure
      ? "Thanks for coming in today. We appreciate your interest in this position. Why don't you start by telling me a little about yourself?"
      : config.interviewType === "behavioral"
        ? "Welcome! I'm going to ask you some questions about your past experiences. Take your time with each answer. Let's start — tell me about yourself and what brought you here today."
        : "Hi there, thanks for taking the time to interview with us today. Let's get started — can you tell me a bit about yourself and why you're interested in this role?";

    setMessages([{ role: "assistant", content: openingMessage }]);
    setStep("practice");
    setExchangeCount(0);

    // Track interview start
    try {
      const tracker = JSON.parse(
        localStorage.getItem("consumer_progress") || "{}"
      );
      tracker.interviews_started = (tracker.interviews_started || 0) + 1;
      tracker.last_interview = new Date().toISOString();
      localStorage.setItem("consumer_progress", JSON.stringify(tracker));
    } catch {}
  }

  async function sendMessage() {
    if (!input.trim()) return;

    const newMessage = { role: "user", content: input };
    const updatedMessages = [...messages, newMessage];
    setMessages(updatedMessages);
    setInput("");
    setSending(true);

    const newExchangeCount = exchangeCount + 1;
    setExchangeCount(newExchangeCount);

    try {
      const res = await fetch("/api/interview-practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages,
          config,
          exchangeCount: newExchangeCount,
          forgeContext: forgeContext || undefined,
        }),
      });

      if (res.status === 429) {
        const data = await res.json();
        setRateLimitError(data.error);
      } else if (res.ok) {
        const data = await res.json();

        if (data.feedback) {
          // Interview complete — show feedback
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: data.response },
          ]);
          setFeedback(data.feedback);
          setStep("feedback");

          // Track completion
          try {
            const tracker = JSON.parse(
              localStorage.getItem("consumer_progress") || "{}"
            );
            tracker.interviews_completed =
              (tracker.interviews_completed || 0) + 1;
            localStorage.setItem("consumer_progress", JSON.stringify(tracker));
          } catch {}
        } else {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: data.response },
          ]);
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I had trouble with that response. Let's try again.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  // --- Setup ---
  if (step === "setup") {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          Interview Practice
        </h1>
        <p className="text-body text-muted mb-8">
          Practice makes confidence. Choose your interview type and we&apos;ll
          simulate a real conversation.
        </p>

        <div className="space-y-6">
          {/* Target role */}
          <div>
            <label className="text-sm font-medium block mb-1">
              What role are you interviewing for?
            </label>
            <input
              value={config.targetRole}
              onChange={(e) =>
                setConfig({ ...config, targetRole: e.target.value })
              }
              placeholder="e.g., Warehouse Associate, Customer Service Rep"
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white min-h-touch"
            />
          </div>

          {/* Skills from Forge */}
          {forgeContext?.skills && forgeContext.skills.length > 0 && (
            <div>
              <p className="text-xs text-muted mb-2">Your skills (from The Forge)</p>
              <div className="flex flex-wrap gap-1.5">
                {forgeContext.skills.map((s, i) => (
                  <span key={i} className="px-2.5 py-1 rounded-full text-xs bg-sage-50 text-sage-700 border border-sage-200">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Interview type */}
          <div>
            <label className="text-sm font-medium block mb-3">
              What kind of practice do you need?
            </label>
            <CardSelect
              options={INTERVIEW_TYPES}
              selected={config.interviewType}
              onSelect={(val) =>
                setConfig({
                  ...config,
                  interviewType: val,
                  includeDisclosure: val === "disclosure",
                })
              }
            />
          </div>

          {/* Disclosure toggle (for non-disclosure types) */}
          {config.interviewType &&
            config.interviewType !== "disclosure" && (
              <label className="flex items-start gap-3 p-4 bg-warm-50 rounded-xl border border-warm-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.includeDisclosure}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      includeDisclosure: e.target.checked,
                    })
                  }
                  className="mt-1 w-5 h-5 rounded accent-sage-600"
                />
                <div>
                  <span className="text-sm font-medium block">
                    Include disclosure practice
                  </span>
                  <span className="text-xs text-muted">
                    The interviewer will ask about your background at some point
                    during the conversation.
                  </span>
                </div>
              </label>
            )}

          <button
            onClick={startInterview}
            disabled={!config.interviewType}
            className="w-full px-6 py-4 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 disabled:bg-gray-300 transition-colors min-h-touch"
          >
            Start Practice Interview
          </button>
        </div>
      </div>
    );
  }

  // --- Feedback ---
  if (step === "feedback" && feedback) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          Interview Feedback
        </h1>
        <p className="text-body text-muted mb-6">
          Here&apos;s how you did. Remember — this is about practice, not
          perfection.
        </p>

        {/* Strengths */}
        {feedback.strengths && (
          <div className="bg-sage-50 rounded-2xl p-5 border border-sage-200 mb-4">
            <h2 className="font-semibold text-sage-800 mb-2">
              What you did well
            </h2>
            <ul className="space-y-2">
              {feedback.strengths.map((s: string, i: number) => (
                <li key={i} className="text-sm text-sage-700 flex gap-2">
                  <span className="flex-shrink-0">+</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Areas to improve */}
        {feedback.improvements && (
          <div className="bg-warm-50 rounded-2xl p-5 border border-warm-200 mb-4">
            <h2 className="font-semibold text-earth-800 mb-2">
              Areas to work on
            </h2>
            <ul className="space-y-2">
              {feedback.improvements.map((s: string, i: number) => (
                <li key={i} className="text-sm text-earth-700 flex gap-2">
                  <span className="flex-shrink-0">-</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Overall */}
        {feedback.overall && (
          <div className="bg-sky-50 rounded-2xl p-5 border border-sky-200 mb-6">
            <h2 className="font-semibold text-sky-800 mb-2">Overall</h2>
            <p className="text-sm text-sky-700 leading-relaxed">
              {feedback.overall}
            </p>
          </div>
        )}

        {/* Disclosure-specific feedback */}
        {feedback.disclosure_notes && (
          <div className="bg-white rounded-2xl p-5 border border-border mb-6">
            <h2 className="font-semibold text-foreground mb-2">
              Disclosure notes
            </h2>
            <p className="text-sm text-muted leading-relaxed">
              {feedback.disclosure_notes}
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => {
              setStep("setup");
              setMessages([]);
              setFeedback(null);
              setExchangeCount(0);
            }}
            className="flex-1 px-6 py-4 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 transition-colors min-h-touch"
          >
            Practice Again
          </button>
          <button
            onClick={() => {
              setStep("practice");
              setFeedback(null);
            }}
            className="px-6 py-4 border-2 border-border rounded-xl font-medium hover:border-sage-300 transition-colors min-h-touch"
          >
            Review Chat
          </button>
        </div>
      </div>
    );
  }

  // --- Practice ---
  return (
    <div className="max-w-2xl">
      {/* Video-call style header */}
      <div className="bg-gray-900 rounded-2xl px-5 py-4 mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-white text-sm font-bold">
            HM
          </div>
          <div>
            <p className="text-white text-sm font-medium flex items-center gap-2">
              Hiring Manager
              <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
            </p>
            <p className="text-gray-400 text-xs">
              {config.targetRole ? `${config.targetRole} interview` : "Interview in progress"}
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            setStep("setup");
            setMessages([]);
            setExchangeCount(0);
          }}
          className="text-sm text-gray-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
        >
          End
        </button>
      </div>

      {/* Chat */}
      <div className="bg-white rounded-2xl border border-border mb-4">
        <div
          ref={chatRef}
          className="p-5 space-y-4 max-h-[500px] overflow-y-auto"
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-sage-600 text-white rounded-br-sm"
                    : "bg-gray-100 text-foreground rounded-bl-sm"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-gray-100 px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1">
                <span className="w-2 h-2 bg-muted rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-muted rounded-full animate-bounce [animation-delay:0.1s]" />
                <span className="w-2 h-2 bg-muted rounded-full animate-bounce [animation-delay:0.2s]" />
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="flex gap-2 p-4 border-t border-border"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your answer..."
            className="flex-1 px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 min-h-touch"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="px-4 py-3 bg-sage-600 text-white rounded-xl hover:bg-sage-700 disabled:bg-gray-300 min-h-touch"
          >
            Send
          </button>
        </form>
      </div>

      {rateLimitError && (
        <div className="bg-amber-50 rounded-xl p-4 border border-amber-200 mt-4">
          <p className="text-sm text-amber-800">{rateLimitError}</p>
        </div>
      )}

      <p className="text-xs text-muted text-center">
        This is a safe practice space. Nothing here is saved or shared.
      </p>
    </div>
  );
}
