"use client";

/**
 * Page 2: Resume Intake
 *
 * The most complex page. Four paths:
 * A: Upload (drag/drop or camera). PDF, DOCX, JPG, PNG, screenshots.
 * B: Platform import — links to download from LinkedIn, Indeed
 * C: External builder — links to free resume builders
 * D: Guided AI builder — hidden fallback, scaffolded, never auto-generates
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { DEMO_SESSION } from "@/lib/demo-data";
import { getOpusMessage } from "@/lib/opus-messages";
import { FlowPage, GhostGuide } from "@crucible/consumer-ui";
import { parseTextToResume, profileToResume } from "@/components/resume/resumeParsers";
import { formatResumeDownload, type ResumeDocument } from "@/components/resume/resumeModel";
import { ResumeBuilder } from "@/components/forge/ResumeBuilder";
import { SpeechInputButton } from "@/components/SpeechInputButton";
import { GroundingGauge } from "@/components/GroundingGauge";
import { computeGrounding, jobsFromParsedProfile } from "@/lib/grounding";

type IntakePath = "upload" | "import" | "external" | "guided" | "paste" | null;

const ACCEPTED_TYPES = [
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".rtf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".heic",
  ".heif",
  ".bmp",
  ".gif",
  ".tif",
  ".tiff",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/rtf",
  "text/rtf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/bmp",
  "image/gif",
  "image/tiff",
  "text/plain",
].join(",");

export default function ResumeIntakePage() {
  const router = useRouter();
  const { session, updateSession } = useForgeSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDemo = session.isDemo === true;
  const audience = session.audience || "client";

  // Track page visit
  useEffect(() => {
    updateSession({
      pagesVisited: Array.from(new Set([...(session.pagesVisited || []), "resume"])),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [activePath, setActivePath] = useState<IntakePath>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [parsedName, setParsedName] = useState<string | null>(null);
  const [parsedEmail, setParsedEmail] = useState<string>("");
  const [parsedPhone, setParsedPhone] = useState<string>("");
  // Full parsed profile -- feeds the grounding gauge (how much true material we have).
  const [parsedProfile, setParsedProfile] = useState<any>(null);
  const [dragOver, setDragOver] = useState(false);
  // Phase 7: once ingest yields material, drop the user into the structured
  // base-resume builder (the Build stage) instead of routing straight on.
  const [builderDoc, setBuilderDoc] = useState<ResumeDocument | null>(null);

  // All hooks must be declared before any conditional returns (rules-of-hooks)
  const handleFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setUploadError(null);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/parse", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();

        if (!res.ok) {
          setUploadError(data.error || "Something went wrong. Try again?");
          return;
        }

        updateSession({
          resumeText: data.resumeText,
          resumeFileName: file.name,
          resumeMethod: "upload",
        });

        setParsedName(data.profile?.full_name || null);
        setParsedEmail(data.profile?.email || "");
        setParsedPhone(data.profile?.phone || "");
        setParsedProfile(data.profile || null);
        setUploadSuccess(true);
      } catch (err) {
        setUploadError("Couldn't read that file. Try a different one?");
      } finally {
        setUploading(false);
      }
    },
    [updateSession]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  // Enter the Build stage with a structured ResumeDocument. When /api/parse
  // returned a structured profile, build DIRECTLY from it (preserves dates,
  // city/state, education, skills -- Codex finding 1); otherwise fall back to the
  // text heuristic. seed still wins for contact on the fallback path.
  const enterBuilder = useCallback(
    (
      text: string,
      seed?: { name?: string; email?: string; phone?: string },
      profile?: any
    ) => {
      const hasStructuredProfile =
        profile &&
        ((Array.isArray(profile.work_history) && profile.work_history.length) ||
          (Array.isArray(profile.education) && profile.education.length) ||
          profile.city ||
          profile.state);
      setBuilderDoc(
        hasStructuredProfile
          ? profileToResume(profile, text)
          : parseTextToResume(text, seed)
      );
    },
    []
  );

  // Phase 7: the structured builder owns the screen once ingest produced material.
  if (builderDoc) {
    return (
      <ResumeBuilder
        initialDoc={builderDoc}
        onComplete={finishBuilder}
        onBack={() => setBuilderDoc(null)}
      />
    );
  }

  // Demo mode: show pre-filled resume and continue
  if (isDemo) {
    return (
      <FlowPage
        title="Resume received."
        subtitle="We extracted experience, skills, and education from the sample resume."
        actionLabel="Next"
        onAction={() => {
          updateSession({
            resumeText: DEMO_SESSION.resumeText,
            resumeFileName: DEMO_SESSION.resumeFileName,
            resumeMethod: DEMO_SESSION.resumeMethod,
            lastPageVisited: "resume",
          });
          router.push("/goals");
        }}
        showBack
        onBack={() => router.push("/welcome")}
      >
        <GhostGuide
          message={getOpusMessage("resume", audience, true)}
          pageId="resume"
        />
        <div className="bg-t-panel-2 px-4 py-3 mb-4 border border-t-amber">
          <p className="text-sm text-t-amber-bright font-medium">
            Demo mode — sample resume pre-loaded
          </p>
        </div>
        <div className="bg-t-panel p-5 border border-t-line">
          <p className="text-sm text-t-phos font-medium mb-2">Sample: Jordan Mitchell</p>
          <p className="text-xs text-t-phos-dim whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
            {DEMO_SESSION.resumeText?.slice(0, 500)}...
          </p>
        </div>
      </FlowPage>
    );
  }

  // Rush Mode passthrough: resume already provided via /rush
  if (session.resumeMethod === "rush" && session.resumeText) {
    return (
      <FlowPage
        title="We already have your resume."
        subtitle="You pasted this in Rush Mode. We'll use it for the full Forge analysis — no need to re-enter."
        actionLabel="Continue"
        onAction={() => {
          updateSession({ lastPageVisited: "resume" });
          router.push("/goals");
        }}
        showBack
        onBack={() => router.push("/welcome")}
        footer={
          <button
            onClick={() => {
              updateSession({ resumeText: undefined, resumeMethod: undefined });
            }}
            className="text-t-amber-bright underline underline-offset-2 hover:text-t-amber"
          >
            I want to use a different resume
          </button>
        }
      >
        <GhostGuide
          message={getOpusMessage("resume", audience, false)}
          pageId="resume"
        />
        <div className="bg-t-panel p-5 border border-t-line">
          <p className="text-sm text-t-phos font-medium mb-2">
            From Rush Mode
          </p>
          <p className="text-xs text-t-phos-dim whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
            {session.resumeText.slice(0, 500)}
            {session.resumeText.length > 500 ? "..." : ""}
          </p>
        </div>
      </FlowPage>
    );
  }

  // Persist the finished base resume into the Forge session (structured doc +
  // a refreshed plain-text copy for the downstream analysis), then continue.
  function finishBuilder(doc: ResumeDocument) {
    updateSession({
      resumeDoc: doc,
      resumeText: formatResumeDownload(doc),
      lastPageVisited: "resume",
    });
    router.push("/goals");
  }

  // --- Skip option for "I don't have a resume" ---
  function handleNoResume() {
    setActivePath("guided");
  }

  // If upload succeeded, show verification and optional contact info
  if (uploadSuccess) {
    const previewText = session.resumeText || "";

    const commitAndContinue = () => {
      // Prefer the full structured profile (dates/city/state/education/skills);
      // the seed carries any contact the user just filled in by hand.
      const mergedProfile = parsedProfile
        ? {
            ...parsedProfile,
            full_name: parsedName || parsedProfile.full_name,
            email: parsedEmail || parsedProfile.email,
            phone: parsedPhone || parsedProfile.phone,
          }
        : null;
      enterBuilder(
        previewText,
        {
          name: parsedName || undefined,
          email: parsedEmail || undefined,
          phone: parsedPhone || undefined,
        },
        mergedProfile
      );
    };

    return (
      <FlowPage
        title={parsedName ? `Got it, ${parsedName}.` : "Got it."}
        subtitle="Check that we read it correctly before moving on."
        actionLabel="Looks good -- continue"
        onAction={commitAndContinue}
        showBack
        onBack={() => {
          setUploadSuccess(false);
          setActivePath("upload");
        }}
      >
        {/* Grounding gauge -- the honest contract: how much true material we have. */}
        {parsedProfile && (
          <GroundingGauge score={computeGrounding(jobsFromParsedProfile(parsedProfile))} />
        )}

        {/* Full resume preview */}
        <div className="bg-t-panel border border-t-line mb-4 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-t-line bg-t-panel-2">
            <p className="text-xs font-semibold text-t-phos uppercase">
              What we read from your file
            </p>
            <p className="text-xs text-t-phos-dim">{previewText.length} characters</p>
          </div>
          <div className="p-4 max-h-72 overflow-y-auto">
            <pre className="text-xs text-t-phos whitespace-pre-wrap leading-relaxed">
              {previewText}
            </pre>
          </div>
        </div>

        {/* Explicit re-do option */}
        <div className="bg-t-panel p-4 border border-t-line mb-4">
          <p className="text-sm text-t-phos mb-2">
            Doesn&apos;t look right? Text garbled, cut off, or missing sections?
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => { setUploadSuccess(false); setActivePath("upload"); }}
              className="t-focus flex-1 px-4 py-2.5 bg-transparent border border-t-line text-t-phos text-sm font-medium hover:border-t-phos-dim hover:text-t-white transition-colors"
            >
              Re-upload a different file
            </button>
            <button
              onClick={() => { setUploadSuccess(false); setActivePath("paste"); }}
              className="t-focus flex-1 px-4 py-2.5 bg-transparent border border-t-line text-t-phos text-sm font-medium hover:border-t-phos-dim hover:text-t-white transition-colors"
            >
              Paste the text instead
            </button>
          </div>
        </div>

        {/* Optional contact info -- only show fields that are missing */}
        {(!parsedEmail || !parsedPhone) && (
          <div className="bg-t-panel p-5 border border-t-line">
            <p className="text-sm font-medium text-t-white mb-1">
              Missing anything?
            </p>
            <p className="text-xs text-t-phos-dim mb-3">
              Not required -- but these go on your resume when you download it.
            </p>
            <div className="space-y-3">
              {!parsedPhone && (
                <div>
                  <label className="text-xs font-medium text-t-phos-dim block mb-1">
                    Phone number
                  </label>
                  <input
                    type="tel"
                    value={parsedPhone}
                    onChange={(e) => setParsedPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
                  />
                </div>
              )}
              {!parsedEmail && (
                <div>
                  <label className="text-xs font-medium text-t-phos-dim block mb-1">
                    Email address
                  </label>
                  <input
                    type="email"
                    value={parsedEmail}
                    onChange={(e) => setParsedEmail(e.target.value)}
                    placeholder="you@email.com"
                    className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </FlowPage>
    );
  }

  // --- Path Selection ---
  if (!activePath) {
    return (
      <FlowPage
        title="Do you have a resume?"
        subtitle="Any format works -- even a photo of a paper copy."
        showBack
        onBack={() => router.push("/welcome")}
      >
        <GhostGuide
          message={getOpusMessage("resume", audience, false)}
          pageId="resume"
        />
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setActivePath("paste")}
            className="t-focus w-full text-left px-5 py-4 border border-t-amber bg-t-panel-2 hover:border-t-amber-bright transition-all min-h-touch"
          >
            <span className="font-medium text-t-white">Paste your resume text</span>
            <p className="text-sm text-t-phos-dim mt-0.5">
              Copy from an email, notes app, or anywhere and paste it here
            </p>
          </button>

          <button
            onClick={() => setActivePath("upload")}
            className="t-focus w-full text-left px-5 py-4 border border-t-line bg-t-panel hover:border-t-phos-dim transition-all min-h-touch"
          >
            <span className="font-medium text-t-white">Upload a file or image</span>
            <p className="text-sm text-t-phos-dim mt-0.5">
              PDF, Word, photo of a paper copy, or phone camera screenshot
            </p>
          </button>

          <button
            onClick={() => setActivePath("import")}
            className="t-focus w-full text-left px-5 py-4 border border-t-line bg-t-panel hover:border-t-phos-dim transition-all min-h-touch"
          >
            <span className="font-medium text-t-white">Download from LinkedIn or Indeed</span>
            <p className="text-sm text-t-phos-dim mt-0.5">
              We&apos;ll show you how to get your resume from these platforms
            </p>
          </button>

          <button
            onClick={() => setActivePath("external")}
            className="t-focus w-full text-left px-5 py-4 border border-t-line bg-t-panel hover:border-t-phos-dim transition-all min-h-touch"
          >
            <span className="font-medium text-t-white">Build one with a free tool first</span>
            <p className="text-sm text-t-phos-dim mt-0.5">
              Links to Canva, Google Docs, Indeed. Come back when you&apos;re done.
            </p>
          </button>

          {/* Divider */}
          <div className="relative my-1">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-t-line" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-t-bg px-3 text-xs text-t-phos-dim">Starting from nothing?</span>
            </div>
          </div>

          <button
            onClick={handleNoResume}
            className="t-focus w-full text-left px-5 py-4 border border-t-line bg-t-panel hover:border-t-phos-dim transition-all min-h-touch"
          >
            <span className="font-medium text-t-white">Build one from scratch, step by step</span>
            <p className="text-sm text-t-phos-dim mt-0.5">
              15-20 minutes. We guide you through every section. Worth doing right.
            </p>
          </button>

          {/* Record-history recovery -- for users who can't recall employers/dates */}
          <div className="mt-2 bg-t-panel p-4 border border-t-line">
            <p className="text-sm font-medium text-t-white mb-1">
              Can&apos;t remember where you worked, or when?
            </p>
            <p className="text-xs text-t-phos-dim mb-3">
              These free, official sources can remind you. They open on the
              provider&apos;s own site -- we never see or store them.
            </p>
            <div className="space-y-2">
              <a
                href="https://www.irs.gov/individuals/get-transcript"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-t-steel hover:text-t-amber-bright underline underline-offset-2"
              >
                IRS Wage &amp; Income Transcript -- every employer that reported your wages
              </a>
              <a
                href="https://www.theworknumber.com/employees"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-t-steel hover:text-t-amber-bright underline underline-offset-2"
              >
                The Work Number -- your free annual Employment Data Report
              </a>
              <a
                href="https://www.credly.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-t-steel hover:text-t-amber-bright underline underline-offset-2"
              >
                Credly -- digital badges and certifications you&apos;ve earned
              </a>
            </div>
          </div>
        </div>
      </FlowPage>
    );
  }

  // --- Path A: Upload ---
  if (activePath === "upload") {
    return (
      <FlowPage
        title="Upload your resume"
        subtitle="Drag and drop, or tap to select a file. We accept PDF, Word, images, and screenshots."
        showBack
        onBack={() => setActivePath(null)}
      >
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`t-focus w-full border border-dashed p-10 text-center cursor-pointer transition-all min-h-[200px] flex flex-col items-center justify-center gap-4 ${
            dragOver
              ? "border-t-amber bg-t-panel-2"
              : "border-t-line bg-t-panel hover:border-t-phos-dim"
          } ${uploading ? "pointer-events-none opacity-60" : ""}`}
        >
          {uploading ? (
            <>
              <div className="w-8 h-8 border-2 border-t-amber border-t-transparent animate-spin" />
              <p className="text-t-phos-dim">Reading your file...</p>
            </>
          ) : (
            <>
              <svg
                width="40"
                height="40"
                viewBox="0 0 40 40"
                fill="none"
                className="text-t-phos-dim"
                aria-hidden="true"
              >
                <path
                  d="M20 6v20M12 14l8-8 8 8"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M6 28v4a2 2 0 002 2h24a2 2 0 002-2v-4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <div>
                <p className="font-medium text-t-white">
                  Drop your file here, or tap to browse
                </p>
                <p className="text-sm text-t-phos-dim mt-1">
                  PDF, Word, image, or screenshot
                </p>
              </div>
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          onChange={handleFileInput}
          className="hidden"
          aria-label="Upload resume file"
        />

        {uploadError && (
          <div className="mt-4 p-4 bg-t-panel border border-t-red">
            <p className="text-sm text-t-red">{uploadError}</p>
            <button
              onClick={handleNoResume}
              className="text-sm text-t-amber-bright underline mt-2"
            >
              Or build one with our help instead
            </button>
          </div>
        )}
      </FlowPage>
    );
  }

  // --- Path B: Platform Import ---
  if (activePath === "import") {
    return (
      <FlowPage
        title="Download your resume"
        subtitle="Follow these steps, then come back and upload the file."
        showBack
        onBack={() => setActivePath(null)}
        actionLabel="I have my file — upload it"
        onAction={() => setActivePath("upload")}
      >
        <div className="space-y-4">
          <div className="bg-t-panel p-5 border border-t-line">
            <h3 className="font-semibold text-t-white mb-2">From LinkedIn</h3>
            <ol className="text-sm text-t-phos-dim space-y-1.5 list-decimal list-inside">
              <li>Go to your LinkedIn profile</li>
              <li>
                Click the &quot;More&quot; button below your profile photo
              </li>
              <li>Select &quot;Save to PDF&quot;</li>
              <li>Come back here and upload the PDF</li>
            </ol>
          </div>

          <div className="bg-t-panel p-5 border border-t-line">
            <h3 className="font-semibold text-t-white mb-2">From Indeed</h3>
            <ol className="text-sm text-t-phos-dim space-y-1.5 list-decimal list-inside">
              <li>
                Go to{" "}
                <a
                  href="https://profile.indeed.com/resume"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-t-steel underline"
                >
                  profile.indeed.com/resume
                </a>
              </li>
              <li>Click &quot;Download Resume&quot;</li>
              <li>Choose PDF format</li>
              <li>Come back here and upload the PDF</li>
            </ol>
          </div>
        </div>
      </FlowPage>
    );
  }

  // --- Path C: External Builder ---
  if (activePath === "external") {
    return (
      <FlowPage
        title="Free resume builders"
        subtitle="Pick one, build your resume, then come back and upload it."
        showBack
        onBack={() => setActivePath(null)}
        actionLabel="I have my resume — upload it"
        onAction={() => setActivePath("upload")}
        footer={
          <button
            onClick={handleNoResume}
            className="text-t-amber-bright underline underline-offset-2"
          >
            I&apos;d rather build one here with help
          </button>
        }
      >
        <div className="space-y-3">
          {[
            {
              name: "Canva Resume Builder",
              url: "https://www.canva.com/resumes/",
              note: "Free templates. Easy drag and drop.",
            },
            {
              name: "Google Docs Resume Templates",
              url: "https://docs.google.com/document/u/0/?tgif=d&ftv=1",
              note: "Free with a Google account.",
            },
            {
              name: "Indeed Resume Builder",
              url: "https://www.indeed.com/career-services/?collectorID=subnav",
              note: "Step by step. Saves to your Indeed profile.",
            },
          ].map((builder) => (
            <a
              key={builder.name}
              href={builder.url}
              target="_blank"
              rel="noopener noreferrer"
              className="t-focus block w-full text-left px-5 py-4 border border-t-line bg-t-panel hover:border-t-phos-dim transition-all"
            >
              <span className="font-medium text-t-steel">{builder.name}</span>
              <span className="ml-1 text-t-phos-dim text-sm">
                &#8599;
              </span>
              <p className="text-sm text-t-phos-dim mt-0.5">{builder.note}</p>
            </a>
          ))}
        </div>
      </FlowPage>
    );
  }

  // --- Path E: Paste text ---
  if (activePath === "paste") {
    return (
      <PasteResume
        onComplete={(text, seed, profile) => enterBuilder(text, seed, profile)}
        onBack={() => setActivePath(null)}
      />
    );
  }

  // --- Path D: Guided AI Builder (hidden fallback) ---
  if (activePath === "guided") {
    return <GuidedBuilder onComplete={(text) => enterBuilder(text)} onBack={() => setActivePath(null)} />;
  }

  return null;
}

// --- Guided Builder sub-component ---
// Full resume construction, step by step.
// Primary path for users with no resume. NEVER auto-generates.

type BuilderStep =
  | "intro"
  | "name"
  | "contact"
  | "job1-info"
  | "job1-duties"
  | "job2-prompt"
  | "job2-info"
  | "job2-duties"
  | "skills"
  | "education"
  | "extras"
  | "review";

function GuidedBuilder({
  onComplete,
  onBack,
}: {
  onComplete: (text: string) => void;
  onBack: () => void;
}) {
  const { updateSession } = useForgeSession();
  const [step, setStep] = useState<BuilderStep>("intro");
  const [answers, setAnswers] = useState({
    name: "",
    phone: "",
    email: "",
    city: "",
    job1Title: "",
    job1Company: "",
    job1Dates: "",
    job1Duties: "",
    addJob2: false,
    job2Title: "",
    job2Company: "",
    job2Dates: "",
    job2Duties: "",
    skills: "",
    education: "",
    extras: "",
  });

  function set(field: string, value: string | boolean) {
    setAnswers((prev) => ({ ...prev, [field]: value }));
  }

  function goNext() {
    switch (step) {
      case "intro":        setStep("name"); break;
      case "name":         setStep("contact"); break;
      case "contact":      setStep("job1-info"); break;
      case "job1-info":    setStep("job1-duties"); break;
      case "job1-duties":  setStep("job2-prompt"); break;
      case "job2-prompt":  setStep(answers.addJob2 ? "job2-info" : "skills"); break;
      case "job2-info":    setStep("job2-duties"); break;
      case "job2-duties":  setStep("skills"); break;
      case "skills":       setStep("education"); break;
      case "education":    setStep("extras"); break;
      case "extras":       setStep("review"); break;
      case "review": {
        const text = assembleResume();
        updateSession({
          resumeText: text,
          resumeMethod: "guided",
          lastPageVisited: "resume",
        });
        onComplete(text);
        break;
      }
    }
  }

  function goBack() {
    switch (step) {
      case "intro":       onBack(); break;
      case "name":        setStep("intro"); break;
      case "contact":     setStep("name"); break;
      case "job1-info":   setStep("contact"); break;
      case "job1-duties": setStep("job1-info"); break;
      case "job2-prompt": setStep("job1-duties"); break;
      case "job2-info":   setStep("job2-prompt"); break;
      case "job2-duties": setStep("job2-info"); break;
      case "skills":      setStep(answers.addJob2 ? "job2-duties" : "job2-prompt"); break;
      case "education":   setStep("skills"); break;
      case "extras":      setStep("education"); break;
      case "review":      setStep("extras"); break;
    }
  }

  function assembleResume(): string {
    const lines: string[] = [];
    lines.push(answers.name.trim());

    const contactParts = [answers.phone, answers.email, answers.city].filter(Boolean);
    if (contactParts.length) lines.push(contactParts.join(" | "));

    lines.push("");
    lines.push("WORK HISTORY");
    lines.push("");

    if (answers.job1Title || answers.job1Company || answers.job1Duties) {
      const h = [answers.job1Title, answers.job1Company, answers.job1Dates].filter(Boolean).join(" -- ");
      if (h) lines.push(h);
      if (answers.job1Duties) lines.push(answers.job1Duties.trim());
      lines.push("");
    }

    if (answers.addJob2 && (answers.job2Title || answers.job2Company || answers.job2Duties)) {
      const h = [answers.job2Title, answers.job2Company, answers.job2Dates].filter(Boolean).join(" -- ");
      if (h) lines.push(h);
      if (answers.job2Duties) lines.push(answers.job2Duties.trim());
      lines.push("");
    }

    if (answers.skills) {
      lines.push("SKILLS & CERTIFICATIONS");
      lines.push(answers.skills.trim());
      lines.push("");
    }

    if (answers.education) {
      lines.push("EDUCATION & TRAINING");
      lines.push(answers.education.trim());
      lines.push("");
    }

    if (answers.extras) {
      lines.push("ADDITIONAL");
      lines.push(answers.extras.trim());
    }

    return lines.join("\n").trim();
  }

  const inputClass =
    "w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch";
  const textareaClass =
    "w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors resize-y min-h-[140px]";

  // --- Intro ---
  if (step === "intro") {
    return (
      <FlowPage
        title="Build your resume from scratch."
        subtitle="We walk you through it, one section at a time."
        actionLabel="I'm ready -- let's go"
        onAction={goNext}
        showBack
        onBack={goBack}
      >
        <div className="space-y-4">
          <div className="bg-t-panel p-5 border border-t-line">
            <p className="text-sm text-t-phos leading-relaxed mb-3">
              This takes <strong className="text-t-white">15-20 minutes</strong> if you do it right. That&apos;s not a lot
              of time to invest in something this important -- but it only works if you take it
              seriously.
            </p>
            <p className="text-sm text-t-phos-dim leading-relaxed">
              We go section by section: contact info, work history, skills, education.
              Answer each question in your own words. Don&apos;t try to make it sound
              fancy. Just tell us what&apos;s true.
            </p>
          </div>
          <div className="bg-t-panel-2 p-4 border border-t-line">
            <p className="text-xs font-medium text-t-white mb-1">A note on gaps</p>
            <p className="text-xs text-t-phos-dim leading-relaxed">
              If you have gaps in your history -- incarceration, family obligations, health,
              or anything else -- you don&apos;t need to hide or explain them here.
              Just include what you have. The Forge helps you figure out how to
              talk about the gaps later, on your terms.
            </p>
          </div>
        </div>
      </FlowPage>
    );
  }

  // --- Name ---
  if (step === "name") {
    return (
      <FlowPage
        title="What's your full name?"
        subtitle="This goes at the top of your resume."
        actionLabel="Next"
        actionDisabled={!answers.name.trim()}
        onAction={goNext}
        showBack
        onBack={goBack}
      >
        <input
          value={answers.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g., Marcus Johnson"
          className={inputClass}
          autoFocus
        />
      </FlowPage>
    );
  }

  // --- Contact Info ---
  if (step === "contact") {
    return (
      <FlowPage
        title="Contact information"
        subtitle="Goes on your resume. Add what you have -- all optional."
        actionLabel="Next"
        onAction={goNext}
        showBack
        onBack={goBack}
        footer={
          <button onClick={goNext} className="text-t-phos-dim text-sm underline underline-offset-2 hover:text-t-amber-bright">
            Skip for now
          </button>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-t-phos-dim block mb-1">Phone</label>
            <input
              value={answers.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="(555) 123-4567"
              type="tel"
              className={inputClass}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-t-phos-dim block mb-1">Email</label>
            <input
              value={answers.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="you@email.com"
              type="email"
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-t-phos-dim block mb-1">City, State</label>
            <input
              value={answers.city}
              onChange={(e) => set("city", e.target.value)}
              placeholder="e.g., Milwaukee, WI"
              className={inputClass}
            />
          </div>
        </div>
      </FlowPage>
    );
  }

  // --- Job 1 Info ---
  if (step === "job1-info") {
    return (
      <FlowPage
        title="Your most recent job"
        subtitle="Last job you held -- full-time, part-time, temp, gig, or work program. All count."
        actionLabel="Next"
        actionDisabled={!answers.job1Title.trim() && !answers.job1Company.trim()}
        onAction={goNext}
        showBack
        onBack={goBack}
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-t-phos-dim block mb-1">Job title</label>
            <input
              value={answers.job1Title}
              onChange={(e) => set("job1Title", e.target.value)}
              placeholder="e.g., Warehouse Associate, Custodian, Cook"
              className={inputClass}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-t-phos-dim block mb-1">Company or organization</label>
            <input
              value={answers.job1Company}
              onChange={(e) => set("job1Company", e.target.value)}
              placeholder="e.g., Amazon, City of Milwaukee, Self-employed"
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-t-phos-dim block mb-1">When? (approximate is fine)</label>
            <input
              value={answers.job1Dates}
              onChange={(e) => set("job1Dates", e.target.value)}
              placeholder="e.g., 2019-2022"
              className={inputClass}
            />
          </div>
        </div>
      </FlowPage>
    );
  }

  // --- Job 1 Duties ---
  if (step === "job1-duties") {
    return (
      <FlowPage
        title="What did you do there?"
        subtitle="Main responsibilities in your own words. Don't make it fancy -- just be honest."
        actionLabel="Next"
        actionDisabled={!answers.job1Duties.trim()}
        onAction={goNext}
        showBack
        onBack={goBack}
        footer={
          <p className="text-xs text-muted">Include accomplishments, things you were proud of, skills you used.</p>
        }
      >
        <textarea
          value={answers.job1Duties}
          onChange={(e) => set("job1Duties", e.target.value)}
          placeholder={"e.g., Operated forklift and pallet jack. Helped train 3 new employees on safety. Maintained 99% on-time order rate during peak season."}
          rows={5}
          className={textareaClass}
          autoFocus
        />
      </FlowPage>
    );
  }

  // --- Job 2 Prompt ---
  if (step === "job2-prompt") {
    return (
      <FlowPage
        title="Do you have another job to add?"
        subtitle="More work history makes a stronger resume. Part-time, temp, and gig work all count."
        showBack
        onBack={goBack}
      >
        <div className="flex flex-col gap-3">
          <button
            onClick={() => { set("addJob2", true); setStep("job2-info"); }}
            className="t-focus w-full text-left px-5 py-4 border border-t-amber bg-t-panel-2 hover:border-t-amber-bright transition-all min-h-touch"
          >
            <span className="font-medium text-t-white">Yes -- add another job</span>
            <p className="text-sm text-t-phos-dim mt-0.5">Full-time, part-time, temp, gig work, or work program</p>
          </button>
          <button
            onClick={() => { set("addJob2", false); setStep("skills"); }}
            className="t-focus w-full text-left px-5 py-4 border border-t-line bg-t-panel hover:border-t-phos-dim transition-all min-h-touch"
          >
            <span className="font-medium text-t-white">No -- that's my history</span>
            <p className="text-sm text-t-phos-dim mt-0.5">Continue to skills and certifications</p>
          </button>
        </div>
      </FlowPage>
    );
  }

  // --- Job 2 Info ---
  if (step === "job2-info") {
    return (
      <FlowPage
        title="Second job"
        subtitle="Same as before -- title, company, and when."
        actionLabel="Next"
        actionDisabled={!answers.job2Title.trim() && !answers.job2Company.trim()}
        onAction={goNext}
        showBack
        onBack={goBack}
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-t-phos-dim block mb-1">Job title</label>
            <input
              value={answers.job2Title}
              onChange={(e) => set("job2Title", e.target.value)}
              placeholder="e.g., Cashier, Driver, Maintenance Tech"
              className={inputClass}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-t-phos-dim block mb-1">Company or organization</label>
            <input
              value={answers.job2Company}
              onChange={(e) => set("job2Company", e.target.value)}
              placeholder="e.g., Walmart, local restaurant, freelance"
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-t-phos-dim block mb-1">When?</label>
            <input
              value={answers.job2Dates}
              onChange={(e) => set("job2Dates", e.target.value)}
              placeholder="e.g., 2015-2019"
              className={inputClass}
            />
          </div>
        </div>
      </FlowPage>
    );
  }

  // --- Job 2 Duties ---
  if (step === "job2-duties") {
    return (
      <FlowPage
        title="What did you do there?"
        subtitle="Same question -- main responsibilities in your own words."
        actionLabel="Next"
        actionDisabled={!answers.job2Duties.trim()}
        onAction={goNext}
        showBack
        onBack={goBack}
      >
        <textarea
          value={answers.job2Duties}
          onChange={(e) => set("job2Duties", e.target.value)}
          placeholder={"Describe your main responsibilities..."}
          rows={5}
          className={textareaClass}
          autoFocus
        />
      </FlowPage>
    );
  }

  // --- Skills ---
  if (step === "skills") {
    return (
      <FlowPage
        title="What are your skills and certifications?"
        subtitle="What are you good at? Technical skills, people skills, physical skills, licenses -- everything counts."
        actionLabel="Next"
        actionDisabled={!answers.skills.trim()}
        onAction={goNext}
        showBack
        onBack={goBack}
        footer={
          <button onClick={goNext} className="text-t-phos-dim text-sm underline underline-offset-2 hover:text-t-amber-bright">
            Skip for now
          </button>
        }
      >
        <textarea
          value={answers.skills}
          onChange={(e) => set("skills", e.target.value)}
          placeholder={"e.g., Forklift certified (OSHA), CDL Class A, Microsoft Excel, bilingual English/Spanish, team leadership, conflict de-escalation"}
          rows={4}
          className={textareaClass}
          autoFocus
        />
      </FlowPage>
    );
  }

  // --- Education ---
  if (step === "education") {
    return (
      <FlowPage
        title="Education and training"
        subtitle="School, GED, trade programs, certifications, military -- all count. Include anything you completed, even programs from inside."
        actionLabel="Next"
        onAction={goNext}
        showBack
        onBack={goBack}
        footer={
          <button onClick={goNext} className="text-t-phos-dim text-sm underline underline-offset-2 hover:text-t-amber-bright">
            Skip for now
          </button>
        }
      >
        <textarea
          value={answers.education}
          onChange={(e) => set("education", e.target.value)}
          placeholder={"e.g., GED (2018), HVAC certification (ABC Training, 2020), OSHA 10-hour safety, US Army 2004-2008"}
          rows={4}
          className={textareaClass}
          autoFocus
        />
      </FlowPage>
    );
  }

  // --- Extras ---
  if (step === "extras") {
    return (
      <FlowPage
        title="Anything else?"
        subtitle="Volunteer work, community roles, programs you've been part of, or anything that doesn't fit above."
        actionLabel="Next"
        onAction={goNext}
        showBack
        onBack={goBack}
        footer={
          <button onClick={goNext} className="text-t-phos-dim text-sm underline underline-offset-2 hover:text-t-amber-bright">
            Skip -- that&apos;s everything
          </button>
        }
      >
        <textarea
          value={answers.extras}
          onChange={(e) => set("extras", e.target.value)}
          placeholder={"e.g., Volunteer at Milwaukee Rescue Mission 2023-present, peer mentor in reentry program, completed financial literacy and conflict resolution"}
          rows={4}
          className={textareaClass}
          autoFocus
        />
      </FlowPage>
    );
  }

  // --- Review ---
  if (step === "review") {
    const assembled = assembleResume();
    const groundingJobs = [
      { employer: answers.job1Company, title: answers.job1Title, dates: answers.job1Dates, duties: answers.job1Duties },
      ...(answers.addJob2
        ? [{ employer: answers.job2Company, title: answers.job2Title, dates: answers.job2Dates, duties: answers.job2Duties }]
        : []),
    ];
    return (
      <FlowPage
        title="Here's what we have."
        subtitle="Review before we start the analysis. Go back to fix anything."
        actionLabel="Looks good -- start the analysis"
        actionDisabled={!assembled.trim()}
        onAction={goNext}
        showBack
        onBack={goBack}
      >
        {/* Grounding gauge -- the honest contract, computed from the user's answers. */}
        <GroundingGauge score={computeGrounding(groundingJobs)} />

        <div className="bg-t-panel border border-t-line overflow-hidden mb-4">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-t-line bg-t-panel-2">
            <p className="text-xs font-semibold text-t-phos uppercase">
              Your resume draft
            </p>
            <p className="text-xs text-t-phos-dim">{assembled.length} characters</p>
          </div>
          <div className="p-4 max-h-80 overflow-y-auto">
            <pre className="text-xs text-t-phos whitespace-pre-wrap leading-relaxed">
              {assembled}
            </pre>
          </div>
        </div>
        <p className="text-xs text-t-phos-dim">
          This is the raw material for the Forge analysis. The AI transforms it
          into a structured career narrative -- you&apos;ll see the full output at the end.
        </p>
      </FlowPage>
    );
  }

  return null;
}

// --- Paste Resume sub-component ---

// Prompt the user can hand to their own AI (ChatGPT/Claude/etc.), then paste
// the reply back here. Server-side markdown stripping + AI parsing handles
// whatever formatting their AI produces.
const YOUR_AI_PROMPT = `Please write out my resume as plain text. Include my name, phone, email, and city. List every job I have held with the employer name, dates, and 2-4 bullet points describing what I actually did. Then list my skills and any education, certificates, or training. Do not invent anything -- only use what you know about me from our conversations or what I tell you now. Ask me questions first if you need more detail.`;

function PasteResume({
  onComplete,
  onBack,
}: {
  onComplete: (
    text: string,
    seed?: { name?: string; email?: string; phone?: string },
    profile?: any
  ) => void;
  onBack: () => void;
}) {
  const { updateSession } = useForgeSession();
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [showAiHelp, setShowAiHelp] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleSubmit() {
    const raw = text.trim();
    if (!raw) return;
    setParsing(true);

    // Route through the server parser (markdown stripping + AI extraction) so
    // resumes pasted from ChatGPT/Claude parse cleanly. Falls back to the raw
    // text and the client-side parser if the server is unavailable.
    let finalText = raw;
    let seed: { name?: string; email?: string; phone?: string } | undefined;
    let profile: any = null;
    try {
      const formData = new FormData();
      formData.append("text", raw);
      const res = await fetch("/api/parse", { method: "POST", body: formData });
      if (res.ok) {
        const data = await res.json();
        if (data.resumeText) finalText = data.resumeText;
        if (data.profile) {
          profile = data.profile;
          seed = {
            name: data.profile.full_name || undefined,
            email: data.profile.email || undefined,
            phone: data.profile.phone || undefined,
          };
        }
      }
    } catch {
      /* fall back to raw text */
    }

    updateSession({
      resumeText: finalText,
      resumeMethod: "paste",
      lastPageVisited: "resume",
    });
    setParsing(false);
    onComplete(finalText, seed, profile);
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(YOUR_AI_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {}
  }

  return (
    <FlowPage
      title="Paste your resume"
      subtitle="Copy your resume text from anywhere and paste it below. Don't worry about formatting."
      actionLabel={parsing ? "Reading..." : "Continue"}
      actionDisabled={text.trim().length < 20 || parsing}
      onAction={handleSubmit}
      showBack
      onBack={onBack}
      footer={
        <p className="text-xs text-t-phos-dim">
          Minimum 20 characters. Just get the basics in there.
        </p>
      }
    >
      {/* Use-your-own-AI assist */}
      <div className="mb-4 border border-t-line bg-t-panel">
        <button
          type="button"
          onClick={() => setShowAiHelp(!showAiHelp)}
          className="t-focus w-full flex items-center justify-between px-4 py-3 text-left min-h-touch"
        >
          <span className="text-sm font-medium text-t-white">
            Already use ChatGPT or another AI? Have it write your resume, then paste it here.
          </span>
          <span className="text-t-phos-dim text-sm ml-2">{showAiHelp ? "Hide" : "Show"}</span>
        </button>
        {showAiHelp && (
          <div className="px-4 pb-4 border-t border-t-line pt-3">
            <p className="text-xs text-t-phos-dim mb-2">
              Copy this prompt, give it to your AI, then paste its answer in the
              box below. We handle the formatting.
            </p>
            <div className="bg-t-panel-2 border border-t-line p-3 text-xs text-t-phos leading-relaxed mb-2">
              {YOUR_AI_PROMPT}
            </div>
            <button
              type="button"
              onClick={copyPrompt}
              className="t-focus px-3 py-1.5 text-xs font-bold bg-t-amber text-white hover:bg-t-amber-bright transition-colors"
            >
              {copied ? "Copied!" : "Copy this prompt"}
            </button>
          </div>
        )}
      </div>

      <div className="flex justify-end mb-1.5">
        <SpeechInputButton
          compact
          onText={(t) => setText((prev) => (prev ? `${prev.trim()}\n${t}` : t))}
        />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Paste your resume here...\n\nExample:\nJohn Smith\nForklift Operator with 5 years experience\n\nWork History:\nWarehouse Associate, Amazon, 2019-2024\n- Operated forklift and pallet jack\n- Trained new team members"}
        rows={10}
        className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors resize-y min-h-[200px]"
        autoFocus
      />
      {text.length > 0 && text.trim().length < 20 && (
        <p className="text-xs text-t-amber-bright mt-2">
          Keep going. We need a little more to work with.
        </p>
      )}
    </FlowPage>
  );
}
