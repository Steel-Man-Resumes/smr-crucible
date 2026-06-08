"use client";

/**
 * Page 7: The Forge Output
 *
 * Narrative, not report. User's life reframed through redemption lens.
 * Reflects user's own words back, reorganized, affirmed.
 * Sections: Strengths -> Skills -> Barriers (with resources) -> Career paths -> Documents -> Next steps
 * Never scored, never graded.
 * Downloadable (analysis text + resume DOCX + cover letter DOCX), saveable to dashboard.
 * Gateway to Refinery: value-based invitation, not fear-based conversion.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { getOpusMessage } from "@/lib/opus-messages";
import { GhostGuide } from "@crucible/consumer-ui";

interface Strength {
  title: string;
  evidence: string;
  source: string;
}

interface Skill {
  name: string;
  category: string;
}

interface Resource {
  name: string;
  type: string;
  description: string;
  url?: string;
}

interface Barrier {
  type: string;
  user_narrative?: string;
  resources: Resource[];
  legal_notes?: string;
}

interface CareerPath {
  title: string;
  industry?: string;
  match_reason: string;
  salary_range?: string;
  next_steps: string[];
}

interface ForgeOutput {
  narrative?: {
    headline?: string;
    summary?: string;
    reflection?: string;
    strengths?: Strength[];
  };
  readiness_stage?: string;
  strengths?: Strength[];
  skills?: Skill[];
  barriers?: Barrier[];
  career_paths?: CareerPath[];
}

type DocGenState = "idle" | "generating" | "done" | "error";
type ResumeViewMode = "preview" | "text";

/** Readiness-aware messaging for the output page */
const READINESS_CONFIG: Record<string, {
  docsHeading: string;
  docsSubtext: string;
  refineryHeading: string;
  refineryBody: string;
  refineryCta: string;
  refinerySubtext: string;
  careersHeading: string;
  strengthsHeading: string;
  reflectionLabel: string;
}> = {
  precontemplation: {
    docsHeading: "Your Resume Draft",
    docsSubtext: "This is a starting point. When you are ready to polish it, The Refinery has tools built for that.",
    refineryHeading: "This is yours whenever you need it",
    refineryBody: "Create a free account to save your results. No pressure, no timeline. When you are ready to take the next step, everything will be here.",
    refineryCta: "Save My Results",
    refinerySubtext: "Free. No credit card. Come back anytime.",
    careersHeading: "Paths Worth Knowing About",
    strengthsHeading: "What You Bring",
    reflectionLabel: "A note from t.ROY",
  },
  contemplation: {
    docsHeading: "Your Resume Draft",
    docsSubtext: "A solid starting point. The Refinery can help you sharpen it for specific jobs when you are ready.",
    refineryHeading: "Ready to keep building?",
    refineryBody: "Save your results and get access to The Refinery, where you can target specific jobs, practice interviews, and plan your disclosure strategy.",
    refineryCta: "Save & Explore The Refinery",
    refinerySubtext: "Free. No credit card. No catch.",
    careersHeading: "Career Paths to Consider",
    strengthsHeading: "Your Strengths",
    reflectionLabel: "A note from t.ROY",
  },
  preparation: {
    docsHeading: "Your Documents",
    docsSubtext: "Resume and cover letter ready to customize. Replace [Company Name] and [Hiring Manager] before sending.",
    refineryHeading: "Take the next step",
    refineryBody: "Save your results and unlock The Refinery: targeted resume versions, interview practice, disclosure planning, and a job board filtered for fair-chance employers.",
    refineryCta: "Continue to The Refinery",
    refinerySubtext: "Free. No credit card. Your results carry over.",
    careersHeading: "Career Paths That Fit",
    strengthsHeading: "Your Strengths",
    reflectionLabel: "A reflection",
  },
  action: {
    docsHeading: "Your Documents",
    docsSubtext: "Download, customize, and send. Replace [Company Name] and [Hiring Manager] with the real employer.",
    refineryHeading: "Get 10x more in The Refinery",
    refineryBody: "Your Forge results are the foundation. The Refinery gives you targeted resume versions for each job, AI interview practice, disclosure strategy for your specific record, and a fair-chance job board.",
    refineryCta: "Start Using The Refinery",
    refinerySubtext: "Free. No credit card. Built for exactly where you are right now.",
    careersHeading: "Career Paths That Fit",
    strengthsHeading: "Your Competitive Advantages",
    reflectionLabel: "A reflection",
  },
};

export default function OutputPage() {
  const router = useRouter();
  const { session } = useForgeSession();
  const isDemo = session.isDemo === true;
  const audience = session.audience || "client";
  const output = (session.forgeOutput as ForgeOutput) || {};

  const readiness = output.readiness_stage || session.readinessStage || "preparation";
  const rc = READINESS_CONFIG[readiness] || READINESS_CONFIG.preparation;

  const narrative = output.narrative || {};
  const strengths = output.strengths || narrative.strengths || [];
  const skills = output.skills || [];
  const barriers = output.barriers || [];
  const careerPaths = output.career_paths || [];

  // Prevent double-submission on mount
  const hasStarted = useRef(false);

  // Document generation state
  const [docState, setDocState] = useState<DocGenState>("idle");
  const [resumeText, setResumeText] = useState<string>("");
  const [coverLetterText, setCoverLetterText] = useState<string>("");
  const [docError, setDocError] = useState<string>("");
  const [downloading, setDownloading] = useState<string>("");
  const [copied, setCopied] = useState<string>("");
  const [resumeViewMode, setResumeViewMode] = useState<ResumeViewMode>("preview");

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  };

  const generateDocs = useCallback(async () => {
    if (hasStarted.current) return;
    if (docState === "generating" || docState === "done") return;
    hasStarted.current = true;
    setDocState("generating");
    setDocError("");

    try {
      const response = await fetch("/api/forge/generate-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          narrative: output.narrative,
          strengths: output.strengths,
          skills: output.skills,
          career_paths: output.career_paths,
          barriers: output.barriers,
          resumeText: session.resumeText,
          goals: session.goals,
          goalNarrative: session.goalNarrative,
          preferences: session.preferences,
          readinessStage: session.readinessStage,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Document generation failed");
      }

      const data = await response.json();
      setResumeText(data.resume || "");
      setCoverLetterText(data.coverLetter || "");
      setDocState("done");
    } catch (err: any) {
      console.error("Doc generation error:", err);
      setDocError("Something went wrong generating your documents.");
      setDocState("error");
      hasStarted.current = false;
    }
  }, [docState, output, session.resumeText, session.goals, session.goalNarrative, session.preferences]);

  // Auto-trigger document generation when output page loads
  useEffect(() => {
    if (session.forgeOutput && docState === "idle") {
      generateDocs();
    }
  }, [session.forgeOutput, docState, generateDocs]);

  const handleDownload = async (type: "resume" | "cover_letter") => {
    const content = type === "resume" ? resumeText : coverLetterText;
    if (!content) return;

    setDownloading(type);
    try {
      const response = await fetch("/api/forge/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, type, format: "docx" }),
      });

      if (!response.ok) throw new Error("Download failed");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        type === "resume"
          ? "My_Resume_SteelMan.docx"
          : "My_CoverLetter_SteelMan.docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download error:", err);
    } finally {
      setDownloading("");
    }
  };

  function handlePrintResumePdf() {
    if (!resumeText) return;
    const html = resumeTextToStandaloneHtml(resumeText);
    const w = window.open("", "_blank");
    if (!w) { alert("Please allow popups for this site to save the PDF."); return; }
    w.document.write(html);
    w.document.close();
  }

  function handlePrintAnalysisPdf() {
    const html = analysisToStandaloneHtml(output, narrative);
    const w = window.open("", "_blank");
    if (!w) { alert("Please allow popups for this site to save the PDF."); return; }
    w.document.write(html);
    w.document.close();
  }

  // If no output, redirect back
  if (!session.forgeOutput) {
    return (
      <div className="flow-center min-h-screen flex flex-col items-center justify-center text-center">
        <h1 className="text-2xl font-bold mb-4">
          Let&apos;s build your story first
        </h1>
        <p className="text-body text-muted mb-6">
          It looks like we haven&apos;t analyzed your information yet.
        </p>
        <button
          onClick={() => router.push("/welcome")}
          className="px-8 py-4 bg-sage-600 text-white rounded-xl text-lg font-medium hover:bg-sage-700 transition-colors min-h-touch"
        >
          Start The Forge
        </button>
      </div>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8 sm:px-6 sm:py-12">
      <GhostGuide
        message={getOpusMessage("output", audience, isDemo)}
        pageId="output"
      />

      {isDemo && (
        <div className="bg-amber-50 rounded-xl px-5 py-4 mb-8 border border-amber-200 text-center">
          <p className="text-sm text-amber-800 font-medium">
            This is a sample output — try it with your own data
          </p>
          <button
            onClick={() => router.push("/welcome")}
            className="mt-2 text-sm text-sage-600 underline underline-offset-2 hover:text-sage-700"
          >
            Start your own Forge session
          </button>
        </div>
      )}

      {/* Section jump nav */}
      <nav className="flex flex-wrap gap-2 justify-center mb-10" aria-label="Jump to section">
        {strengths.length > 0 && (
          <a href="#strengths" className="px-3 py-1.5 text-xs font-medium text-sage-600 bg-sage-50 border border-sage-200 rounded-lg hover:bg-sage-100 transition-colors">
            {rc.strengthsHeading}
          </a>
        )}
        {skills.length > 0 && (
          <a href="#skills" className="px-3 py-1.5 text-xs font-medium text-sage-600 bg-sage-50 border border-sage-200 rounded-lg hover:bg-sage-100 transition-colors">
            Skills
          </a>
        )}
        {careerPaths.length > 0 && (
          <a href="#careers" className="px-3 py-1.5 text-xs font-medium text-sage-600 bg-sage-50 border border-sage-200 rounded-lg hover:bg-sage-100 transition-colors">
            {rc.careersHeading}
          </a>
        )}
        <a href="#documents" className="px-3 py-1.5 text-xs font-medium text-white bg-sage-600 rounded-lg hover:bg-sage-700 transition-colors">
          {rc.docsHeading}
        </a>
      </nav>

      {/* Header / Narrative */}
      <section className="mb-12 text-center">
        <h1 className="text-3xl font-bold text-foreground mb-4">
          {narrative.headline || "Your Story, Reforged"}
        </h1>
        {narrative.summary && (
          <p className="text-body text-foreground leading-relaxed max-w-xl mx-auto mb-4">
            {narrative.summary}
          </p>
        )}
        {narrative.reflection && (
          <p className="text-sm text-sage-600 italic max-w-md mx-auto">
            {narrative.reflection}
          </p>
        )}
      </section>

      {/* Strengths */}
      {strengths.length > 0 && (
        <section id="strengths" className="mb-10 scroll-mt-20">
          <h2 className="text-xl font-bold text-foreground mb-4">
            {rc.strengthsHeading}
          </h2>
          <div className="space-y-3">
            {strengths.map((s, i) => (
              <div
                key={i}
                className="bg-sage-50 rounded-xl p-5 border border-sage-200"
              >
                <h3 className="font-semibold text-sage-800">{s.title}</h3>
                <p className="text-sm text-sage-700 mt-1">{s.evidence}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Skills */}
      {skills.length > 0 && (
        <section id="skills" className="mb-10 scroll-mt-20">
          <h2 className="text-xl font-bold text-foreground mb-4">
            Skills We Found
          </h2>
          <div className="flex flex-wrap gap-2">
            {skills.map((s, i) => (
              <span
                key={i}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  s.category === "hard"
                    ? "bg-sky-100 text-sky-700"
                    : s.category === "soft"
                      ? "bg-warm-100 text-warm-700"
                      : "bg-sage-100 text-sage-700"
                }`}
              >
                {s.name}
              </span>
            ))}
          </div>
          <div className="flex gap-4 mt-3 text-xs text-muted">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-sky-300" /> Technical
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-warm-300" /> People
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-sage-300" />{" "}
              Transferable
            </span>
          </div>
        </section>
      )}

      {/* Barriers with Resources */}
      {barriers.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-foreground mb-4">
            Your Hurdles, and What Can Help
          </h2>
          <div className="space-y-4">
            {barriers.map((b, i) => (
              <div
                key={i}
                className="bg-warm-50 rounded-xl p-5 border border-warm-200"
              >
                <h3 className="font-semibold text-earth-800 capitalize">
                  {b.type.replace(/_/g, " ")}
                </h3>
                {b.user_narrative && (
                  <p className="text-sm text-earth-600 mt-1 italic">
                    &ldquo;{b.user_narrative}&rdquo;
                  </p>
                )}
                {b.legal_notes && (
                  <p className="text-sm text-sky-700 mt-2 bg-sky-50 rounded-lg px-3 py-2">
                    {b.legal_notes}
                  </p>
                )}
                {b.resources.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium text-muted uppercase tracking-wide">
                      Resources
                    </p>
                    {b.resources.map((r, j) => (
                      <div
                        key={j}
                        className="bg-white rounded-lg px-4 py-3 border border-border"
                      >
                        <p className="font-medium text-sm">{r.name}</p>
                        <p className="text-xs text-muted mt-0.5">
                          {r.description}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Career Paths */}
      {careerPaths.length > 0 && (
        <section id="careers" className="mb-10 scroll-mt-20">
          <h2 className="text-xl font-bold text-foreground mb-4">
            {rc.careersHeading}
          </h2>
          <div className="space-y-4">
            {careerPaths.map((cp, i) => (
              <div
                key={i}
                className="bg-white rounded-xl p-5 border border-border"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-foreground">
                      {cp.title}
                    </h3>
                    {cp.industry && (
                      <p className="text-sm text-muted">{cp.industry}</p>
                    )}
                  </div>
                  {cp.salary_range && (
                    <span className="text-sm font-medium text-sage-600 whitespace-nowrap">
                      {cp.salary_range}
                    </span>
                  )}
                </div>
                <p className="text-sm text-foreground mt-2">
                  {cp.match_reason}
                </p>
                {cp.next_steps.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-muted uppercase tracking-wide mb-1">
                      Next Steps
                    </p>
                    <ol className="text-sm text-muted space-y-1 list-decimal list-inside">
                      {cp.next_steps.map((step, j) => (
                        <li key={j}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Your Documents */}
      <section id="documents" className="mb-10 scroll-mt-20">
        <h2 className="text-xl font-bold text-foreground mb-4">
          {rc.docsHeading}
        </h2>

        {docState === "generating" && (
          <div className="bg-sage-50 rounded-2xl p-8 border border-sage-200 text-center">
            <div className="w-10 h-10 mx-auto mb-4 relative">
              <div className="absolute inset-0 border-3 border-sage-200 rounded-full" />
              <div className="absolute inset-0 border-3 border-sage-600 rounded-full border-t-transparent animate-spin" />
            </div>
            <p className="text-sm font-medium text-sage-700">
              Generating your resume and cover letter...
            </p>
            <p className="text-xs text-muted mt-1">
              This usually takes 30-60 seconds
            </p>
          </div>
        )}

        {docState === "error" && (
          <div className="bg-warm-50 rounded-2xl p-6 border border-warm-200 text-center">
            <p className="text-sm text-earth-700 mb-3">{docError}</p>
            <button
              onClick={() => {
                setDocState("idle");
                generateDocs();
              }}
              className="px-6 py-3 bg-sage-600 text-white rounded-xl text-sm font-medium hover:bg-sage-700 transition-colors min-h-touch"
            >
              Try Again
            </button>
          </div>
        )}

        {docState === "done" && (
          <div className="space-y-4">
            {/* Resume */}
            {resumeText && (
              <div className="bg-white rounded-xl border border-border overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 bg-sage-50 border-b border-border">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-sage-800 text-sm">Resume</h3>
                    <div className="flex rounded-lg border border-sage-200 overflow-hidden text-xs">
                      <button
                        onClick={() => setResumeViewMode("preview")}
                        className={`px-2.5 py-1 font-medium transition-colors ${resumeViewMode === "preview" ? "bg-sage-600 text-white" : "bg-white text-sage-600 hover:bg-sage-50"}`}
                      >
                        Preview
                      </button>
                      <button
                        onClick={() => setResumeViewMode("text")}
                        className={`px-2.5 py-1 font-medium transition-colors ${resumeViewMode === "text" ? "bg-sage-600 text-white" : "bg-white text-sage-600 hover:bg-sage-50"}`}
                      >
                        Plain text
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end">
                    <button
                      onClick={() => handleCopy(resumeText, "resume")}
                      className="px-3 py-1.5 text-xs font-medium text-sage-600 bg-white border border-sage-200 rounded-lg hover:bg-sage-50 transition-colors"
                    >
                      {copied === "resume" ? "Copied!" : "Copy"}
                    </button>
                    <button
                      onClick={handlePrintResumePdf}
                      className="px-3 py-1.5 text-xs font-medium text-sage-600 bg-white border border-sage-200 rounded-lg hover:bg-sage-50 transition-colors"
                    >
                      Save as PDF
                    </button>
                    <button
                      onClick={() => handleDownload("resume")}
                      disabled={downloading === "resume"}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-sage-600 rounded-lg hover:bg-sage-700 transition-colors disabled:opacity-50"
                    >
                      {downloading === "resume" ? "Downloading..." : "Download .docx"}
                    </button>
                  </div>
                </div>
                <div className={resumeViewMode === "preview" ? "p-4 overflow-y-auto max-h-[600px]" : "p-5 max-h-80 overflow-y-auto"}>
                  {resumeViewMode === "preview" ? (
                    <ResumePreview text={resumeText} />
                  ) : (
                    <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">
                      {resumeText}
                    </pre>
                  )}
                </div>
              </div>
            )}

            {/* Cover Letter */}
            {coverLetterText && (
              <div className="bg-white rounded-xl border border-border overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 bg-sage-50 border-b border-border">
                  <h3 className="font-semibold text-sage-800 text-sm">
                    Cover Letter
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCopy(coverLetterText, "cover")}
                      className="px-3 py-1.5 text-xs font-medium text-sage-600 bg-white border border-sage-200 rounded-lg hover:bg-sage-50 transition-colors"
                    >
                      {copied === "cover" ? "Copied!" : "Copy"}
                    </button>
                    <button
                      onClick={() => handleDownload("cover_letter")}
                      disabled={downloading === "cover_letter"}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-sage-600 rounded-lg hover:bg-sage-700 transition-colors disabled:opacity-50"
                    >
                      {downloading === "cover_letter"
                        ? "Downloading..."
                        : "Download .docx"}
                    </button>
                  </div>
                </div>
                <div className="p-5 max-h-80 overflow-y-auto">
                  <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">
                    {coverLetterText}
                  </pre>
                </div>
              </div>
            )}

            <div className="mt-2 text-center space-y-1">
              <p className="text-xs text-muted">
                <strong>Save as PDF</strong> -- preserves the exact formatting you see above. Best for sharing and submitting.
                &nbsp;<strong>Download .docx</strong> -- opens in Word or Google Docs so you can edit if anything needs adjusting.
              </p>
              <p className="text-xs text-muted">{rc.docsSubtext}</p>
            </div>
          </div>
        )}

        {docState === "idle" && (
          <div className="bg-sage-50 rounded-2xl p-6 border border-sage-200 text-center">
            <p className="text-sm text-muted mb-3">
              Ready to generate your resume and cover letter from the analysis
              above.
            </p>
            <button
              onClick={generateDocs}
              className="px-6 py-3 bg-sage-600 text-white rounded-xl text-sm font-medium hover:bg-sage-700 transition-colors min-h-touch"
            >
              Generate Documents
            </button>
          </div>
        )}
      </section>

      {/* What's next -- journey explainer + CTA */}
      <section className="border-t border-border pt-8">

        {/* 3-step journey indicator */}
        <div className="flex items-center gap-1 mb-6">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="w-6 h-6 rounded-full bg-sage-600 flex items-center justify-center flex-shrink-0">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-xs font-semibold text-sage-700 whitespace-nowrap">The Forge</span>
          </div>
          <div className="flex-1 h-px bg-sage-300 mx-1" />
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="w-6 h-6 rounded-full border-2 border-sage-600 text-sage-600 flex items-center justify-center flex-shrink-0 text-xs font-bold">2</div>
            <span className="text-xs font-semibold text-foreground whitespace-nowrap">Create account</span>
          </div>
          <div className="flex-1 h-px bg-border mx-1" />
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="w-6 h-6 rounded-full border-2 border-border text-muted flex items-center justify-center flex-shrink-0 text-xs font-bold">3</div>
            <span className="text-xs font-semibold text-muted whitespace-nowrap">The Refinery</span>
          </div>
        </div>

        {/* Journey explanation */}
        <div className="bg-sage-50 rounded-2xl p-6 border border-sage-200 mb-4">
          <h3 className="font-bold text-foreground text-lg mb-3 leading-snug">
            You&apos;re done with this part. You won&apos;t come back here.
          </h3>
          <p className="text-sm text-muted leading-relaxed mb-3">
            When you create your free account, everything you just built is automatically
            waiting in The Refinery: your resume, your career narrative, your strengths,
            your documents -- all pre-loaded, nothing to re-enter.
          </p>
          <p className="text-sm text-muted leading-relaxed">
            The Refinery is where the real work happens. Target your resume for specific jobs,
            practice interview questions, plan your disclosure strategy, and browse a job board
            filtered for fair-chance employers -- all built on what you just created here.
          </p>
        </div>

        {/* Primary CTA */}
        <button
          onClick={() => router.push("/login?from=forge")}
          className="w-full px-6 py-4 bg-sage-600 text-white rounded-xl font-semibold text-base hover:bg-sage-700 transition-colors min-h-touch mb-2"
        >
          {rc.refineryCta}
        </button>
        <p className="text-xs text-muted text-center mb-6">{rc.refinerySubtext}</p>

        {/* Secondary: downloads */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handlePrintAnalysisPdf}
            className="flex-1 px-4 py-3 bg-white border border-border text-muted rounded-xl text-sm font-medium hover:border-sage-300 hover:text-foreground transition-colors"
          >
            Print / save analysis as PDF
          </button>
        </div>
      </section>
    </main>
  );
}

// ─── Resume Preview (mirrors the TORI DOCX format visually) ─────────────────

const PREVIEW_SECTION_HEADERS = new Set([
  "PROFESSIONAL SUMMARY", "CAREER SUMMARY", "SUMMARY",
  "CORE COMPETENCIES", "CORE SKILLS", "KEY QUALIFICATIONS", "AREAS OF EXPERTISE", "TECHNICAL SKILLS",
  "PROFESSIONAL EXPERIENCE", "EXPERIENCE", "WORK HISTORY", "RELEVANT EXPERIENCE",
  "EDUCATION", "EDUCATION & CREDENTIALS", "EDUCATION & CERTIFICATIONS",
  "CERTIFICATIONS", "LICENSES & CERTIFICATIONS",
  "SKILLS", "MILITARY SERVICE", "VOLUNTEER EXPERIENCE",
  "JUSTICE ADVOCACY & COMMUNITY IMPACT", "COMMUNITY IMPACT",
]);

function isPreviewSectionHeader(text: string): boolean {
  return PREVIEW_SECTION_HEADERS.has(text.toUpperCase().replace(/[^A-Z\s&]/g, "").trim());
}

function ResumePreview({ text }: { text: string }) {
  const lines = text.split("\n");

  // Parse header block (name, headline, contact)
  const headerLines: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { if (headerLines.length > 0) break; continue; }
    if (isPreviewSectionHeader(t)) break;
    if (headerLines.length < 4) headerLines.push(t);
    else break;
  }

  const nameLine = headerLines[0] || "";
  const headlineLine = headerLines.length > 2 ? headerLines[1] : "";
  const contactLine =
    headerLines.find((l) => l.includes("|") || l.includes("@") || l.includes("•")) ||
    (headerLines.length > 1 ? headerLines[1] : "");

  // Parse body
  const headerSet = new Set(headerLines.map((l) => l.trim()));
  let pastHeader = false;
  const bodyNodes: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (!pastHeader) {
      if (headerSet.has(trimmed) || !trimmed) {
        if (headerSet.has(trimmed)) headerSet.delete(trimmed);
        if (headerSet.size === 0) pastHeader = true;
        continue;
      }
      pastHeader = true;
    }

    if (!trimmed) {
      bodyNodes.push(<div key={i} className="h-1.5" />);
      continue;
    }

    // Section header
    if (isPreviewSectionHeader(trimmed)) {
      bodyNodes.push(
        <div key={i} className="mt-3 mb-1 pb-0.5 border-b-2" style={{ borderColor: "#1B2A4A" }}>
          <span className="font-bold text-xs" style={{ fontFamily: "Georgia, serif", color: "#1B2A4A" }}>
            {trimmed.toUpperCase()}
          </span>
        </div>
      );
      continue;
    }

    // Bullet
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ")) {
      const bullet = trimmed.replace(/^[-*•]\s*/, "");
      const parts = bullet.split(/(\d+[%$,.\d]*[KMB]?|\$[\d,.]+\s?[KMB]?)/gi);
      bodyNodes.push(
        <div key={i} className="flex gap-1.5 pl-3 mb-0.5 leading-snug">
          <span className="flex-shrink-0 text-xs font-bold" style={{ color: "#1B2A4A" }}>&bull;</span>
          <span className="text-xs" style={{ color: "#1a1a1a" }}>
            {parts.map((p, j) =>
              /\d/.test(p) ? <strong key={j}>{p}</strong> : p
            )}
          </span>
        </div>
      );
      continue;
    }

    // Competency line (3+ pipe/bullet separators)
    if ((trimmed.includes(" | ") || trimmed.includes(" • ")) && trimmed.split(/[|•]/).length >= 3) {
      bodyNodes.push(
        <div key={i} className="text-center text-xs font-bold mb-1" style={{ color: "#333333" }}>
          {trimmed}
        </div>
      );
      continue;
    }

    // Job title line (pipe-separated, no @)
    if (trimmed.includes("|") && !trimmed.includes("@")) {
      const parts = trimmed.split("|").map((p) => p.trim());
      bodyNodes.push(
        <div key={i} className="mt-2.5 mb-0.5 text-xs leading-snug">
          <span className="font-bold" style={{ color: "#1a1a1a" }}>{parts[0]}</span>
          {parts.slice(1).map((p, j) => (
            <span key={j} style={{ color: "#555555" }}>{"  |  "}{p}</span>
          ))}
        </div>
      );
      continue;
    }

    // Regular body text
    bodyNodes.push(
      <p key={i} className="text-xs leading-snug mb-0.5" style={{ color: "#1a1a1a" }}>
        {trimmed}
      </p>
    );
  }

  return (
    <div
      className="bg-white rounded shadow-md overflow-hidden border border-gray-200 mx-auto"
      style={{ maxWidth: 600, fontFamily: "Arial, sans-serif" }}
    >
      {/* Navy header block */}
      <div className="px-6 py-4 text-center" style={{ backgroundColor: "#1B2A4A" }}>
        {nameLine && (
          <p
            className="font-bold tracking-wide text-base"
            style={{ fontFamily: "Georgia, serif", color: "#FFFFFF" }}
          >
            {nameLine.toUpperCase()}
          </p>
        )}
        {headlineLine && headlineLine !== contactLine && (
          <p className="text-xs mt-0.5" style={{ color: "#B8C9E0" }}>{headlineLine}</p>
        )}
        {contactLine && (
          <p className="text-xs mt-0.5" style={{ color: "#FFFFFF" }}>{contactLine}</p>
        )}
      </div>
      {/* Body */}
      <div className="px-5 py-3">
        {bodyNodes}
      </div>
      <div className="px-5 pb-2 text-center">
        <p className="text-[10px] text-gray-400">Preview matches your .docx download</p>
      </div>
    </div>
  );
}

// ─── Print-to-PDF helpers ─────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function resumeTextToStandaloneHtml(text: string): string {
  const lines = text.split("\n");

  const headerLines: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { if (headerLines.length > 0) break; continue; }
    if (isPreviewSectionHeader(t)) break;
    if (headerLines.length < 4) headerLines.push(t);
    else break;
  }

  const nameLine = headerLines[0] || "";
  const headlineLine = headerLines.length > 2 ? headerLines[1] : "";
  const contactLine =
    headerLines.find((l) => l.includes("|") || l.includes("@") || l.includes("•")) ||
    (headerLines.length > 1 ? headerLines[1] : "");

  let headerHtml = `<div style="background:#1B2A4A;padding:20px 24px;text-align:center;">`;
  if (nameLine) headerHtml += `<p style="font-family:Georgia,serif;color:#FFF;font-size:18pt;font-weight:bold;text-transform:uppercase;letter-spacing:2px;margin:0;">${escHtml(nameLine)}</p>`;
  if (headlineLine && headlineLine !== contactLine) headerHtml += `<p style="color:#B8C9E0;font-size:11pt;margin:4px 0 0;">${escHtml(headlineLine)}</p>`;
  if (contactLine) headerHtml += `<p style="color:#FFF;font-size:10pt;margin:4px 0 0;">${escHtml(contactLine)}</p>`;
  headerHtml += `</div>`;

  const headerSet = new Set(headerLines.map((l) => l.trim()));
  let pastHeader = false;
  let bodyHtml = `<div style="padding:12px 20px;">`;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!pastHeader) {
      if (headerSet.has(trimmed) || !trimmed) {
        if (headerSet.has(trimmed)) headerSet.delete(trimmed);
        if (headerSet.size === 0) pastHeader = true;
        continue;
      }
      pastHeader = true;
    }
    if (!trimmed) { bodyHtml += `<div style="height:6px;"></div>`; continue; }

    if (isPreviewSectionHeader(trimmed)) {
      bodyHtml += `<div style="margin-top:12px;margin-bottom:4px;padding-bottom:2px;border-bottom:2px solid #1B2A4A;"><span style="font-family:Georgia,serif;color:#1B2A4A;font-size:11pt;font-weight:bold;">${escHtml(trimmed.toUpperCase())}</span></div>`;
      continue;
    }
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ")) {
      const bullet = trimmed.replace(/^[-*•]\s*/, "");
      const bHtml = bullet.replace(/(\d+[%$,.\d]*[KMB]?|\$[\d,.]+\s?[KMB]?)/gi, "<strong>$1</strong>");
      bodyHtml += `<div style="display:flex;gap:6px;padding-left:12px;margin-bottom:2px;line-height:1.4;"><span style="color:#1B2A4A;font-weight:bold;font-size:10pt;flex-shrink:0;">&bull;</span><span style="font-size:10pt;color:#1a1a1a;">${bHtml}</span></div>`;
      continue;
    }
    if ((trimmed.includes(" | ") || trimmed.includes(" • ")) && trimmed.split(/[|•]/).length >= 3) {
      bodyHtml += `<div style="text-align:center;font-size:10pt;font-weight:bold;margin-bottom:4px;color:#333;">${escHtml(trimmed)}</div>`;
      continue;
    }
    if (trimmed.includes("|") && !trimmed.includes("@")) {
      const parts = trimmed.split("|").map((p) => p.trim());
      const partsHtml = parts.map((p, i) =>
        i === 0 ? `<strong style="color:#1a1a1a;">${escHtml(p)}</strong>` : `<span style="color:#555;">&nbsp;&nbsp;|&nbsp;&nbsp;${escHtml(p)}</span>`
      ).join("");
      bodyHtml += `<div style="margin-top:10px;margin-bottom:2px;font-size:10pt;line-height:1.4;">${partsHtml}</div>`;
      continue;
    }
    bodyHtml += `<p style="font-size:10pt;line-height:1.4;margin-bottom:2px;color:#1a1a1a;">${escHtml(trimmed)}</p>`;
  }
  bodyHtml += `</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Resume -- Steel Man Resumes</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#fff}
@media print{@page{margin:0.5in;size:letter}body{margin:0}.no-print{display:none!important}}</style>
</head><body><div style="max-width:7.5in;margin:0 auto;background:#fff;">
${headerHtml}${bodyHtml}
<div class="no-print" style="padding:12px 20px;text-align:center;border-top:1px solid #eee;margin-top:16px;">
<p style="font-size:9pt;color:#999;">Steel Man Resumes -- steelmanresumes.com</p>
<p style="font-size:9pt;color:#aaa;">File &rsaquo; Print &rsaquo; Save as PDF to download</p></div>
</div><script>window.onload=function(){setTimeout(function(){window.print()},500)}</script>
</body></html>`;
}

function analysisToStandaloneHtml(
  output: ForgeOutput,
  narrative: Record<string, unknown>
): string {
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const headline = String(narrative.headline || "Your Career Profile");
  const summary = String(narrative.summary || "");
  const reflection = String(narrative.reflection || "");

  let body = "";

  if (summary) body += `<h2>Your Story</h2><p class="narrative">${escHtml(summary)}</p>`;
  if (reflection) body += `<p class="narrative">${escHtml(reflection)}</p>`;

  if (output.strengths?.length) {
    body += `<h2>Your Strengths</h2>`;
    for (const s of output.strengths) {
      body += `<div class="strength"><p class="strength-title">${escHtml(s.title)}</p><p>${escHtml(s.evidence)}</p></div>`;
    }
  }

  if (output.skills?.length) {
    const grouped: Record<string, string[]> = {};
    for (const sk of output.skills) {
      if (!grouped[sk.category]) grouped[sk.category] = [];
      grouped[sk.category].push(sk.name);
    }
    body += `<h2>Skills</h2>`;
    for (const [cat, names] of Object.entries(grouped)) {
      body += `<p><strong>${escHtml(cat)}:</strong> ${names.map(escHtml).join(", ")}</p>`;
    }
  }

  if (output.career_paths?.length) {
    body += `<h2>Career Paths</h2>`;
    for (const cp of output.career_paths) {
      body += `<div class="career-path">`;
      body += `<h3>${escHtml(cp.title)}${cp.salary_range ? ` <span style="font-weight:normal;color:#666;">(${escHtml(cp.salary_range)})</span>` : ""}</h3>`;
      body += `<p>${escHtml(cp.match_reason)}</p>`;
      if (cp.next_steps.length) {
        body += `<ul>${cp.next_steps.map((s) => `<li>${escHtml(s)}</li>`).join("")}</ul>`;
      }
      body += `</div>`;
    }
  }

  if (output.barriers?.length) {
    body += `<h2>Resources for Your Situation</h2>`;
    for (const b of output.barriers) {
      body += `<div class="career-path">`;
      body += `<h3>${escHtml(b.type.replace(/_/g, " "))}</h3>`;
      if (b.legal_notes) body += `<p><em>${escHtml(b.legal_notes)}</em></p>`;
      if (b.resources.length) {
        body += `<ul>${b.resources.map((r) => `<li><strong>${escHtml(r.name)}</strong> -- ${escHtml(r.description)}</li>`).join("")}</ul>`;
      }
      body += `</div>`;
    }
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Career Analysis -- Steel Man Resumes</title>
<style>
body{font-family:Georgia,serif;max-width:8in;margin:0 auto;padding:.5in;color:#1a1a1a}
.header{background:#1B2A4A;color:#fff;padding:24px;margin-bottom:28px}
.header h1{margin:0 0 4px;font-size:18pt;text-transform:uppercase;letter-spacing:2px}
.header p{margin:0;color:#B8C9E0;font-size:11pt}
.date{color:#B8C9E0;font-size:9pt;margin-top:6px}
h2{font-size:14pt;color:#1B2A4A;border-bottom:2px solid #1B2A4A;padding-bottom:4px;margin-top:28px}
.narrative{font-size:12pt;line-height:1.8}
.strength{margin-bottom:14px}
.strength-title{font-weight:bold;font-size:11pt;color:#1B2A4A;margin:0 0 2px}
.career-path{margin-bottom:18px;padding:10px 14px;border-left:3px solid #B8C9E0}
.career-path h3{margin:0 0 4px;font-size:11pt;color:#1B2A4A}
.career-path p{margin:0 0 4px;font-size:10pt;color:#444}
ul{margin:4px 0;padding-left:18px}li{font-size:10pt;line-height:1.6}
.footer{margin-top:32px;padding-top:12px;border-top:1px solid #ddd;font-size:9pt;color:#888;text-align:center}
@media print{@page{margin:.5in}.no-print{display:none!important}}
</style></head><body>
<div class="header"><h1>${escHtml(headline)}</h1><p>Your Forge Analysis from Steel Man Resumes</p><p class="date">${date}</p></div>
${body}
<div class="footer no-print"><p>Steel Man Resumes -- steelmanresumes.com</p><p>File &rsaquo; Print &rsaquo; Save as PDF to download</p></div>
<script>window.onload=function(){setTimeout(function(){window.print()},500)}</script>
</body></html>`;
}

function formatOutputAsText(
  output: ForgeOutput,
  narrative: Record<string, unknown>
): string {
  const lines: string[] = [
    "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
    "  THE FORGE -- Your Story, Reforged",
    "  Steel Man Resumes",
    "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
    "",
  ];

  if (narrative.headline) lines.push(String(narrative.headline), "");
  if (narrative.summary) lines.push(String(narrative.summary), "");

  if (output.strengths?.length) {
    lines.push("", "YOUR STRENGTHS", "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    for (const s of output.strengths) {
      lines.push(`\u2022 ${s.title}: ${s.evidence}`);
    }
  }

  if (output.skills?.length) {
    lines.push("", "SKILLS", "\u2500\u2500\u2500\u2500\u2500\u2500");
    lines.push(output.skills.map((s) => s.name).join(", "));
  }

  if (output.career_paths?.length) {
    lines.push("", "CAREER PATHS", "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    for (const cp of output.career_paths) {
      lines.push(`\n${cp.title}${cp.salary_range ? ` (${cp.salary_range})` : ""}`);
      lines.push(cp.match_reason);
      if (cp.next_steps.length) {
        lines.push("Next steps:");
        cp.next_steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
      }
    }
  }

  if (output.barriers?.length) {
    lines.push("", "RESOURCES FOR YOUR SITUATION", "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    for (const b of output.barriers) {
      lines.push(`\n${b.type.replace(/_/g, " ").toUpperCase()}`);
      if (b.legal_notes) lines.push(`Legal note: ${b.legal_notes}`);
      for (const r of b.resources) {
        lines.push(`  \u2022 ${r.name}: ${r.description}`);
      }
    }
  }

  lines.push("", "", "Generated by The Forge, powered by t.ROY -- steelmanresumes.com");
  return lines.join("\n");
}
