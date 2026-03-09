"use client";

import { TierGate } from "@/components/TierGate";

/**
 * Resume Builder — Refinery Tool 1
 *
 * Job-specific, not generic. User selects a target position, then builds
 * a resume for THAT specific job.
 *
 * Fading scaffold (Wood/Bruner/Ross, WS6):
 * - Bullet 1: fill-in template
 * - Bullet 3: partial prompt
 * - Bullet 5: open with hints
 * - Bullet 10: user writes independently
 *
 * The user does the work. The AI never auto-generates.
 * Right-sized output: one resume for one application.
 *
 * Phase 1: Persists to refinery_artifact table via /api/artifacts endpoints.
 * Supports save, auto-save, load, and "My Resumes" list.
 */

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";

interface ResumeData {
  targetJob: string;
  targetCompany: string;
  summary: string;
  bullets: BulletEntry[];
}

interface BulletEntry {
  id: number;
  text: string;
  scaffoldLevel: number; // 1.0 = full template, 0.0 = independent
}

interface SavedResume {
  id: string;
  target_context: { targetJob?: string; targetCompany?: string };
  scaffold_level: number;
  iteration_number: number;
  updated_at: string;
}

// Scaffold levels determine how much help the user gets
function getScaffoldPrompt(
  bulletIndex: number,
  totalBullets: number,
  targetJob: string
): { placeholder: string; hint: string | null } {
  const progress = bulletIndex / Math.max(totalBullets, 10);

  if (progress < 0.1) {
    // Full template
    return {
      placeholder: `[Action verb] + [what you did] + [result/impact]. Example: "Managed a team of 5 warehouse workers, reducing order errors by 20%"`,
      hint: "Fill in the template above with your own experience. Use numbers when you can.",
    };
  }
  if (progress < 0.3) {
    // Partial prompt
    return {
      placeholder: `[Action verb] + [your responsibility at ${targetJob || "this role"}]...`,
      hint: "Start with a strong verb: Managed, Led, Created, Improved, Trained, Built...",
    };
  }
  if (progress < 0.5) {
    // Open with hints
    return {
      placeholder: "Describe what you accomplished...",
      hint: "Include a number or result if you can. What changed because of your work?",
    };
  }
  // Independent
  return {
    placeholder: "Write your bullet point...",
    hint: null,
  };
}

function getScaffoldLevel(bulletIndex: number): number {
  if (bulletIndex < 1) return 1.0;
  if (bulletIndex < 3) return 0.75;
  if (bulletIndex < 5) return 0.5;
  if (bulletIndex < 8) return 0.25;
  return 0.0;
}

function averageScaffoldLevel(bullets: BulletEntry[]): number {
  if (bullets.length === 0) return 1.0;
  const sum = bullets.reduce((acc, b) => acc + b.scaffoldLevel, 0);
  return Math.round((sum / bullets.length) * 100) / 100;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function ResumeBuilderPage() {
  return (
    <TierGate requiredTier="client">
      <Suspense>
        <ResumeBuilderContent />
      </Suspense>
    </TierGate>
  );
}

function ResumeBuilderContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [step, setStep] = useState<"target" | "build" | "preview">("target");
  const [resume, setResume] = useState<ResumeData>({
    targetJob: "",
    targetCompany: "",
    summary: "",
    bullets: [{ id: 1, text: "", scaffoldLevel: 1.0 }],
  });
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [rateLimitError, setRateLimitError] = useState("");

  // Persistence state
  const [currentArtifactId, setCurrentArtifactId] = useState<string | null>(null);
  const [savedResumes, setSavedResumes] = useState<SavedResume[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContent = useRef<string>("");

  // Load profile data from Forge session
  const [profileSkills, setProfileSkills] = useState<string[]>([]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("forge_session");
      if (stored) {
        const session = JSON.parse(stored);
        if (session.forgeOutput?.skills) {
          setProfileSkills(
            session.forgeOutput.skills.map((s: any) => s.name).slice(0, 10)
          );
        }
      }
    } catch {}
  }, []);

  // Load saved resumes list
  useEffect(() => {
    async function loadSavedResumes() {
      try {
        const res = await fetch("/api/artifacts?type=resume&limit=20");
        if (res.ok) {
          const { data } = await res.json();
          setSavedResumes(data || []);
        }
      } catch {}
    }
    loadSavedResumes();
  }, []);

  // Load artifact from URL param ?id=
  useEffect(() => {
    const artifactId = searchParams.get("id");
    if (!artifactId) return;

    async function loadArtifact(id: string) {
      try {
        const res = await fetch(`/api/artifacts/${id}`);
        if (res.ok) {
          const { data } = await res.json();
          setCurrentArtifactId(data.id);
          const content = data.content as ResumeData;
          setResume({
            targetJob: content.targetJob || "",
            targetCompany: content.targetCompany || "",
            summary: content.summary || "",
            bullets: content.bullets?.length
              ? content.bullets
              : [{ id: 1, text: "", scaffoldLevel: 1.0 }],
          });
          lastSavedContent.current = JSON.stringify(content);
          // Skip target step if we have a target job
          if (content.targetJob) {
            setStep("build");
          }
        }
      } catch {}
    }
    loadArtifact(artifactId);
  }, [searchParams]);

  // Build content payload for save
  const buildContent = useCallback(() => ({
    targetJob: resume.targetJob,
    targetCompany: resume.targetCompany,
    summary: resume.summary,
    bullets: resume.bullets,
    formatVersion: 1,
  }), [resume]);

  // Save function
  const saveResume = useCallback(async (isAutoSave = false) => {
    const content = buildContent();
    const contentStr = JSON.stringify(content);

    // Skip if nothing changed
    if (contentStr === lastSavedContent.current) {
      if (!isAutoSave) setSaveStatus("saved");
      return;
    }

    setSaveStatus("saving");
    try {
      const scaffoldLevel = averageScaffoldLevel(resume.bullets);

      if (currentArtifactId) {
        // Update existing
        const res = await fetch(`/api/artifacts/${currentArtifactId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, scaffoldLevel }),
        });
        if (res.ok) {
          lastSavedContent.current = contentStr;
          setSaveStatus("saved");
        } else {
          setSaveStatus("error");
        }
      } else {
        // Create new
        const res = await fetch("/api/artifacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "resume",
            targetContext: {
              targetJob: resume.targetJob,
              targetCompany: resume.targetCompany,
            },
            content,
            scaffoldLevel,
          }),
        });
        if (res.ok) {
          const { data } = await res.json();
          setCurrentArtifactId(data.id);
          lastSavedContent.current = contentStr;
          setSaveStatus("saved");
          // Update URL without full navigation
          router.replace(`/dashboard/resume-builder?id=${data.id}`, { scroll: false });
          // Refresh saved resumes list
          setSavedResumes((prev) => [data, ...prev]);
        } else {
          setSaveStatus("error");
        }
      }
    } catch {
      setSaveStatus("error");
    }
  }, [buildContent, currentArtifactId, resume.bullets, resume.targetJob, resume.targetCompany, router]);

  // Auto-save: debounced 5s after content changes (only when editing an existing artifact)
  useEffect(() => {
    if (!currentArtifactId) return;
    if (step !== "build") return;

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      saveResume(true);
    }, 5000);

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [resume, currentArtifactId, step, saveResume]);

  // Clear saved indicator after 3s
  useEffect(() => {
    if (saveStatus === "saved") {
      const t = setTimeout(() => setSaveStatus("idle"), 3000);
      return () => clearTimeout(t);
    }
  }, [saveStatus]);

  function addBullet() {
    const nextIndex = resume.bullets.length;
    setResume((prev) => ({
      ...prev,
      bullets: [
        ...prev.bullets,
        {
          id: nextIndex + 1,
          text: "",
          scaffoldLevel: getScaffoldLevel(nextIndex),
        },
      ],
    }));
  }

  function updateBullet(id: number, text: string) {
    setResume((prev) => ({
      ...prev,
      bullets: prev.bullets.map((b) => (b.id === id ? { ...b, text } : b)),
    }));
  }

  async function getSuggestion() {
    setGenerating(true);
    try {
      const res = await fetch("/api/resume-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetJob: resume.targetJob,
          targetCompany: resume.targetCompany,
          existingBullets: resume.bullets
            .filter((b) => b.text.trim())
            .map((b) => b.text),
          skills: profileSkills,
          action: "suggest_summary",
        }),
      });
      if (res.status === 429) {
        const data = await res.json();
        setRateLimitError(data.error);
      } else if (res.ok) {
        const data = await res.json();
        setAiSuggestion(data.suggestion);
      }
    } catch {
      // Silent — suggestion is optional
    } finally {
      setGenerating(false);
    }
  }

  function startNewResume() {
    setCurrentArtifactId(null);
    setResume({
      targetJob: "",
      targetCompany: "",
      summary: "",
      bullets: [{ id: 1, text: "", scaffoldLevel: 1.0 }],
    });
    lastSavedContent.current = "";
    setSaveStatus("idle");
    setStep("target");
    router.replace("/dashboard/resume-builder", { scroll: false });
  }

  // Save status indicator
  const SaveIndicator = () => {
    if (saveStatus === "saving") return <span className="text-xs text-muted">Saving...</span>;
    if (saveStatus === "saved") return <span className="text-xs text-sage-600">Saved</span>;
    if (saveStatus === "error") return <span className="text-xs text-earth-600">Save failed</span>;
    return null;
  };

  // --- My Resumes List ---
  const MyResumes = () => {
    if (savedResumes.length === 0) return null;
    return (
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-foreground">My Resumes</h2>
          <button
            onClick={startNewResume}
            className="text-sm text-sage-600 hover:text-sage-700 font-medium"
          >
            + New Resume
          </button>
        </div>
        <div className="space-y-2">
          {savedResumes.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                router.replace(`/dashboard/resume-builder?id=${r.id}`, { scroll: false });
              }}
              className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                currentArtifactId === r.id
                  ? "border-sage-400 bg-sage-50"
                  : "border-border bg-white hover:border-sage-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground truncate">
                  {r.target_context?.targetJob || "Untitled resume"}
                </span>
                <span className="text-xs text-muted ml-2 flex-shrink-0">
                  {timeAgo(r.updated_at)}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1">
                {r.target_context?.targetCompany && (
                  <span className="text-xs text-muted">
                    at {r.target_context.targetCompany}
                  </span>
                )}
                <span className="text-xs text-muted">
                  v{r.iteration_number}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  // --- Step 1: Target ---
  if (step === "target") {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          Resume Builder
        </h1>
        <p className="text-body text-muted mb-8">
          One resume for one job. Tell us what you&apos;re applying for, and
          we&apos;ll help you build it.
        </p>

        <MyResumes />

        <div className="space-y-4 mb-8">
          <div>
            <label
              htmlFor="target-job"
              className="text-sm font-medium text-foreground block mb-1.5"
            >
              What job are you applying for?
            </label>
            <input
              id="target-job"
              value={resume.targetJob}
              onChange={(e) =>
                setResume({ ...resume, targetJob: e.target.value })
              }
              placeholder="e.g., Warehouse Associate, CNA, Forklift Operator"
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors min-h-touch"
            />
          </div>

          <div>
            <label
              htmlFor="target-company"
              className="text-sm font-medium text-foreground block mb-1.5"
            >
              Where?{" "}
              <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="target-company"
              value={resume.targetCompany}
              onChange={(e) =>
                setResume({ ...resume, targetCompany: e.target.value })
              }
              placeholder="e.g., Amazon, local hospital, specific company name"
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors min-h-touch"
            />
          </div>
        </div>

        {profileSkills.length > 0 && (
          <div className="mb-8">
            <p className="text-sm font-medium text-foreground mb-2">
              Skills from your Forge results
            </p>
            <div className="flex flex-wrap gap-2">
              {profileSkills.map((s, i) => (
                <span
                  key={i}
                  className="px-3 py-1 rounded-lg text-sm bg-sage-100 text-sage-700"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => setStep("build")}
          disabled={!resume.targetJob.trim()}
          className="px-8 py-4 bg-sage-600 text-white rounded-xl text-lg font-medium hover:bg-sage-700 disabled:bg-gray-300 transition-colors min-h-touch"
        >
          Start Building
        </button>
      </div>
    );
  }

  // --- Step 2: Build with fading scaffold ---
  if (step === "build") {
    return (
      <div className="max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Resume for: {resume.targetJob}
            </h1>
            {resume.targetCompany && (
              <p className="text-sm text-muted">at {resume.targetCompany}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <SaveIndicator />
            <button
              onClick={() => setStep("target")}
              className="text-sm text-muted hover:text-foreground"
            >
              Change target
            </button>
          </div>
        </div>

        {/* Summary */}
        <div className="mb-8">
          <label className="text-sm font-medium text-foreground block mb-1.5">
            Professional Summary
          </label>
          <textarea
            value={resume.summary}
            onChange={(e) => setResume({ ...resume, summary: e.target.value })}
            placeholder="2-3 sentences about what you bring to this role. Focus on your strongest, most relevant experience."
            rows={3}
            className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors resize-y"
          />
          {!resume.summary && (
            <button
              onClick={getSuggestion}
              disabled={generating}
              className="mt-2 text-sm text-sage-600 hover:text-sage-700 underline underline-offset-2"
            >
              {generating ? "Thinking..." : "Help me get started"}
            </button>
          )}
          {rateLimitError && (
            <div className="mt-3 bg-amber-50 rounded-xl p-4 border border-amber-200">
              <p className="text-sm text-amber-800">{rateLimitError}</p>
            </div>
          )}
          {aiSuggestion && !resume.summary && (
            <div className="mt-3 bg-sage-50 rounded-xl p-4 border border-sage-200">
              <p className="text-sm text-foreground mb-2">{aiSuggestion}</p>
              <p className="text-xs text-muted mb-2">
                This is a starting point. Edit it to sound like you.
              </p>
              <button
                onClick={() => {
                  setResume({ ...resume, summary: aiSuggestion });
                  setAiSuggestion(null);
                }}
                className="text-sm text-sage-600 font-medium"
              >
                Use this as a starting point
              </button>
            </div>
          )}
        </div>

        {/* Experience bullets with fading scaffold */}
        <div className="mb-8">
          <h2 className="text-sm font-medium text-foreground mb-3">
            Experience Bullets
          </h2>
          <div className="space-y-3">
            {resume.bullets.map((bullet, index) => {
              const scaffold = getScaffoldPrompt(
                index,
                resume.bullets.length,
                resume.targetJob
              );
              return (
                <div key={bullet.id}>
                  <div className="flex items-start gap-2">
                    <span className="text-sm text-muted mt-3 w-6 flex-shrink-0">
                      {index + 1}.
                    </span>
                    <div className="flex-1">
                      <textarea
                        value={bullet.text}
                        onChange={(e) =>
                          updateBullet(bullet.id, e.target.value)
                        }
                        placeholder={scaffold.placeholder}
                        rows={2}
                        className="w-full px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 transition-colors resize-y"
                      />
                      {scaffold.hint && !bullet.text && (
                        <p className="text-xs text-sage-600 mt-1 ml-1">
                          {scaffold.hint}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Scaffold level indicator */}
                  {index < 5 && (
                    <div className="ml-8 mt-1 flex items-center gap-2">
                      <div className="h-1 flex-1 max-w-[80px] bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-sage-400 rounded-full"
                          style={{
                            width: `${getScaffoldLevel(index) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-muted">
                        {getScaffoldLevel(index) >= 0.75
                          ? "guided"
                          : getScaffoldLevel(index) >= 0.5
                            ? "hints"
                            : getScaffoldLevel(index) >= 0.25
                              ? "light"
                              : "independent"}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={addBullet}
            className="mt-3 text-sm text-sage-600 hover:text-sage-700 font-medium"
          >
            + Add another bullet
          </button>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => saveResume(false)}
            className="px-6 py-4 bg-white border-2 border-sage-600 text-sage-600 rounded-xl font-medium hover:bg-sage-50 transition-colors min-h-touch"
          >
            Save
          </button>
          <button
            onClick={() => setStep("preview")}
            disabled={
              !resume.summary.trim() &&
              !resume.bullets.some((b) => b.text.trim())
            }
            className="flex-1 px-6 py-4 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 disabled:bg-gray-300 transition-colors min-h-touch"
          >
            Preview Resume
          </button>
        </div>
      </div>
    );
  }

  // --- Step 3: Preview ---
  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Preview</h1>
        <div className="flex items-center gap-3">
          <SaveIndicator />
          <button
            onClick={() => setStep("build")}
            className="text-sm text-sage-600 hover:text-sage-700"
          >
            Edit
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-8 border border-border shadow-sm">
        {/* Resume preview */}
        <div className="text-center mb-6 pb-4 border-b border-border">
          <h2 className="text-xl font-bold text-foreground uppercase tracking-wide">
            Resume
          </h2>
          <p className="text-sm text-sage-600 italic mt-1">
            Targeting: {resume.targetJob}
            {resume.targetCompany ? ` at ${resume.targetCompany}` : ""}
          </p>
        </div>

        {resume.summary && (
          <div className="mb-6">
            <h3 className="text-xs font-bold text-muted uppercase tracking-wider mb-2">
              Professional Summary
            </h3>
            <p className="text-sm text-foreground leading-relaxed">
              {resume.summary}
            </p>
          </div>
        )}

        {resume.bullets.some((b) => b.text.trim()) && (
          <div>
            <h3 className="text-xs font-bold text-muted uppercase tracking-wider mb-2">
              Experience
            </h3>
            <ul className="space-y-1.5">
              {resume.bullets
                .filter((b) => b.text.trim())
                .map((b) => (
                  <li
                    key={b.id}
                    className="text-sm text-foreground flex gap-2"
                  >
                    <span className="text-muted flex-shrink-0">•</span>
                    <span>{b.text}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={() => {
            const text = formatResumeText(resume);
            const blob = new Blob([text], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `resume-${resume.targetJob.replace(/\s+/g, "-").toLowerCase()}.txt`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="px-6 py-4 bg-white border-2 border-border text-foreground rounded-xl font-medium hover:bg-gray-50 transition-colors min-h-touch"
        >
          Download
        </button>
        <button
          onClick={() => saveResume(false)}
          className="px-6 py-4 bg-white border-2 border-sage-600 text-sage-600 rounded-xl font-medium hover:bg-sage-50 transition-colors min-h-touch"
        >
          Save
        </button>
        <button
          onClick={() => setStep("build")}
          className="flex-1 px-6 py-4 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 transition-colors min-h-touch"
        >
          Keep Editing
        </button>
      </div>

      <p className="text-xs text-muted text-center mt-4">
        Scaffold level:{" "}
        {resume.bullets.length <= 2
          ? "guided"
          : resume.bullets.length <= 5
            ? "building independence"
            : "mostly independent"}{" "}
        — you&apos;re getting better each time.
      </p>
    </div>
  );
}

function formatResumeText(resume: ResumeData): string {
  const lines = [
    "RESUME",
    `Target: ${resume.targetJob}${resume.targetCompany ? ` at ${resume.targetCompany}` : ""}`,
    "",
  ];
  if (resume.summary) {
    lines.push("PROFESSIONAL SUMMARY", resume.summary, "");
  }
  const bullets = resume.bullets.filter((b) => b.text.trim());
  if (bullets.length) {
    lines.push("EXPERIENCE");
    bullets.forEach((b) => lines.push(`• ${b.text}`));
  }
  lines.push("", "Built with The Refinery — steelmanresumes.com");
  return lines.join("\n");
}
