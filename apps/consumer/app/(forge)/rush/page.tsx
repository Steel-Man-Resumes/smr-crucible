"use client";

/**
 * Rush Mode — Fast-Track Resume Rewriter
 *
 * Single-page flow: paste resume + target job → get rewritten summary, bullets
 * and skills to paste into the person's own resume. The output has no name,
 * employers or dates, so it is never presented or exported as a finished resume
 * (truth fix: never presented as finished).
 * Crucible rules: only uses facts from original resume, never fabricates.
 * Lives in (forge) route group — gets ForgeLayout wrapper (exit button, t.ROY, contact Troy).
 * No auth required. IP-rate-limited via /api/rush-resume.
 */

import { TroyWork } from "@crucible/consumer-ui";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useForgeSession } from "@/lib/forge-context";
import { getOpusMessage } from "@/lib/opus-messages";
import { GhostGuide, TBtn } from "@crucible/consumer-ui";
import { ResumePage } from "@/components/resume/ResumePage";

type Step = "input" | "processing" | "result";

interface RushBullet {
  text: string;
  original: string;
}

interface RushResult {
  summary: string;
  bullets: RushBullet[];
  skills: string[];
  tips: string;
}

const PROCESSING_MESSAGES = ["reading", "strengths", "rewriting", "polishing"] as const;

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
].join(",");

export default function RushPage() {
  const t = useTranslations("forgeRush");
  const locale = useLocale();
  const router = useRouter();
  const { session, updateSession } = useForgeSession();
  const audience = session.audience || "client";
  const isDemo = session.isDemo === true;
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    updateSession({ lastPageVisited: "rush" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [step, setStep] = useState<Step>("input");
  const [resumeText, setResumeText] = useState("");
  const [targetJob, setTargetJob] = useState("");
  const [targetCompany, setTargetCompany] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<RushResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processingMsg, setProcessingMsg] = useState(0);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function handleFileUpload(file: File) {
    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/parse", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("rush.errors.readFile"));
      }
      const data = await res.json();
      setResumeText(data.resumeText || "");
    } catch (err: any) {
      setError(err.message || t("rush.errors.uploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    if (!resumeText.trim() || !targetJob.trim()) return;

    setStep("processing");
    setError("");
    setProcessingMsg(0);

    const msgInterval = setInterval(() => {
      setProcessingMsg((prev) =>
        prev < PROCESSING_MESSAGES.length - 1 ? prev + 1 : prev
      );
    }, 6000);

    try {
      const res = await fetch("/api/rush-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeText: resumeText.trim(),
          targetJob: targetJob.trim(),
          targetCompany: targetCompany.trim() || undefined,
          jobDescription: jobDescription.trim() || undefined,
        }),
      });

      clearInterval(msgInterval);

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t("rush.errors.generic"));
      }

      const data = await res.json();
      setResult(data);
      setStep("result");
    } catch (err: any) {
      clearInterval(msgInterval);
      setError(err.message || t("rush.errors.genericRetry"));
      setStep("input");
    }
  }

  function buildResumeText() {
    if (!result) return "";
    const lines: string[] = [
      "REWRITTEN LINES FOR YOUR RESUME",
      `For: ${targetJob}${targetCompany ? ` at ${targetCompany}` : ""}`,
      "",
      "This is not a finished resume. It has no name, employers or dates.",
      "Paste each line into your own resume under the job it came from, and check every line before you send it.",
      "",
      "PROFESSIONAL SUMMARY",
      "",
      result.summary,
      "",
      "EXPERIENCE",
      "",
    ];
    for (const b of result.bullets ?? []) {
      lines.push(`- ${b.text}`);
    }
    if (result.skills?.length) {
      lines.push("", "SKILLS", "", result.skills.join(" | "));
    }
    return lines.join("\n");
  }

  async function handleDownloadDocx() {
    if (!result) return;
    setDownloading(true);
    try {
      const res = await fetch("/api/forge/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: buildResumeText(),
          type: "resume",
          format: "docx",
        }),
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Rush_Rewritten_Lines.docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback to txt
      handleDownloadTxt();
    } finally {
      setDownloading(false);
    }
  }

  function handleDownloadTxt() {
    // Not a checked, finished version (Phase 5 R1, review L3): marked DRAFT,
    // like every file the server makes from raw text. Also the docx fallback.
    const text = `DRAFT\n\n${buildResumeText()}`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Rush_Rewritten_Lines.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCopy() {
    if (!result) return;
    const text = [
      result.summary,
      "",
      ...(result.bullets ?? []).map((b) => `• ${b.text}`),
      "",
      `Skills: ${(result.skills ?? []).join(", ")}`,
    ].join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // --- INPUT STEP ---
  if (step === "input") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 bg-t-bg">
        <div className="w-full max-w-lg">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-t-white mb-2">
              {t("rush.intro.title")}
            </h1>
            <p className="text-base text-t-phos">
              {t("rush.intro.subtitle")}
            </p>
          </div>

          {/* Disclaimer */}
          <div className="bg-t-panel px-4 py-3 mb-6 border border-t-line">
            <p className="text-sm text-t-phos leading-relaxed">
              <span className="font-semibold text-t-amber-bright">{t("rush.intro.whatThisIsLead")}</span>{" "}
              {t.rich("rush.intro.whatThisIsBody", {
                link: (chunks) => (
                  <Link
                    href="/intro"
                    className="text-t-amber-bright underline underline-offset-2 hover:text-t-amber font-medium"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </div>

          <GhostGuide
            message={getOpusMessage("rush", audience, isDemo, locale)}
            pageId="rush"
          />

          {error && (
            <div className="bg-t-panel px-4 py-3 mb-4 border border-t-red">
              <p className="text-sm text-t-red">{error}</p>
            </div>
          )}

          {/* Resume input */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-t-white mb-1">
              {t("rush.form.resumeLabel")}
            </label>
            <textarea
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              placeholder={t("rush.form.resumePlaceholder")}
              rows={8}
              className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors resize-none"
            />
            <div className="flex items-center gap-3 mt-2">
              <span className="text-xs text-t-phos-dim">{t("rush.form.or")}</span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-xs text-t-amber-bright hover:text-t-amber underline underline-offset-2"
              >
                {uploading ? t("rush.form.readingFile") : t("rush.form.uploadFile")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
              />
              {uploading && (
                <TroyWork compact decorative />
              )}
            </div>
          </div>

          {/* Target job */}
          <div className="mb-3">
            <label className="block text-sm font-medium text-t-white mb-1">
              {t("rush.form.jobLabel")} <span className="text-t-red">*</span>
            </label>
            <input
              type="text"
              value={targetJob}
              onChange={(e) => setTargetJob(e.target.value)}
              placeholder={t("rush.form.jobPlaceholder")}
              className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
            />
          </div>

          {/* Target company (optional) */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-t-white mb-1">
              {t("rush.form.companyLabel")}{" "}
              <span className="text-xs text-t-phos-dim font-normal">{t("rush.form.optional")}</span>
            </label>
            <input
              type="text"
              value={targetCompany}
              onChange={(e) => setTargetCompany(e.target.value)}
              placeholder={t("rush.form.companyPlaceholder")}
              className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
            />
          </div>

          {/* Job description (optional) */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-t-white mb-1">
              {t("rush.form.descriptionLabel")}{" "}
              <span className="text-xs text-t-phos-dim font-normal">{t("rush.form.descriptionHint")}</span>
            </label>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder={t("rush.form.descriptionPlaceholder")}
              rows={5}
              className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors resize-none"
            />
          </div>

          <TBtn
            onClick={handleSubmit}
            disabled={!resumeText.trim() || !targetJob.trim()}
            className="w-full text-lg"
          >
            {t("rush.form.submit")}
          </TBtn>
        </div>
      </div>
    );
  }

  // --- PROCESSING STEP ---
  if (step === "processing") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-t-bg">
        <div className="w-full max-w-md text-center">
          <div className="my-4 flex justify-center"><TroyWork topic="resume" label={t("rush.processing.workLabel")} /></div>
          <h1 className="text-2xl font-bold mb-2 text-t-white">{t("rush.processing.title")}</h1>
          <p className="text-base text-t-amber-bright transition-opacity duration-500">
            {t(`rush.processing.messages.${PROCESSING_MESSAGES[processingMsg]}`)}
          </p>
          <p className="mt-5 text-xs text-t-phos-dim">{t("rush.processing.stillWorking")}</p>
        </div>
      </div>
    );
  }

  // --- RESULT STEP ---
  return (
    <div className="min-h-screen px-4 py-8 bg-t-bg">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-t-white mb-2">
            {t("rush.result.title")}
          </h1>
          <p className="text-sm text-t-phos-dim">
            {targetCompany
              ? t("rush.result.forJobAtCompany", { job: targetJob, company: targetCompany })
              : t("rush.result.forJob", { job: targetJob })}
          </p>
        </div>

        <div className="bg-t-panel px-4 py-3 mb-6 border border-t-amber">
          <p className="text-sm text-t-phos leading-relaxed">
            <span className="font-semibold text-t-amber-bright">{t("rush.result.notFinishedLead")}</span>{" "}
            {t("rush.result.notFinishedBody")}
          </p>
        </div>

        {result && (
          <>
            {/* Professional Summary */}
            <section className="mb-6">
              <h2 className="text-lg font-bold text-t-white mb-2">
                {t("rush.result.summaryHeading")}
              </h2>
              <p className="text-base text-t-phos bg-t-panel p-5 border border-t-line leading-relaxed">
                {result.summary}
              </p>
            </section>

            {/* Experience Bullets */}
            <section className="mb-6">
              <h2 className="text-lg font-bold text-t-white mb-2">
                {t("rush.result.experienceHeading")}
              </h2>
              <div className="space-y-3">
                {(result.bullets ?? []).map((b, i) => (
                  <div
                    key={i}
                    className="bg-t-panel p-4 border border-t-line"
                  >
                    <p className="text-sm text-t-white font-medium">
                      {b.text}
                    </p>
                    <p className="text-xs text-t-phos-dim mt-1 italic">
                      {t("rush.result.basedOn", { original: b.original })}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* Skills */}
            {result.skills.length > 0 && (
              <section className="mb-6">
                <h2 className="text-lg font-bold text-t-white mb-2">
                  {t("rush.result.skillsHeading")}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {result.skills.map((skill, i) => (
                    <span
                      key={i}
                      className="px-3 py-1.5 text-sm font-medium border border-t-line bg-t-panel-2 text-t-phos"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Tip */}
            {result.tips && (
              <section className="mb-8">
                <div className="bg-t-panel p-4 border border-t-line">
                  <p className="text-sm text-t-phos">
                    <span className="font-medium text-t-amber-bright">{t("rush.result.tipLabel")}</span>
                    {result.tips}
                  </p>
                </div>
              </section>
            )}

            <section className="mb-8" aria-labelledby="rush-preview-title">
              <h2 id="rush-preview-title" className="mb-2 text-lg font-bold text-t-white">{t("rush.result.previewTitle")}</h2>
              <p className="mb-3 text-sm text-t-phos-dim">{t("rush.result.previewNote")}</p>
              <div className="border border-t-line bg-t-bg p-3 sm:p-5" data-testid="rush-download-preview">
                <ResumePage text={buildResumeText()} draft />
              </div>
            </section>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <button
                onClick={handleDownloadDocx}
                disabled={downloading}
                className="t-focus flex-1 px-6 py-4 bg-t-amber text-white font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright disabled:opacity-40 disabled:shadow-none transition-colors min-h-touch"
              >
                {downloading ? t("rush.result.preparing") : t("rush.result.downloadDocx")}
              </button>
              <button
                onClick={handleCopy}
                className="t-focus flex-1 px-6 py-4 bg-transparent border border-t-amber text-t-amber-bright font-bold hover:bg-t-amber/10 transition-colors min-h-touch"
              >
                {copied ? t("rush.result.copied") : t("rush.result.copyText")}
              </button>
              <button
                onClick={handleDownloadTxt}
                className="t-focus flex-1 px-6 py-4 bg-transparent border border-t-line text-t-phos-dim font-bold hover:text-t-white hover:border-t-phos-dim transition-colors min-h-touch"
              >
                {t("rush.result.downloadTxt")}
              </button>
            </div>

            {/* Continue editing in the Application Tailor */}
            <button
              onClick={() => {
                try {
                  sessionStorage.setItem("rush_result", JSON.stringify(result));
                  sessionStorage.setItem("rush_target", targetJob);
                } catch {}
                router.push("/dashboard/application-tailor?from=rush");
              }}
              className="t-focus w-full px-6 py-3 bg-transparent border border-t-line text-t-phos text-sm font-medium hover:border-t-phos-dim hover:text-t-white transition-colors mb-4"
            >
              {t("rush.result.continueTailor")}
            </button>

            {/* Interview Warning */}
            <div className="bg-t-panel px-4 py-3 mb-6 border border-t-line">
              <p className="text-sm text-t-phos leading-relaxed">
                <span className="font-semibold text-t-amber-bright">{t("rush.result.interviewLead")}</span>{" "}
                {t("rush.result.interviewBody")}
              </p>
            </div>

            {/* Save + Go Deeper CTA */}
            <div className="bg-t-panel-2 p-6 border border-t-amber text-center">
              <h3 className="font-bold text-t-white mb-2">
                {t("rush.result.ctaTitle")}
              </h3>
              <p className="text-sm text-t-phos-dim leading-relaxed mb-4">
                {t("rush.result.ctaBody")}
              </p>
              <TBtn
                onClick={() => {
                  updateSession({
                    resumeText,
                    resumeMethod: "rush",
                    pagesVisited: ["rush"],
                  });
                  router.push("/welcome");
                }}
                className="text-lg"
              >
                {t("rush.result.ctaButton")}
              </TBtn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
