"use client";

/**
 * Disclosure Planner — Refinery Tool 2
 *
 * When to disclose, how to frame it, how to practice.
 * Record-aware: adjusts guidance by conviction type, jurisdiction, ban-the-box.
 * Rehearsal mode: practice the conversation with AI.
 *
 * New capability — no equivalent in current tools.
 */

import { useState, useEffect } from "react";
import { CardSelect, FlowPage } from "@crucible/consumer-ui";

type PlannerStep = "assess" | "plan" | "rehearse";

interface RecordInfo {
  type: string;
  charge_count: string;
  most_recent: string;
  supervision: string;
  state: string;
}

const DISCLOSURE_TIMING = [
  {
    id: "application",
    label: "On the application",
    description: "Some applications ask directly. Know your rights first.",
  },
  {
    id: "interview",
    label: "During the interview",
    description: "Face-to-face lets you control the narrative.",
  },
  {
    id: "after-offer",
    label: "After receiving an offer",
    description: "If not asked earlier, disclosure after offer is often safest.",
  },
  {
    id: "not-sure",
    label: "I'm not sure",
    description: "We'll help you figure out the right timing.",
  },
];

export default function DisclosurePlannerPage() {
  const [step, setStep] = useState<PlannerStep>("assess");
  const [record, setRecord] = useState<RecordInfo>({
    type: "",
    charge_count: "",
    most_recent: "",
    supervision: "",
    state: "",
  });
  const [timing, setTiming] = useState("");
  const [plan, setPlan] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const [rehearsalMessages, setRehearsalMessages] = useState<
    Array<{ role: string; content: string }>
  >([]);
  const [rehearsalInput, setRehearsalInput] = useState("");
  const [rehearsing, setRehearsing] = useState(false);
  const [rateLimitError, setRateLimitError] = useState("");

  // Load criminal record from Forge session
  useEffect(() => {
    try {
      const stored = localStorage.getItem("forge_session");
      if (stored) {
        const session = JSON.parse(stored);
        if (session.criminalRecord) {
          setRecord((prev) => ({
            ...prev,
            ...session.criminalRecord,
          }));
        }
        if (session.preferences?.location) {
          const loc = session.preferences.location;
          // Try to extract state from location
          const stateMatch = loc.match(/,\s*([A-Z]{2})\b/);
          if (stateMatch) {
            setRecord((prev) => ({ ...prev, state: stateMatch[1] }));
          }
        }
      }
    } catch {}
  }, []);

  async function generatePlan() {
    setGenerating(true);
    setRateLimitError("");
    try {
      const res = await fetch("/api/disclosure-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record, timing }),
      });
      if (res.status === 429) {
        const data = await res.json();
        setRateLimitError(data.error);
      } else if (res.ok) {
        const data = await res.json();
        setPlan(data);
        setStep("plan");
      }
    } catch {
      // Silent failure
    } finally {
      setGenerating(false);
    }
  }

  async function sendRehearsalMessage() {
    if (!rehearsalInput.trim()) return;

    const newMessage = { role: "user", content: rehearsalInput };
    const updatedMessages = [...rehearsalMessages, newMessage];
    setRehearsalMessages(updatedMessages);
    setRehearsalInput("");
    setRehearsing(true);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages,
          context: {
            currentPage: "disclosure-rehearsal",
            readinessStage: "action",
            userInput: { record, timing },
          },
          systemOverride: `You are playing the role of a hiring manager conducting a job interview. The candidate needs to practice disclosing their criminal record.

Your role:
- Act as a professional but fair hiring manager
- Ask natural follow-up questions a real manager would ask
- Don't be hostile, but don't be a pushover either
- After 3-4 exchanges, break character and give brief feedback on how they did
- Focus feedback on: confidence, honesty, brevity, pivot to strengths

The candidate's record: ${record.type || "criminal record"}, ${record.most_recent || "timing unknown"}, ${record.supervision || "supervision unknown"}.`,
        }),
      });

      if (res.status === 429) {
        const data = await res.json();
        setRateLimitError(data.error);
      } else if (res.ok) {
        const reader = res.body?.getReader();
        if (reader) {
          let text = "";
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
          }
          // Extract text content from stream
          const contentMatch = text.match(/0:"([^"]*)"/g);
          const content = contentMatch
            ? contentMatch
                .map((m) => m.slice(3, -1))
                .join("")
                .replace(/\\n/g, "\n")
            : text;

          setRehearsalMessages((prev) => [
            ...prev,
            { role: "assistant", content: content || "Could you tell me a bit more about that?" },
          ]);
        }
      }
    } catch {
      setRehearsalMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I had trouble responding. Let's try again.",
        },
      ]);
    } finally {
      setRehearsing(false);
    }
  }

  // --- Step 1: Assess ---
  if (step === "assess") {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          Disclosure Planner
        </h1>
        <p className="text-body text-muted mb-8">
          Knowing when and how to talk about your record makes all the
          difference. Let&apos;s build a plan together.
        </p>

        {/* Record info (pre-filled from Forge if available) */}
        <div className="space-y-4 mb-8">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium block mb-1">
                Type of charge
              </label>
              <select
                value={record.type}
                onChange={(e) =>
                  setRecord({ ...record, type: e.target.value })
                }
                className="w-full px-4 py-3 rounded-xl border-2 border-border text-sm bg-white min-h-touch"
              >
                <option value="">Select...</option>
                <option value="misdemeanor">Misdemeanor</option>
                <option value="felony">Felony</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">
                How long ago?
              </label>
              <select
                value={record.most_recent}
                onChange={(e) =>
                  setRecord({ ...record, most_recent: e.target.value })
                }
                className="w-full px-4 py-3 rounded-xl border-2 border-border text-sm bg-white min-h-touch"
              >
                <option value="">Select...</option>
                <option value="<1 year">Less than 1 year</option>
                <option value="1-3 years">1-3 years</option>
                <option value="3-5 years">3-5 years</option>
                <option value="5-10 years">5-10 years</option>
                <option value="10+ years">10+ years</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">
              Your state{" "}
              <span className="font-normal text-muted">
                (for ban-the-box laws)
              </span>
            </label>
            <input
              value={record.state}
              onChange={(e) =>
                setRecord({
                  ...record,
                  state: e.target.value.toUpperCase().slice(0, 2),
                })
              }
              placeholder="e.g., WI, IL, MI"
              maxLength={2}
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white min-h-touch"
            />
          </div>
        </div>

        {/* When do you plan to disclose? */}
        <div className="mb-8">
          <h2 className="font-medium text-foreground mb-3">
            When are you thinking about disclosing?
          </h2>
          <CardSelect
            options={DISCLOSURE_TIMING}
            selected={timing}
            onSelect={setTiming}
          />
        </div>

        {rateLimitError && (
          <div className="bg-amber-50 rounded-xl p-4 border border-amber-200 mb-4">
            <p className="text-sm text-amber-800">{rateLimitError}</p>
          </div>
        )}

        <button
          onClick={generatePlan}
          disabled={generating || !record.type}
          className="w-full px-6 py-4 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 disabled:bg-gray-300 transition-colors min-h-touch"
        >
          {generating ? "Building your plan..." : "Build My Disclosure Plan"}
        </button>
      </div>
    );
  }

  // --- Step 2: Plan ---
  if (step === "plan" && plan) {
    return (
      <div className="max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-foreground">
            Your Disclosure Plan
          </h1>
          <button
            onClick={() => setStep("assess")}
            className="text-sm text-muted hover:text-foreground"
          >
            Adjust
          </button>
        </div>

        {/* Timing guidance */}
        {plan.timing_advice && (
          <div className="bg-sky-50 rounded-2xl p-5 border border-sky-200 mb-6">
            <h2 className="font-semibold text-sky-800 mb-2">When to disclose</h2>
            <p className="text-sm text-sky-700 leading-relaxed">
              {plan.timing_advice}
            </p>
          </div>
        )}

        {/* Legal context */}
        {plan.legal_context && (
          <div className="bg-warm-50 rounded-2xl p-5 border border-warm-200 mb-6">
            <h2 className="font-semibold text-earth-800 mb-2">
              Know your rights
            </h2>
            <p className="text-sm text-earth-700 leading-relaxed">
              {plan.legal_context}
            </p>
          </div>
        )}

        {/* The script */}
        {plan.script && (
          <div className="bg-sage-50 rounded-2xl p-5 border border-sage-200 mb-6">
            <h2 className="font-semibold text-sage-800 mb-2">
              What to say
            </h2>
            <blockquote className="text-sm text-foreground leading-relaxed italic border-l-4 border-sage-400 pl-4">
              &ldquo;{plan.script}&rdquo;
            </blockquote>
            <p className="text-xs text-muted mt-3">
              This is a starting point. Practice it until it sounds natural in
              your voice.
            </p>
          </div>
        )}

        {/* Tips */}
        {plan.tips && plan.tips.length > 0 && (
          <div className="bg-white rounded-2xl p-5 border border-border mb-6">
            <h2 className="font-semibold text-foreground mb-2">Key tips</h2>
            <ul className="space-y-2">
              {plan.tips.map((tip: string, i: number) => (
                <li key={i} className="text-sm text-muted flex gap-2">
                  <span className="text-sage-500 flex-shrink-0">•</span>
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          onClick={() => {
            setStep("rehearse");
            setRehearsalMessages([
              {
                role: "assistant",
                content:
                  "Hi there. Thanks for coming in today. So, tell me a little about yourself and why you're interested in this position.",
              },
            ]);
          }}
          className="w-full px-6 py-4 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 transition-colors min-h-touch"
        >
          Practice the Conversation
        </button>
      </div>
    );
  }

  // --- Step 3: Rehearse ---
  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Practice Mode
          </h1>
          <p className="text-sm text-muted">
            Practice disclosing with a simulated hiring manager.
          </p>
        </div>
        <button
          onClick={() => setStep("plan")}
          className="text-sm text-muted hover:text-foreground"
        >
          Back to plan
        </button>
      </div>

      {/* Chat */}
      <div className="bg-white rounded-2xl border border-border mb-4">
        <div className="p-5 space-y-4 max-h-[400px] overflow-y-auto">
          {rehearsalMessages.map((msg, i) => (
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
          {rehearsing && (
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
            sendRehearsalMessage();
          }}
          className="flex gap-2 p-4 border-t border-border"
        >
          <input
            value={rehearsalInput}
            onChange={(e) => setRehearsalInput(e.target.value)}
            placeholder="Respond to the interviewer..."
            className="flex-1 px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 min-h-touch"
            disabled={rehearsing}
          />
          <button
            type="submit"
            disabled={rehearsing || !rehearsalInput.trim()}
            className="px-4 py-3 bg-sage-600 text-white rounded-xl hover:bg-sage-700 disabled:bg-gray-300 min-h-touch"
          >
            Send
          </button>
        </form>
      </div>

      <p className="text-xs text-muted text-center">
        This is a safe practice space. Nothing here is saved or shared.
      </p>
    </div>
  );
}
