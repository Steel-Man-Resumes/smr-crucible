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
import { OnboardingGate } from "@/components/OnboardingGate";
import { getOpusMessage } from "@/lib/opus-messages";
import { escapeHtml } from "@/lib/escape-html";
import { useUserContext } from "@/lib/use-user-context";
import { ProgressiveIntake, type IntakeQuestion } from "@/components/ProgressiveIntake";
import type { IntakeAnswer, IntakeContext } from "@/lib/intake-engine";
import { CheckCircle2 } from "lucide-react";

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
      <OnboardingGate toolName="The Disclosure Planner">
        <Suspense><DisclosurePlannerPage /></Suspense>
      </OnboardingGate>
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

  // Forge strengths are fully editable here -- nothing is locked (Troy doctrine).
  function updateStrength(index: number, field: "title" | "evidence", value: string) {
    setForge((prev) => ({
      ...prev,
      strengths: prev.strengths.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    }));
  }
  function addStrength() {
    setForge((prev) => ({ ...prev, strengths: [...prev.strengths, { title: "", evidence: "" }] }));
  }
  function removeStrength(index: number) {
    setForge((prev) => ({ ...prev, strengths: prev.strengths.filter((_, i) => i !== index) }));
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
                strengths: forge.strengths.filter((s) => s.title.trim()),
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
<h1>Disclosure Plan${targetJob ? ` -- ${escapeHtml(targetJob)}` : ""}</h1>
<p class="subtitle">Built with The Refinery &bull; steelmanresumes.com &bull; ${date}</p>
<div class="callout"><strong>This is career coaching, not legal advice.</strong> Laws change and every situation is different -- for legal guidance, contact a reentry attorney or free legal aid in your area.</div>
<div class="callout">Disclosure is a conversation, not a checkbox. It happens face-to-face, where you control the narrative with your voice and your presence.</div>
${plan.timing_advice ? `<h2>When to Disclose</h2><p>${escapeHtml(plan.timing_advice)}</p>` : ""}
${plan.legal_context ? `<h2>Your Legal Rights</h2><p>${escapeHtml(plan.legal_context)}</p>` : ""}
${plan.script ? `<h2>What to Say</h2><blockquote>${escapeHtml(plan.script)}</blockquote><p style="font-size:10pt;color:#666;font-style:italic;">Practice this out loud until it sounds natural in your own voice.</p>` : ""}
${plan.tips?.length ? `<h2>Key Tips</h2><ul>${plan.tips.map((t: string) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : ""}
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
        <h1 className="text-2xl font-bold text-t-white mb-2">
          Disclosure Planner
        </h1>
        <GhostGuide message={getOpusMessage("disclosure")} pageId="disclosure" />
        <p className="text-base text-t-phos-dim mb-2">
          Knowing when and how to talk about your record makes all the
          difference. Let&apos;s build a plan together.
        </p>
        <p className="text-sm text-t-phos-dim mb-8">
          Disclosure happens in person, face-to-face — never on paper. This
          tool helps you prepare and practice what to say.
        </p>

        {/* Lead with your strengths — from Forge */}
        {hasForgeData && (
          <div className="bg-t-panel p-5 border border-t-line mb-8">
            <h2 className="font-semibold text-t-amber-bright mb-1">
              Lead with your strengths
            </h2>
            <p className="text-xs text-t-phos-dim mb-3">
              From your Forge career analysis -- edit anytime, add your own, or
              go deeper. These are what you pivot to after you disclose.
            </p>

            {forge.headline && (
              <p className="text-sm font-medium text-t-white mb-3">
                {forge.headline}
              </p>
            )}

            <div className="space-y-2">
              {forge.strengths.map((s, i) => (
                <div
                  key={i}
                  className="bg-t-panel-2 px-4 py-3 border border-t-line"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-t-amber font-bold text-sm mt-2.5 flex-shrink-0">
                      {i + 1}.
                    </span>
                    <div className="flex-1 space-y-1.5">
                      <input
                        value={s.title}
                        onChange={(e) => updateStrength(i, "title", e.target.value)}
                        placeholder="A strength (e.g., Reliable under pressure)"
                        className="w-full px-3 py-2 border border-t-line text-sm font-medium text-t-white bg-t-panel focus:border-t-amber focus:outline-none transition-colors"
                      />
                      <textarea
                        value={s.evidence}
                        onChange={(e) => updateStrength(i, "evidence", e.target.value)}
                        placeholder="The proof -- a specific example an employer would believe."
                        rows={2}
                        className="w-full px-3 py-2 border border-t-line text-xs text-t-phos-dim bg-t-panel focus:border-t-amber focus:outline-none transition-colors resize-y"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeStrength(i)}
                      title="Remove this strength"
                      className="text-t-phos-dim hover:text-t-red text-xl leading-none mt-1 flex-shrink-0"
                    >
                      &times;
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addStrength}
              className="mt-3 text-sm font-medium text-t-amber-bright hover:text-t-amber transition-colors"
            >
              + Add a strength
            </button>

            <p className="text-xs text-t-phos-dim mt-3 italic">
              Good disclosure follows a simple pattern: acknowledge briefly,
              then pivot to these strengths. Your record is one chapter —
              these are the rest of the book.
            </p>
          </div>
        )}

        {/* Target job */}
        <div className="mb-6">
          <label className="text-sm font-medium text-t-white block mb-1">
            Target job{" "}
            <span className="font-normal text-t-phos-dim">
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
            className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none min-h-touch"
          />
        </div>

        {/* Target company (from URL param) */}
        {targetCompany && (
          <div className="mb-6">
            <label className="text-sm font-medium text-t-white block mb-1">Target employer</label>
            <input
              value={targetCompany}
              onChange={(e) => setTargetCompany(e.target.value)}
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none min-h-touch"
            />
          </div>
        )}

        {/* Personalized vs generic -- motivate the deeper path */}
        {!consentGiven && !showConsentGate && (
          <div className="bg-t-panel p-5 border border-t-steel mb-8">
            <h3 className="font-semibold text-t-steel mb-2">
              Build a plan around you, or grab a generic template
            </h3>
            <p className="text-sm text-t-phos-dim leading-relaxed mb-3">
              Answer a few questions about your record, your strengths, and the job
              you want, and I build a disclosure plan for your exact situation -- the
              words to say, when to say them, and your rights in your state. Skip it
              and you get a generic template you will have to rewrite yourself.
            </p>
            <p className="text-xs text-t-phos-dim mb-4">
              Your details are never put on paper, never shared, and you can delete
              them anytime.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setShowConsentGate(true)}
                className="t-focus px-4 py-2.5 bg-t-steel text-white text-sm font-bold hover:opacity-90 transition-colors"
              >
                Build my personalized plan
              </button>
              <button
                onClick={() => setConsentGiven(true)}
                className="px-4 py-2.5 text-t-steel text-sm font-medium hover:opacity-80 transition-colors"
              >
                Use a generic template
              </button>
            </div>
          </div>
        )}

        {showConsentGate && !consentGiven && (
          <div className="bg-t-panel p-6 border border-t-steel mb-8">
            <h3 className="font-bold text-t-white mb-4 text-lg">
              Before we continue
            </h3>

            <div className="space-y-4 text-sm text-t-phos leading-relaxed mb-6">
              <div>
                <p className="font-semibold text-t-white mb-1">What we&apos;ll ask:</p>
                <ul className="text-t-phos-dim space-y-1 ml-4">
                  <li>Type of conviction and approximate date</li>
                  <li>Current supervision status</li>
                  <li>State where it occurred</li>
                </ul>
              </div>

              <div>
                <p className="font-semibold text-t-white mb-1">What we do with it:</p>
                <ul className="text-t-phos-dim space-y-1 ml-4">
                  <li>Craft a disclosure script specific to this employer</li>
                  <li>Prepare you for follow-up questions they&apos;ll likely ask</li>
                  <li>Identify legal protections in your state</li>
                </ul>
              </div>

              <div>
                <p className="font-semibold text-t-white mb-1">What we NEVER do:</p>
                <ul className="text-t-phos-dim space-y-1 ml-4">
                  <li>Put any of this on your resume or cover letter</li>
                  <li>Share it with anyone — ever</li>
                  <li>Store it longer than you want — delete anytime in Settings</li>
                </ul>
              </div>

              <div className="bg-t-panel-2 p-4 border border-t-line">
                <p className="text-xs text-t-phos leading-relaxed">
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
                className="t-focus px-5 py-3 bg-t-amber text-white text-sm font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright transition-colors min-h-touch"
              >
                I understand — let&apos;s prepare
              </button>
              <button
                onClick={() => {
                  setConsentGiven(true);
                  setShowConsentGate(false);
                }}
                className="px-4 py-3 text-t-phos-dim text-sm hover:text-t-white transition-colors min-h-touch"
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
              <label className="text-sm font-medium text-t-white block mb-1">
                Type of charge
              </label>
              <select
                value={record.type}
                onChange={(e) =>
                  setRecord({ ...record, type: e.target.value })
                }
                className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none min-h-touch"
              >
                <option value="">Select...</option>
                <option value="misdemeanor">Misdemeanor</option>
                <option value="felony">Felony</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-t-white block mb-1">
                How long ago?
              </label>
              <select
                value={record.most_recent}
                onChange={(e) =>
                  setRecord({ ...record, most_recent: e.target.value })
                }
                className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none min-h-touch"
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
            <label className="text-sm font-medium text-t-white block mb-1">
              Your state{" "}
              <span className="font-normal text-t-phos-dim">
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
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none min-h-touch"
            />
          </div>
        </div>

        {/* When do you plan to disclose? */}
        <div className="mb-8">
          <h2 className="font-medium text-t-white mb-3">
            When are you thinking about disclosing?
          </h2>
          <CardSelect
            options={DISCLOSURE_TIMING}
            selected={timing}
            onSelect={setTiming}
          />
        </div>

        {rateLimitError && (
          <div className="bg-t-panel p-4 border border-t-amber mb-4">
            <p className="text-sm text-t-amber-bright">{rateLimitError}</p>
          </div>
        )}

        <button
          onClick={() => { if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" }); setStep("deepen"); }}
          disabled={!record.type}
          className="t-focus w-full px-6 py-4 bg-t-amber text-white font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright disabled:opacity-40 disabled:shadow-none transition-colors min-h-touch"
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
          <h1 className="text-2xl font-bold text-t-white">
            A few questions, so this plan is really yours
          </h1>
          <button
            onClick={() => setStep("assess")}
            className="text-sm text-t-phos-dim hover:text-t-white"
          >
            Back
          </button>
        </div>
        <p className="text-sm text-t-phos-dim mb-6">
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

        {generating && (
          <div className="mt-4 flex items-center gap-3 bg-t-panel px-4 py-3 border border-t-line">
            <div className="w-4 h-4 border-2 border-t-amber border-t-transparent animate-spin flex-shrink-0" />
            <p className="text-sm text-t-phos">
              Building your plan around what you shared -- this usually takes
              about 30 seconds.
            </p>
          </div>
        )}

        {rateLimitError && (
          <div className="bg-t-panel p-4 border border-t-amber mt-4">
            <p className="text-sm text-t-amber-bright">{rateLimitError}</p>
          </div>
        )}

        <button
          onClick={() => generatePlan()}
          disabled={generating}
          className="mt-4 text-sm text-t-phos-dim hover:text-t-white transition-colors disabled:opacity-50"
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
          <h1 className="text-2xl font-bold text-t-white">
            Your Disclosure Plan
          </h1>
          <div className="flex items-center gap-3">
            <button
              onClick={downloadPlan}
              className="text-sm font-medium text-t-amber-bright hover:text-t-amber flex items-center gap-1.5 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M8 2v8M5 7l3 3 3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Save PDF
            </button>
            <button
              onClick={() => { setAdjustPanelOpen((o) => !o); setAdjustQuery(""); }}
              className="text-sm text-t-phos-dim hover:text-t-white transition-colors"
            >
              Adjust
            </button>
          </div>
        </div>

        {/* Non-negotiable framing: coaching, never legal advice (master plan s.16) */}
        <div className="bg-t-panel px-4 py-3 border border-t-line mb-4">
          <p className="text-xs text-t-phos leading-relaxed">
            <span className="font-semibold text-t-white">This is career coaching, not legal advice.</span>{" "}
            Laws change and every situation is different -- for legal guidance,
            contact a reentry attorney or free legal aid in your area.
          </p>
        </div>

        {/* Persistent confirmation -- the plan is saved to Materials */}
        <div className="flex items-center justify-between gap-3 bg-t-panel-2 px-4 py-3 border border-t-amber mb-6">
          <p className="text-sm text-t-amber-bright">
            <span className="font-semibold">Saved to your Materials.</span> Come
            back to it anytime -- it is private to your account.
          </p>
          <a
            href="/dashboard/vault"
            className="text-sm font-medium text-t-amber-bright hover:text-t-amber whitespace-nowrap"
          >
            View Materials
          </a>
        </div>

        {/* Adjust panel -- inline refinement, never a full reset */}
        {adjustPanelOpen && (
          <div className="bg-t-panel p-5 border border-t-steel mb-6">
            <h3 className="font-semibold text-t-steel mb-1">What would you like to change?</h3>
            <p className="text-xs text-t-phos-dim mb-3">
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
                  className={`t-focus px-3 py-1.5 text-xs font-medium border transition-colors ${
                    adjustQuery === chip
                      ? "bg-t-steel text-white border-t-steel"
                      : "bg-t-panel text-t-steel border-t-line hover:border-t-steel"
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
              className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-steel focus:outline-none resize-none mb-3"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={refinePlan}
                disabled={!adjustQuery.trim() || adjusting}
                className="t-focus px-5 py-2.5 bg-t-steel text-white text-sm font-bold hover:opacity-90 disabled:opacity-40 transition-colors"
              >
                {adjusting ? "Refining..." : "Refine My Plan"}
              </button>
              <button
                onClick={() => { setAdjustPanelOpen(false); setStep("assess"); }}
                className="text-sm text-t-phos-dim hover:text-t-white transition-colors"
              >
                Start over instead
              </button>
            </div>
          </div>
        )}

        {/* In-person philosophy callout */}
        <div className="bg-t-panel-2 p-4 border border-t-amber mb-6">
          <p className="text-sm text-t-phos">
            <span className="font-semibold text-t-amber-bright">Remember:</span> Disclosure is a
            conversation, not a checkbox. It happens face-to-face, where you
            control the narrative with your voice and your presence.
          </p>
        </div>

        {/* Strengths to pivot to */}
        {forge.strengths.length > 0 && (
          <div className="bg-t-panel p-5 border border-t-line mb-6">
            <h2 className="font-semibold text-t-amber-bright mb-2">
              Your pivot points
            </h2>
            <p className="text-xs text-t-phos-dim mb-3">
              After a brief acknowledgment, pivot to these. They are real,
              they are yours, and they are what the employer needs to hear.
            </p>
            <div className="flex flex-wrap gap-2">
              {forge.strengths.map((s, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-3 py-1.5 bg-t-panel-2 border border-t-line text-sm text-t-white font-medium"
                >
                  {s.title}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Timing guidance */}
        {plan.timing_advice && (
          <div className="bg-t-panel p-5 border border-t-steel mb-6">
            <h2 className="font-semibold text-t-steel mb-2">When to disclose</h2>
            <p className="text-sm text-t-phos leading-relaxed">
              {plan.timing_advice}
            </p>
          </div>
        )}

        {/* Legal context */}
        {plan.legal_context && (
          <div className="bg-t-panel p-5 border border-t-line mb-6">
            <h2 className="font-semibold text-t-white mb-2">
              Know your rights
            </h2>
            <p className="text-sm text-t-phos leading-relaxed">
              {plan.legal_context}
            </p>
          </div>
        )}

        {/* The script */}
        {plan.script && (
          <div className="bg-t-panel p-5 border border-t-line mb-6">
            <h2 className="font-semibold text-t-amber-bright mb-2">
              What to say
            </h2>
            <blockquote className="text-sm text-t-white leading-relaxed italic border-l-2 border-t-amber pl-4">
              &ldquo;{plan.script}&rdquo;
            </blockquote>
            <p className="text-xs text-t-phos-dim mt-3">
              This is a starting point. Practice it out loud until it sounds
              natural in your voice.
            </p>
          </div>
        )}

        {/* Tips */}
        {plan.tips && plan.tips.length > 0 && (
          <div className="bg-t-panel p-5 border border-t-line mb-6">
            <h2 className="font-semibold text-t-white mb-2">Key tips</h2>
            <ul className="space-y-2">
              {plan.tips.map((tip: string, i: number) => (
                <li key={i} className="text-sm text-t-phos-dim flex gap-2">
                  <span className="text-t-amber flex-shrink-0">•</span>
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
          className="t-focus w-full px-6 py-4 bg-t-amber text-white font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright transition-colors min-h-touch"
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
          <h1 className="text-2xl font-bold text-t-white">
            Practice Mode
          </h1>
          <p className="text-sm text-t-phos-dim">
            Practice disclosing with a simulated hiring manager
            {targetJob ? ` for a ${targetJob} role` : ""}.
          </p>
        </div>
        <button
          onClick={() => setStep("plan")}
          className="text-sm text-t-phos-dim hover:text-t-white"
        >
          Back to plan
        </button>
      </div>

      {/* Strength reminders — compact chips above the chat */}
      {forge.strengths.length > 0 && (
        <div className="bg-t-panel px-4 py-3 border border-t-line mb-4">
          <p className="text-xs text-t-amber-bright font-medium mb-1.5">
            Pivot to your strengths:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {forge.strengths.map((s, i) => (
              <span
                key={i}
                className="text-xs px-2 py-1 bg-t-panel-2 border border-t-line text-t-phos"
              >
                {s.title}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Chat */}
      <div className="bg-t-panel border border-t-line mb-4">
        <div className="p-5 space-y-4 max-h-[400px] overflow-y-auto">
          {rehearsalMessages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-t-amber text-white"
                    : "bg-t-panel-2 text-t-white border border-t-line"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {rehearsing && (
            <div className="flex justify-start">
              <div className="bg-t-panel-2 border border-t-line px-4 py-3 flex gap-1">
                <span className="w-2 h-2 bg-t-phos-dim animate-bounce" />
                <span className="w-2 h-2 bg-t-phos-dim animate-bounce [animation-delay:0.1s]" />
                <span className="w-2 h-2 bg-t-phos-dim animate-bounce [animation-delay:0.2s]" />
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
          className="flex gap-2 p-4 border-t border-t-line"
        >
          <button
            type="button"
            onClick={startVoice}
            title={recording ? "Stop recording" : "Speak your response"}
            className={`t-focus p-3 border transition-colors min-h-touch flex-shrink-0 ${
              recording
                ? "bg-t-panel-2 border-t-red text-t-red animate-pulse"
                : "border-t-line text-t-phos-dim hover:border-t-amber hover:text-t-amber-bright"
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
            className="flex-1 px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none min-h-touch"
            disabled={rehearsing}
          />
          <button
            type="submit"
            disabled={rehearsing || !rehearsalInput.trim()}
            className="t-focus px-4 py-3 bg-t-amber text-white font-bold hover:bg-t-amber-bright disabled:opacity-40 min-h-touch"
          >
            Send
          </button>
        </form>
      </div>

      {rateLimitError && (
        <div className="bg-t-panel p-4 border border-t-amber mb-4">
          <p className="text-sm text-t-amber-bright">{rateLimitError}</p>
        </div>
      )}

      <p className="text-xs text-t-phos-dim text-center">
        This is a safe space to rehearse. What you say in this practice
        conversation is not saved. Your disclosure plan itself is saved
        privately to your account so you can come back and refine it, and it is
        never shared unless you choose to connect a support partner. You can
        delete it anytime.
      </p>

      {/* t.ROY nudge */}
      <div className="mt-6 bg-t-panel px-4 py-4 border border-t-line text-center">
        <p className="text-sm font-medium text-t-amber-bright mb-1">
          Want live coaching on your response?
        </p>
        <p className="text-xs text-t-phos-dim">
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

  return (
    <div className="pointer-events-none fixed left-1/2 top-24 z-50 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-[6px] border border-[#b9cdbd] bg-[#e3ede5] px-5 py-3 text-[#344b38] shadow-[0_8px_22px_rgba(22,26,21,0.14)]">
        <CheckCircle2 size={20} aria-hidden="true" />
        <div>
          <p className="m-0 text-sm font-semibold">Disclosure plan built</p>
          <p className="m-0 mt-0.5 text-xs">Saved to your materials</p>
        </div>
      </div>
    </div>
  );
}
