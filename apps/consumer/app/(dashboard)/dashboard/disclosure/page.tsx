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
import { useUserContext } from "@/lib/use-user-context";
import { ProgressiveIntake, type IntakeQuestion } from "@/components/ProgressiveIntake";
import type { IntakeAnswer, IntakeContext } from "@/lib/intake-engine";

type PlannerStep = "assess" | "deepen" | "plan" | "rehearse";

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
  const [intakeAnswers, setIntakeAnswers] = useState<IntakeAnswer[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [adjustPanelOpen, setAdjustPanelOpen] = useState(false);
  const [adjustQuery, setAdjustQuery] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const recognitionRef = useRef<any>(null);
  const { context } = useUserContext();
  const forgeLoadedRef = useRef(false);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    if (step === "rehearse") {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [rehearsalMessages, rehearsing, step]);

  // Load Forge context from the SERVER (not fragile cross-domain localStorage).
  // Strengths/skills/career paths come from the user's saved Forge analysis; the
  // record details stay user-entered and editable (and more private). Runs once
  // when context first arrives so it never overwrites the user's own edits.
  useEffect(() => {
    if (!context || forgeLoadedRef.current) return;
    forgeLoadedRef.current = true;
    const f = context.forge;
    if (f) {
      setForge({
        headline: f.headline ?? undefined,
        summary: f.summary ?? undefined,
        strengths: (f.strengths ?? []).map((s) => ({
          title: s.title,
          evidence: s.evidence,
        })),
        skills: (f.skills ?? []).map((s) =>
          typeof s === "string"
            ? { name: s, category: "" }
            : { name: s.name, category: s.category ?? "" }
        ),
        careerPaths: (f.careerPaths ?? []).map((c) =>
          typeof c === "string"
            ? { title: c, match_reason: "" }
            : {
                title: c.title,
                industry: (c as any).industry,
                match_reason: (c as any).match_reason ?? "",
              }
        ),
      });
      if (!targetJob && f.careerPaths?.length) {
        const top = f.careerPaths[0];
        setTargetJob(typeof top === "string" ? top : top.title);
      }
    }
    // Pre-fill state from the user's saved location (still editable).
    if (context.profile?.state) {
      setRecord((prev) => (prev.state ? prev : { ...prev, state: context.profile.state }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

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

  async function generatePlan(refinementNote?: string, answersOverride?: IntakeAnswer[]) {
    const answers = answersOverride ?? intakeAnswers;
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
          refinementNote: refinementNote || undefined,
          intakeAnswers: answers.length ? answers : undefined,
        }),
      });
      if (res.status === 429) {
        const data = await res.json();
        setRateLimitError(data.error);
      } else if (res.ok) {
        const data = await res.json();
        setPlan(data);
        setStep("plan");
        if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
        if (!refinementNote) setShowCelebration(true);

        // Persist the disclosure plan (the user's deliverable -- a frame, not
        // their rehearsal words) so they can return to it and the journey engine
        // advances past Stage 4. Fire-and-forget; never block the plan view.
        fetch("/api/artifacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "disclosure_plan",
            targetContext: { targetJob: targetJob || null },
            content: {
              timing_advice: data.timing_advice ?? null,
              legal_context: data.legal_context ?? null,
              script: data.script ?? null,
              tips: data.tips ?? [],
              targetJob: targetJob || null,
              completedAt: new Date().toISOString(),
            },
            scaffoldLevel: 1.0,
          }),
        }).then(() => {
          window.dispatchEvent(new Event("disclosure-saved"));
        }).catch(() => {});
      }
    } catch {
      // Silent failure
    } finally {
      setGenerating(false);
    }
  }

  async function refinePlan() {
    if (!adjustQuery.trim()) return;
    setAdjusting(true);
    setAdjustPanelOpen(false);
    await generatePlan(adjustQuery.trim());
    setAdjustQuery("");
    setAdjusting(false);
  }

  function downloadPlan() {
    if (!plan) return;
    const date = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Disclosure Plan</title>
<style>
  @page { margin: 0.85in; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; font-size: 12pt; line-height: 1.65; }
  h1 { font-size: 18pt; font-weight: bold; margin: 0 0 4pt; }
  .subtitle { font-size: 9.5pt; color: #777; margin-bottom: 22pt; }
  h2 { font-size: 10pt; font-weight: bold; color: #2d5a3d; text-transform: uppercase; letter-spacing: 0.12em; border-bottom: 1pt solid #4D7C5A; padding-bottom: 3pt; margin: 22pt 0 8pt; }
  p { margin: 0 0 9pt; }
  blockquote { border-left: 3pt solid #4D7C5A; margin: 0 0 9pt; padding: 8pt 14pt; font-style: italic; color: #333; background: #f8f5f0; }
  ul { margin: 0 0 9pt; padding-left: 18pt; }
  li { margin-bottom: 5pt; }
  .callout { border: 1pt solid #d4b896; border-radius: 4pt; padding: 10pt 14pt; margin-bottom: 18pt; font-size: 10pt; color: #5c4a2a; background: #fdf7ef; }
  .footer { margin-top: 36pt; border-top: 0.5pt solid #ddd; padding-top: 8pt; font-size: 8pt; color: #aaa; text-align: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<h1>Disclosure Plan${targetJob ? ` -- ${targetJob}` : ""}</h1>
<p class="subtitle">Built with The Refinery &bull; steelmanresumes.com &bull; ${date}</p>
<div class="callout">Disclosure is a conversation, not a checkbox. It happens face-to-face, where you control the narrative with your voice and your presence.</div>
${plan.timing_advice ? `<h2>When to Disclose</h2><p>${plan.timing_advice}</p>` : ""}
${plan.legal_context ? `<h2>Your Legal Rights</h2><p>${plan.legal_context}</p>` : ""}
${plan.script ? `<h2>What to Say</h2><blockquote>${plan.script}</blockquote><p style="font-size:10pt;color:#666;font-style:italic;">Practice this out loud until it sounds natural in your own voice.</p>` : ""}
${plan.tips?.length ? `<h2>Key Tips</h2><ul>${plan.tips.map((t: string) => `<li>${t}</li>`).join("")}</ul>` : ""}
<div class="footer">This plan is yours. It is never shared without your permission. Delete it anytime in Settings.</div>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }

  function startVoice() {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert("Voice input requires Chrome or Edge.");
      return;
    }
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = false;
    recognitionRef.current = r;
    r.onresult = (e: any) => {
      const text = Array.from(e.results as any[])
        .map((res: any) => res[0].transcript)
        .join(" ");
      setRehearsalInput((prev) =>
        [prev.trim(), text.trim()].filter(Boolean).join(" ")
      );
    };
    r.onend = () => setRecording(false);
    r.onerror = () => setRecording(false);
    r.start();
    setRecording(true);
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
          onClick={() => { if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" }); setStep("deepen"); }}
          disabled={!record.type}
          className="w-full px-6 py-4 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 disabled:bg-gray-300 transition-colors min-h-touch"
        >
          Next: a few quick questions
        </button>
      </div>
    );
  }

  // --- Step 1.5: Deepen -- progressive intake (Phase 2 anchor) ---
  if (step === "deepen") {
    const intakeContext: IntakeContext = {
      targetJob: targetJob || undefined,
      headline: forge.headline,
      strengths: forge.strengths.map((s) => s.title),
      skills: forge.skills.map((s) => s.name),
      hasRecord: !!record.type,
    };
    const initialQuestions: IntakeQuestion[] = [
      {
        id: "story",
        label:
          "In your own words, what do you most want an employer to understand about you?",
        placeholder: "No wrong answers -- a sentence or two is plenty.",
        multiline: true,
      },
      {
        id: "since",
        label: "What have you done since then that you are proud of?",
        placeholder:
          "Work, school, recovery, family, a habit you changed -- anything that shows who you are now.",
        multiline: true,
      },
      {
        id: "worry",
        label: "What worries you most about bringing up your record?",
        placeholder: "Naming the worry helps us prepare for it.",
        multiline: true,
      },
    ];
    return (
      <div className="max-w-2xl">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-foreground">
            A few questions, so this plan is really yours
          </h1>
          <button
            onClick={() => setStep("assess")}
            className="text-sm text-muted hover:text-foreground"
          >
            Back
          </button>
        </div>
        <p className="text-sm text-muted mb-6">
          The more real you get here, the more your plan sounds like you and not a
          template. I will read your answers and may ask a follow-up or two.
        </p>

        <ProgressiveIntake
          topic="disclosure"
          context={intakeContext}
          initialQuestions={initialQuestions}
          submitLabel={generating ? "Building your plan..." : "Build my disclosure plan"}
          busy={generating}
          onComplete={(answers) => {
            setIntakeAnswers(answers);
            generatePlan(undefined, answers);
          }}
        />

        {rateLimitError && (
          <div className="bg-amber-50 rounded-xl p-4 border border-amber-200 mt-4">
            <p className="text-sm text-amber-800">{rateLimitError}</p>
          </div>
        )}

        <button
          onClick={() => generatePlan()}
          disabled={generating}
          className="mt-4 text-sm text-muted hover:text-foreground transition-colors disabled:opacity-50"
        >
          Skip the questions and build a basic plan
        </button>
      </div>
    );
  }

  // --- Step 2: Plan ---
  if (step === "plan" && plan) {
    return (
      <>
      {showCelebration && (
        <MilestoneCelebration onDone={() => setShowCelebration(false)} />
      )}
      <div className="max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-foreground">
            Your Disclosure Plan
          </h1>
          <div className="flex items-center gap-3">
            <button
              onClick={downloadPlan}
              className="text-sm font-medium text-sage-700 hover:text-sage-900 flex items-center gap-1.5 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M8 2v8M5 7l3 3 3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Save PDF
            </button>
            <button
              onClick={() => { setAdjustPanelOpen((o) => !o); setAdjustQuery(""); }}
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              Adjust
            </button>
          </div>
        </div>

        {/* Adjust panel -- inline refinement, never a full reset */}
        {adjustPanelOpen && (
          <div className="bg-sky-50 rounded-2xl p-5 border border-sky-200 mb-6">
            <h3 className="font-semibold text-sky-900 mb-1">What would you like to change?</h3>
            <p className="text-xs text-sky-700 mb-3">
              Pick a quick option or describe it yourself -- we will refine your plan without starting over.
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              {[
                "Make the script more conversational",
                "More formal and professional tone",
                "Focus more on my strengths",
                "Shorter script",
                "More detail on legal rights",
              ].map((chip) => (
                <button
                  key={chip}
                  onClick={() => setAdjustQuery(chip)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    adjustQuery === chip
                      ? "bg-sky-600 text-white border-sky-600"
                      : "bg-white text-sky-700 border-sky-300 hover:border-sky-500"
                  }`}
                >
                  {chip}
                </button>
              ))}
            </div>
            <textarea
              value={adjustQuery}
              onChange={(e) => setAdjustQuery(e.target.value)}
              placeholder="Or describe what to adjust..."
              rows={2}
              className="w-full px-4 py-3 rounded-xl border-2 border-sky-200 text-sm bg-white focus:border-sky-500 resize-none mb-3"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={refinePlan}
                disabled={!adjustQuery.trim() || adjusting}
                className="px-5 py-2.5 bg-sky-600 text-white rounded-xl text-sm font-medium hover:bg-sky-700 disabled:bg-gray-300 transition-colors"
              >
                {adjusting ? "Refining..." : "Refine My Plan"}
              </button>
              <button
                onClick={() => { setAdjustPanelOpen(false); setStep("assess"); }}
                className="text-sm text-muted hover:text-foreground transition-colors"
              >
                Start over instead
              </button>
            </div>
          </div>
        )}

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
      </>
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
          <button
            type="button"
            onClick={startVoice}
            title={recording ? "Stop recording" : "Speak your response"}
            className={`p-3 rounded-xl border-2 transition-colors min-h-touch flex-shrink-0 ${
              recording
                ? "bg-red-50 border-red-400 text-red-600 animate-pulse"
                : "border-border text-muted hover:border-sage-400 hover:text-sage-600"
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
          <input
            value={rehearsalInput}
            onChange={(e) => setRehearsalInput(e.target.value)}
            placeholder={recording ? "Listening..." : "Respond to the interviewer..."}
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
        This is a safe space to rehearse, and we never save your words from this
        practice. Your disclosure plan is saved privately to your account so you
        can come back and refine it, and it is never shared unless you choose to
        connect a support partner. You can delete it anytime.
      </p>

      {/* t.ROY nudge */}
      <div className="mt-6 bg-sage-50 rounded-xl p-4 border border-sage-200 text-center">
        <p className="text-sm font-medium text-sage-800 mb-1">
          Want live coaching on your response?
        </p>
        <p className="text-xs text-sage-600">
          Ask t.ROY -- the AI assistant available on every page. It knows your
          Forge profile and can help you sharpen your pivot in real time.
          Hit the &ldquo;Ask t.ROY&rdquo; button to open it.
        </p>
      </div>
    </div>
  );
}

function MilestoneCelebration({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [onDone]);

  const particles = Array.from({ length: 38 }, (_, i) => ({
    id: i,
    x: 5 + (i % 12) * 8 + Math.sin(i * 1.3) * 4,
    color: ["#4D7C5A","#8FA876","#C4A35A","#D4B896","#E8E0D0","#6B9E7A","#A8C5B0"][i % 7],
    delay: (i % 8) * 0.07,
    dur: 1.4 + (i % 5) * 0.22,
    size: 5 + (i % 4),
    rotate: (i * 47) % 360,
  }));

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            top: 0,
            left: `${p.x}%`,
            width: p.size,
            height: p.size * 1.6,
            backgroundColor: p.color,
            borderRadius: 2,
            opacity: 0,
            animation: `smr-confetti ${p.dur}s ${p.delay}s ease-in forwards`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{ top: "20%" }}
      >
        <div
          style={{
            background: "white",
            border: "1.5px solid #4D7C5A",
            borderRadius: 12,
            padding: "14px 28px",
            textAlign: "center",
            boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
            animation: "smr-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards",
          }}
        >
          <p style={{ fontWeight: 700, color: "#2d5a3d", fontSize: 15, margin: 0 }}>
            Disclosure Plan Built
          </p>
          <p style={{ color: "#4D7C5A", fontSize: 12, marginTop: 4, marginBottom: 0 }}>
            Saved to your materials
          </p>
        </div>
      </div>
      <style>{`
        @keyframes smr-confetti {
          0%   { transform: translateY(-12px) rotate(0deg); opacity: 1; }
          70%  { opacity: 0.9; }
          100% { transform: translateY(100vh) rotate(600deg); opacity: 0; }
        }
        @keyframes smr-pop {
          0%   { transform: scale(0.7); opacity: 0; }
          100% { transform: scale(1);   opacity: 1; }
        }
      `}</style>
    </div>
  );
}
