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

type IntakePath = "upload" | "import" | "external" | "guided" | "paste" | null;

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
  "image/heif",
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
  const [dragOver, setDragOver] = useState(false);

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
        <div className="bg-amber-50 rounded-xl px-4 py-3 mb-4 border border-amber-200">
          <p className="text-sm text-amber-800 font-medium">
            Demo mode — sample resume pre-loaded
          </p>
        </div>
        <div className="bg-sage-50 rounded-xl p-5 border border-sage-200">
          <p className="text-sm text-sage-700 font-medium mb-2">Sample: Jordan Mitchell</p>
          <p className="text-xs text-muted font-mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
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
            className="text-sage-600 underline underline-offset-2 hover:text-sage-700"
          >
            I want to use a different resume
          </button>
        }
      >
        <GhostGuide
          message={getOpusMessage("resume", audience, false)}
          pageId="resume"
        />
        <div className="bg-sage-50 rounded-xl p-5 border border-sage-200">
          <p className="text-sm text-sage-700 font-medium mb-2">
            From Rush Mode
          </p>
          <p className="text-xs text-muted font-mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
            {session.resumeText.slice(0, 500)}
            {session.resumeText.length > 500 ? "..." : ""}
          </p>
        </div>
      </FlowPage>
    );
  }

  function handleContinue() {
    updateSession({ lastPageVisited: "resume" });
    router.push("/goals");
  }

  // --- Skip option for "I don't have a resume" ---
  function handleNoResume() {
    setActivePath("guided");
  }

  // If upload succeeded, show verification and optional contact info
  if (uploadSuccess) {
    return (
      <FlowPage
        title={parsedName ? `Got it, ${parsedName}.` : "Got it."}
        subtitle="Here&apos;s what we found. Look right?"
        actionLabel="Continue"
        onAction={() => {
          // Save any added contact info into the resume text header
          if (parsedEmail || parsedPhone) {
            const contactLine = [parsedPhone, parsedEmail].filter(Boolean).join(" | ");
            const currentText = session.resumeText || "";
            // Prepend contact info if not already present
            if (contactLine && !currentText.includes(parsedEmail || "___") && !currentText.includes(parsedPhone || "___")) {
              const nameHeader = parsedName || "";
              updateSession({
                resumeText: nameHeader + "\n" + contactLine + "\n\n" + currentText.replace(new RegExp("^" + nameHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\n?"), ""),
              });
            }
          }
          handleContinue();
        }}
        showBack
        onBack={() => {
          setUploadSuccess(false);
          setActivePath("upload");
        }}
      >
        {/* What we found */}
        <div className="bg-sage-50 rounded-xl p-5 border border-sage-200 mb-4">
          <p className="text-sm text-sage-700 font-medium mb-2">We read from your resume:</p>
          <div className="text-sm text-foreground space-y-1">
            {parsedName && <p><span className="text-muted">Name:</span> {parsedName}</p>}
            <p className="text-xs text-muted font-mono whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto mt-2">
              {session.resumeText?.slice(0, 300)}
              {(session.resumeText?.length || 0) > 300 ? "..." : ""}
            </p>
          </div>
        </div>

        {/* Optional contact info — only show fields that are missing */}
        {(!parsedEmail || !parsedPhone) && (
          <div className="bg-white rounded-xl p-5 border border-border">
            <p className="text-sm font-medium text-foreground mb-1">
              Missing anything?
            </p>
            <p className="text-xs text-muted mb-3">
              Not required — but these go on your resume when you download it.
            </p>
            <div className="space-y-3">
              {!parsedPhone && (
                <div>
                  <label className="text-xs font-medium text-muted block mb-1">
                    Phone number
                  </label>
                  <input
                    type="tel"
                    value={parsedPhone}
                    onChange={(e) => setParsedPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    className="w-full px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 transition-colors min-h-touch"
                  />
                </div>
              )}
              {!parsedEmail && (
                <div>
                  <label className="text-xs font-medium text-muted block mb-1">
                    Email address
                  </label>
                  <input
                    type="email"
                    value={parsedEmail}
                    onChange={(e) => setParsedEmail(e.target.value)}
                    placeholder="you@email.com"
                    className="w-full px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 transition-colors min-h-touch"
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
        subtitle="Any format works — even a photo of a paper copy."
        showBack
        onBack={() => router.push("/welcome")}
        footer={
          <button
            onClick={handleNoResume}
            className="text-sage-600 underline underline-offset-2 hover:text-sage-700"
          >
            I don&apos;t have one yet
          </button>
        }
      >
        <GhostGuide
          message={getOpusMessage("resume", audience, false)}
          pageId="resume"
        />
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setActivePath("paste")}
            className="w-full text-left px-5 py-4 rounded-xl border-2 border-sage-300 bg-sage-50 hover:border-sage-400 transition-all min-h-touch"
          >
            <span className="font-medium">Paste your resume text</span>
            <p className="text-sm text-muted mt-0.5">
              Copy from an email, notes app, or anywhere and paste it here
            </p>
          </button>

          <button
            onClick={() => setActivePath("upload")}
            className="w-full text-left px-5 py-4 rounded-xl border-2 border-border bg-white hover:border-sage-300 transition-all min-h-touch"
          >
            <span className="font-medium">Upload a file or image</span>
            <p className="text-sm text-muted mt-0.5">
              PDF, Word, photo of a paper copy
            </p>
          </button>

          <button
            onClick={() => setActivePath("import")}
            className="w-full text-left px-5 py-4 rounded-xl border-2 border-border bg-white hover:border-sage-300 transition-all min-h-touch"
          >
            <span className="font-medium">Download from LinkedIn or Indeed</span>
            <p className="text-sm text-muted mt-0.5">
              We&apos;ll show you how to get your resume from these platforms
            </p>
          </button>

          <button
            onClick={() => setActivePath("external")}
            className="w-full text-left px-5 py-4 rounded-xl border-2 border-border bg-white hover:border-sage-300 transition-all min-h-touch"
          >
            <span className="font-medium">Build one with a free tool first</span>
            <p className="text-sm text-muted mt-0.5">
              Links to free resume builders. Come back when you&apos;re done
            </p>
          </button>
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
          className={`w-full border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all min-h-[200px] flex flex-col items-center justify-center gap-4 ${
            dragOver
              ? "border-sage-500 bg-sage-50"
              : "border-border hover:border-sage-300 hover:bg-sage-50/50"
          } ${uploading ? "pointer-events-none opacity-60" : ""}`}
        >
          {uploading ? (
            <>
              <div className="w-8 h-8 border-2 border-sage-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-muted">Reading your file...</p>
            </>
          ) : (
            <>
              <svg
                width="40"
                height="40"
                viewBox="0 0 40 40"
                fill="none"
                className="text-muted"
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
                <p className="font-medium text-foreground">
                  Drop your file here, or tap to browse
                </p>
                <p className="text-sm text-muted mt-1">
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
          <div className="mt-4 p-4 rounded-xl bg-warm-50 border border-warm-200">
            <p className="text-sm text-warm-700">{uploadError}</p>
            <button
              onClick={handleNoResume}
              className="text-sm text-sage-600 underline mt-2"
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
          <div className="bg-white rounded-xl p-5 border border-border">
            <h3 className="font-semibold mb-2">From LinkedIn</h3>
            <ol className="text-sm text-muted space-y-1.5 list-decimal list-inside">
              <li>Go to your LinkedIn profile</li>
              <li>
                Click the &quot;More&quot; button below your profile photo
              </li>
              <li>Select &quot;Save to PDF&quot;</li>
              <li>Come back here and upload the PDF</li>
            </ol>
          </div>

          <div className="bg-white rounded-xl p-5 border border-border">
            <h3 className="font-semibold mb-2">From Indeed</h3>
            <ol className="text-sm text-muted space-y-1.5 list-decimal list-inside">
              <li>
                Go to{" "}
                <a
                  href="https://profile.indeed.com/resume"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-600 underline"
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
            className="text-sage-600 underline underline-offset-2"
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
              className="block w-full text-left px-5 py-4 rounded-xl border-2 border-border bg-white hover:border-sage-300 transition-all"
            >
              <span className="font-medium text-sky-600">{builder.name}</span>
              <span className="ml-1 text-muted text-sm">
                &#8599;
              </span>
              <p className="text-sm text-muted mt-0.5">{builder.note}</p>
            </a>
          ))}
        </div>
      </FlowPage>
    );
  }

  // --- Path E: Paste text ---
  if (activePath === "paste") {
    return <PasteResume onComplete={handleContinue} onBack={() => setActivePath(null)} />;
  }

  // --- Path D: Guided AI Builder (hidden fallback) ---
  if (activePath === "guided") {
    return <GuidedBuilder onComplete={handleContinue} onBack={() => setActivePath(null)} />;
  }

  return null;
}

// --- Guided Builder sub-component ---
// Scaffolded: templates → partial → hints → independent (WS6)
// NEVER auto-generates. The user does the work.

function GuidedBuilder({
  onComplete,
  onBack,
}: {
  onComplete: () => void;
  onBack: () => void;
}) {
  const { updateSession } = useForgeSession();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({
    name: "",
    recentJob: "",
    recentDuties: "",
    skills: "",
    education: "",
  });

  const steps = [
    {
      title: "What's your name?",
      subtitle: "Just your first and last name.",
      field: "name" as const,
      placeholder: "e.g., Marcus Johnson",
    },
    {
      title: "What was your most recent job?",
      subtitle:
        "Job title and company. If it's been a while, that's okay — what was the last one?",
      field: "recentJob" as const,
      placeholder: "e.g., Warehouse Associate at Amazon",
    },
    {
      title: "What did you do there?",
      subtitle:
        "Describe your main responsibilities in your own words. Don't worry about making it sound fancy.",
      field: "recentDuties" as const,
      placeholder:
        "e.g., Loaded trucks, operated forklift, trained new employees...",
      multiline: true,
    },
    {
      title: "What are you good at?",
      subtitle:
        "Skills, certifications, things people come to you for. Anything counts.",
      field: "skills" as const,
      placeholder:
        "e.g., Forklift certified, good with people, fast learner, CDL...",
      multiline: true,
    },
    {
      title: "Any education or training?",
      subtitle:
        "High school, GED, college, trade school, military training, certifications — all count.",
      field: "education" as const,
      placeholder: "e.g., GED, OSHA 10-hour safety certification",
    },
  ];

  function handleNext() {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      // Compose resume text from answers
      const text = [
        answers.name,
        "",
        `Most Recent Position: ${answers.recentJob}`,
        answers.recentDuties,
        "",
        `Skills: ${answers.skills}`,
        "",
        `Education/Training: ${answers.education}`,
      ]
        .filter(Boolean)
        .join("\n");

      updateSession({
        resumeText: text,
        resumeMethod: "guided",
        lastPageVisited: "resume",
      });

      onComplete();
    }
  }

  const current = steps[step];

  return (
    <FlowPage
      title={current.title}
      subtitle={current.subtitle}
      actionLabel={step < steps.length - 1 ? "Next" : "Continue"}
      actionDisabled={!answers[current.field].trim()}
      onAction={handleNext}
      showBack
      onBack={step === 0 ? onBack : () => setStep(step - 1)}
      footer={
        <p className="text-xs">
          This is just a starting point. You can improve it later in The
          Refinery.
        </p>
      }
    >
      {current.multiline ? (
        <textarea
          value={answers[current.field]}
          onChange={(e) =>
            setAnswers({ ...answers, [current.field]: e.target.value })
          }
          placeholder={current.placeholder}
          rows={4}
          className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors resize-y min-h-[120px]"
          autoFocus
        />
      ) : (
        <input
          value={answers[current.field]}
          onChange={(e) =>
            setAnswers({ ...answers, [current.field]: e.target.value })
          }
          placeholder={current.placeholder}
          className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors min-h-touch"
          autoFocus
        />
      )}
    </FlowPage>
  );
}

// --- Paste Resume sub-component ---

function PasteResume({
  onComplete,
  onBack,
}: {
  onComplete: () => void;
  onBack: () => void;
}) {
  const { updateSession } = useForgeSession();
  const [text, setText] = useState("");

  function handleSubmit() {
    if (!text.trim()) return;
    updateSession({
      resumeText: text.trim(),
      resumeMethod: "paste" as any,
      lastPageVisited: "resume",
    });
    onComplete();
  }

  return (
    <FlowPage
      title="Paste your resume"
      subtitle="Copy your resume text from anywhere and paste it below. Don't worry about formatting."
      actionLabel="Continue"
      actionDisabled={text.trim().length < 20}
      onAction={handleSubmit}
      showBack
      onBack={onBack}
      footer={
        <p className="text-xs text-muted">
          Minimum 20 characters. Just get the basics in there.
        </p>
      }
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Paste your resume here...\n\nExample:\nJohn Smith\nForklift Operator with 5 years experience\n\nWork History:\nWarehouse Associate, Amazon, 2019-2024\n- Operated forklift and pallet jack\n- Trained new team members"}
        rows={10}
        className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors resize-y min-h-[200px]"
        autoFocus
      />
      {text.length > 0 && text.trim().length < 20 && (
        <p className="text-xs text-warm-600 mt-2">
          Keep going. We need a little more to work with.
        </p>
      )}
    </FlowPage>
  );
}
