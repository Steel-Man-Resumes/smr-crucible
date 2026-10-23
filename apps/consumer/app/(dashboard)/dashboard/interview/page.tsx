"use client";

/**
 * Interview Practice — Refinery Tool 3
 *
 * AI mock interviews: industry-specific, role-specific.
 * Includes disclosure practice scenarios.
 * Feedback on content, not judgment.
 */

import { TroyWork } from "@crucible/consumer-ui";
import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CardSelect, GhostGuide } from "@crucible/consumer-ui";
import { TierGate } from "@/components/TierGate";
import { PremiumGate, usePremium } from "@/components/premium/PremiumGate";
import { textPracticeAllowanceLine, toolIsOpen } from "@/lib/premium";
import { OnboardingGate } from "@/components/OnboardingGate";
import { getOpusMessage } from "@/lib/opus-messages";
import { useUserContext } from "@/lib/use-user-context";
import { formatResumeDownload } from "@/components/resume/resumeModel";
import { escapeHtml as esc } from "@/lib/escape-html";
import { trackProgress } from "@/lib/track-progress";
import { useEffectiveRole } from "@/components/RoleProvider";
import { saveArtifactReceipt } from "@/lib/artifact-save";
import type { VoiceSessionBody } from "@/lib/voice-instructions";
import type { SavedVoiceReport } from "@/lib/saved-voice-report";
import type { InterviewFeedback } from "@/lib/interview-feedback";
import { parseInterviewFeedback } from "@/lib/interview-feedback";
import { pickJdSource, formatSnapshotAge } from "@/lib/interview-jd";
import {
  turnFromRealtimeEvent,
  captionDeltaFromEvent,
  type VoiceTurn,
} from "@/lib/voice-transcript";
import {
  deriveStruggleTags,
  struggleTagLabel,
  knownStruggleTags,
} from "@/lib/struggle-tags";

const VOICE_PURPOSE = "interview_voice";

type InterviewStep = "setup" | "practice" | "feedback";

interface InterviewConfig {
  targetRole: string;
  interviewType: string;
  includeDisclosure: boolean;
  /** Phase 5.9: encouraging skills the user chose to target this run. */
  focusAreas?: string[];
}

/** A saved job application that carries a JD snapshot we can auto-fill from. */
interface SavedApplication {
  resume_artifact_id?: string | null;
  id: string;
  job_title: string;
  company: string;
  jd_full_text: string | null;
  jd_excerpt: string | null;
  jd_fetched_at: string | null;
  jd_truncated: boolean;
}

/** Metadata for a saved interview_voice session (history list). */
interface VoiceSessionMeta {
  id: string;
  target_context: Record<string, unknown>;
  status: string;
  struggle_tags: string[];
  takeaways: Record<string, unknown> | null;
  started_at: string;
  ended_at: string | null;
}

/**
 * Persist a privacy-safe record that a practice session happened, so the journey
 * engine (computeNextStep Stage 5) can advance and the coach can see progress.
 * We teach frames, not scripts, so we store the FRAME practiced and the coach's
 * meaning-level feedback -- never the user's words, transcript, or audio.
 */
interface PracticeRecord {
  accountId: string;
  role: string;
  frame: string;
  mode: "text" | "voice";
  includeDisclosure: boolean;
  exchanges?: number;
  feedback?: unknown;
  voiceSessionId?: string;
}
async function recordInterviewPractice(record: PracticeRecord): Promise<boolean> {
  try {
    await saveArtifactReceipt({
      type: "interview_prep",
      targetContext: { targetJob: record.role || null, frame: record.frame, ...(record.voiceSessionId ? { voiceSessionId: record.voiceSessionId } : {}) },
      content: {
        role: record.role || null,
        frame: record.frame,
        mode: record.mode,
        includeDisclosure: record.includeDisclosure,
        ...(record.exchanges !== undefined ? { exchanges: record.exchanges } : {}),
        ...(record.feedback ? { feedback: record.feedback } : {}),
        completedAt: new Date().toISOString(),
      },
      scaffoldLevel: 1.0,
    }, record.accountId);
    return true;
  } catch {
    // Never let progress-tracking break the practice experience.
    return false;
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
      <OnboardingGate requiredState="needs_profile" toolName="Interview Practice" previewFeature="interview">
        {/* Text practice is free with an account (a daily allowance while the
            premium gate is on). Voice coaching is sponsored: only the voice
            panel below sits behind the gate. */}
        <Suspense><InterviewPracticePage /></Suspense>
      </OnboardingGate>
    </TierGate>
  );
}

function InterviewPracticePage() {
  const effectiveRole = useEffectiveRole();
  const practiceOwnerRef = useRef<string | null>(null);
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
  const [voiceSaveWarning, setVoiceSaveWarning] = useState("");
  const voiceRecordRef = useRef<PracticeRecord | null>(null);
  const voiceRecordBusy = useRef(false);
  const [voiceRecordSaving, setVoiceRecordSaving] = useState(false);
  const [voiceRecordFailed, setVoiceRecordFailed] = useState(false);
  async function saveVoiceRecord() {
    if (!voiceRecordRef.current || voiceRecordBusy.current) return;
    voiceRecordBusy.current = true;
    setVoiceRecordSaving(true);
    setVoiceRecordFailed(false);
    try {
      const saved = await recordInterviewPractice(voiceRecordRef.current);
      setVoiceRecordFailed(!saved);
      if (saved) { voiceRecordRef.current = null; loadVoiceHistory(); }
    } finally { voiceRecordBusy.current = false; setVoiceRecordSaving(false); }
  }
  const [rateLimitError, setRateLimitError] = useState("");
  // The server's id for this practice interview (the daily allowance counts
  // one per interview, lib/premium-server.ts). Sent back on every later turn.
  const practiceSessionRef = useRef<string | null>(null);
  // The daily text practice allowance applies while the premium gate is on
  // and voice coaching is not open for this person (no sponsor).
  const { status: premiumStatus } = usePremium();
  const practiceAllowanceApplies = !!premiumStatus?.gate && toolIsOpen(premiumStatus, "interview_coaching") === false;
  const chatRef = useRef<HTMLDivElement>(null);
  // Phase 3: interview against a SPECIFIC saved resume + optional job posting.
  const [resumes, setResumes] = useState<
    Array<{ id: string; targetJob: string | null; targetCompany: string | null; createdAt: string; content: any }>
  >([]);
  const [selectedResumeId, setSelectedResumeId] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [copiedSummary, setCopiedSummary] = useState(false);

  // Phase 5.6: saved jobs with a JD snapshot, so the user picks a job and we
  // auto-fill the role + JD instead of asking them to re-paste it.
  const [applications, setApplications] = useState<SavedApplication[]>([]);
  const [selectedApplicationId, setSelectedApplicationId] = useState("");
  const [jdMeta, setJdMeta] = useState<{ age: string; truncated: boolean } | null>(null);

  // Phase 5.8/5.9: saved voice-interview sessions + the struggle tags carried
  // from the most recent one, to offer targeted practice next time.
  const [voiceHistory, setVoiceHistory] = useState<VoiceSessionMeta[]>([]);
  const [lastStruggleTags, setLastStruggleTags] = useState<string[]>([]);

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
    fetch("/api/artifacts?type=resume&limit=20&examples=hide&order=recent")
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
        if (list.length && !searchParams.get("applicationId")) {
          setSelectedResumeId((prev) => prev || list[0].id);
          const r0 = list[0];
          const label = [r0.targetJob, r0.targetCompany].filter(Boolean).join(" at ");
          if (label) setConfig((prev) => (prev.targetRole ? prev : { ...prev, targetRole: label }));
        }
      })
      .catch(() => {});
  }, []);

  // Phase 5.6: load the user's saved applications that carry a JD snapshot, so
  // they can pick a job and auto-fill the role + description (no re-paste). We
  // reuse /api/applications (returns the jd_* snapshot columns) and keep only
  // rows that actually have a JD to fill from.
  useEffect(() => {
    fetch("/api/applications")
      .then((r) => (r.ok ? r.json() : { applications: [] }))
      .then(({ applications: rows }) => {
        const withJd: SavedApplication[] = (rows || [])
          .filter((a: any) => a?.id)
          .map((a: any) => ({
            id: a.id,
            resume_artifact_id: a.resume_artifact_id ?? null,
            job_title: a.job_title || "",
            company: a.company || "",
            jd_full_text: a.jd_full_text ?? null,
            jd_excerpt: a.jd_excerpt ?? null,
            jd_fetched_at: a.jd_fetched_at ?? null,
            jd_truncated: !!a.jd_truncated,
          }));
        setApplications(withJd);
      })
      .catch(() => {});
  }, []);

  const [selectedSnapshot, setSelectedSnapshot] = useState<{ id: string; content: any; applicationId: string } | null>(null);
  const [applicationLoading, setApplicationLoading] = useState(false);
  const [applicationFailed, setApplicationFailed] = useState(false);
  const selectionSequence = useRef(0);
  useEffect(() => {
    const id = searchParams.get("applicationId");
    if (id) void selectApplication(id);
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 5.8/5.9: load saved voice-interview sessions (metadata only) so we can
  // show a history list and offer to target last time's struggle tags.
  const loadVoiceHistory = () => {
    fetch(`/api/conversation/sessions?purpose=${VOICE_PURPOSE}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!Array.isArray(d?.sessions)) return;
        setVoiceHistory(d.sessions);
        // Most recent ended session with struggle tags seeds the targeting offer.
        const recent = d.sessions.find(
          (s: VoiceSessionMeta) => Array.isArray(s.struggle_tags) && s.struggle_tags.length
        );
        if (recent) setLastStruggleTags(knownStruggleTags(recent.struggle_tags));
      })
      .catch(() => {});
  };
  useEffect(() => {
    loadVoiceHistory();
    // Fallback hint from a text-mode run on this device (no stored session).
    try {
      const raw = localStorage.getItem("interview_struggle_tags");
      if (raw) {
        const tags = knownStruggleTags(JSON.parse(raw));
        if (tags.length) setLastStruggleTags((prev) => (prev.length ? prev : tags));
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick a saved job: auto-fill role + company, load its JD snapshot into the
  // job-description field (snapshot wins over any paste), and prefer a tailored
  // resume linked to the same job if the user has one.
  async function selectApplication(id: string) {
    const seq = ++selectionSequence.current;
    setSelectedApplicationId(id);
    setSelectedSnapshot(null);
    setApplicationFailed(false);
    setConfig(prev => ({ ...prev, targetRole: "" }));
    setSelectedResumeId("");
    setJobDescription("");
    setJdMeta(null);
    if (!id) return;
    setApplicationLoading(true);
    setRateLimitError("");
    try {
      const response = await fetch(`/api/application-context?applicationId=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const context = await response.json();
      if (selectionSequence.current !== seq) return;
      const app = context.application;
      setConfig(prev => ({ ...prev, targetRole: [app.job_title, app.company].filter(Boolean).join(" at ") }));
      setJobDescription(pickJdSource(app.jd_full_text || app.jd_excerpt || app.description, "").text);
      setJdMeta({ age: formatSnapshotAge(app.jd_fetched_at), truncated: app.jd_truncated });
      if (context.resumeSnapshot) setSelectedSnapshot({ id: context.resumeSnapshot.id, content: context.resumeSnapshot.content_snapshot, applicationId: id });
      else if (context.revision) setSelectedSnapshot({ id: context.revision.id, content: null, applicationId: id, text: context.revision.resume_text } as any);
      setSelectedResumeId(app.resume_artifact_id || "");
      const nextUrl = new URL(window.location.href);
      if (nextUrl.searchParams.get("applicationId") !== id) {
        nextUrl.searchParams.set("applicationId", id);
        window.history.replaceState(null, "", nextUrl.toString());
      }
    } catch { if (selectionSequence.current === seq) { setApplicationFailed(true); setRateLimitError("This saved job could not be loaded. Choose a job again before starting."); } }
    finally { if (selectionSequence.current === seq) setApplicationLoading(false); }
  }

  // Phase 5.9: toggle targeting last time's struggle tags for this run.
  const focusActive = (config.focusAreas?.length ?? 0) > 0;
  function toggleFocus() {
    setConfig((prev) => {
      if (prev.focusAreas?.length) {
        const { focusAreas: _drop, ...rest } = prev;
        return rest;
      }
      const labels = lastStruggleTags.map(struggleTagLabel).filter(Boolean);
      return { ...prev, focusAreas: labels };
    });
  }

  // Auto-scroll chat
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  function startInterview() {
    const accountId = effectiveRole?.accountId;
    if (!accountId) { setRateLimitError("Your account is still loading. Try again in a moment."); return; }
    practiceOwnerRef.current = accountId;
    const isDisclosure =
      config.interviewType === "disclosure" || config.includeDisclosure;

    const openingMessage = isDisclosure
      ? "Thanks for coming in today. We appreciate your interest in this position. Why don't you start by telling me a little about yourself?"
      : config.interviewType === "behavioral"
        ? "Welcome! I'm going to ask you some questions about your past experiences. Take your time with each answer. Let's start. Tell me about yourself and what brought you here today."
        : "Hi there, thanks for taking the time to interview with us today. Let's get started. Can you tell me a bit about yourself and why you're interested in this role?";

    if (applicationLoading || applicationFailed) return;
    setMessages([{ role: "assistant", content: openingMessage }]);
    setStep("practice");
    setExchangeCount(0);
    practiceSessionRef.current = null;

    // Track interview start
    try {
      const tracker = JSON.parse(
        localStorage.getItem("consumer_progress") || "{}"
      );
      tracker.interviews_started = (tracker.interviews_started || 0) + 1;
      tracker.last_interview = new Date().toISOString();
      localStorage.setItem("consumer_progress", JSON.stringify(tracker));
    } catch {}
    trackProgress("interview_started");
  }

  // The selected resume, formatted for the interviewer prompt + the bullet-proof
  // handoff. Shared by sendMessage and endInterview.
  function buildResumePayload():
    | { targetJob: string | null; targetCompany: string | null; text: string; evidence: any[] }
    | undefined {
    const selected = resumes.find((r) => r.id === selectedResumeId);
    if (selectedSnapshot && (selectedSnapshot as any).text) return { targetJob: config.targetRole, targetCompany: null, text: (selectedSnapshot as any).text, evidence: [] };
    const sel = selectedSnapshot?.content ? { content: selectedSnapshot.content, targetJob: config.targetRole, targetCompany: null } : selected;
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
    const accountId = practiceOwnerRef.current;
    if (!accountId) return;
    try {
      const tracker = JSON.parse(localStorage.getItem("consumer_progress") || "{}");
      tracker.interviews_completed = (tracker.interviews_completed || 0) + 1;
      localStorage.setItem("consumer_progress", JSON.stringify(tracker));
    } catch {}
    trackProgress("interview_completed");
    recordInterviewPractice({
      accountId,
      role: config.targetRole,
      frame: config.interviewType || "general",
      mode: "text",
      includeDisclosure: config.interviewType === "disclosure" || config.includeDisclosure,
      exchanges,
      feedback: fb,
    });
    stashStruggleTags(fb);
  }

  // Phase 5.9: keep last run's struggle tags for the next setup screen. Text
  // mode has no stored session (we never save its words), so this local stash is
  // the only carry-over; it holds derived TAG IDS, never any transcript.
  function stashStruggleTags(fb: any) {
    try {
      const tags = deriveStruggleTags(fb);
      if (tags.length) {
        localStorage.setItem("interview_struggle_tags", JSON.stringify(tags));
        setLastStruggleTags(tags);
      }
    } catch {}
  }

  // Phase 5.8: a SAVED voice session produced a real scorecard. Show it in the
  // same feedback screen text mode uses, and record the completion (mode voice,
  // with feedback). The conversation session itself is closed inside the voice
  // panel (takeaways + struggle tags) before this runs.
  function handleVoiceFeedback(fb: any, exchanges: number, saveFeedback: boolean, warning: string, voiceSessionId?: string, practiceConfig: InterviewConfig = config, practiceAccountId?: string) {
    setFeedback(fb);
    setVoiceSaveWarning(warning);
    setStep("feedback");
    try {
      const tracker = JSON.parse(localStorage.getItem("consumer_progress") || "{}");
      tracker.interviews_completed = (tracker.interviews_completed || 0) + 1;
      localStorage.setItem("consumer_progress", JSON.stringify(tracker));
    } catch {}
    trackProgress("interview_completed", { mode: "voice" });
    if (!practiceAccountId) { setVoiceSaveWarning("Your report is here, but the account could not be confirmed for saving."); return; }
    voiceRecordRef.current = {
      accountId: practiceAccountId,
      role: practiceConfig.targetRole,
      frame: practiceConfig.interviewType || "general",
      mode: "voice",
      includeDisclosure: practiceConfig.interviewType === "disclosure" || practiceConfig.includeDisclosure,
      exchanges,
      feedback: saveFeedback ? fb : undefined,
      voiceSessionId: saveFeedback ? voiceSessionId : undefined,
    };
    void saveVoiceRecord();
    if (saveFeedback) stashStruggleTags(fb);
    loadVoiceHistory();
  }

  function resetToSetup() {
    // A failed save remains recoverable while the report is open.
    if (voiceRecordSaving) return;
    setVoiceSaveWarning("");
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
    setRateLimitError("");
    try {
      const res = await fetch("/api/interview-practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId: selectedApplicationId || undefined,
          resumeArtifactId: selectedResumeId || undefined,
          messages,
          config,
          exchangeCount,
          endInterview: true,
          practiceSession: practiceSessionRef.current ?? undefined,
          forgeContext: forgeContext || undefined,
          resume: buildResumePayload(),
          jobDescription: jobDescription.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (typeof data?.practiceSession === "string") practiceSessionRef.current = data.practiceSession;
      if (res.ok && data) {
        if (data.feedback) {
          if (data.response) setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
          setFeedback(data.feedback);
          setStep("feedback");
          recordCompletion(data.feedback, exchangeCount);
        } else {
          setRateLimitError("Your feedback could not be prepared. Your answers are still here. Try End & get feedback again.");
        }
      } else {
        setRateLimitError(data?.error || "Your feedback could not be prepared. Your answers are still here. Try End & get feedback again.");
      }
    } catch {
      setRateLimitError("The connection dropped. Your answers are still here. Try End & get feedback again.");
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
          applicationId: selectedApplicationId || undefined,
          resumeArtifactId: selectedResumeId || undefined,
          messages: updatedMessages,
          config,
          exchangeCount: newExchangeCount,
          practiceSession: practiceSessionRef.current ?? undefined,
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
        if (typeof data.practiceSession === "string") practiceSessionRef.current = data.practiceSession;

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
      } else {
        // A failed turn can still carry the session id it was counted under
        // (the retry then continues this session, not a new one).
        const data = await res.json().catch(() => null);
        if (typeof data?.practiceSession === "string") practiceSessionRef.current = data.practiceSession;
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "I had trouble with that response. Let's try again." },
        ]);
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
    const out: string[] = ["INTERVIEW PRACTICE SUMMARY (analysis only, no transcript)"];
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
<h1>Interview Analysis${config.targetRole ? `: ${esc(config.targetRole)}` : ""}</h1>
<p class="subtitle">Built with The Refinery &bull; steelmanresumes.com &bull; ${date} &bull; Analysis and your notes, no transcript</p>
${fb.frame ? `<h2>The Frame to Carry In</h2><blockquote>${esc(fb.frame)}</blockquote>` : ""}
${Array.isArray(fb.strengths) && fb.strengths.length ? `<h2>What You Did Well</h2><ul>${list(fb.strengths)}</ul>` : ""}
${Array.isArray(fb.improvements) && fb.improvements.length ? `<h2>Areas to Work On</h2><ul>${list(fb.improvements)}</ul>` : ""}
${Array.isArray(fb.better_answers) && fb.better_answers.length ? `<h2>Stronger Answers to Model</h2>${fb.better_answers.map((b: any) => `<p class="q">${esc(b.question)}</p><blockquote>${esc(b.model_answer)}</blockquote>`).join("")}` : ""}
${fb.overall ? `<h2>Overall</h2><p>${esc(fb.overall)}</p>` : ""}
${userNotes.trim() ? `<h2>Your Notes</h2><p>${esc(userNotes).replace(/\n/g, "<br/>")}</p>` : ""}
<div class="footer">This analysis is yours. Text practice keeps this feedback, never a transcript. Voice practice keeps a text transcript only when you turn saving on. We never keep the audio.</div>
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

        {/* Phase 5.9: gently offer last time's focus */}
        {lastStruggleTags.length > 0 && (
          <div className="bg-t-panel-2 border border-t-amber p-4 mb-6">
            <p className="text-sm text-t-white">
              Last time you wanted to work on{" "}
              <span className="font-medium text-t-amber-bright">
                {lastStruggleTags.map(struggleTagLabel).filter(Boolean).join(", ")}
              </span>
              . Want to target that this time?
            </p>
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={focusActive}
                onChange={toggleFocus}
                className="w-4 h-4 accent-t-amber"
              />
              <span className="text-sm text-t-phos">
                Yes, give me chances to practice that
              </span>
            </label>
          </div>
        )}

        <div className="space-y-6">
          {/* Phase 5.6: pick a saved job to auto-fill role + description */}
          {applications.length > 0 && (
            <div>
              <label className="text-sm font-medium text-t-white block mb-1">
                Practice for a saved job?{" "}
                <span className="font-normal text-t-phos-dim">
                  (auto-fills the role and job description)
                </span>
              </label>
              <select
                value={selectedApplicationId}
                onChange={(e) => void selectApplication(e.target.value)}
                className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none min-h-touch"
              >
                <option value="">Not right now</option>
                {applications.map((a) => {
                  const label = [a.job_title, a.company].filter(Boolean).join(" at ");
                  return (
                    <option key={a.id} value={a.id}>
                      {label || "Saved job"}
                    </option>
                  );
                })}
              </select>
              {selectedApplicationId && jdMeta && (
                <p className="text-xs text-t-amber-bright mt-1">
                  Using the job description we saved for this job
                  {jdMeta.age ? ` (${jdMeta.age})` : ""}.
                  {jdMeta.truncated
                    ? " It was long, so we saved the first part of it."
                    : ""}
                </p>
              )}
            </div>
          )}

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
                  setSelectedSnapshot(null);
                  setSelectedResumeId(id);
                  const r = resumes.find((x) => x.id === id);
                  const label = r ? [r.targetJob, r.targetCompany].filter(Boolean).join(" at ") : "";
                  if (label && !selectedApplicationId) setConfig((prev) => ({ ...prev, targetRole: label }));
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
                  Questions will be based on the real jobs, tools, and results on this resume.
                </p>
              )}
            </div>
          )}

          {/* Phase 3: optional job posting */}
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">
              Paste the job posting{" "}
              <span className="font-normal text-t-phos-dim">
                (optional, helps the questions match the real role)
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

          {/* Voice coaching is sponsored (an organization or SMR opens it).
              Locked, it shows what's included and how to get it; the text
              practice below keeps working either way. */}
          <PremiumGate tool="interview_coaching" compact>
            <VoicePracticePanel
              accountId={effectiveRole?.accountId ?? null}
              config={config}
              forgeContext={forgeContext}
              enabled={!!config.interviewType && !applicationLoading && !applicationFailed}
              jobDescription={jobDescription.trim() || undefined}
              buildResumePayload={buildResumePayload}
              applicationId={selectedApplicationId || undefined}
              resumeArtifactId={selectedResumeId || null}
              onVoiceFeedback={handleVoiceFeedback}
              onHistoryChange={loadVoiceHistory}
            />
          </PremiumGate>

          <button
            onClick={startInterview}
            disabled={!config.interviewType}
            className="t-focus w-full px-6 py-4 bg-t-amber text-white font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright disabled:opacity-40 disabled:shadow-none transition-colors min-h-touch"
          >
            Start Practice Interview
          </button>
          {practiceAllowanceApplies && (
            <p className="text-xs text-t-phos-dim" data-testid="text-practice-allowance">
              {textPracticeAllowanceLine()}
            </p>
          )}
        </div>

        <VoiceSessionHistory history={voiceHistory} />
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
          Here&apos;s how you did. Remember, this is about practice, not
          perfection.
        </p>

        {voiceSaveWarning && <p role="alert" className="mb-4 text-sm text-t-amber-bright">{voiceSaveWarning}</p>}
        {/* Strengths */}
        {voiceRecordSaving && <p role="status" className="mb-4 text-sm text-t-phos-dim">Saving your practice record...</p>}
        {voiceRecordFailed && <div role="alert" className="mb-4 border border-t-amber p-3 text-sm"><p>Your practice record save has not been confirmed. Your report is still here. Check your Library before retrying, or download a copy.</p><button onClick={() => void saveVoiceRecord()} className="t-focus mt-2 min-h-touch text-t-amber-bright underline">Retry saving practice</button></div>}

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
            Jot what you want to remember. These notes stay on this page and are not saved. Copy or download the analysis to keep them.
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
              <TroyWork topic="interview" label="Preparing a response to your answer" />
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
        This is a safe space to practice. In text practice we keep the role, the
        kind of practice and t.ROY&apos;s feedback, never a transcript of your
        answers, so the app can track your progress. In voice practice, what was said is kept as text
        only when you turn saving on, and we never keep the audio. No program or
        employer can read your practice. If you share your progress with a
        program, it sees how many sessions you have done.
      </p>
    </div>
  );
}

function VoicePracticePanel({
  accountId,
  config,
  forgeContext,
  enabled,
  jobDescription,
  buildResumePayload,
  applicationId,
  resumeArtifactId,
  onVoiceFeedback,
  onHistoryChange,
}: {
  accountId: string | null;
  config: InterviewConfig;
  forgeContext: {
    skills: string[];
    strengths: string[];
    narrative: string;
  } | null;
  enabled: boolean;
  jobDescription?: string;
  buildResumePayload: () =>
    | { targetJob: string | null; targetCompany: string | null; text: string; evidence: any[] }
    | undefined;
  applicationId?: string;
  resumeArtifactId?: string | null;
  onVoiceFeedback: (feedback: any, exchanges: number, saveFeedback: boolean, warning: string, voiceSessionId?: string, practiceConfig?: InterviewConfig, practiceAccountId?: string) => void;
  onHistoryChange: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [error, setError] = useState("");
  const [reservedSeconds, setReservedSeconds] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  const mountedRef = useRef(true);
  const [saveWarning, setSaveWarning] = useState("");
  const saveWarningRef = useRef("");
  const pendingWritesRef = useRef(new Set<Promise<void>>());
  const [consentBusy, setConsentBusy] = useState(false);
  const reportBusyRef = useRef(false);
  const reportRequestRef = useRef<Record<string, unknown> | null>(null);
  const reportContextRef = useRef<Record<string, unknown> | null>(null);
  const voiceContextRef = useRef<VoiceSessionBody | null>(null);
  const sessionSavingRef = useRef(false);
  const voiceOwnerRef = useRef<string | null>(null);
  const sessionFeedbackRef = useRef(onVoiceFeedback);
  const connectionEpochRef = useRef(0);
  const practiceSessionRef = useRef<string | undefined>(undefined);
  const [consentReady, setConsentReady] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Phase 5.7: opt-in, text-only transcript capture. The SESSION is the consent
  // unit -- same model as the Confidence Coach. "Save this run" opens a session
  // WITHOUT granting anything durable; "always save" grants the interview
  // transcript layer so future runs auto-open a session.
  const [alwaysAllow, setAlwaysAllow] = useState(false);
  const [saveThisSession, setSaveThisSession] = useState(false);
  const savingOn = alwaysAllow || saveThisSession;
  const convSessionIdRef = useRef<string | null>(null);
  const convSeqRef = useRef(0);
  // Every completed turn, in arrival order. Held for the end-of-session
  // scorecard; text only, never audio.
  const turnsRef = useRef<VoiceTurn[]>([]);

  // Phase 5.7 accessibility: a live, on-screen caption of the conversation so a
  // deaf or hard-of-hearing user can follow along. These are ephemeral (shown,
  // not stored) and appear for EVERY live session, saved or not.
  const [captions, setCaptions] = useState<VoiceTurn[]>([]);
  const [partial, setPartial] = useState("");

  // On mount: is the durable interview-transcript layer already granted?
  useEffect(() => {
    let live = true;
    fetch(`/api/conversation/consent?purpose=${VOICE_PURPOSE}`, { cache: "no-store", signal: AbortSignal.timeout(10000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live) return;
        setAlwaysAllow(d?.granted === true);
        // A missing preference is different from a deliberate revocation.
        // Failed/older API responses stay off rather than guessing.
        setSaveThisSession(d?.preference === null);
        setConsentReady(true);
      })
      .catch(() => { if (live) setConsentReady(true); });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupVoiceConnection();
      void endServerSession();
    };
  }, []);

  function cleanupVoiceConnection() {
    connectionEpochRef.current++;
    dataChannelRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    dataChannelRef.current = null;
    pcRef.current = null;
    streamRef.current = null;
  }

  async function endServerSession() {
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (!sessionId) return;
    try {
      await fetch("/api/interview-voice/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } catch {
      // Best-effort: the reconcile cron closes any lease this misses.
    }
  }

  function warnSaving(message: string) {
    saveWarningRef.current = message;
    if (mountedRef.current) setSaveWarning(message);
  }

  /** Save an explicit off choice without granting durable saving. */
  async function handleSaveToggle(next: boolean, durable: boolean) {
    if (consentBusy || finishingRef.current || status === "live") return;
    if (!durable && next) {
      setSaveThisSession(true);
      return;
    }
    // Turning either control off creates the existing durable revoked record.
    // A later one-run save still uses sessionConsent, not a durable grant.
    if (!next) {
      setAlwaysAllow(false);
      setSaveThisSession(false);
      // Never carry a failed start's saved-session identity into a later private run.
      convSessionIdRef.current = null;
    }
    setConsentBusy(true);
    try {
      const res = await fetch("/api/conversation/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ purpose: VOICE_PURPOSE, action: next ? "grant" : "revoke" }),
      });
      const data = res.ok ? await res.json() : null;
      if (typeof data?.granted !== "boolean" || data.granted !== next) throw new Error("Preference not confirmed");
      setAlwaysAllow(data.granted);
      if (!data.granted) setSaveThisSession(false);
      warnSaving("");
    } catch {
      warnSaving("Your saving preference could not be saved. Check this choice again before your next practice.");
    } finally {
      setConsentBusy(false);
    }
  }

  /** Open a stored conversation session if saving is on. For a one-time "save
   *  this run" we pass sessionConsent so nothing durable is granted. */
  async function ensureConvSession(): Promise<void> {
    if (!savingOn || convSessionIdRef.current) return;
    try {
      const res = await fetch("/api/conversation/session", {
        signal: AbortSignal.timeout(10000),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: VOICE_PURPOSE,
          sessionConsent: saveThisSession && !alwaysAllow ? true : undefined,
          targetContext: {
            role: config.targetRole || null,
            interviewType: config.interviewType || null,
          },
        }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.created || !data.sessionId) throw new Error("Transcript session unavailable");
      convSessionIdRef.current = data.sessionId;
    } catch {
      warnSaving("Your transcript could not be saved. You can still practice and get feedback in this tab.");
    }
  }

  async function persistVoiceTurn(turn: VoiceTurn) {
    if (!savingOn || !convSessionIdRef.current || !turn.text.trim()) return;
    const seq = convSeqRef.current++;
    try {
      const res = await fetch("/api/conversation/chunk", {
        signal: AbortSignal.timeout(10000),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: VOICE_PURPOSE,
          sessionId: convSessionIdRef.current,
          seq,
          role: turn.role,
          text: turn.text,
        }),
      });
      if (!res.ok) throw new Error("Transcript write failed");
    } catch {
      warnSaving("Some transcript text could not be saved. Keep this tab open for your feedback; saved history may be incomplete.");
    }
  }

  // Each Realtime data-channel event: map to a completed turn (captions +
  // capture) or a streaming caption fragment. TEXT ONLY -- audio bytes never
  // reach this handler.
  function handleDataChannelMessage(ev: MessageEvent) {
    if (!mountedRef.current) return;
    let evt: unknown;
    try {
      evt = JSON.parse(typeof ev.data === "string" ? ev.data : "");
    } catch {
      return;
    }
    const turn = turnFromRealtimeEvent(evt);
    if (turn) {
      turnsRef.current.push(turn);
      setCaptions((prev) => [...prev, turn].slice(-60));
      setPartial("");
      const pending = persistVoiceTurn(turn);
      pendingWritesRef.current.add(pending);
      void pending.finally(() => pendingWritesRef.current.delete(pending));
      return;
    }
    const delta = captionDeltaFromEvent(evt);
    if (delta) setPartial((prev) => (prev + delta).slice(-400));
  }

  // Generate a real scorecard from the captured transcript (same feedback shape
  // as text mode) and close the stored session with takeaways + struggle tags.
  async function finishSavedVoice(turns: VoiceTurn[]) {
    if (reportBusyRef.current) return;
    reportBusyRef.current = true;
    setGenerating(true);
    setReportError("");
    try {
      const userTurns = turns.filter((t) => t.role === "user" && t.text.trim()).length;
      // Freeze the context for retries even if setup fields change afterwards.
      reportRequestRef.current ??= {
        ...reportContextRef.current,
        messages: turns.map((t) => ({ role: t.role, content: t.text })),
        exchangeCount: userTurns,
        endInterview: true,
      };
      const res = await fetch("/api/interview-practice", {
        signal: AbortSignal.timeout(65000),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...reportRequestRef.current, practiceSession: practiceSessionRef.current }),
      });
      const data = await res.json().catch(() => null);
      if (typeof data?.practiceSession === "string") practiceSessionRef.current = data.practiceSession;
      const parsed = res.ok ? parseInterviewFeedback(JSON.stringify({ closing: "Practice complete.", feedback: data?.feedback })) : null;
      if (!parsed) throw new Error("Feedback unavailable");
      const feedback = parsed.feedback;
      await Promise.allSettled([...pendingWritesRef.current]);
      if (!mountedRef.current) return;
      if (sessionSavingRef.current && convSessionIdRef.current) {
        const saved = await fetch("/api/conversation/session/end", {
          signal: AbortSignal.timeout(10000),
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            purpose: VOICE_PURPOSE,
            sessionId: convSessionIdRef.current,
            struggleTags: deriveStruggleTags(feedback),
            takeaways: { overall: feedback.overall ?? null, frame: feedback.frame ?? null },
          }),
        }).catch(() => null);
        if (!saved?.ok) warnSaving("Your feedback is ready, but saved practice history could not be finalized. Keep this report open or download it.");
      }
      if (!mountedRef.current) return;
      const savedVoiceSessionId = convSessionIdRef.current ?? undefined;
      convSessionIdRef.current = null;
      convSeqRef.current = 0;
      onHistoryChange();
      turnsRef.current = [];
      sessionFeedbackRef.current(feedback, userTurns, sessionSavingRef.current, saveWarningRef.current, savedVoiceSessionId, voiceContextRef.current?.config as InterviewConfig | undefined, voiceOwnerRef.current ?? undefined);
    } catch {
      setReportError("Your feedback could not be prepared. Your captured answers are still here in this tab. Retry feedback before leaving this page.");
    } finally {
      reportBusyRef.current = false;
      setGenerating(false);
    }
  }

  async function stopVoicePractice() {
    if (finishingRef.current || reportBusyRef.current || status !== "live") return;
    finishingRef.current = true;
    setFinishing(true);
    const wasLive = status === "live";
    // Stop sending microphone audio immediately; allow already sent audio a
    // short, bounded window to arrive as final transcript events.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioRef.current) audioRef.current.muted = true;
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    if (!mountedRef.current) return;
    const turns = turnsRef.current.slice();
    const hasAnswer = turns.some((turn) => turn.role === "user" && turn.text.trim());

    cleanupVoiceConnection();
    void endServerSession();
    setStatus("idle");
    setError("");
    setReservedSeconds(null);
    finishingRef.current = false;
    setFinishing(false);

    if (hasAnswer) {
      // A saved run has a transcript -> generate a scorecard (Phase 5.8). The
      // completion is recorded by the parent's onVoiceFeedback.
      void finishSavedVoice(turns);
      return;
    }

    setError("No completed answer was captured. Start again and wait for your answer to appear in the captions before ending.");
    setStatus("error");
    // No completed answer: record only practice metadata.
    if (wasLive && voiceOwnerRef.current) {
      recordInterviewPractice({
        accountId: voiceOwnerRef.current,
        role: config.targetRole,
        frame: config.interviewType || "general",
        mode: "voice",
        includeDisclosure:
          config.interviewType === "disclosure" || config.includeDisclosure,
      });
    }
    turnsRef.current = [];
    convSessionIdRef.current = null;
    convSeqRef.current = 0;
  }

  async function startVoicePractice() {
    if (!accountId || !enabled || !consentReady || consentBusy || finishingRef.current || reportBusyRef.current || reportError || status === "connecting" || status === "live") return;
    voiceOwnerRef.current = accountId;
    const connectionEpoch = ++connectionEpochRef.current;
    const assertActive = () => { if (!mountedRef.current || connectionEpochRef.current !== connectionEpoch) throw new Error("Voice connection cancelled."); };
    reportRequestRef.current = null;
    voiceContextRef.current = structuredClone({ config, forgeContext: forgeContext || undefined, applicationId, resumeArtifactId: resumeArtifactId ?? null, jobDescription: jobDescription || undefined });
    reportContextRef.current = { ...voiceContextRef.current, voiceContext: true };
    sessionSavingRef.current = savingOn;
    sessionFeedbackRef.current = onVoiceFeedback;
    convSessionIdRef.current = null;
    practiceSessionRef.current = undefined;
    if (audioRef.current) audioRef.current.muted = false;
    warnSaving("");
    setStatus("connecting");
    setError("");
    setCaptions([]);
    setPartial("");
    turnsRef.current = [];
    convSeqRef.current = 0;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support microphone access.");
      }

      // Open the stored session first (if saving is on) so we never miss the
      // opening turns. No consent -> no session -> nothing stored.
      await ensureConvSession();
      assertActive();

      const tokenRes = await fetch("/api/interview-voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(voiceContextRef.current),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        throw new Error(tokenData.message || tokenData.error || "Could not start voice practice.");
      }
      // Freeze the owned revision resolved before the lease. The call and the
      // report re-check these selectors; later setup edits cannot change this run.
      voiceContextRef.current = { ...voiceContextRef.current, ...tokenData.selection };
      reportContextRef.current = { ...voiceContextRef.current, voiceContext: true };
      const sessionId = tokenData.sessionId;
      if (!sessionId) {
        throw new Error("Voice session could not be reserved.");
      }
      sessionIdRef.current = sessionId;
      assertActive();
      setReservedSeconds(tokenData.reservedSeconds ?? null);

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
      assertActive();
      mediaStream.getTracks().forEach((track) => pc.addTrack(track, mediaStream));

      const dataChannel = pc.createDataChannel("oai-events");
      dataChannelRef.current = dataChannel;
      dataChannel.onmessage = handleDataChannelMessage;
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
      assertActive();
      await pc.setLocalDescription(offer);
      if (!offer.sdp) throw new Error("Could not create voice offer.");

      const sdpRes = await fetch(
        `/api/interview-voice/call?sessionId=${encodeURIComponent(sessionId)}`,
        {
          method: "POST",
          body: JSON.stringify({ sdp: offer.sdp, context: voiceContextRef.current }),
          headers: { "Content-Type": "application/json" },
        }
      );
      if (!sdpRes.ok) {
        let message = "Realtime voice connection failed.";
        try {
          const errData = await sdpRes.clone().json();
          message = errData.message || errData.error || message;
        } catch {}
        throw new Error(message);
      }

      await pc.setRemoteDescription({
        type: "answer",
        sdp: await sdpRes.text(),
      });

      assertActive();
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
      trackProgress("interview_started", { mode: "voice" });
    } catch (err: any) {
      cleanupVoiceConnection();
      convSessionIdRef.current = null;
      void endServerSession();
      setStatus("error");
      setError(err?.message || "Voice practice could not start.");
    }
  }

  const showCaptions = status === "live" || captions.length > 0 || partial;

  return (
    <div className="border border-t-steel bg-t-panel p-5">
      <audio ref={audioRef} autoPlay className="hidden" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-t-steel">Live voice practice</h2>
          <p className="text-sm text-t-phos-dim">
            Talk out loud with a realtime AI interviewer using gpt-realtime-2.
          </p>
          <p className="mt-1 text-xs text-t-phos-dim">
            Voice practice runs through OpenAI. They may keep audio and
            transcripts for up to 30 days for abuse monitoring, then delete
            them. We do not store your audio.
          </p>
          <p className="mt-1 text-xs text-t-phos-dim">
            Prefer to read along? Live captions show below while you talk. You
            can also use the text interview instead.
          </p>
          <div aria-live="polite" role="status">
            {status === "connecting" && (
              <p className="mt-1 text-xs font-medium text-t-phos-dim">Connecting...</p>
            )}
            {status === "live" && (
              <p className="mt-1 text-xs font-medium text-t-amber-bright">
                Live now. Speak naturally; end the session when you are done.
                {reservedSeconds != null &&
                  ` You have up to ${Math.round(reservedSeconds / 60)} minutes this session.`}
              </p>
            )}
            {generating && (
              <TroyWork topic="interview" label="Building feedback from your captured answers" />
            )}
            {status === "error" && error && (
              <p className="mt-1 text-xs font-medium text-t-red">{error}</p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {status === "live" ? (
            <button
              onClick={stopVoicePractice}
              disabled={finishing}
              className="t-focus inline-flex min-h-touch items-center justify-center bg-t-panel-2 px-5 py-3 text-sm font-medium text-t-red border border-t-red hover:bg-t-red/10"
            >
              {finishing ? "Finishing captured answers..." : "End & get feedback"}
            </button>
          ) : (
            <button
              onClick={startVoicePractice}
              disabled={!enabled || !consentReady || consentBusy || finishing || status === "connecting" || generating || !!reportError}
              className="t-focus inline-flex min-h-touch items-center justify-center bg-t-steel px-5 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
            >
              {status === "connecting" ? "Connecting..." : "Start live voice"}
            </button>
          )}
          {status !== "live" && reservedSeconds != null && (
            <p className="text-xs text-t-phos-dim">
              Up to {Math.round(reservedSeconds / 60)} minutes today.
            </p>
          )}
        </div>
      </div>

      {saveWarning && <p role="alert" className="mt-3 text-sm text-t-amber-bright">{saveWarning}</p>}
      {reportError && (
        <div className="mt-4" role="alert">
          <p className="text-sm text-t-red">{reportError}</p>
          <button type="button" disabled={generating} onClick={() => void finishSavedVoice(turnsRef.current.slice())} className="t-focus min-h-touch border border-t-steel px-4 py-2 text-sm text-t-white disabled:opacity-40">
            Retry feedback
          </button>
        </div>
      )}
      {status === "live" && <p className="mt-3 text-xs text-t-phos-dim">{savingOn ? "Text saving is on for this practice." : "Text saving is off. You can still get feedback when you end."}</p>}
      {/* Saving is chosen before the call; feedback does not require saving. */}
      {status !== "live" && (
        <div className="mt-4 border-t border-t-line pt-4">
          <p className="text-sm font-medium text-t-white mb-1">Save this voice practice?</p>
          <p className="text-xs text-t-phos-dim leading-relaxed mb-3">
            Saving is selected for your first practice unless you previously turned
            it off. You can turn it off below. Saved transcripts are text only,
            encrypted and private to your account. Feedback is available either
            way. We never save the audio. Delete saved practice in Settings.
          </p>
          <label className="flex items-start gap-2 mb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={savingOn}
              onChange={(e) => handleSaveToggle(e.target.checked, false)}
              className="mt-1"
              disabled={alwaysAllow || !consentReady || consentBusy || finishing || generating || !!reportError || status === "connecting"}
            />
            <span className="text-sm text-t-white">
              Save this voice practice
              <span className="block text-xs text-t-phos-dim">
                Turning this off remembers your choice. Turning it on here saves only this run.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={alwaysAllow}
              disabled={!consentReady || consentBusy || finishing || generating || !!reportError || status === "connecting"}
              onChange={(e) => handleSaveToggle(e.target.checked, true)}
              className="mt-1"
            />
            <span className="text-sm text-t-white">
              Always save my voice practice
              <span className="block text-xs text-t-phos-dim">
                Keeps saving on until you turn it off here or in Settings.
              </span>
            </span>
          </label>
          {!savingOn && (
            <p className="text-xs text-t-phos-dim mt-2">
              With saving off, your transcript and feedback stay in this tab.
              We keep basic practice progress. Leaving the page clears the report.
            </p>
          )}
        </div>
      )}

      {/* Phase 5.7 accessibility -- live captions of the conversation. */}
      {showCaptions && (
        <div className="mt-4 border-t border-t-line pt-4">
          <p className="text-xs font-medium text-t-steel mb-2">Live captions</p>
          <div
            aria-live="polite"
            role="log"
            className="max-h-40 overflow-y-auto space-y-2 bg-t-panel-2 border border-t-line p-3"
          >
            {captions.length === 0 && !partial && (
              <p className="text-xs text-t-phos-dim">
                Captions will appear here as you and the interviewer speak.
              </p>
            )}
            {captions.map((c, i) => (
              <p key={i} className="text-xs leading-relaxed">
                <span
                  className={c.role === "user" ? "text-t-amber-bright" : "text-t-steel"}
                >
                  {c.role === "user" ? "You" : "Interviewer"}:
                </span>{" "}
                <span className="text-t-white">{c.text}</span>
              </p>
            ))}
            {partial && (
              <p className="text-xs leading-relaxed text-t-phos-dim">
                <span className="text-t-steel">Interviewer:</span> {partial}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Phase 5.8: saved voice-interview sessions, with a decrypted detail view --
 *  same pattern as the disclosure rehearsal history. Only sessions the user
 *  chose to save appear here. */
function VoiceSessionHistory({ history }: { history: VoiceSessionMeta[] }) {
  const [detail, setDetail] = useState<{ id: string; transcript: Array<{ role: string; text: string }>; report: SavedVoiceReport | null; reportStatus: string } | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<{ id: string; message: string } | null>(null);
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current++; }, []);

  async function openDetail(id: string) {
    const request = ++sequence.current;
    setDetail(null);
    setLoadError(null);
    setLoadingId(id);
    try {
      const response = await fetch(`/api/conversation/session/${id}?purpose=${VOICE_PURPOSE}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const data = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(data?.transcript)) throw new Error();
      if (request === sequence.current) setDetail({ id, transcript: data.transcript, report: data.report ?? null, reportStatus: data.reportStatus || "missing" });
    } catch { if (request === sequence.current) setLoadError({ id, message: "This saved practice could not be opened. Try again." }); }
    finally { if (request === sequence.current) setLoadingId(null); }
  }
  function closeDetail() { sequence.current++; setDetail(null); setLoadingId(null); setLoadError(null); }
  if (history.length === 0) return null;
  return (
    <div className="mt-8">
      <h2 className="font-semibold text-t-white mb-1">Your saved voice practice</h2>
      <p className="text-xs text-t-phos-dim mb-3">Open a saved practice to read its feedback and text transcript. Older sessions may have only a transcript and a short summary. Transcript text is encrypted in your account. We do not save audio.</p>
      <div className="space-y-2">
        {history.map((session) => {
          const role = typeof session.target_context?.role === "string" ? session.target_context.role : "an interview";
          const when = new Date(session.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          const tags = knownStruggleTags(session.struggle_tags);
          const opened = detail?.id === session.id;
          return <div key={session.id} className="bg-t-panel border border-t-line px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-sm text-t-white font-medium">Voice practice for {role}</p><p className="text-xs text-t-phos-dim">{when}</p></div>
              <button onClick={() => opened ? closeDetail() : void openDetail(session.id)} disabled={loadingId === session.id} aria-expanded={opened} className="t-focus min-h-touch text-sm font-medium text-t-amber-bright hover:text-t-amber">{loadingId === session.id ? "Opening..." : opened ? "Close practice" : "Open practice"}</button>
            </div>
            {tags.length > 0 && <p className="text-xs text-t-phos mt-2"><span className="text-t-amber-bright">Working on:</span> {tags.map(struggleTagLabel).filter(Boolean).join(", ")}</p>}
            {loadError?.id === session.id && <p role="alert" className="mt-3 text-sm text-t-red">{loadError.message}</p>}
            {opened && <div className="mt-3 space-y-4 border-t border-t-line pt-3">
              {detail.report ? <SavedVoiceFeedback feedback={detail.report.feedback} /> : <div className="text-sm text-t-phos-dim">
                <p>{detail.reportStatus === "unavailable" ? "Your transcript opened, but the saved report could not be loaded." : "There is no full report linked to this practice. It may be an older session, or its report was not saved."}</p>
                {detail.reportStatus === "unavailable" && <button onClick={() => void openDetail(session.id)} className="t-focus min-h-touch text-t-amber-bright underline">Retry loading report</button>}
                {typeof session.takeaways?.overall === "string" && <p className="mt-2">Saved summary: {session.takeaways.overall}</p>}
                {typeof session.takeaways?.frame === "string" && <p className="mt-2">{session.takeaways.frame}</p>}
              </div>}
              <section aria-label="Practice transcript"><h3 className="font-semibold text-t-white mb-2">Transcript</h3>
                {detail.transcript.length === 0 && <p className="text-sm text-t-phos-dim">No transcript text was saved for this practice.</p>}
                {detail.transcript.map((chunk, index) => <div key={index} className="mb-3 text-sm"><p className="font-semibold text-t-amber-bright">{chunk.role === "user" ? "You" : "Interviewer"}</p><p className="whitespace-pre-wrap text-t-phos">{chunk.text}</p></div>)}
              </section>
            </div>}
          </div>;
        })}
      </div>
    </div>
  );
}
function SavedVoiceFeedback({ feedback }: { feedback: InterviewFeedback }) {
  return <section aria-label="Saved practice report" className="space-y-3 text-sm text-t-phos">
    <h3 className="font-semibold text-t-white">Your practice report</h3>
    <p>{feedback.overall}</p>
    <div><h4 className="font-semibold text-t-white">What worked</h4><ul className="list-disc pl-5">{feedback.strengths.map((text, index) => <li key={index}>{text}</li>)}</ul></div>
    <div><h4 className="font-semibold text-t-white">What to practice next</h4><ul className="list-disc pl-5">{feedback.improvements.map((text, index) => <li key={index}>{text}</li>)}</ul></div>
    {feedback.frame && <div><h4 className="font-semibold text-t-white">What to carry into your interview</h4><p>{feedback.frame}</p></div>}
    {feedback.disclosure_notes && <div><h4 className="font-semibold text-t-white">Disclosure practice</h4><p>{feedback.disclosure_notes}</p></div>}
    {!!feedback.better_answers?.length && <div><h4 className="font-semibold text-t-white">Answers to practice</h4>{feedback.better_answers.map((answer, index) => <div key={index} className="mt-2"><p className="font-medium">{answer.question}</p><p>{answer.model_answer}</p></div>)}</div>}
  </section>;
}
