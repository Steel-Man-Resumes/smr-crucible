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
import { CardSelect, GhostGuide } from "@crucible/consumer-ui";
import { TierGate } from "@/components/TierGate";
import { OnboardingGate } from "@/components/OnboardingGate";
import { getOpusMessage } from "@/lib/opus-messages";
import { useUserContext } from "@/lib/use-user-context";
import { formatResumeDownload } from "@/components/resume/resumeModel";

type InterviewStep = "setup" | "practice" | "feedback";

interface InterviewConfig {
  targetRole: string;
  interviewType: string;
  includeDisclosure: boolean;
}

/**
 * Persist a privacy-safe record that a practice session happened, so the journey
 * engine (computeNextStep Stage 5) can advance and the coach can see progress.
 * We teach frames, not scripts, so we store the FRAME practiced and the coach's
 * meaning-level feedback -- never the user's words, transcript, or audio.
 */
async function recordInterviewPractice(record: {
  role: string;
  frame: string;
  mode: "text" | "voice";
  includeDisclosure: boolean;
  exchanges?: number;
  feedback?: unknown;
}): Promise<void> {
  try {
    await fetch("/api/artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "interview_prep",
        targetContext: { targetJob: record.role || null, frame: record.frame },
        content: {
          role: record.role || null,
          frame: record.frame, // the frame practiced (behavioral=STAR, disclosure, industry)
          mode: record.mode,
          includeDisclosure: record.includeDisclosure,
          ...(record.exchanges !== undefined ? { exchanges: record.exchanges } : {}),
          ...(record.feedback ? { feedback: record.feedback } : {}),
          completedAt: new Date().toISOString(),
        },
        scaffoldLevel: 1.0,
      }),
    });
  } catch {
    // Never let progress-tracking break the practice experience.
  }
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
      <OnboardingGate toolName="Interview Practice">
        <Suspense><InterviewPracticePage /></Suspense>
      </OnboardingGate>
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
  // Phase 3: interview against a SPECIFIC saved resume + optional job posting.
  const [resumes, setResumes] = useState<
    Array<{ id: string; targetJob: string | null; targetCompany: string | null; createdAt: string; content: any }>
  >([]);
  const [selectedResumeId, setSelectedResumeId] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [copiedSummary, setCopiedSummary] = useState(false);

  // Forge context for richer AI interaction
  const [forgeContext, setForgeContext] = useState<{
    skills: string[];
    strengths: string[];
    narrative: string;
  } | null>(null);
  const { context } = useUserContext();
  const forgeLoadedRef = useRef(false);

  // Load target role + Forge context from the SERVER (not fragile cross-domain
  // localStorage, which is empty on refinery.* for users whose Forge was saved
  // server-side at signup). Runs once when context first arrives so it never
  // overwrites the user's own edits or a role passed in via URL.
  useEffect(() => {
    if (!context || forgeLoadedRef.current) return;
    forgeLoadedRef.current = true;
    const f = context.forge;
    if (!f) return;

    const top = f.careerPaths?.[0];
    const role = top ? (typeof top === "string" ? top : top.title) : "";
    if (role) {
      setConfig((prev) => (prev.targetRole ? prev : { ...prev, targetRole: role }));
    }

    const skills = (f.skills ?? [])
      .map((s) => (typeof s === "string" ? s : s.name))
      .filter(Boolean)
      .slice(0, 10);
    const strengths = (f.strengths ?? [])
      .map((s) => s.title)
      .filter(Boolean)
      .slice(0, 6);
    const narrative = f.summary ?? "";

    if (skills.length || strengths.length || narrative) {
      setForgeContext({ skills, strengths, narrative });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

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

  // Phase 3: load the user's saved resumes so they can interview against a
  // SPECIFIC tailored resume (default: most recent), not just generic Forge data.
  useEffect(() => {
    fetch("/api/artifacts?type=resume&limit=20")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then(({ data }) => {
        const list = (data || []).map((a: any) => ({
          id: a.id,
          targetJob: a.target_context?.targetJob ?? a.content?.meta?.targetJob ?? null,
          targetCompany: a.target_context?.targetCompany ?? a.content?.meta?.targetCompany ?? null,
          createdAt: a.created_at ?? a.updated_at ?? "",
          content: a.content ?? null,
        }));
        setResumes(list);
        if (list.length) {
          setSelectedResumeId((prev) => prev || list[0].id);
          const r0 = list[0];
          const label = [r0.targetJob, r0.targetCompany].filter(Boolean).join(" at ");
          if (label) setConfig((prev) => (prev.targetRole ? prev : { ...prev, targetRole: label }));
        }
      })
      .catch(() => {});
  }, []);

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

  // The selected resume, formatted for the interviewer prompt + the bullet-proof
  // handoff. Shared by sendMessage and endInterview.
  function buildResumePayload():
    | { targetJob: string | null; targetCompany: string | null; text: string; evidence: any[] }
    | undefined {
    const sel = resumes.find((r) => r.id === selectedResumeId);
    if (!sel?.content) return undefined;
    let text = "";
    try {
      text = formatResumeDownload(sel.content).slice(0, 2800);
    } catch {
      text = JSON.stringify(sel.content).slice(0, 2800);
    }
    const proofPoints = Array.isArray(sel.content.experience)
      ? sel.content.experience.flatMap((e: any) =>
          (Array.isArray(e.evidence) ? e.evidence : []).map((ev: any) => ({
            role: e.title || "",
            bullet: ev.bullet || "",
            did: ev.did || "",
            tools: ev.tools || "",
            often: ev.often || "",
            quantity: ev.quantity || "",
            improved: ev.improved || "",
          }))
        )
      : [];
    return {
      targetJob: sel.targetJob,
      targetCompany: sel.targetCompany,
      text,
      evidence: proofPoints.slice(0, 12),
    };
  }

  // Record a completed practice into the in-page tracker + the journey engine.
  function recordCompletion(fb: any, exchanges: number) {
    try {
      const tracker = JSON.parse(localStorage.getItem("consumer_progress") || "{}");
      tracker.interviews_completed = (tracker.interviews_completed || 0) + 1;
      localStorage.setItem("consumer_progress", JSON.stringify(tracker));
    } catch {}
    recordInterviewPractice({
      role: config.targetRole,
      frame: config.interviewType || "general",
      mode: "text",
      includeDisclosure: config.interviewType === "disclosure" || config.includeDisclosure,
      exchanges,
      feedback: fb,
    });
  }

  function resetToSetup() {
    setStep("setup");
    setMessages([]);
    setFeedback(null);
    setExchangeCount(0);
  }

  // F13: ending the interview produces a written scorecard instead of dropping the
  // user back to setup empty-handed. If they've given at least one real answer we
  // ask the coach to wrap up + score; if they barely started, just reset.
  async function endInterview() {
    if (sending) return;
    const answered = messages.filter((m) => m.role === "user").length;
    if (answered < 1) {
      resetToSetup();
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/interview-practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          config,
          exchangeCount,
          endInterview: true,
          forgeContext: forgeContext || undefined,
          resume: buildResumePayload(),
          jobDescription: jobDescription.trim() || undefined,
        }),
      });
      if (res.status === 429) {
        const data = await res.json();
        setRateLimitError(data.error);
      } else if (res.ok) {
        const data = await res.json();
        if (data.feedback) {
          if (data.response) setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
          setFeedback(data.feedback);
          setStep("feedback");
          recordCompletion(data.feedback, exchangeCount);
        } else {
          resetToSetup();
        }
      } else {
        resetToSetup();
      }
    } catch {
      resetToSetup();
    } finally {
      setSending(false);
    }
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
          resume: buildResumePayload(),
          jobDescription: jobDescription.trim() || undefined,
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
          recordCompletion(data.feedback, newExchangeCount);
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

  // --- Phase 3 deliverable: analysis only, never a transcript ---
  function buildSummaryText(): string {
    const fb = feedback || {};
    const out: string[] = ["INTERVIEW PRACTICE SUMMARY (analysis only -- no transcript)"];
    if (config.targetRole) out.push(`Role: ${config.targetRole}`);
    out.push(`Practice type: ${config.interviewType || "general"}`);
    if (fb.frame) out.push(`\nFrame to carry: ${fb.frame}`);
    if (Array.isArray(fb.strengths) && fb.strengths.length) out.push(`\nWhat I did well:\n- ${fb.strengths.join("\n- ")}`);
    if (Array.isArray(fb.improvements) && fb.improvements.length) out.push(`\nTo work on:\n- ${fb.improvements.join("\n- ")}`);
    if (Array.isArray(fb.better_answers) && fb.better_answers.length) {
      out.push("\nStronger answers to model:");
      for (const b of fb.better_answers) out.push(`Q: ${b.question}\nA: ${b.model_answer}`);
    }
    if (fb.overall) out.push(`\nOverall: ${fb.overall}`);
    if (userNotes.trim()) out.push(`\nMy notes:\n${userNotes.trim()}`);
    return out.join("\n");
  }

  async function copyPracticeSummary() {
    try {
      await navigator.clipboard.writeText(buildSummaryText());
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2000);
    } catch {
      // Clipboard can fail (permissions) -- non-critical to the practice.
    }
  }

  function downloadAnalysis() {
    const fb = feedback || {};
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const list = (arr: any[]) => (Array.isArray(arr) ? arr.map((x) => `<li>${esc(x)}</li>`).join("") : "");
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>Interview Analysis</title>
<style>
  @page { margin: 0.85in; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; font-size: 12pt; line-height: 1.6; }
  h1 { font-size: 18pt; margin: 0 0 4pt; }
  .subtitle { font-size: 9.5pt; color: #777; margin-bottom: 20pt; }
  h2 { font-size: 10pt; font-weight: bold; color: #2d5a3d; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 1pt solid #4D7C5A; padding-bottom: 3pt; margin: 20pt 0 8pt; }
  ul { margin: 0 0 8pt; padding-left: 18pt; } li { margin-bottom: 4pt; }
  blockquote { border-left: 3pt solid #4D7C5A; margin: 0 0 8pt; padding: 6pt 12pt; font-style: italic; color: #333; background: #f8f5f0; }
  .q { font-weight: bold; margin: 8pt 0 2pt; }
  .footer { margin-top: 32pt; border-top: 0.5pt solid #ddd; padding-top: 8pt; font-size: 8pt; color: #aaa; text-align: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<h1>Interview Analysis${config.targetRole ? ` -- ${esc(config.targetRole)}` : ""}</h1>
<p class="subtitle">Built with The Refinery &bull; steelmanresumes.com &bull; ${date} &bull; Practice frames only, no transcript</p>
${fb.frame ? `<h2>The Frame to Carry In</h2><blockquote>${esc(fb.frame)}</blockquote>` : ""}
${Array.isArray(fb.strengths) && fb.strengths.length ? `<h2>What You Did Well</h2><ul>${list(fb.strengths)}</ul>` : ""}
${Array.isArray(fb.improvements) && fb.improvements.length ? `<h2>Areas to Work On</h2><ul>${list(fb.improvements)}</ul>` : ""}
${Array.isArray(fb.better_answers) && fb.better_answers.length ? `<h2>Stronger Answers to Model</h2>${fb.better_answers.map((b: any) => `<p class="q">${esc(b.question)}</p><blockquote>${esc(b.model_answer)}</blockquote>`).join("")}` : ""}
${fb.overall ? `<h2>Overall</h2><p>${esc(fb.overall)}</p>` : ""}
${userNotes.trim() ? `<h2>Your Notes</h2><p>${esc(userNotes).replace(/\n/g, "<br/>")}</p>` : ""}
<div class="footer">This analysis is yours. We never store your interview words or recordings -- only the frames you practiced.</div>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }

  // --- Setup ---
  if (step === "setup") {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-t-white mb-2">
          Interview Practice
        </h1>
        <GhostGuide message={getOpusMessage("interview")} pageId="interview" />
        <p className="text-base text-t-phos-dim mb-8">
          Practice makes confidence. Choose your interview type and we&apos;ll
          simulate a real conversation.
        </p>

        <div className="space-y-6">
          {/* Target role */}
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">
              What role are you interviewing for?
            </label>
            <input
              value={config.targetRole}
              onChange={(e) =>
                setConfig({ ...config, targetRole: e.target.value })
              }
              placeholder="e.g., Warehouse Associate, Customer Service Rep"
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none min-h-touch"
            />
          </div>

          {/* Phase 3: interview against a specific saved resume */}
          {resumes.length > 0 && (
            <div>
              <label className="text-sm font-medium text-t-white block mb-1">
                Interview against which resume?{" "}
                <span className="font-normal text-t-phos-dim">
                  (so questions match your real experience)
                </span>
              </label>
              <select
                value={selectedResumeId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedResumeId(id);
                  const r = resumes.find((x) => x.id === id);
                  const label = r ? [r.targetJob, r.targetCompany].filter(Boolean).join(" at ") : "";
                  if (label) setConfig((prev) => ({ ...prev, targetRole: label }));
                }}
                className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none min-h-touch"
              >
                {resumes.map((r) => {
                  const label = [r.targetJob, r.targetCompany].filter(Boolean).join(" at ");
                  return (
                    <option key={r.id} value={r.id}>
                      {label || `Resume from ${r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "your account"}`}
                    </option>
                  );
                })}
                <option value="">General (no specific resume)</option>
              </select>
              {selectedResumeId && (
                <p className="text-xs text-t-amber-bright mt-1">
                  Questions will be based on this resume -- the real jobs, tools, and results on it.
                </p>
              )}
            </div>
          )}

          {/* Phase 3: optional job posting */}
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">
              Paste the job posting{" "}
              <span className="font-normal text-t-phos-dim">
                (optional -- makes questions match the real role)
              </span>
            </label>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the description from the job you are applying to..."
              rows={3}
              className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none resize-y"
            />
          </div>

          {/* Skills from Forge */}
          {forgeContext?.skills && forgeContext.skills.length > 0 && (
            <div>
              <p className="text-xs text-t-phos-dim mb-2">Your skills (from The Forge)</p>
              <div className="flex flex-wrap gap-1.5">
                {forgeContext.skills.map((s, i) => (
                  <span key={i} className="px-2.5 py-1 text-xs bg-t-panel text-t-phos border border-t-line">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Interview type */}
          <div>
            <label className="text-sm font-medium text-t-white block mb-3">
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
              <label className="flex items-start gap-3 p-4 bg-t-panel border border-t-line cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.includeDisclosure}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      includeDisclosure: e.target.checked,
                    })
                  }
                  className="mt-1 w-5 h-5 accent-t-amber"
                />
                <div>
                  <span className="text-sm font-medium text-t-white block">
                    Include disclosure practice
                  </span>
                  <span className="text-xs text-t-phos-dim">
                    The interviewer will ask about your background at some point
                    during the conversation.
                  </span>
                </div>
              </label>
            )}

          <VoicePracticePanel
            config={config}
            forgeContext={forgeContext}
            enabled={!!config.interviewType}
          />

          <button
            onClick={startInterview}
            disabled={!config.interviewType}
            className="t-focus w-full px-6 py-4 bg-t-amber text-white font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright disabled:opacity-40 disabled:shadow-none transition-colors min-h-touch"
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
        <h1 className="text-2xl font-bold text-t-white mb-2">
          Interview Feedback
        </h1>
        <p className="text-base text-t-phos-dim mb-6">
          Here&apos;s how you did. Remember — this is about practice, not
          perfection.
        </p>

        {/* Strengths */}
        {feedback.strengths && (
          <div className="bg-t-panel p-5 border border-t-line mb-4">
            <h2 className="font-semibold text-t-amber-bright mb-2">
              What you did well
            </h2>
            <ul className="space-y-2">
              {feedback.strengths.map((s: string, i: number) => (
                <li key={i} className="text-sm text-t-phos flex gap-2">
                  <span className="flex-shrink-0 text-t-amber">+</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Areas to improve */}
        {feedback.improvements && (
          <div className="bg-t-panel p-5 border border-t-line mb-4">
            <h2 className="font-semibold text-t-white mb-2">
              Areas to work on
            </h2>
            <ul className="space-y-2">
              {feedback.improvements.map((s: string, i: number) => (
                <li key={i} className="text-sm text-t-phos-dim flex gap-2">
                  <span className="flex-shrink-0">-</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Overall */}
        {feedback.overall && (
          <div className="bg-t-panel p-5 border border-t-steel mb-6">
            <h2 className="font-semibold text-t-steel mb-2">Overall</h2>
            <p className="text-sm text-t-phos leading-relaxed">
              {feedback.overall}
            </p>
          </div>
        )}

        {/* Disclosure-specific feedback */}
        {feedback.disclosure_notes && (
          <div className="bg-t-panel p-5 border border-t-line mb-6">
            <h2 className="font-semibold text-t-white mb-2">
              Disclosure notes
            </h2>
            <p className="text-sm text-t-phos-dim leading-relaxed">
              {feedback.disclosure_notes}
            </p>
          </div>
        )}

        {/* The frame to carry (Phase 3) */}
        {feedback.frame && (
          <div className="bg-t-panel-2 p-5 border border-t-amber mb-4">
            <h2 className="font-semibold text-t-amber-bright mb-2">The frame to carry in</h2>
            <p className="text-sm text-t-phos leading-relaxed">{feedback.frame}</p>
          </div>
        )}

        {/* Stronger answers to model (Phase 3) */}
        {Array.isArray(feedback.better_answers) && feedback.better_answers.length > 0 && (
          <div className="bg-t-panel p-5 border border-t-line mb-4">
            <h2 className="font-semibold text-t-white mb-3">Stronger answers to model</h2>
            <div className="space-y-4">
              {feedback.better_answers.map((b: any, i: number) => (
                <div key={i}>
                  <p className="text-sm font-medium text-t-white mb-1">{b.question}</p>
                  <p className="text-sm text-t-phos-dim leading-relaxed border-l-2 border-t-amber pl-3 italic">
                    {b.model_answer}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Your notes -- stay on your device (Phase 3) */}
        <div className="bg-t-panel p-5 border border-t-line mb-4">
          <h2 className="font-semibold text-t-white mb-2">Your notes</h2>
          <p className="text-xs text-t-phos-dim mb-2">
            Jot what you want to remember. These stay on your device -- we never store your words.
          </p>
          <textarea
            value={userNotes}
            onChange={(e) => setUserNotes(e.target.value)}
            placeholder="What clicked? What do you want to do differently next time?"
            rows={3}
            className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none resize-y"
          />
        </div>

        {/* Deliverable actions (Phase 3) -- analysis only, never a transcript */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <button
            onClick={downloadAnalysis}
            className="t-focus px-4 py-2.5 border border-t-line text-t-phos text-sm font-medium hover:border-t-phos-dim hover:text-t-white transition-colors flex items-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 2v8M5 7l3 3 3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Save analysis PDF
          </button>
          <button
            onClick={copyPracticeSummary}
            className="px-4 py-2.5 text-t-amber-bright text-sm font-medium hover:text-t-amber transition-colors"
          >
            {copiedSummary ? "Copied!" : "Copy a practice summary for any AI"}
          </button>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => {
              setStep("setup");
              setMessages([]);
              setFeedback(null);
              setExchangeCount(0);
            }}
            className="t-focus flex-1 px-6 py-4 bg-t-amber text-white font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright transition-colors min-h-touch"
          >
            Practice Again
          </button>
          <button
            onClick={() => {
              setStep("practice");
              setFeedback(null);
            }}
            className="t-focus px-6 py-4 border border-t-line text-t-phos font-medium hover:border-t-phos-dim hover:text-t-white transition-colors min-h-touch"
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
      <div className="bg-t-panel-2 border border-t-line px-5 py-4 mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-t-panel border border-t-line flex items-center justify-center text-t-white text-sm font-bold">
            HM
          </div>
          <div>
            <p className="text-t-white text-sm font-medium flex items-center gap-2">
              Hiring Manager
              <span className="w-2 h-2 bg-t-phos inline-block" />
            </p>
            <p className="text-t-phos-dim text-xs">
              {config.targetRole ? `${config.targetRole} interview` : "Interview in progress"}
            </p>
          </div>
        </div>
        <button
          onClick={endInterview}
          disabled={sending}
          className="t-focus text-sm text-t-phos-dim hover:text-t-white px-3 py-1.5 hover:bg-t-panel transition-colors disabled:opacity-50"
        >
          {sending ? "Wrapping up..." : "End & get feedback"}
        </button>
      </div>

      {/* Chat */}
      <div className="bg-t-panel border border-t-line mb-4">
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
          {sending && (
            <div className="flex justify-start">
              <div className="bg-t-panel-2 border border-t-line px-4 py-3 flex gap-1">
                <span className="w-2 h-2 bg-t-phos-dim animate-bounce" />
                <span className="w-2 h-2 bg-t-phos-dim animate-bounce [animation-delay:0.1s]" />
                <span className="w-2 h-2 bg-t-phos-dim animate-bounce [animation-delay:0.2s]" />
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="flex gap-2 p-4 border-t border-t-line"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your answer..."
            className="flex-1 px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none min-h-touch"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="t-focus px-4 py-3 bg-t-amber text-white font-bold hover:bg-t-amber-bright disabled:opacity-40 min-h-touch"
          >
            Send
          </button>
        </form>
      </div>

      {rateLimitError && (
        <div className="bg-t-panel p-4 border border-t-amber mt-4">
          <p className="text-sm text-t-amber-bright">{rateLimitError}</p>
        </div>
      )}

      <p className="text-xs text-t-phos-dim text-center">
        This is a safe space to practice. We never save your words or
        recordings, only the frames you practice and whether your point lands, so
        the app can coach you and track your progress. Your practice is private
        to your account and never shared unless you choose to connect a support
        partner.
      </p>
    </div>
  );
}

function VoicePracticePanel({
  config,
  forgeContext,
  enabled,
}: {
  config: InterviewConfig;
  forgeContext: {
    skills: string[];
    strengths: string[];
    narrative: string;
  } | null;
  enabled: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [error, setError] = useState("");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      cleanupVoiceConnection();
    };
  }, []);

  function cleanupVoiceConnection() {
    dataChannelRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    dataChannelRef.current = null;
    pcRef.current = null;
    streamRef.current = null;
  }

  function stopVoicePractice() {
    // Only record a completion if a live session actually took place.
    if (status === "live") {
      recordInterviewPractice({
        role: config.targetRole,
        frame: config.interviewType || "general",
        mode: "voice",
        includeDisclosure:
          config.interviewType === "disclosure" || config.includeDisclosure,
      });
    }
    cleanupVoiceConnection();
    setStatus("idle");
    setError("");
  }

  async function startVoicePractice() {
    if (!enabled || status === "connecting" || status === "live") return;
    setStatus("connecting");
    setError("");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support microphone access.");
      }

      const tokenRes = await fetch("/api/interview-voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, forgeContext: forgeContext || undefined }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        throw new Error(tokenData.error || "Could not start voice practice.");
      }
      const ephemeralKey =
        tokenData.value || tokenData.client_secret?.value || tokenData.secret?.value;
      if (!ephemeralKey) {
        throw new Error("Voice session token was missing.");
      }

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.ontrack = (event) => {
        if (audioRef.current) {
          audioRef.current.srcObject = event.streams[0];
        }
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = mediaStream;
      mediaStream.getTracks().forEach((track) => pc.addTrack(track, mediaStream));

      const dataChannel = pc.createDataChannel("oai-events");
      dataChannelRef.current = dataChannel;
      dataChannel.onopen = () => {
        dataChannel.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions:
                "Begin the mock interview now with one short greeting and the first question.",
            },
          })
        );
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (!offer.sdp) throw new Error("Could not create voice offer.");

      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
      });
      if (!sdpRes.ok) {
        throw new Error("Realtime voice connection failed.");
      }

      await pc.setRemoteDescription({
        type: "answer",
        sdp: await sdpRes.text(),
      });

      setStatus("live");

      try {
        const tracker = JSON.parse(
          localStorage.getItem("consumer_progress") || "{}"
        );
        tracker.voice_interviews_started =
          (tracker.voice_interviews_started || 0) + 1;
        tracker.interviews_started = (tracker.interviews_started || 0) + 1;
        tracker.last_interview = new Date().toISOString();
        localStorage.setItem("consumer_progress", JSON.stringify(tracker));
      } catch {}
    } catch (err: any) {
      cleanupVoiceConnection();
      setStatus("error");
      setError(err?.message || "Voice practice could not start.");
    }
  }

  return (
    <div className="border border-t-steel bg-t-panel p-5">
      <audio ref={audioRef} autoPlay className="hidden" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-t-steel">Live voice practice</h2>
          <p className="text-sm text-t-phos-dim">
            Talk out loud with a realtime AI interviewer using gpt-realtime-2.
          </p>
          {status === "live" && (
            <p className="mt-1 text-xs font-medium text-t-amber-bright">
              Live now. Speak naturally; end the session when you are done.
            </p>
          )}
          {status === "error" && error && (
            <p className="mt-1 text-xs font-medium text-t-red">{error}</p>
          )}
        </div>
        {status === "live" ? (
          <button
            onClick={stopVoicePractice}
            className="t-focus inline-flex min-h-touch items-center justify-center bg-t-panel-2 px-5 py-3 text-sm font-medium text-t-red border border-t-red hover:bg-t-red/10"
          >
            End voice session
          </button>
        ) : (
          <button
            onClick={startVoicePractice}
            disabled={!enabled || status === "connecting"}
            className="t-focus inline-flex min-h-touch items-center justify-center bg-t-steel px-5 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
          >
            {status === "connecting" ? "Connecting..." : "Start live voice"}
          </button>
        )}
      </div>
    </div>
  );
}
