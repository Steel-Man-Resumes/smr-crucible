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
  formatResumeDownload,
  migrateLegacyResume,
} from "./resumeModel";
import { parseRushToResume } from "./resumeParsers";
import { ResumeEditor } from "./ResumeEditor";
import { printResumePdf } from "./resumePrint";

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

  // Optional pasted job description -- when present, tailoring is targeted to the
  // real posting text (the ratified "pasted-JD unlocks the toolset" path). No
  // live Job Board required.
  const [jobDescription, setJobDescription] = useState("");

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
        jobListingUrl?: string;
        // Provenance for the created job_application (board = "jsearch",
        // typed/pasted in the Tailor = "manual"). Purely a label; the unlock
        // gate keys on the saved resume being job-targeted, not the source.
        source?: string;
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
            jobListingUrl: job.jobListingUrl ?? d.meta.jobListingUrl,
            createdFrom: "job" as const,
          },
        }));

        // Load Forge data for context
        let forgeOutput: any = null;
        let resumeText: string | undefined;
        let contactInfo: any = {};
        let challenges: string[] = [];
        let criminalRecord: any = null;
        // The contact the user typed on their BASE resume -- the authoritative
        // identity for DOCUMENTS (the account profile/session name may be a
        // nickname or persona; the resume's own name is what employers see).
        let baseDocContact: any = null;

        // Try localStorage first
        try {
          const stored = localStorage.getItem("forge_session");
          if (stored) {
            const session = JSON.parse(stored);
            forgeOutput = session.forgeOutput;
            resumeText = session.resumeText;
            challenges = session.challenges || [];
            criminalRecord = session.criminalRecord || null;
            if (session.resumeDoc?.contact?.name) {
              baseDocContact = session.resumeDoc.contact;
            }
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

        // Server-side base resume artifact: the cross-device source of the
        // document identity (works when localStorage is empty -- shared or new
        // computers, common for this population).
        if (!baseDocContact) {
          try {
            const artRes = await fetch("/api/artifacts?type=resume&limit=20");
            if (artRes.ok) {
              const { data } = await artRes.json();
              const base = (data || []).find(
                (a: any) => (a.target_context as any)?.source === "forge" && a.content?.contact?.name
              );
              if (base) baseDocContact = base.content.contact;
            }
          } catch {}
        }

        // Account profile fills whatever the base resume doesn't carry.
        try {
          const profileRes = await fetch("/api/user/profile");
          if (profileRes.ok) {
            const { contact: profileContact } = await profileRes.json();
            if (profileContact) contactInfo = profileContact;
          }
        } catch {}

        // Document identity: base resume contact wins field-by-field; profile
        // is the fallback. (Identity-desync fix, Fable analysis 2026-06-10.
        // The generated doc's Contact section stays fully editable as always.)
        if (baseDocContact) {
          contactInfo = {
            name: baseDocContact.name || contactInfo.name || "",
            phone: baseDocContact.phone || contactInfo.phone || "",
            email: baseDocContact.email || contactInfo.email || "",
            city: baseDocContact.city || contactInfo.city || "",
            state: baseDocContact.state || contactInfo.state || "",
          };
        }

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
        const finalResume = resume as ResumeDocument;
        // Keep the typed job-listing URL on the tailored doc (the generator
        // response doesn't echo it back).
        if (job.jobListingUrl && finalResume?.meta) {
          finalResume.meta = { ...finalResume.meta, jobListingUrl: job.jobListingUrl };
        }
        setDoc(finalResume);
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
                source: job.source || "jsearch",
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

  // Print / save as PDF -- shared helper (components/resume/resumePrint.ts).

  // --- Tailor for the typed/pasted job ---
  // Runs the real AI tailoring against whatever the user typed (title/company/
  // URL) and optionally a pasted job description -- honoring those fields instead
  // of silently retargeting to the Forge-recommended role. runCareerPackage
  // sources the base resume from localStorage OR the server (works cross-device,
  // even when this browser has no Forge session), creates + links a job
  // application, and the saved resume becomes job-targeted -- which unlocks the
  // toolset without ever needing the live Job Board.
  function tailorForJob() {
    if (!doc.meta.targetJob.trim()) return;
    runCareerPackage(
      {
        title: doc.meta.targetJob,
        company: doc.meta.targetCompany,
        description: jobDescription.trim() || undefined,
        jobListingUrl: doc.meta.jobListingUrl || undefined,
        source: "manual",
      },
      {}
    );
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

  // --- Full resume generation loading state ---
  if (generatingFull) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-t-white mb-2">
          Building Your Career Package
        </h1>
        <div className="bg-t-panel p-8 border border-t-line text-center mt-6">
          <div className="w-12 h-12 mx-auto mb-4 relative">
            <div className="absolute inset-0 border-[3px] border-t-line" />
            <div className="absolute inset-0 border-[3px] border-t-amber border-t-transparent animate-spin" />
          </div>
          <p className="text-sm font-medium text-t-amber-bright">
            Building your package for {doc.meta.targetJob || "this job"}
            {doc.meta.targetCompany ? ` at ${doc.meta.targetCompany}` : ""}...
          </p>
          <p className="text-xs text-t-phos-dim mt-2">
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
        <h1 className="text-2xl font-bold text-t-white mb-2">
          Application Tailor
        </h1>
        <div className="bg-t-panel p-6 border border-t-red text-center mt-6">
          <p className="text-sm text-t-phos mb-4">{genError}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => {
                setGenError(null);
                setShowSetup(true);
              }}
              className="t-focus px-6 py-3 bg-t-amber text-white font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright transition-colors min-h-touch"
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
        <h1 className="text-2xl font-bold text-t-white mb-2">
          Application Tailor
        </h1>
        <p className="text-base text-t-phos-dim mb-8">
          Aim your base resume at a specific job. We tailor your resume, cover
          letter, and disclosure plan to the exact posting -- using your Forge
          profile.
        </p>

        {/* Saved resumes */}
        {savedResumes.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-t-white">
                My Resumes
              </h2>
              <button
                onClick={startNewResume}
                className="text-sm text-t-amber-bright hover:text-t-amber font-medium"
              >
                + New Resume
              </button>
            </div>
            <div className="space-y-2">
              {savedResumes.map((r) => {
                // The Forge-built resume is the user's base resume. Historical
                // rows stored the literal label "General" -- treat those as
                // base too, and never offer to delete the base resume.
                const isBase =
                  (r.target_context as any)?.source === "forge" ||
                  r.target_context?.targetJob === "General";
                const label = isBase
                  ? "Base resume"
                  : r.target_context?.targetJob || "Untitled resume";
                return (
                  <div
                    key={r.id}
                    className="border border-t-line bg-t-panel hover:border-t-phos-dim transition-colors"
                  >
                    {confirmDeleteId === r.id ? (
                      <div className="px-4 py-3 flex items-center justify-between gap-3">
                        <span className="text-sm text-t-white">Delete this resume?</span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => deleteResume(r.id)}
                            disabled={deletingId === r.id}
                            className="t-focus text-xs font-medium text-white bg-t-red px-3 py-1.5 hover:opacity-90 disabled:opacity-50 transition-colors"
                          >
                            {deletingId === r.id ? "Deleting..." : "Delete"}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs text-t-phos-dim hover:text-t-white px-2"
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
                          <span className="text-sm font-medium text-t-white">
                            {label}
                          </span>
                          {isBase && (
                            <span className="text-xs text-t-phos-dim ml-2">
                              built in The Forge -- your starting point
                            </span>
                          )}
                          {r.target_context?.targetCompany && (
                            <span className="text-xs text-t-phos-dim ml-2">
                              at {r.target_context.targetCompany}
                            </span>
                          )}
                        </button>
                        {!isBase && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(r.id);
                            }}
                            className="px-3 py-3 text-t-phos-dim hover:text-t-red transition-colors flex-shrink-0"
                            title="Delete resume"
                          >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                              <path d="M3 3l8 8M11 3l-8 8" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Target job */}
        <div className="space-y-4 mb-6">
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">
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
              data-tour="tailor-target-job"
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">
              Where?{" "}
              <span className="font-normal text-t-phos-dim">(optional)</span>
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
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">
              Job listing link{" "}
              <span className="font-normal text-t-phos-dim">(optional)</span>
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
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">
              Paste the job description{" "}
              <span className="font-normal text-t-phos-dim">(optional -- makes the tailoring sharper)</span>
            </label>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the posting's duties and requirements here. We tailor your resume to what this employer actually asks for -- using only what's true about you."
              rows={5}
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors resize-y min-h-[120px]"
            />
          </div>
        </div>

        {/* Start options -- the Tailor aims a BASE resume at the job. "Have a
            base resume" is truthful about BOTH sources: this browser's Forge
            session OR a base resume saved to the account (cross-device). If a
            base exists, tailoring is the primary action and honors the typed
            job; otherwise the Forge builds the base first. */}
        {(() => {
          const hasBaseResume =
            forgeAvailable ||
            savedResumes.some(
              (r) =>
                (r.target_context as any)?.source === "forge" ||
                r.target_context?.targetJob === "General"
            );
          return (
            <div className="space-y-3">
              {hasBaseResume ? (
                <>
                  <button
                    onClick={tailorForJob}
                    disabled={!doc.meta.targetJob.trim()}
                    data-tour="tailor-generate"
                    className="t-focus w-full px-6 py-4 bg-t-amber text-white text-base font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright disabled:opacity-40 disabled:shadow-none transition-colors min-h-touch"
                  >
                    Tailor my resume for this job
                  </button>
                  <p className="text-xs text-t-phos-dim text-center">
                    Uses your base resume{" "}
                    {jobDescription.trim()
                      ? "and the job description you pasted"
                      : "-- paste the job description above for a sharper match"}
                    . Only what&apos;s true about you, aimed at this posting.
                  </p>
                  <a
                    href="/resume"
                    className="t-focus block w-full text-center px-6 py-4 bg-transparent border border-t-amber text-t-amber-bright text-base font-bold hover:bg-t-amber/10 transition-colors min-h-touch"
                  >
                    Rebuild my base resume in the Forge
                  </a>
                </>
              ) : (
                <>
                  <a
                    href="/resume"
                    className="t-focus block w-full text-center px-6 py-4 bg-t-amber text-white text-base font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright transition-colors min-h-touch"
                  >
                    Build your base resume in the Forge first
                  </a>
                  <button
                    onClick={startFresh}
                    disabled={!doc.meta.targetJob.trim()}
                    data-tour="tailor-generate"
                    className="t-focus w-full px-6 py-4 bg-transparent border border-t-amber text-t-amber-bright text-base font-bold hover:bg-t-amber/10 disabled:opacity-40 transition-colors min-h-touch"
                  >
                    Or start a blank resume here
                  </button>
                </>
              )}
            </div>
          );
        })()}
      </div>
    );
  }

  // --- Workspace ---
  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-t-white truncate">
            {doc.meta.targetJob || "Resume"}
          </h1>
          {doc.meta.targetCompany && (
            <p className="text-xs text-t-phos-dim">at {doc.meta.targetCompany}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {saveStatus === "error" && (
            <span className="text-xs text-t-red">Save failed</span>
          )}
          <button
            onClick={startNewResume}
            className="text-xs text-t-phos-dim hover:text-t-white"
          >
            + New
          </button>
        </div>
      </div>

      {/* What we tailored for this job */}
      {tailoringNotes.length > 0 && (
        <div className="mb-4 bg-t-panel border border-t-line px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-t-amber flex-shrink-0">
              <path d="M8 1l2 4.5H15l-4 3 1.5 5L8 11 3.5 13.5 5 8.5 1 5.5h5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
            <span className="text-xs font-bold text-t-amber-bright uppercaser">
              What we tailored for this job
            </span>
          </div>
          <ul className="space-y-1">
            {tailoringNotes.map((note, i) => (
              <li key={i} className="text-xs text-t-phos flex gap-2">
                <span className="text-t-phos-dim flex-shrink-0">--</span>
                {note}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-t-phos-dim mt-2 italic">
            Use these points in your disclosure and interview prep -- they are where your profile and this job connect.
          </p>
        </div>
      )}

      {/* Career Package tabs — shown when cover letter or disclosure brief exists */}
      {(coverLetterText || disclosureBrief) && (
        <div className="flex gap-1 mb-4 bg-t-panel border border-t-line p-1">
          <button
            onClick={() => setPackageTab("resume")}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              packageTab === "resume" ? "bg-t-amber text-white" : "text-t-phos-dim"
            }`}
          >
            Resume
          </button>
          {coverLetterText && (
            <button
              onClick={() => setPackageTab("cover-letter")}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                packageTab === "cover-letter" ? "bg-t-amber text-white" : "text-t-phos-dim"
              }`}
            >
              Cover Letter
            </button>
          )}
          {disclosureBrief && (
            <button
              onClick={() => setPackageTab("disclosure")}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                packageTab === "disclosure" ? "bg-t-amber text-white" : "text-t-phos-dim"
              }`}
            >
              Disclosure
            </button>
          )}
        </div>
      )}

      {/* Cover Letter panel */}
      {packageTab === "cover-letter" && coverLetterText && (
        <div className="bg-t-panel border border-t-line overflow-hidden mb-6">
          <div className="flex items-center justify-between px-5 py-3 bg-t-panel-2 border-b border-t-line">
            <h3 className="font-semibold text-t-white text-sm">
              Cover Letter for {doc.meta.targetCompany || doc.meta.targetJob}
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(coverLetterText);
                  setCoverLetterCopied(true);
                  setTimeout(() => setCoverLetterCopied(false), 2000);
                }}
                className="t-focus px-3 py-1.5 text-xs font-medium text-t-phos bg-t-panel border border-t-line hover:border-t-phos-dim transition-colors"
              >
                {coverLetterCopied ? "Copied!" : "Copy"}
              </button>
              <button
                onClick={() => downloadDocx("cover_letter", coverLetterText)}
                className="t-focus px-3 py-1.5 text-xs font-bold text-white bg-t-amber hover:bg-t-amber-bright transition-colors"
              >
                Download .docx
              </button>
            </div>
          </div>
          <div className="p-6">
            <pre className="text-sm text-t-phos whitespace-pre-wrap font-sans leading-relaxed">
              {coverLetterText}
            </pre>
          </div>
        </div>
      )}

      {/* Disclosure Brief panel */}
      {packageTab === "disclosure" && disclosureBrief && (
        <div className="space-y-4 mb-6">
          {!disclosureBrief.hasRecord && (
            <div className="bg-t-panel p-6 border border-t-line text-center">
              <h3 className="font-semibold text-t-white mb-2">Disclosure Planner</h3>
              <p className="text-sm text-t-phos-dim mb-4">
                No criminal record was detected from your Forge session.
                If you need help preparing a disclosure strategy, the full Disclosure Planner can help.
              </p>
              <a
                href={`/dashboard/disclosure?company=${encodeURIComponent(disclosureBrief.targetCompany || "")}&job=${encodeURIComponent(disclosureBrief.targetJob || "")}`}
                className="t-focus inline-flex items-center px-5 py-3 bg-t-amber text-white text-sm font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright transition-colors min-h-touch"
              >
                Open Disclosure Planner
              </a>
            </div>
          )}
          {disclosureBrief.hasRecord && <>
          {/* Confidence meter */}
          <div className="bg-t-panel p-6 border border-t-line">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-t-white">Disclosure Readiness</h3>
              <span className={`text-sm font-medium ${
                disclosureBrief.confidenceLevel === "high" ? "text-t-amber-bright" :
                disclosureBrief.confidenceLevel === "medium" ? "text-t-steel" : "text-t-red"
              }`}>
                {disclosureBrief.confidencePercent}%
              </span>
            </div>
            <div className="w-full bg-t-line h-3 mb-4">
              <div
                className={`h-3 transition-all ${
                  disclosureBrief.confidenceLevel === "high" ? "bg-t-amber" :
                  disclosureBrief.confidenceLevel === "medium" ? "bg-t-steel" : "bg-t-red"
                }`}
                style={{ width: `${disclosureBrief.confidencePercent}%` }}
              />
            </div>

            {disclosureBrief.briefScript && (
              <div className="bg-t-panel-2 p-4 border border-t-line mb-4">
                <p className="text-xs font-medium text-t-amber-bright uppercase mb-2">
                  Starting script
                </p>
                <p className="text-sm text-t-white leading-relaxed italic">
                  &ldquo;{disclosureBrief.briefScript}&rdquo;
                </p>
              </div>
            )}

            {disclosureBrief.timingAdvice && (
              <p className="text-sm text-t-phos-dim mb-4">
                {disclosureBrief.timingAdvice}
              </p>
            )}

            <p className="text-sm text-t-phos-dim mb-4">
              {disclosureBrief.upgradeMessage}
            </p>

            <p className="text-xs text-t-phos bg-t-panel-2 border border-t-line px-3 py-2 mb-4">
              <span className="font-semibold text-t-white">This is career coaching, not legal advice.</span>{" "}
              For legal guidance, contact a reentry attorney or free legal aid in your area.
            </p>

            <a
              href={`/dashboard/disclosure?company=${encodeURIComponent(disclosureBrief.targetCompany || "")}&job=${encodeURIComponent(disclosureBrief.targetJob || "")}`}
              className="t-focus inline-flex items-center px-5 py-3 bg-t-amber text-white text-sm font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright transition-colors min-h-touch"
            >
              Open Disclosure Planner for {disclosureBrief.targetCompany || "this role"}
            </a>
          </div>
          </>}
        </div>
      )}

      {/* Resume editor -- only shown on resume tab */}
      {packageTab !== "resume" ? null : (
        <ResumeEditor
          doc={doc}
          onChange={updateDoc}
          onSummaryAssist={requestSummarySuggestion}
          summaryGenerating={generating}
          summarySuggestion={aiSuggestion}
          onUseSummarySuggestion={() => {
            updateDoc((d) => ({ ...d, summary: aiSuggestion! }));
            setAiSuggestion(null);
          }}
          actions={
            <>
              <button
                onClick={() => save(false)}
                className="t-focus px-5 py-3 bg-t-amber text-white font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright transition-colors min-h-touch"
              >
                {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save"}
              </button>
              <button
                onClick={() => downloadDocx("resume", formatResumeDownload(doc))}
                className="t-focus px-4 py-3 bg-transparent border border-t-amber text-t-amber-bright font-bold hover:bg-t-amber/10 transition-colors min-h-touch text-sm"
              >
                Download .docx
              </button>
              <button
                onClick={() => printResumePdf(doc)}
                className="t-focus px-4 py-3 bg-transparent border border-t-steel text-t-steel font-bold hover:bg-t-steel/10 transition-colors min-h-touch text-sm"
              >
                Save as PDF
              </button>
            </>
          }
          actionsHint=".docx = editable in Word. PDF = keeps the formatting exactly. Save both."
        />
      )}
    </div>
  );
}
