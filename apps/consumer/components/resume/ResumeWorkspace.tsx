"use client";

/**
 * ResumeWorkspace — The unified resume editing experience.
 *
 * Split-pane on desktop (editor left, live preview right).
 * Toggle tabs on mobile.
 * Handles: state management, save/load, auto-save, Forge/Rush import.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  type ResumeDocument,
  createEmptyResume,
  scoreResume,
  formatResumeDownload,
  migrateLegacyResume,
} from "./resumeModel";
import { parseForgeToResume, parseRushToResume } from "./resumeParsers";
import { ResumePreview } from "./ResumePreview";
import { SectionWrapper } from "./SectionWrapper";
import {
  ContactSection,
  SummarySection,
  ExperienceSection,
  EducationSection,
  SkillsSection,
} from "./sections";

interface SavedResume {
  id: string;
  target_context: { targetJob?: string; targetCompany?: string };
  scaffold_level: number;
  iteration_number: number;
  updated_at: string;
}

export function ResumeWorkspace() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Document state
  const [doc, setDoc] = useState<ResumeDocument>(createEmptyResume());
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit");
  const [showSetup, setShowSetup] = useState(true);

  // Persistence
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [savedResumes, setSavedResumes] = useState<SavedResume[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSaved = useRef<string>("");
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // AI
  const [generating, setGenerating] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);

  // Forge data
  const [forgeAvailable, setForgeAvailable] = useState(false);

  // --- Load saved resumes list ---
  useEffect(() => {
    fetch("/api/artifacts?type=resume&limit=20")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => setSavedResumes(d.data || []))
      .catch(() => {});
  }, []);

  // --- Check for Forge data ---
  useEffect(() => {
    try {
      const stored = localStorage.getItem("forge_session");
      if (stored) {
        const session = JSON.parse(stored);
        if (session.forgeOutput || session.resumeText) {
          setForgeAvailable(true);
        }
      }
    } catch {}
  }, []);

  // --- Load from URL param ?id= ---
  useEffect(() => {
    const id = searchParams.get("id");
    if (!id) return;
    fetch(`/api/artifacts/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.data) return;
        setArtifactId(data.data.id);
        const content = data.data.content;
        if (content.formatVersion === 2) {
          setDoc(content as ResumeDocument);
        } else {
          setDoc(migrateLegacyResume(content));
        }
        lastSaved.current = JSON.stringify(content);
        setShowSetup(false);
      })
      .catch(() => {});
  }, [searchParams]);

  // --- Import from Rush (via sessionStorage) ---
  useEffect(() => {
    const from = searchParams.get("from");
    if (from === "rush") {
      try {
        const rushData = sessionStorage.getItem("rush_result");
        const rushTarget = sessionStorage.getItem("rush_target");
        if (rushData) {
          const result = JSON.parse(rushData);
          const imported = parseRushToResume(result, rushTarget || "");
          setDoc(imported);
          setShowSetup(false);
          sessionStorage.removeItem("rush_result");
          sessionStorage.removeItem("rush_target");
        }
      } catch {}
    }
  }, [searchParams]);

  // --- Updater function passed to section editors ---
  const updateDoc = useCallback(
    (fn: (prev: ResumeDocument) => ResumeDocument) => {
      setDoc((prev) => fn(prev));
    },
    []
  );

  // --- Save ---
  const save = useCallback(
    async (isAutoSave = false) => {
      const content = doc;
      const contentStr = JSON.stringify(content);
      if (contentStr === lastSaved.current) {
        if (!isAutoSave) setSaveStatus("saved");
        return;
      }

      setSaveStatus("saving");
      try {
        if (artifactId) {
          const res = await fetch(`/api/artifacts/${artifactId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, scaffoldLevel: 0.5 }),
          });
          if (res.ok) {
            lastSaved.current = contentStr;
            setSaveStatus("saved");
          } else {
            setSaveStatus("error");
          }
        } else {
          const res = await fetch("/api/artifacts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "resume",
              targetContext: {
                targetJob: doc.meta.targetJob,
                targetCompany: doc.meta.targetCompany,
              },
              content,
              scaffoldLevel: 0.5,
            }),
          });
          if (res.ok) {
            const { data } = await res.json();
            setArtifactId(data.id);
            lastSaved.current = contentStr;
            setSaveStatus("saved");
            router.replace(`/dashboard/resume-builder?id=${data.id}`, {
              scroll: false,
            });
            setSavedResumes((prev) => [data, ...prev]);
          } else {
            setSaveStatus("error");
          }
        }
      } catch {
        setSaveStatus("error");
      }
    },
    [doc, artifactId, router]
  );

  // --- Auto-save (5s debounce after edits, only when past setup) ---
  useEffect(() => {
    if (showSetup) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => save(true), 5000);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [doc, showSetup, save]);

  // Clear "saved" indicator after 3s
  useEffect(() => {
    if (saveStatus === "saved") {
      const t = setTimeout(() => setSaveStatus("idle"), 3000);
      return () => clearTimeout(t);
    }
  }, [saveStatus]);

  // --- AI Summary Assist ---
  async function requestSummarySuggestion() {
    setGenerating(true);
    try {
      const skills = doc.skills.slice(0, 10);
      const existingBullets = doc.experience
        .flatMap((e) => e.bullets)
        .filter((b) => b.trim());
      const res = await fetch("/api/resume-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetJob: doc.meta.targetJob,
          targetCompany: doc.meta.targetCompany,
          existingBullets,
          skills,
          action: "suggest_summary",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiSuggestion(data.suggestion);
      }
    } catch {} finally {
      setGenerating(false);
    }
  }

  // --- Download ---
  function downloadResume() {
    const text = formatResumeDownload(doc);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resume-${(doc.meta.targetJob || "draft").replace(/\s+/g, "-").toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- Import from Forge ---
  function importFromForge() {
    try {
      const stored = localStorage.getItem("forge_session");
      if (stored) {
        const session = JSON.parse(stored);
        const imported = parseForgeToResume(session);
        setDoc(imported);
        setShowSetup(false);
      }
    } catch {}
  }

  // --- Start fresh ---
  function startFresh() {
    const d = createEmptyResume();
    d.meta.targetJob = doc.meta.targetJob;
    d.meta.targetCompany = doc.meta.targetCompany;
    d.meta.jobListingUrl = doc.meta.jobListingUrl;
    setDoc(d);
    setShowSetup(false);
  }

  // --- Load existing resume ---
  function loadResume(id: string) {
    setArtifactId(null);
    router.replace(`/dashboard/resume-builder?id=${id}`, { scroll: false });
  }

  // --- New resume ---
  function startNewResume() {
    setArtifactId(null);
    setDoc(createEmptyResume());
    lastSaved.current = "";
    setSaveStatus("idle");
    setShowSetup(true);
    router.replace("/dashboard/resume-builder", { scroll: false });
  }

  // Scoring
  const { overall, sections } = scoreResume(doc);

  // --- Setup screen (target + import options) ---
  if (showSetup) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          Resume Builder
        </h1>
        <p className="text-body text-muted mb-8">
          Build a resume for a specific job. We&apos;ll guide you through each
          section.
        </p>

        {/* Saved resumes */}
        {savedResumes.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-foreground">
                My Resumes
              </h2>
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
                  onClick={() => loadResume(r.id)}
                  className="w-full text-left px-4 py-3 rounded-xl border border-border bg-white hover:border-sage-300 transition-colors"
                >
                  <span className="text-sm font-medium text-foreground">
                    {r.target_context?.targetJob || "Untitled resume"}
                  </span>
                  {r.target_context?.targetCompany && (
                    <span className="text-xs text-muted ml-2">
                      at {r.target_context.targetCompany}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Target job */}
        <div className="space-y-4 mb-6">
          <div>
            <label className="text-sm font-medium block mb-1">
              What job are you applying for?
            </label>
            <input
              value={doc.meta.targetJob}
              onChange={(e) =>
                updateDoc((d) => ({
                  ...d,
                  meta: { ...d.meta, targetJob: e.target.value },
                }))
              }
              placeholder="e.g., Warehouse Associate, CNA, Forklift Operator"
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors min-h-touch"
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">
              Where?{" "}
              <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              value={doc.meta.targetCompany}
              onChange={(e) =>
                updateDoc((d) => ({
                  ...d,
                  meta: { ...d.meta, targetCompany: e.target.value },
                }))
              }
              placeholder="e.g., Amazon, local hospital, specific company"
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors min-h-touch"
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">
              Job listing link{" "}
              <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              value={doc.meta.jobListingUrl}
              onChange={(e) =>
                updateDoc((d) => ({
                  ...d,
                  meta: { ...d.meta, jobListingUrl: e.target.value },
                }))
              }
              placeholder="Paste the URL from Indeed, LinkedIn, or any job board"
              type="url"
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors min-h-touch"
            />
          </div>
        </div>

        {/* Start options */}
        <div className="space-y-3">
          {forgeAvailable && (
            <button
              onClick={importFromForge}
              disabled={!doc.meta.targetJob.trim()}
              className="w-full px-6 py-4 bg-sage-600 text-white rounded-xl text-base font-medium hover:bg-sage-700 disabled:bg-gray-300 transition-colors min-h-touch"
            >
              Import from The Forge &amp; Start Building
            </button>
          )}
          <button
            onClick={startFresh}
            disabled={!doc.meta.targetJob.trim()}
            className={`w-full px-6 py-4 rounded-xl text-base font-medium transition-colors min-h-touch ${
              forgeAvailable
                ? "bg-white border-2 border-sage-600 text-sage-600 hover:bg-sage-50"
                : "bg-sage-600 text-white hover:bg-sage-700 disabled:bg-gray-300"
            }`}
          >
            {forgeAvailable ? "Start from Scratch" : "Start Building"}
          </button>
        </div>
      </div>
    );
  }

  // --- Workspace ---
  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-foreground truncate">
            {doc.meta.targetJob || "Resume"}
          </h1>
          {doc.meta.targetCompany && (
            <p className="text-xs text-muted">at {doc.meta.targetCompany}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {saveStatus === "saving" && (
            <span className="text-xs text-muted">Saving...</span>
          )}
          {saveStatus === "saved" && (
            <span className="text-xs text-sage-600">Saved</span>
          )}
          {saveStatus === "error" && (
            <span className="text-xs text-red-500">Save failed</span>
          )}
          <button
            onClick={startNewResume}
            className="text-xs text-muted hover:text-foreground"
          >
            New
          </button>
        </div>
      </div>

      {/* Mobile toggle */}
      <div className="flex gap-1 mb-4 lg:hidden bg-gray-100 p-1 rounded-lg">
        <button
          onClick={() => setMobileView("edit")}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            mobileView === "edit"
              ? "bg-white shadow-sm text-foreground"
              : "text-muted"
          }`}
        >
          Edit
        </button>
        <button
          onClick={() => setMobileView("preview")}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            mobileView === "preview"
              ? "bg-white shadow-sm text-foreground"
              : "text-muted"
          }`}
        >
          Preview ({overall}%)
        </button>
      </div>

      {/* Split layout */}
      <div className="lg:grid lg:grid-cols-[1fr_380px] lg:gap-6">
        {/* Editor panel */}
        <div
          className={`space-y-3 ${mobileView === "preview" ? "hidden lg:block" : ""}`}
        >
          <SectionWrapper
            score={sections.find((s) => s.section === "contact")!}
            defaultOpen={!doc.contact.name}
          >
            <ContactSection doc={doc} update={updateDoc} />
          </SectionWrapper>

          <SectionWrapper
            score={sections.find((s) => s.section === "summary")!}
            defaultOpen={!doc.summary.trim()}
          >
            <SummarySection
              doc={doc}
              update={updateDoc}
              onAiAssist={requestSummarySuggestion}
              generating={generating}
            />
            {aiSuggestion && !doc.summary.trim() && (
              <div className="mt-3 bg-sage-50 rounded-xl p-3 border border-sage-200">
                <p className="text-sm text-foreground mb-2">{aiSuggestion}</p>
                <p className="text-xs text-muted mb-2">
                  Starting point. Edit it to sound like you.
                </p>
                <button
                  onClick={() => {
                    updateDoc((d) => ({ ...d, summary: aiSuggestion }));
                    setAiSuggestion(null);
                  }}
                  className="text-sm text-sage-600 font-medium"
                >
                  Use this
                </button>
              </div>
            )}
          </SectionWrapper>

          <SectionWrapper
            score={sections.find((s) => s.section === "experience")!}
            defaultOpen
          >
            <ExperienceSection doc={doc} update={updateDoc} />
          </SectionWrapper>

          <SectionWrapper
            score={sections.find((s) => s.section === "education")!}
          >
            <EducationSection doc={doc} update={updateDoc} />
          </SectionWrapper>

          <SectionWrapper
            score={sections.find((s) => s.section === "skills")!}
            defaultOpen={doc.skills.length > 0}
          >
            <SkillsSection doc={doc} update={updateDoc} />
          </SectionWrapper>

          {/* Action bar */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => save(false)}
              className="px-5 py-3 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 transition-colors min-h-touch"
            >
              Save
            </button>
            <button
              onClick={downloadResume}
              className="px-5 py-3 bg-white border-2 border-border text-foreground rounded-xl font-medium hover:bg-gray-50 transition-colors min-h-touch"
            >
              Download
            </button>
          </div>
        </div>

        {/* Preview panel */}
        <div
          className={`${mobileView === "edit" ? "hidden lg:block" : ""}`}
        >
          <div className="lg:sticky lg:top-20">
            <ResumePreview
              doc={doc}
              sections={sections}
              overall={overall}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
