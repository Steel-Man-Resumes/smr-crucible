"use client";

/**
 * Disclosure Planner — Refinery Tool 2
 *
 * When to disclose, how to frame it, how to practice.
 * Record-aware: adjusts guidance by conviction type, jurisdiction, ban-the-box.
 * Rehearsal mode: practice the conversation with AI.
 *
 * Philosophy: Disclosure happens IN PERSON during interviews, NEVER on paper.
 * This tool helps users practice and prepare what to say face-to-face.
 *
 * Loads Forge session data for personalized strengths + narrative context.
 */

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CardSelect, FlowPage, GhostGuide } from "@crucible/consumer-ui";
import { TierGate } from "@/components/TierGate";
import { getOpusMessage } from "@/lib/opus-messages";

type PlannerStep = "assess" | "plan" | "rehearse";

interface RecordInfo {
  type: string;
  charge_count: string;
  most_recent: string;
  supervision: string;
  state: string;
}

interface ForgeStrength {
  title: string;
  evidence: string;
  source?: string;
}

interface ForgeContext {
  headline?: string;
  summary?: string;
  strengths: ForgeStrength[];
  skills: Array<{ name: string; category: string }>;
  careerPaths: Array<{ title: string; industry?: string; match_reason: string }>;
}

const EMPTY_FORGE: ForgeContext = {
  strengths: [],
  skills: [],
  careerPaths: [],
};

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

export default function DisclosurePlannerPageWrapper() {
  return (
    <TierGate requiredTier="client">
      <Suspense><DisclosurePlannerPage /></Suspense>
    </TierGate>
  );
}

function DisclosurePlannerPage() {
  const searchParams = useSearchParams();
  const [consentGiven, setConsentGiven] = useState(false);
  const [showConsentGate, setShowConsentGate] = useState(false);
  const [targetCompany, setTargetCompany] = useState("");
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
  const [targetJob, setTargetJob] = useState("");
  const [forge, setForge] = useState<ForgeContext>(EMPTY_FORGE);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    if (step === "rehearse") {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [rehearsalMessages, rehearsing, step]);

  // Load criminal record + Forge context from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("forge_session");
      if (!stored) return;
      const session = JSON.parse(stored);

      // Criminal record
      if (session.criminalRecord) {
        setRecord((prev) => ({ ...prev, ...session.criminalRecord }));
      }

      // State from location preference
      if (session.preferences?.location) {
        const stateMatch = session.preferences.location.match(/,\s*([A-Z]{2})\b/);
        if (stateMatch) {
          setRecord((prev) => ({ ...prev, state: stateMatch[1] }));
        }
      }

      // Forge output: narrative, strengths, skills, career paths
      if (session.forgeOutput) {
        const o = session.forgeOutput;
        setForge({
          headline: o.narrative?.headline,
          summary: o.narrative?.summary,
          strengths: o.narrative?.strengths || [],
          skills: o.skills || [],
          careerPaths: o.career_paths || [],
        });

        // Pre-fill target job from top career path
        if (o.career_paths?.[0]?.title) {
          setTargetJob(o.career_paths[0].title);
        }
      }
    } catch {}
  }, []);

  // Load URL params (from dashboard CTA or disclosure brief)
  useEffect(() => {
    const company = searchParams.get("company");
    const job = searchParams.get("job");
    if (company) setTargetCompany(company);
    if (job) setTargetJob(job);
  }, [searchParams]);

  const hasForgeData = forge.strengths.length > 0 || !!forge.headline;

  /** Build context string for AI prompts so responses reference real strengths */
  function buildForgePromptContext(): string {
    const parts: string[] = [];
    if (targetJob) parts.push(`TARGET ROLE: ${targetJob}`);
    if (forge.headline) parts.push(`PROFESSIONAL HEADLINE: ${forge.headline}`);
    if (forge.summary) parts.push(`CAREER SUMMARY: ${forge.summary}`);
    if (forge.strengths.length > 0) {
      parts.push(
        `KEY STRENGTHS (from career analysis):\n${forge.strengths.map((s) => `- ${s.title}: ${s.evidence}`).join("\n")}`
      );
    }
    if (forge.skills.length > 0) {
      parts.push(`TOP SKILLS: ${forge.skills.slice(0, 8).map((s) => s.name).join(", ")}`);
    }
    return parts.length > 0
      ? `\n\nCANDIDATE PROFILE (from Forge career analysis):\n${parts.join("\n\n")}`
      : "";
  }

  async function generatePlan() {
    setGenerating(true);
    setRateLimitError("");
    try {
      const res = await fetch("/api/disclosure-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record,
          timing,
          targetJob: targetJob || undefined,
          forgeContext: hasForgeData
            ? {
                headline: forge.headline,
                summary: forge.summary,
                strengths: forge.strengths,
                skills: forge.skills.slice(0, 8),
              }
            : undefined,
        }),
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

    const forgeCtx = buildForgePromptContext();

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
${targetJob ? `\nYou are interviewing them for: ${targetJob}` : ""}
${forgeCtx}

Your role:
- Act as a professional but fair hiring manager
- Ask natural follow-up questions a real manager would ask
- Don't be hostile, but don't be a pushover either
- After 3-4 exchanges, break character and give brief feedback on how they did
- Focus feedback on: confidence, honesty, brevity, pivot to strengths
${forge.strengths.length > 0 ? `- When giving feedback, note whether they leveraged their verified strengths: ${forge.strengths.map((s) => s.title).join(", ")}` : ""}
- Remember: disclosure happens in person, face-to-face. The goal is to control the narrative with voice and presence, not apologize on paper.

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
        <GhostGuide message={getOpusMessage("disclosure")} pageId="disclosure" />
        <p className="text-body text-muted mb-2">
          Knowing when and how to talk about your record makes all the
          difference. Let&apos;s build a plan together.
        </p>
        <p className="text-sm text-muted mb-8">
          Disclosure happens in person, face-to-face — never on paper. This
          tool helps you prepare and practice what to say.
        </p>

        {/* Lead with your strengths — from Forge */}
        {hasForgeData && (
          <div className="bg-sage-50 rounded-2xl p-5 border border-sage-200 mb-8">
            <h2 className="font-semibold text-sage-800 mb-1">
              Lead with your strengths
            </h2>
            <p className="text-xs text-sage-600 mb-3">
              From your Forge career analysis — the foundation of your
              disclosure pivot.
            </p>

            {forge.headline && (
              <p className="text-sm font-medium text-foreground mb-3">
                {forge.headline}
              </p>
            )}

            {forge.strengths.length > 0 && (
              <div className="space-y-2">
                {forge.strengths.map((s, i) => (
                  <div
                    key={i}
                    className="bg-white rounded-xl px-4 py-3 border border-sage-100"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sage-500 font-bold text-sm mt-0.5 flex-shrink-0">
                        {i + 1}.
                      </span>
                      <div>
                        <span className="text-sm font-medium text-foreground">
                          {s.title}
                        </span>
                        <p className="text-xs text-muted mt-0.5 leading-relaxed">
                          {s.evidence}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-sage-600 mt-3 italic">
              Good disclosure follows a simple pattern: acknowledge briefly,
              then pivot to these strengths. Your record is one chapter —
              these are the rest of the book.
            </p>
          </div>
        )}

        {/* Target job */}
        <div className="mb-6">
          <label className="text-sm font-medium block mb-1">
            Target job{" "}
            <span className="font-normal text-muted">
              (so we can tailor your plan)
            </span>
          </label>
          <input
            value={targetJob}
            onChange={(e) => setTargetJob(e.target.value)}
            placeholder={
              forge.careerPaths[0]?.title
                ? `e.g., ${forge.careerPaths[0].title}`
                : "e.g., Warehouse Associate, CNC Operator"
            }
            className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white min-h-touch"
          />
        </div>

        {/* Target company (from URL param) */}
        {targetCompany && (
          <div className="mb-6">
            <label className="text-sm font-medium block mb-1">Target employer</label>
            <input
              value={targetCompany}
              onChange={(e) => setTargetCompany(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white min-h-touch"
            />
          </div>
        )}

        {/* Privacy consent gate — Tier 2 */}
        {!consentGiven && !showConsentGate && (
          <div className="bg-sky-50 rounded-2xl p-5 border border-sky-200 mb-8">
            <h3 className="font-semibold text-sky-900 mb-2">
              Your resume was built with public data only.
            </h3>
            <p className="text-sm text-sky-700 leading-relaxed mb-3">
              To prepare you for what the employer will actually be thinking — even the
              questions they can&apos;t legally ask — we need some details about your record.
              This gives you a real strategy, not generic advice.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConsentGate(true)}
                className="px-4 py-2.5 bg-sky-600 text-white rounded-xl text-sm font-medium hover:bg-sky-700 transition-colors"
              >
                I want a personalized plan
              </button>
              <button
                onClick={() => setConsentGiven(true)}
                className="px-4 py-2.5 text-sky-600 text-sm font-medium hover:text-sky-800 transition-colors"
              >
                Skip — use basic guidance
              </button>
            </div>
          </div>
        )}

        {showConsentGate && !consentGiven && (
          <div className="bg-white rounded-2xl p-6 border-2 border-sky-300 mb-8">
            <h3 className="font-bold text-foreground mb-4 text-lg">
              Before we continue
            </h3>

            <div className="space-y-4 text-sm text-foreground leading-relaxed mb-6">
              <div>
                <p className="font-semibold mb-1">What we&apos;ll ask:</p>
                <ul className="text-muted space-y-1 ml-4">
                  <li>Type of conviction and approximate date</li>
                  <li>Current supervision status</li>
                  <li>State where it occurred</li>
                </ul>
              </div>

              <div>
                <p className="font-semibold mb-1">What we do with it:</p>
                <ul className="text-muted space-y-1 ml-4">
                  <li>Craft a disclosure script specific to this employer</li>
                  <li>Prepare you for follow-up questions they&apos;ll likely ask</li>
                  <li>Identify legal protections in your state</li>
                </ul>
              </div>

              <div>
                <p className="font-semibold mb-1">What we NEVER do:</p>
                <ul className="text-muted space-y-1 ml-4">
                  <li>Put any of this on your resume or cover letter</li>
                  <li>Share it with anyone — ever</li>
                  <li>Store it longer than you want — delete anytime in Settings</li>
                </ul>
              </div>

              <div className="bg-sage-50 rounded-xl p-4 border border-sage-200">
                <p className="text-xs text-sage-700 leading-relaxed">
                  Research shows candidates who prepare their disclosure are significantly
                  more likely to receive a job offer compared to those who don&apos;t address
                  it or improvise in the moment. (Bushway & Apel, 2012; Maruna, 2001)
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setConsentGiven(true);
                  setShowConsentGate(false);
                }}
                className="px-5 py-3 bg-sage-600 text-white rounded-xl text-sm font-medium hover:bg-sage-700 transition-colors min-h-touch"
              >
                I understand — let&apos;s prepare
              </button>
              <button
                onClick={() => {
                  setConsentGiven(true);
                  setShowConsentGate(false);
                }}
                className="px-4 py-3 text-muted text-sm hover:text-foreground transition-colors min-h-touch"
              >
                Not now — basic guidance
              </button>
            </div>
          </div>
        )}

        {/* Record info (pre-filled from Forge if available) */}
        <div className={`space-y-4 mb-8 ${!consentGiven ? "opacity-40 pointer-events-none" : ""}`}>
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

        {/* In-person philosophy callout */}
        <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200 mb-6">
          <p className="text-sm text-amber-800">
            <span className="font-semibold">Remember:</span> Disclosure is a
            conversation, not a checkbox. It happens face-to-face, where you
            control the narrative with your voice and your presence.
          </p>
        </div>

        {/* Strengths to pivot to */}
        {forge.strengths.length > 0 && (
          <div className="bg-sage-50 rounded-2xl p-5 border border-sage-200 mb-6">
            <h2 className="font-semibold text-sage-800 mb-2">
              Your pivot points
            </h2>
            <p className="text-xs text-sage-600 mb-3">
              After a brief acknowledgment, pivot to these. They are real,
              they are yours, and they are what the employer needs to hear.
            </p>
            <div className="flex flex-wrap gap-2">
              {forge.strengths.map((s, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-3 py-1.5 rounded-lg bg-white border border-sage-200 text-sm text-foreground font-medium"
                >
                  {s.title}
                </span>
              ))}
            </div>
          </div>
        )}

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
              This is a starting point. Practice it out loud until it sounds
              natural in your voice.
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
            const opener = targetJob
              ? `Hi there. Thanks for coming in today. I see you're interested in the ${targetJob} position. Tell me a little about yourself and why you're interested in this role.`
              : "Hi there. Thanks for coming in today. So, tell me a little about yourself and why you're interested in this position.";
            setRehearsalMessages([{ role: "assistant", content: opener }]);
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
            Practice disclosing with a simulated hiring manager
            {targetJob ? ` for a ${targetJob} role` : ""}.
          </p>
        </div>
        <button
          onClick={() => setStep("plan")}
          className="text-sm text-muted hover:text-foreground"
        >
          Back to plan
        </button>
      </div>

      {/* Strength reminders — compact chips above the chat */}
      {forge.strengths.length > 0 && (
        <div className="bg-sage-50 rounded-xl px-4 py-3 border border-sage-200 mb-4">
          <p className="text-xs text-sage-700 font-medium mb-1.5">
            Pivot to your strengths:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {forge.strengths.map((s, i) => (
              <span
                key={i}
                className="text-xs px-2 py-1 rounded-md bg-white border border-sage-200 text-sage-800"
              >
                {s.title}
              </span>
            ))}
          </div>
        </div>
      )}

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
          <div ref={chatEndRef} />
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

      {rateLimitError && (
        <div className="bg-amber-50 rounded-xl p-4 border border-amber-200 mb-4">
          <p className="text-sm text-amber-800">{rateLimitError}</p>
        </div>
      )}

      <p className="text-xs text-muted text-center">
        This is a safe practice space. Nothing here is saved or shared.
      </p>
    </div>
  );
}
