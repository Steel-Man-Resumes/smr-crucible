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

  // Delete
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // AI
  const [generating, setGenerating] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);

  // Forge data
  const [forgeAvailable, setForgeAvailable] = useState(false);

  // Full resume generation (from job board)
  const [generatingFull, setGeneratingFull] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [tailoringNotes, setTailoringNotes] = useState<string[]>([]);

  // The saved job application this resume is being tailored for, if any. When
  // set, the saved resume artifact is linked to it (Stage 3 journey gate).
  const [targetApplicationId, setTargetApplicationId] = useState<string | null>(null);

  // Career package (cover letter + disclosure brief)
  const [packageTab, setPackageTab] = useState<"resume" | "cover-letter" | "disclosure">("resume");
  const [coverLetterText, setCoverLetterText] = useState<string | null>(null);
  const [disclosureBrief, setDisclosureBrief] = useState<{
    hasRecord: boolean;
    confidenceLevel: string;
    confidencePercent: number;
    briefScript: string | null;
    timingAdvice: string | null;
    upgradeMessage: string;
    targetJob: string;
    targetCompany: string;
  } | null>(null);
  const [coverLetterCopied, setCoverLetterCopied] = useState(false);

  // --- Delete resume ---
  async function deleteResume(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/artifacts/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSavedResumes((prev) => prev.filter((r) => r.id !== id));
        if (artifactId === id) {
          startNewResume();
        }
      }
    } catch {} finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  // --- Load saved resumes list ---
  const loadSavedResumes = useCallback(() => {
    fetch("/api/artifacts?type=resume&limit=20")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => setSavedResumes(d.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSavedResumes();

    // Re-fetch when forge sync completes (may have created a new artifact)
    const handleForgeSync = () => {
      // Small delay to let the DB commit settle
      setTimeout(loadSavedResumes, 500);
    };
    window.addEventListener("forge-synced", handleForgeSync);
    return () => window.removeEventListener("forge-synced", handleForgeSync);
  }, [loadSavedResumes]);

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

  // --- Import from Job Board (AI-generated targeted resume, via sessionStorage) ---
  useEffect(() => {
    if (searchParams.get("from") !== "job") return;
    const jobData = sessionStorage.getItem("resume_target_job");
    if (!jobData) return;
    sessionStorage.removeItem("resume_target_job");
    try {
      runCareerPackage(JSON.parse(jobData), {});
    } catch {
      setGenError("Could not read the selected job. Try importing from Forge instead.");
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Updater function passed to section editors ---
  const updateDoc = useCallback(
    (fn: (prev: ResumeDocument) => ResumeDocument) => {
      setDoc((prev) => fn(prev));
    },
    []
  );

  // --- Generate the full career package (resume + cover letter + disclosure) ---
  // Shared by the job-board hand-off (sessionStorage) and the next-step card
  // (?job=<applicationId>). With existingApplicationId we link to that saved
  // application instead of creating a new one; either way we remember the id so
  // the saved resume artifact links back to it (Stage 3 journey gate).
  const runCareerPackage = useCallback(
    async (
      job: {
        title?: string;
        company?: string;
        description?: string;
        requirements?: string;
        location?: string;
        salary?: string;
        employment_type?: string;
        id?: string;
      },
      opts: { existingApplicationId?: string } = {}
    ) => {
      try {
        setGeneratingFull(true);
        setGenError(null);
        setShowSetup(false);

        // Pre-fill target info immediately
        updateDoc((d) => ({
          ...d,
          meta: {
            ...d.meta,
            targetJob: job.title || "",
            targetCompany: job.company || "",
            createdFrom: "job" as const,
          },
        }));

        // Load Forge data for context
        let forgeOutput: any = null;
        let resumeText: string | undefined;
        let contactInfo: any = {};
        let challenges: string[] = [];
        let criminalRecord: any = null;

        // Try localStorage first
        try {
          const stored = localStorage.getItem("forge_session");
          if (stored) {
            const session = JSON.parse(stored);
            forgeOutput = session.forgeOutput;
            resumeText = session.resumeText;
            challenges = session.challenges || [];
            criminalRecord = session.criminalRecord || null;
          }
        } catch {}

        // If no localStorage, try API
        if (!forgeOutput) {
          try {
            const res = await fetch("/api/forge/load");
            if (res.ok) {
              const { data } = await res.json();
              if (data) {
                forgeOutput = data.forgeOutput;
                resumeText = data.resumeText;
                challenges = data.challenges || [];
                criminalRecord = data.criminalRecord || null;
              }
            }
          } catch {}
        }

        // Try to get contact from profile API
        try {
          const profileRes = await fetch("/api/user/profile");
          if (profileRes.ok) {
            const { contact: profileContact } = await profileRes.json();
            if (profileContact) contactInfo = profileContact;
          }
        } catch {}

        // Call the career package generation API
        const res = await fetch("/api/resume-generate-full", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            forgeOutput,
            resumeText,
            job: {
              title: job.title,
              company: job.company,
              // Use full description if available for better tailoring
              description: (job as any).full_description || job.description,
              requirements: job.requirements,
            },
            contact: contactInfo,
            challenges,
            criminalRecord,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Generation failed");
        }

        const { resume, coverLetter, disclosureBrief: brief, tailoringNotes: notes } = await res.json();
        setDoc(resume as ResumeDocument);
        if (coverLetter) setCoverLetterText(coverLetter);
        if (brief) setDisclosureBrief(brief);
        if (notes?.length) setTailoringNotes(notes);
        setPackageTab("resume");
        setGeneratingFull(false);

        // Resolve the target application: reuse the existing one (next-step card)
        // or create it now (job board). Remember its id so the resume artifact
        // links back to it.
        let applicationId = opts.existingApplicationId ?? null;
        if (!applicationId) {
          try {
            const appRes = await fetch("/api/applications", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                job_title: job.title,
                company: job.company,
                location: job.location || "",
                salary: job.salary || "",
                description: job.description || "",
                employment_type: job.employment_type || "",
                source: "jsearch",
                source_id: job.id || "",
                status: "saved",
              }),
            });
            if (appRes.ok) {
              const { application } = await appRes.json();
              if (application?.id) applicationId = application.id;
            }
          } catch {}
        }
        if (applicationId) setTargetApplicationId(applicationId);

        // Auto-save cover letter as artifact
        if (coverLetter) {
          try {
            await fetch("/api/artifacts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "cover_letter",
                targetContext: {
                  targetJob: job.title,
                  targetCompany: job.company,
                  source: "job",
                  ...(applicationId ? { applicationId } : {}),
                },
                content: { text: coverLetter, targetJob: job.title, targetCompany: job.company },
                scaffoldLevel: 1.0,
              }),
            });
          } catch {}
        }
      } catch (err: any) {
        console.error("Career-package generation error:", err);
        setGenError(err.message || "Could not generate resume. Try importing from Forge instead.");
        setGeneratingFull(false);
      }
    },
    [updateDoc]
  );

  // --- Next-step card hand-off (?job=<applicationId>) ---
  // The journey "Tailor your resume for X" action lands here. Load the saved
  // application, then tailor against it (or open the existing tailored resume).
  useEffect(() => {
    const appId = searchParams.get("job");
    if (!appId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/applications");
        if (!res.ok) return;
        const { applications } = await res.json();
        const app = (applications || []).find((a: any) => a.id === appId);
        if (!app || cancelled) return;
        // Already tailored: open it for editing rather than regenerating (no AI spend).
        if (app.resume_artifact_id) {
          setTargetApplicationId(app.id);
          router.replace(`/dashboard/application-tailor?id=${app.resume_artifact_id}`, { scroll: false });
          return;
        }
        await runCareerPackage(
          {
            title: app.job_title,
            company: app.company,
            description: app.description,
            location: app.location,
            salary: app.salary,
            employment_type: app.employment_type,
            id: app.source_id,
          },
          { existingApplicationId: app.id }
        );
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, runCareerPackage, router]);

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
                // Mark source so onboarding can distinguish forge-auto vs job-targeted
                source: (coverLetterText || disclosureBrief) ? "job" : doc.meta.createdFrom || "fresh",
                // Link to the saved application so the journey sees Stage 3 done.
                ...(targetApplicationId ? { applicationId: targetApplicationId } : {}),
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
            router.replace(`/dashboard/application-tailor?id=${data.id}`, {
              scroll: false,
            });
            setSavedResumes((prev) => [data, ...prev]);
            // Signal the nav to re-check unlock state
            window.dispatchEvent(new Event("resume-saved"));
          } else {
            setSaveStatus("error");
          }
        }
      } catch {
        setSaveStatus("error");
      }
    },
    [doc, artifactId, router, targetApplicationId, coverLetterText, disclosureBrief]
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

  // --- Download DOCX ---
  async function downloadDocx(type: "resume" | "cover_letter", content: string) {
    try {
      const res = await fetch("/api/forge/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, type, format: "docx" }),
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const jobSlug = (doc.meta.targetJob || "resume").replace(/\s+/g, "_");
      a.download = type === "resume"
        ? `${jobSlug}_Resume_SteelMan.docx`
        : `${jobSlug}_CoverLetter_SteelMan.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("DOCX download error:", err);
    }
  }

  // --- Print / save as PDF ---
  function printResumePdf() {
    const text = formatResumeDownload(doc);
    const name = doc.contact.name || "Resume";
    const job = doc.meta.targetJob || "";
    const company = doc.meta.targetCompany || "";

    const lines = text.split("\n");
    let bodyHtml = "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) { bodyHtml += "<br>"; continue; }
      if (/^[A-Z &]+$/.test(t) && t.length > 3 && !t.includes("|")) {
        bodyHtml += `<div class="section-header">${t}</div>`;
      } else if (t.startsWith("- ") || t.startsWith("* ")) {
        bodyHtml += `<div class="bullet">${t.slice(2)}</div>`;
      } else {
        bodyHtml += `<div class="body-line">${t}</div>`;
      }
    }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${name} -- Resume${job ? ` for ${job}` : ""}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#1a1a1a;margin:0;padding:0.5in 0.5in 0.5in 0.5in}
  .name{font-family:Georgia,serif;font-size:16pt;font-weight:bold;text-align:center;background:#1B2A4A;color:#fff;padding:8px 0;letter-spacing:0.05em}
  .subtitle{text-align:center;background:#1B2A4A;color:#B8C9E0;font-size:8pt;padding:3px 0 6px}
  .section-header{font-family:Georgia,serif;font-size:9pt;font-weight:bold;color:#1B2A4A;border-bottom:1.5px solid #1B2A4A;margin:12px 0 4px;padding-bottom:2px;text-transform:uppercase;letter-spacing:0.1em}
  .bullet{margin:2px 0 2px 14px;font-size:8.5pt;line-height:1.45}
  .bullet::before{content:"\\2022  ";color:#1B2A4A;font-weight:bold}
  .body-line{margin:2px 0;font-size:8.5pt;line-height:1.4}
  br{display:block;margin:3px 0}
  @media print{@page{size:letter;margin:0.4in 0.45in}}
</style></head>
<body>
<div class="name">${name.toUpperCase()}</div>
${job || company ? `<div class="subtitle">${[job, company].filter(Boolean).join(" -- ")}</div>` : ""}
${bodyHtml}
<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script>
</body></html>`;

    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
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
    router.replace(`/dashboard/application-tailor?id=${id}`, { scroll: false });
  }

  // --- New resume ---
  function startNewResume() {
    setArtifactId(null);
    setDoc(createEmptyResume());
    lastSaved.current = "";
    setSaveStatus("idle");
    setShowSetup(true);
    router.replace("/dashboard/application-tailor", { scroll: false });
  }

  // Scoring
  const { overall, sections } = scoreResume(doc);

  // --- Full resume generation loading state ---
  if (generatingFull) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          Building Your Career Package
        </h1>
        <div className="bg-sage-50 rounded-2xl p-8 border border-sage-200 text-center mt-6">
          <div className="w-12 h-12 mx-auto mb-4 relative">
            <div className="absolute inset-0 border-3 border-sage-200 rounded-full" />
            <div className="absolute inset-0 border-3 border-sage-600 rounded-full border-t-transparent animate-spin" />
          </div>
          <p className="text-sm font-medium text-sage-700">
            Building your package for {doc.meta.targetJob || "this job"}
            {doc.meta.targetCompany ? ` at ${doc.meta.targetCompany}` : ""}...
          </p>
          <p className="text-xs text-muted mt-2">
            Targeted resume + cover letter + disclosure brief. Takes 20-40 seconds.
          </p>
        </div>
      </div>
    );
  }

  // --- Generation error state ---
  if (genError && !showSetup) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          Application Tailor
        </h1>
        <div className="bg-warm-50 rounded-2xl p-6 border border-warm-200 text-center mt-6">
          <p className="text-sm text-earth-700 mb-4">{genError}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => {
                setGenError(null);
                setShowSetup(true);
              }}
              className="px-6 py-3 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 transition-colors min-h-touch"
            >
              Start Manually
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Setup screen (target + import options) ---
  if (showSetup) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          Application Tailor
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
                <div
                  key={r.id}
                  className="rounded-xl border border-border bg-white hover:border-sage-300 transition-colors"
                >
                  {confirmDeleteId === r.id ? (
                    <div className="px-4 py-3 flex items-center justify-between gap-3">
                      <span className="text-sm text-foreground">Delete this resume?</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => deleteResume(r.id)}
                          disabled={deletingId === r.id}
                          className="text-xs font-medium text-white bg-red-500 px-3 py-1.5 rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
                        >
                          {deletingId === r.id ? "Deleting..." : "Delete"}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs text-muted hover:text-foreground px-2"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center">
                      <button
                        onClick={() => loadResume(r.id)}
                        className="flex-1 text-left px-4 py-3"
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
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(r.id);
                        }}
                        className="px-3 py-3 text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                        title="Delete resume"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <path d="M3 3l8 8M11 3l-8 8" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
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
          {saveStatus === "error" && (
            <span className="text-xs text-red-500">Save failed</span>
          )}
          <button
            onClick={startNewResume}
            className="text-xs text-muted hover:text-foreground"
          >
            + New
          </button>
        </div>
      </div>

      {/* What we tailored for this job */}
      {tailoringNotes.length > 0 && (
        <div className="mb-4 bg-sage-50 rounded-xl border border-sage-200 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-sage-600 flex-shrink-0">
              <path d="M8 1l2 4.5H15l-4 3 1.5 5L8 11 3.5 13.5 5 8.5 1 5.5h5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
            <span className="text-xs font-bold text-sage-800 uppercase tracking-wider">
              What we tailored for this job
            </span>
          </div>
          <ul className="space-y-1">
            {tailoringNotes.map((note, i) => (
              <li key={i} className="text-xs text-sage-700 flex gap-2">
                <span className="text-sage-400 flex-shrink-0">--</span>
                {note}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-sage-600 mt-2 italic">
            Use these points in your disclosure and interview prep -- they are where your profile and this job connect.
          </p>
        </div>
      )}

      {/* Career Package tabs — shown when cover letter or disclosure brief exists */}
      {(coverLetterText || disclosureBrief) && (
        <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setPackageTab("resume")}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              packageTab === "resume" ? "bg-white shadow-sm text-foreground" : "text-muted"
            }`}
          >
            Resume
          </button>
          {coverLetterText && (
            <button
              onClick={() => setPackageTab("cover-letter")}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                packageTab === "cover-letter" ? "bg-white shadow-sm text-foreground" : "text-muted"
              }`}
            >
              Cover Letter
            </button>
          )}
          {disclosureBrief && (
            <button
              onClick={() => setPackageTab("disclosure")}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                packageTab === "disclosure" ? "bg-white shadow-sm text-foreground" : "text-muted"
              }`}
            >
              Disclosure
            </button>
          )}
        </div>
      )}

      {/* Cover Letter panel */}
      {packageTab === "cover-letter" && coverLetterText && (
        <div className="bg-white rounded-2xl border border-border overflow-hidden mb-6">
          <div className="flex items-center justify-between px-5 py-3 bg-sage-50 border-b border-border">
            <h3 className="font-semibold text-sage-800 text-sm">
              Cover Letter for {doc.meta.targetCompany || doc.meta.targetJob}
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(coverLetterText);
                  setCoverLetterCopied(true);
                  setTimeout(() => setCoverLetterCopied(false), 2000);
                }}
                className="px-3 py-1.5 text-xs font-medium text-sage-600 bg-white border border-sage-200 rounded-lg hover:bg-sage-50 transition-colors"
              >
                {coverLetterCopied ? "Copied!" : "Copy"}
              </button>
              <button
                onClick={() => downloadDocx("cover_letter", coverLetterText)}
                className="px-3 py-1.5 text-xs font-medium text-white bg-sage-600 rounded-lg hover:bg-sage-700 transition-colors"
              >
                Download .docx
              </button>
            </div>
          </div>
          <div className="p-6">
            <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">
              {coverLetterText}
            </pre>
          </div>
        </div>
      )}

      {/* Disclosure Brief panel */}
      {packageTab === "disclosure" && disclosureBrief && (
        <div className="space-y-4 mb-6">
          {!disclosureBrief.hasRecord && (
            <div className="bg-white rounded-2xl p-6 border border-border text-center">
              <h3 className="font-semibold text-foreground mb-2">Disclosure Planner</h3>
              <p className="text-sm text-muted mb-4">
                No criminal record was detected from your Forge session.
                If you need help preparing a disclosure strategy, the full Disclosure Planner can help.
              </p>
              <a
                href={`/dashboard/disclosure?company=${encodeURIComponent(disclosureBrief.targetCompany || "")}&job=${encodeURIComponent(disclosureBrief.targetJob || "")}`}
                className="inline-flex items-center px-5 py-3 bg-sage-600 text-white rounded-xl text-sm font-medium hover:bg-sage-700 transition-colors min-h-touch"
              >
                Open Disclosure Planner
              </a>
            </div>
          )}
          {disclosureBrief.hasRecord && <>
          {/* Confidence meter */}
          <div className="bg-white rounded-2xl p-6 border border-border">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-foreground">Disclosure Readiness</h3>
              <span className={`text-sm font-medium ${
                disclosureBrief.confidenceLevel === "high" ? "text-sage-600" :
                disclosureBrief.confidenceLevel === "medium" ? "text-amber-600" : "text-red-500"
              }`}>
                {disclosureBrief.confidencePercent}%
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3 mb-4">
              <div
                className={`rounded-full h-3 transition-all ${
                  disclosureBrief.confidenceLevel === "high" ? "bg-sage-500" :
                  disclosureBrief.confidenceLevel === "medium" ? "bg-amber-400" : "bg-red-400"
                }`}
                style={{ width: `${disclosureBrief.confidencePercent}%` }}
              />
            </div>

            {disclosureBrief.briefScript && (
              <div className="bg-sage-50 rounded-xl p-4 border border-sage-200 mb-4">
                <p className="text-xs font-medium text-sage-600 uppercase tracking-wide mb-2">
                  Starting script
                </p>
                <p className="text-sm text-foreground leading-relaxed italic">
                  &ldquo;{disclosureBrief.briefScript}&rdquo;
                </p>
              </div>
            )}

            {disclosureBrief.timingAdvice && (
              <p className="text-sm text-muted mb-4">
                {disclosureBrief.timingAdvice}
              </p>
            )}

            <p className="text-sm text-muted mb-4">
              {disclosureBrief.upgradeMessage}
            </p>

            <a
              href={`/dashboard/disclosure?company=${encodeURIComponent(disclosureBrief.targetCompany || "")}&job=${encodeURIComponent(disclosureBrief.targetJob || "")}`}
              className="inline-flex items-center px-5 py-3 bg-sage-600 text-white rounded-xl text-sm font-medium hover:bg-sage-700 transition-colors min-h-touch"
            >
              Open Disclosure Planner for {disclosureBrief.targetCompany || "this role"}
            </a>
          </div>
          </>}
        </div>
      )}

      {/* Resume editor — only shown on resume tab */}
      {packageTab !== "resume" ? null : <>

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

          {/* Action bar -- sticky so it stays visible while editing */}
          <div className="sticky bottom-0 bg-white border-t border-border pt-3 pb-3 -mx-1 px-1 mt-3">
            <div className="flex flex-wrap gap-2 items-center">
              <button
                onClick={() => save(false)}
                className="px-5 py-3 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 transition-colors min-h-touch"
              >
                {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save"}
              </button>
              <button
                onClick={() => downloadDocx("resume", formatResumeDownload(doc))}
                className="px-4 py-3 bg-white border-2 border-sage-600 text-sage-600 rounded-xl font-medium hover:bg-sage-50 transition-colors min-h-touch text-sm"
              >
                Download .docx
              </button>
              <button
                onClick={printResumePdf}
                className="px-4 py-3 bg-white border-2 border-sky-500 text-sky-600 rounded-xl font-medium hover:bg-sky-50 transition-colors min-h-touch text-sm"
              >
                Save as PDF
              </button>
            </div>
            <p className="text-[11px] text-muted mt-1.5">
              .docx = editable in Word. PDF = keeps the formatting exactly. Save both.
            </p>
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
      </>}
    </div>
  );
}
