"use client";

/**
 * ResumeWorkspace — The unified resume editing experience.
 *
 * Split-pane on desktop (editor left, live preview right).
 * Toggle tabs on mobile.
 * Handles: state management, save/load, auto-save, Forge/Rush import.
 */

import { TroyWork } from "@crucible/consumer-ui";
import { SavedPackagePreview } from "./SavedPackagePreview";
import { CheckAndFinish } from "@/components/lanes/CheckAndFinish";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  type ResumeDocument,
  createEmptyResume,
  formatResumeDownload,
  migrateLegacyResume,
  upgradeToV3,
} from "./resumeModel";
import { parseRushToResume } from "./resumeParsers";
import { ResumeEditor } from "./ResumeEditor";
import { PageFitCheck } from "./PageFitCheck";
import { printResumePdf } from "./resumePrint";
import { RECHECK_HREF, RECHECK_LINE, needsRecheck } from "@/lib/recheck-copy";
import { ApplyActions } from "@/components/apply/ApplyActions";
import { BaselineSelector } from "@/components/apply/BaselineSelector";
import { isSamePerson } from "@/lib/is-same-person";
import { useSession } from "next-auth/react";
import { readOwnForgeSession } from "@/lib/forge-carry";
import { useLanes } from "@/components/lanes/useLanes";
import { LaneSwitcher } from "@/components/lanes/LaneSwitcher";
import { LaneIntro } from "@/components/lanes/LaneIntro";
import { laneFilterParam, laneIdForSave, MAIN_LANE_LABEL, FACTS_CARRY_COPY } from "@/lib/lanes";
import { EDIT_RESUME_HREF } from "@/lib/refinery-guards";

interface SavedResume {
  id: string;
  target_context: { targetJob?: string; targetCompany?: string };
  scaffold_level: number;
  iteration_number: number;
  updated_at: string;
  lane_id?: string | null;
  is_current?: boolean;
  is_locked?: boolean;
}

export function ResumeWorkspace() {
  const searchParams = useSearchParams();
  const router = useRouter();
  // The local Forge run is read only when it is marked as this user's
  // (shared-computer rule, lib/forge-carry.ts readOwnForgeSession).
  const ownerUid = useSession().data?.user?.id;
  const ownerUidRef = useRef(ownerUid);
  ownerUidRef.current = ownerUid;

  // Career lanes (074): the Tailor works in one lane at a time. New work is
  // saved into it; "Main" is work outside any named lane.
  const lanes = useLanes();
  const laneIdForNewWork = laneIdForSave(lanes.active);
  const laneIdRef = useRef<string | null>(laneIdForNewWork);
  laneIdRef.current = laneIdForNewWork;
  // The person's base resume, across every lane: a new lane starts from it.
  const [baseResume, setBaseResume] = useState<SavedResume | null>(null);
  const [startingLane, setStartingLane] = useState(false);
  // The editor's own lane picker: switching saves this resume, then opens the
  // other lane's Tailor (a resume belongs to one lane; "Move to" in the
  // Library moves it).
  const [showLanePicker, setShowLanePicker] = useState(false);

  // Document state
  const [doc, setDoc] = useState<ResumeDocument>(createEmptyResume());
  const [showSetup, setShowSetup] = useState(true);

  // Persistence
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [savedResumes, setSavedResumes] = useState<SavedResume[]>([]);
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error" | "locked">("idle");
  const lastSaved = useRef<string>("");
  // Phase 5 R1: every download and print goes through a saved revision. The
  // last one prepared for this resume, so the page can say which version.
  const [exportRev, setExportRev] = useState<{ id: string; number: number; status: "draft" | "finished"; recheck?: boolean } | null>(null);
  const [exportError, setExportError] = useState("");
  const artifactIdRef = useRef<string | null>(null);
  // Review M3: the resume a Tailor output was made from (the approved base, or
  // the Forge resume). Saved as its parent, so its version starts from the
  // parent's settled answers: unchanged lines stay settled.
  const tailorParentRef = useRef<string | null>(null);
  useEffect(() => {
    artifactIdRef.current = artifactId;
    setExportRev(null);
    setExportError("");
  }, [artifactId]);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The artifact id whose content is currently loaded in the editor -- guards
  // the ?id= effect against re-fetch-and-clobber after a fork URL replace.
  const loadedIdRef = useRef<string | null>(null);

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

  // P2.0: pull the posting text from the pasted URL so the tailoring targets the
  // real description. Honest fallback ("paste it instead") on paywall/anti-bot/timeout.
  const [fetchingPosting, setFetchingPosting] = useState(false);
  const [fetchPostingMsg, setFetchPostingMsg] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);

  // Phase 3.2: when the JD text came from a URL fetch (not a hand paste), keep
  // the source URL + fetch time so the saved snapshot records provenance
  // ('fetched_url'). Cleared the moment the user edits the textarea by hand,
  // since then the text is effectively pasted/edited, not the fetched original.
  const [jdFetchMeta, setJdFetchMeta] = useState<{ url: string; fetchedAt: string } | null>(null);

  async function fetchPostingFromUrl() {
    const url = (doc.meta.jobListingUrl || "").trim();
    if (!url || fetchingPosting) return;
    setFetchingPosting(true);
    setFetchPostingMsg(null);
    try {
      const res = await fetch("/api/fetch-job-posting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && typeof data.text === "string") {
        setJobDescription(data.text);
        setJdFetchMeta({ url, fetchedAt: new Date().toISOString() });
        setFetchPostingMsg({
          kind: "ok",
          text: "Read the posting. Check it below and edit if anything is missing, then tailor.",
        });
      } else {
        setFetchPostingMsg({
          kind: "warn",
          text: data.message || "Could not read that link automatically. Paste the job description below instead.",
        });
      }
    } catch {
      setFetchPostingMsg({
        kind: "warn",
        text: "Could not read that link automatically. Paste the job description below instead.",
      });
    } finally {
      setFetchingPosting(false);
    }
  }

  // Full resume generation (from job board)
  const [generatingFull, setGeneratingFull] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [tailoringNotes, setTailoringNotes] = useState<string[]>([]);
  // The tailor's truth check result. It used to be computed and then
  // dropped here, so the person never saw a warning the server raised.
  const [truthCheck, setTruthCheck] = useState<{ blocked: boolean; notice: string; flags: string[] } | null>(null);

  // The saved job application this resume is being tailored for, if any. When
  // set, the saved resume artifact is linked to it (Stage 3 journey gate).
  const [targetApplicationId, setTargetApplicationId] = useState<string | null>(null);

  // Where to actually APPLY once the resume is ready (Wave R / R8). The ladder is
  // apply_url -> employer_website -> t.ROY-drafted email; `applied` reflects the
  // saved application's status so the CTA can flip to "Applied".
  const [applyInfo, setApplyInfo] = useState<{
    applyUrl: string | null;
    employerWebsite: string | null;
    applied: boolean;
  }>({ applyUrl: null, employerWebsite: null, applied: false });

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
  const [emailState, setEmailState] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [packageBusy, setPackageBusy] = useState(false);
  const packageEpoch = useRef(0);
  const hydratingRef = useRef(false);
  const savingRef = useRef(false);
  const [hydrating, setHydrating] = useState(false);
  const packageLaneRef = useRef<string | null>(laneIdForNewWork);
  const currentContentRef = useRef("");
  currentContentRef.current = JSON.stringify([doc, coverLetterText]);
  useEffect(() => () => { packageEpoch.current++; }, []);
  function resetPackage() {
    packageEpoch.current++;
    setEmailBusy(false); setPackageBusy(false); setGeneratingFull(false);
    if(autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setTargetApplicationId(null); setApplyInfo({applyUrl:null,employerWebsite:null,applied:false});
    setCoverLetterText(null); setDisclosureBrief(null); setTailoringNotes([]); setPackageTab("resume");
    setExportRev(null); setEmailState(""); setExportError(""); tailorParentRef.current=null;
  }


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
  const laneParam = laneFilterParam(lanes.active);
  const loadSavedResumes = useCallback(() => {
    if (!lanes.loaded) return;
    const lane = laneParam ? `&laneId=${encodeURIComponent(laneParam)}` : "";
    fetch(`/api/artifacts?type=resume&limit=20&examples=hide${lane}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => setSavedResumes(d.data || []))
      .catch(() => {})
      .finally(() => setSavedLoaded(true));
    // The base resume, wherever it sits: the pinned current one, else the
    // Forge's, else the newest approved baseline.
    fetch("/api/artifacts?type=resume&limit=50&examples=hide")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => {
        const all: SavedResume[] = d.data || [];
        setBaseResume(
          all.find((a) => a.is_current && (a.target_context as any)?.source !== "job" && !a.target_context?.targetCompany) ||
            all.find((a) => (a.target_context as any)?.source === "forge") ||
            all.find((a) => a.is_locked && (a.target_context as any)?.source !== "job" && !a.target_context?.targetCompany) ||
            null
        );
      })
      .catch(() => {});
  }, [lanes.loaded, laneParam]);

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
    const check = () => {
      const session = readOwnForgeSession(ownerUid);
      if (session && (session.forgeOutput || session.resumeText)) {
        setForgeAvailable(true);
      }
    };
    check();
    window.addEventListener("forge-synced", check);
    return () => window.removeEventListener("forge-synced", check);
  }, [ownerUid]);

  // --- Load from URL param ?id= ---
  // A locked baseline must never be opened under its own id (Phase 0.1 keeps
  // the write blocked at the SQL layer, but the workspace should not even try
  // -- and should not silently mask edits as read-only when a fork is the
  // right move). Phase 1A: fork it and open the fork instead.
  useEffect(() => {
    const id = searchParams.get("id");
    if (!id) return;
    // After a fork the URL is replaced with the fork's id, which re-runs this
    // effect. The document is already loaded then -- re-fetching would clobber
    // any keystroke made in the meantime.
    if (id === loadedIdRef.current) return;
    resetPackage();
    const epoch = packageEpoch.current;
    hydratingRef.current = true;
    setHydrating(true);
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/artifacts/${id}`, {cache: "no-store"});
        if (!response.ok) throw new Error("load");
        const data = await response.json();
        if (!data?.data || cancelled || epoch !== packageEpoch.current) return;
        let artifact = data.data;
        let forked = false;
        if (artifact.is_locked) {
          const jobId = searchParams.get("job");
          try {
            const result = await fetch(`/api/artifacts/${id}/fork`, {
              method: "POST", headers: {"Content-Type": "application/json"},
              body: JSON.stringify({reason: "tailor", operationKey: `tailor:${id}:${jobId || "manual"}`}),
            });
            if (result.ok) { artifact = (await result.json()).data; forked = true; }
          } catch { /* The original stays read-only when a fork is unavailable. */ }
        }
        if (cancelled || epoch !== packageEpoch.current) return;
        // Publish identity and content together. A failed optional revision read
        // must never leave an old document attached to the new artifact id.
        const content = artifact.content;
        let letter = typeof content.jobPackage?.coverLetterText === "string" ? content.jobPackage.coverLetterText : null;
        if (letter === null) {
          try {
            const result = await fetch(`/api/revisions?artifactId=${encodeURIComponent(artifact.id)}`, {cache: "no-store"});
            const revision = result.ok ? (await result.json()).revision : null;
            if (typeof revision?.letterText === "string") letter = revision.letterText;
          } catch { /* The saved artifact remains usable without a revision. */ }
        }
        if (cancelled || epoch !== packageEpoch.current) return;
        await lanes.setActive(artifact.lane_id || "main");
        if (cancelled || epoch !== packageEpoch.current) return;
        packageLaneRef.current = artifact.lane_id || null;
        loadedIdRef.current = artifact.id;
        artifactIdRef.current = artifact.id;
        setArtifactId(artifact.id);
        setDoc(content.formatVersion === 2 || content.formatVersion === 3 ? upgradeToV3(content) : migrateLegacyResume(content));
        setCoverLetterText(letter);
        setSaveStatus(artifact.is_locked ? "locked" : "idle");
        lastSaved.current = JSON.stringify(content);
        setShowSetup(false);
        if (forked) router.replace(`/dashboard/application-tailor?id=${artifact.id}`, {scroll: false});
      } catch {
        if (!cancelled && epoch === packageEpoch.current) setGenError("This resume could not be opened. Your saved work has not changed. Try opening it again.");
      } finally {
        if (!cancelled && epoch === packageEpoch.current) { hydratingRef.current = false; setHydrating(false); }
      }
    })();
    // lanes.setActive is stable per account; the lane list is not a reason to reload the document.
    return () => { cancelled = true; };
  }, [searchParams, router]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Recover the linked application when a tailored resume is opened directly
  // (?id=, or from "Your saved work") so the Apply CTA (R8) can appear even
  // when the user did not arrive through the job hand-off. ---
  useEffect(() => {
    if (!artifactId || targetApplicationId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/applications");
        if (!res.ok) return;
        const { applications } = await res.json();
        const app = (applications || []).find(
          (a: any) => a.resume_artifact_id === artifactId
        );
        if (!app || cancelled) return;
        setTargetApplicationId(app.id);
        setApplyInfo({
          applyUrl: app.apply_url || null,
          employerWebsite: app.employer_website || null,
          applied: app.status === "applied",
        });
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [artifactId, targetApplicationId]);

  // --- Next saved job to work on (R7 "what's next"): the next non-applied job
  // that still needs a tailored resume, so the workspace can point straight to
  // it once this one is applied. ---
  const [nextJob, setNextJob] = useState<{ id: string; title: string } | null>(null);
  useEffect(() => {
    if (!targetApplicationId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/applications");
        if (!res.ok) return;
        const { applications } = await res.json();
        const next = (applications || []).find(
          (a: any) =>
            a.id !== targetApplicationId &&
            !a.resume_artifact_id &&
            !["rejected", "declined", "applied"].includes(a.status)
        );
        if (!cancelled) setNextJob(next ? { id: next.id, title: next.job_title } : null);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [targetApplicationId, applyInfo.applied]);

  // Real strengths from the Forge session -- referenced only if t.ROY drafts an
  // application email (R8 rung 3). Never invents; empty is fine.
  function workspaceStrengths(): string[] {
    try {
      const s = readOwnForgeSession(ownerUidRef.current) || {};
      const raw = s?.forgeOutput?.strengths;
      if (Array.isArray(raw)) {
        return raw.map((x: any) => (typeof x === "string" ? x : x?.title)).filter(Boolean);
      }
    } catch {}
    return [];
  }

  const startTargetLoaded = useRef(false);
  useEffect(() => {
    if (searchParams.get("from") !== "start" || !ownerUid || startTargetLoaded.current) return;
    const run = readOwnForgeSession(ownerUid);
    if (!run) return;
    setJobDescription(run.laneJobPosting || "");
    setDoc((d) => ({ ...d, meta: { ...d.meta, targetJob: run.laneTarget || "" } }));
    startTargetLoaded.current = true;
  }, [searchParams, ownerUid]);

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
    if (!lanes.loaded || searchParams.get("from") !== "job") return;
    const jobData = sessionStorage.getItem("resume_target_job");
    if (!jobData) return;
    sessionStorage.removeItem("resume_target_job");
    try {
      runCareerPackage(JSON.parse(jobData), {});
    } catch {
      setGenError("Could not read the selected job. Try importing from Forge instead.");
    }
  }, [searchParams, lanes.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Updater function passed to section editors ---
  const updateDoc = useCallback(
    (fn: (prev: ResumeDocument) => ResumeDocument) => {
      setExportRev(null);
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
        // Where to apply -- persisted on the job_application so the Apply CTA
        // (R8) works from the workspace, the Applications tracker, and the saved
        // job list without a re-fetch of the original board listing.
        apply_url?: string | null;
        employer_website?: string | null;
        // Provenance for the created job_application (board = "jsearch",
        // typed/pasted in the Tailor = "manual"). Purely a label; the unlock
        // gate keys on the saved resume being job-targeted, not the source.
        source?: string;
        // Phase 3.2: JD-snapshot provenance for the created job_application.
        // The full JD text is `description` (unbounded in this flow); these
        // carry where it came from so the saved snapshot records it.
        jdSourceProvider?: string;
        jdSourceUrl?: string | null;
        jdFetchedAt?: string | null;
      },
      opts: { existingApplicationId?: string } = {}
    ) => {
      const epoch = ++packageEpoch.current;
      const generationLaneId = laneIdRef.current;
      packageLaneRef.current = generationLaneId;
      if(autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      setArtifactId(null); artifactIdRef.current=null; loadedIdRef.current=null; lastSaved.current="";
      setTargetApplicationId(null); setCoverLetterText(null); setDisclosureBrief(null); setTailoringNotes([]); setExportRev(null); setEmailState("");
      try {
        setGeneratingFull(true);
        setGenError(null);
        setShowSetup(false);

        // Pre-fill target info immediately
        updateDoc((d) => ({
          ...createEmptyResume(),
          meta: {
            ...createEmptyResume().meta,
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

        // Try localStorage first.
        //
        // Cross-ACCOUNT isolation: readOwnForgeSession returns the local run
        // only when it is marked as this user's (`_ownerUserId`). An unowned
        // run (a shared computer's previous person) is never read here.
        //
        // KNOWN LIMITATION, same account: if a newer Forge run was completed in
        // a different browser or origin, the database holds that run while this
        // browser still holds the older blob, and the blob wins below. Fixing it
        // properly means exposing a run timestamp from loadForgeProfile and
        // preferring the newer source; `consumer_profile` does not return one
        // today. Until then the reliable reset is a fresh account per persona
        // (the login page clears prior-account state) or Settings -> delete my
        // data.
        try {
          const session = readOwnForgeSession(ownerUidRef.current);
          if (session) {
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
            const artRes = await fetch("/api/artifacts?type=resume&limit=20&examples=hide");
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
        //
        // BUT the profile may only fill gaps when it is the SAME PERSON. One
        // account can carry a resume for someone else -- a staff member helping
        // a participant, or a demo persona -- and in that case the account's own
        // phone, email, city and state are a different human's contact details.
        // Silently pasting them onto the document is the worst failure this
        // screen can produce, so a name mismatch drops the profile entirely and
        // leaves the field blank. A blank phone is visible and fixable in one
        // click; the wrong person's phone ships.
        if (baseDocContact) {
          const fill: any = isSamePerson(baseDocContact.name, contactInfo.name)
            ? contactInfo
            : {};
          contactInfo = {
            name: baseDocContact.name || fill.name || "",
            phone: baseDocContact.phone || fill.phone || "",
            email: baseDocContact.email || fill.email || "",
            city: baseDocContact.city || fill.city || "",
            state: baseDocContact.state || fill.state || "",
          };
        }

        // R5/R6 -> 1A: resolve the person's HUMAN-APPROVED base resume -- the
        // one they are "searching as" (R6 active baseline) or their pinned
        // "current" resume -- and pass its ID. The server verifies ownership +
        // approval/lock state and loads the content itself (Phase 1A); the
        // client never sends approved text.
        let approvedArtifactId: string | undefined;
        try {
          const artRes = await fetch("/api/artifacts?type=resume&limit=50&examples=hide");
          if (artRes.ok) {
            const { data } = await artRes.json();
            const resumes: any[] = data || [];
            let activeId: string | null = null;
            try {
              activeId = localStorage.getItem("active_baseline_id");
            } catch {}
            const laneNow = generationLaneId;
            const laneCandidates = resumes.filter((a) => (a.lane_id || null) === (laneNow || null));
            const approvedBase =
              laneCandidates.find((a) => a.id === activeId && (a.is_locked || a.is_current)) ||
              laneCandidates.find((a) => a.is_locked || a.is_current) || null;
            if (approvedBase?.id) approvedArtifactId = approvedBase.id;
            const forgeBase = laneCandidates.find((a) => (a.target_context as any)?.source === "forge");
            tailorParentRef.current = approvedBase?.id || forgeBase?.id || null;
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
            ...(approvedArtifactId ? { approvedArtifactId } : {}),
            // The lane's own length choice is read on the server from this id.
            ...(generationLaneId ? { laneId: generationLaneId } : {}),
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Generation failed");
        }

        const { resume, coverLetter, disclosureBrief: brief, tailoringNotes: notes, grounding, finalizationBlocked, verificationNotice } = await res.json();
        if(epoch !== packageEpoch.current) return;
        const flagClaims: string[] = Array.isArray(grounding?.flags)
          ? grounding.flags.map((f: any) => (typeof f?.claim === "string" ? f.claim.trim() : "")).filter(Boolean).slice(0, 8)
          : [];
        setTruthCheck(
          finalizationBlocked || flagClaims.length || grounding?.hasFabrication
            ? { blocked: !!finalizationBlocked, notice: typeof verificationNotice === "string" ? verificationNotice : "", flags: flagClaims }
            : null
        );
        const finalResume = resume as ResumeDocument;
        // Keep the typed job-listing URL on the tailored doc (the generator
        // response doesn't echo it back).
        if (job.jobListingUrl && finalResume?.meta) {
          finalResume.meta = { ...finalResume.meta, jobListingUrl: job.jobListingUrl };
        }

        // Resolve the target application BEFORE rendering the workspace, so the
        // 5s autosave (which starts when the doc mounts) always sees the linked
        // applicationId -- otherwise the first save could persist the resume
        // unlinked, and unchanged content later blocks the re-save that would link
        // it (Codex 11). Server dedups manual re-runs on title+company.
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
                apply_url: job.apply_url || null,
                employer_website: job.employer_website || null,
                // Phase 3.2: persist the full pasted/fetched JD as the snapshot
                // (job.description is the unbounded text in this flow), with
                // provenance so fit-check / interview auto-fill read one source.
                jdFullText: job.description || "",
                jdSourceProvider:
                  job.jdSourceProvider ||
                  (job.description ? "pasted" : job.source || "jsearch"),
                jdSourceUrl: job.jdSourceUrl ?? job.apply_url ?? null,
                jdFetchedAt: job.jdFetchedAt ?? null,
                status: "saved",
              }),
            });
            if (appRes.ok) {
              const { application } = await appRes.json();
              if (application?.id) applicationId = application.id;
            }
          } catch {}
        }
        if(epoch !== packageEpoch.current) return;
        if (applicationId) setTargetApplicationId(applicationId);
        // Remember where to apply so the Apply CTA (R8) can surface the moment
        // the resume is ready.
        setApplyInfo({
          applyUrl: job.apply_url || null,
          employerWebsite: job.employer_website || null,
          applied: false,
        });

        setDoc(finalResume);
        if (coverLetter) setCoverLetterText(coverLetter);
        if (brief) setDisclosureBrief(brief);
        if (notes?.length) setTailoringNotes(notes);
        setPackageTab("resume");
        setGeneratingFull(false);

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
                ...(generationLaneId ? { laneId: generationLaneId } : {}),
              }),
            });
          } catch {}
        }
      } catch (err: any) {
        if(epoch !== packageEpoch.current) return;
        console.error("Career-package generation error:", err);
        setGenError(err.message || "Could not generate resume. Try importing from Forge instead.");
        setShowSetup(true);
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
    if (!appId || !lanes.loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/applications");
        if (!res.ok) return;
        const { applications } = await res.json();
        const app = (applications || []).find((a: any) => a.id === appId);
        if (!app || cancelled) return;
        // Carry the saved job's apply target + applied-state so the Apply CTA
        // (R8) shows the right rung whether or not the resume already exists.
        setApplyInfo({
          applyUrl: app.apply_url || null,
          employerWebsite: app.employer_website || null,
          applied: app.status === "applied",
        });
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
            description: app.jd_full_text || app.jd_excerpt || app.description,
            location: app.location,
            salary: app.salary,
            employment_type: app.employment_type,
            id: app.source_id,
            apply_url: app.apply_url,
            employer_website: app.employer_website,
          },
          { existingApplicationId: app.id }
        );
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, runCareerPackage, router, lanes.loaded]);

  // --- Save ---
  const save = useCallback(
    async (isAutoSave = false): Promise<string | null> => {
      if (hydratingRef.current || generatingFull || savingRef.current) return null;
      const saveEpoch = packageEpoch.current;
      const content = { ...doc, ...(targetApplicationId ? { jobPackage: { applicationId: targetApplicationId, coverLetterText: coverLetterText || "" } } : {}) };
      const contentStr = JSON.stringify(content);
      if (contentStr === lastSaved.current) {
        if (!isAutoSave) setSaveStatus("saved");
        return artifactId;
      }

      savingRef.current = true;
      setSaveStatus("saving");
      try {
        if (artifactId) {
          const res = await fetch(`/api/artifacts/${artifactId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, scaffoldLevel: 0.5 }),
          });
          if (res.ok) {
            if(saveEpoch !== packageEpoch.current) return null;
            lastSaved.current = contentStr;
            setSaveStatus("saved");
            window.dispatchEvent(new Event("resume-saved"));
            return artifactId;
          } else if (res.status === 409) {
            // Locked baseline: the server refused the write (Phase 0.1).
            // Do NOT touch lastSaved -- a manual Save after the user unlocks
            // it elsewhere must still send the real write. Autosave is
            // suppressed separately while status is "locked".
            if (saveEpoch === packageEpoch.current) setSaveStatus("locked");
            return null;
          } else {
            setSaveStatus("error");
            return null;
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
              ...(packageLaneRef.current ? { laneId: packageLaneRef.current } : {}),
              ...(tailorParentRef.current ? { parentArtifactId: tailorParentRef.current } : {}),
            }),
          });
          if (res.ok) {
            const { data } = await res.json();
            if(saveEpoch !== packageEpoch.current) return null;
            loadedIdRef.current = data.id;
            setArtifactId(data.id);
            lastSaved.current = contentStr;
            setSaveStatus("saved");
            router.replace(`/dashboard/application-tailor?id=${data.id}`, {
              scroll: false,
            });
            setSavedResumes((prev) => [data, ...prev]);
            // Signal the nav to re-check unlock state
            window.dispatchEvent(new Event("resume-saved"));
            artifactIdRef.current = data.id;
            return data.id as string;
          } else {
            setSaveStatus("error");
            return null;
          }
        }
      } catch {
        if (saveEpoch === packageEpoch.current) setSaveStatus("error");
        return null;
      } finally { savingRef.current = false; }
    },
    [doc, artifactId, router, targetApplicationId, coverLetterText, disclosureBrief, generatingFull]
  );

  // --- Auto-save (5s debounce after edits, only when past setup) ---
  // Suppressed while the artifact is a locked baseline: the server refuses
  // the write, so retrying every 5s is noise. A manual Save still attempts
  // (and succeeds once the user unlocks it in My Materials).
  useEffect(() => {
    if (showSetup || generatingFull || hydrating || saveStatus === "locked") return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => save(true), 5000);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [doc, showSetup, generatingFull, hydrating, saveStatus, save]);

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
  /**
   * Phase 5 R1: save, then get the revision that IS this resume as stored
   * (the server makes one from the stored content when needed, and decides
   * draft or finished). Every download and print here uses its id.
   */
  async function exportRevision(): Promise<string | null> {
    setExportError("");
    const epoch = packageEpoch.current;
    const snapshot = currentContentRef.current;
    const current = () => epoch === packageEpoch.current && snapshot === currentContentRef.current;
    const id = await save(false);
    if (!current()) return null;
    if (!id) {
      setExportError("Save your resume first, then download it.");
      return null;
    }
    try {
      const res = await fetch("/api/revisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "export", artifactId: id, letterText: coverLetterText ?? "" }),
      });
      const data = await res.json().catch(() => null);
      if (!current()) return null;
      if (!res.ok || !data?.revision?.id) throw new Error(String(res.status));
      setExportRev({ id: data.revision.id, number: data.revision.number, status: data.revision.status, recheck: needsRecheck(data.revision.openItems) });
      return data.revision.id as string;
    } catch {
      if (current()) setExportError("This version could not be prepared. Save your work and try again.");
      return null;
    }
  }

  async function downloadDocx(type: "resume" | "cover_letter", content: string, format: "pdf" | "docx" = "docx") {
    try {
      const revisionId = await exportRevision();
      if (!revisionId) return;
      const res = await fetch(targetApplicationId ? `/api/applications/package-preview?applicationId=${encodeURIComponent(targetApplicationId)}&revisionId=${encodeURIComponent(revisionId)}&kind=${type}&format=${format}` : "/api/forge/download", targetApplicationId ? {} : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Pass naming inputs so the download is a real slug
        // (First-Last--Company--Role.docx), Phase 2.6. The server takes the
        // text and the DRAFT decision from the revision; without one the
        // text sent is marked DRAFT.
        body: JSON.stringify({
          ...(revisionId ? { revisionId } : {}),
          content,
          type,
          format,
          name: doc.contact.name || "",
          company: doc.meta.targetCompany || "",
          role: doc.meta.targetJob || "",
        }),
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // The server sets Content-Disposition with the slugged name; mirror it
      // here for the programmatic click.
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      a.download = match?.[1] || (type === "resume" ? "Resume.docx" : "CoverLetter.docx");
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
  // A real job needs a title AND a company -- a bare title must never produce a
  // "job-targeted" resume that unlocks the toolset without a linked application
  // (Codex 5). The pasted job description is the sharper-tailoring enhancement.
  const canTailor = lanes.loaded && !lanes.switching && Boolean(doc.meta.targetJob.trim() && doc.meta.targetCompany.trim());

  function tailorForJob() {
    if (!canTailor) return;
    runCareerPackage(
      {
        title: doc.meta.targetJob,
        company: doc.meta.targetCompany,
        description: jobDescription.trim() || undefined,
        jobListingUrl: doc.meta.jobListingUrl || undefined,
        source: "manual",
        // Phase 3.2 provenance: fetched-from-URL text records 'fetched_url' +
        // the source URL + fetch time; a hand paste records 'pasted'.
        jdSourceProvider: jobDescription.trim()
          ? (jdFetchMeta ? "fetched_url" : "pasted")
          : undefined,
        jdSourceUrl: jdFetchMeta?.url ?? null,
        jdFetchedAt: jdFetchMeta?.fetchedAt ?? null,
      },
      {}
    );
  }

  // --- Start a lane's first resume from the base resume (no facts re-asked) ---
  const [laneStartError, setLaneStartError] = useState<string | null>(null);
  async function startLaneFromBase() {
    const lane = lanes.activeLane;
    if (!lane || !baseResume || startingLane) return;
    setStartingLane(true);
    setLaneStartError(null);
    try {
      const res = await fetch(`/api/artifacts/${baseResume.id}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "lane-start",
          operationKey: `lane-start:${lane.id}`,
          laneId: lane.id,
          targetContext: { targetJob: lane.target_role || lane.name, source: "lane" },
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { data: fork } = await res.json();
      // Same facts; only the aim changes. The copy's target line names this lane's job.
      const content = fork?.content;
      if (lane.target_role && content && typeof content === "object" && content.meta) {
        await fetch(`/api/artifacts/${fork.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: { ...content, meta: { ...content.meta, targetJob: lane.target_role } } }),
        }).catch(() => {});
      }
      setSavedResumes((prev) => [fork, ...prev]);
      loadResume(fork.id);
    } catch {
      setLaneStartError("That didn't work. Try again in a moment.");
    } finally {
      setStartingLane(false);
    }
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
    resetPackage();
    setArtifactId(null);
    router.replace(`/dashboard/application-tailor?id=${id}`, { scroll: false });
  }

  // --- New resume ---
  function startNewResume() {
    resetPackage(); loadedIdRef.current=null; artifactIdRef.current=null;
    hydratingRef.current=false; setHydrating(false); packageLaneRef.current=laneIdRef.current;
    setArtifactId(null);
    setDoc(createEmptyResume());
    lastSaved.current = "";
    setSaveStatus("idle");
    setShowSetup(true);
    router.replace("/dashboard/application-tailor", { scroll: false });
  }

  // --- Full resume generation loading state ---
  if (hydrating) return <p role="status" className="p-6 font-mono text-purple-300">Opening your saved work…</p>;
  if (generatingFull) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-t-white mb-2">
          Building Your Career Package
        </h1>
        <div className="bg-t-panel p-8 border border-t-line text-center mt-6">
          <div className="mx-auto mb-4 flex justify-center"><TroyWork topic="resume" label="Preparing your resume and cover letter" /></div>
          <p className="font-mono text-sm font-medium text-purple-300">
            Building your package for {doc.meta.targetJob || "this job"}
            {doc.meta.targetCompany ? ` at ${doc.meta.targetCompany}` : ""}...
          </p>
          <p className="text-xs text-t-phos-dim mt-2">
            Preparing your job-specific resume and cover letter, then checking the wording against your source facts. This can take a little time.
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
        {/* Career lanes (074): which lane this tool is working in. */}
        <div className="mb-4 space-y-3">
          <LaneSwitcher lanes={lanes} value={lanes.active} onChange={(c) => lanes.setActive(c)} />
          <LaneIntro lanes={lanes} tool="tailor" laneId={laneIdForNewWork} />
          {lanes.activeLane && savedLoaded && savedResumes.length === 0 && baseResume && (
            <div data-testid="lane-empty" className="border border-t-amber bg-t-panel p-4 space-y-2">
              <p className="text-sm font-semibold text-t-white">
                No resume in your {lanes.activeLane.name} lane yet.
              </p>
              <p className="text-xs text-t-phos-dim">{FACTS_CARRY_COPY}</p>
              <button
                type="button"
                data-testid="lane-start-from-base"
                onClick={startLaneFromBase}
                disabled={startingLane}
                className="t-focus w-full sm:w-auto min-h-touch px-5 bg-t-amber text-white font-bold hover:bg-t-amber-bright disabled:opacity-50"
              >
                {startingLane ? "Starting..." : "Start it from my base resume"}
              </button>
              {laneStartError && <p className="text-xs text-t-red" role="alert">{laneStartError}</p>}
            </div>
          )}
        </div>
        <p className="text-base text-t-phos-dim mb-2">
          Aim your base resume at a specific job. We use your Forge profile to
          tailor your resume, cover letter, and disclosure plan to the exact
          posting.
        </p>
        <p className="text-sm text-t-phos-dim mb-4">
          Tailor one job here, or pick up to 3 on the Job Board and tailor them
          together. Each job still gets its own resume and its own AI action.
          Saved jobs wait for you under your saved jobs.
        </p>
        <section className="mb-5 border border-purple-400/40 bg-t-panel p-4">
          <h2 className="font-bold text-t-white">Start with a real opening</h2>
          <p className="mt-2 text-sm text-t-phos">Find a job in this lane, then bring it here. We will use the posting to prepare your resume and cover letter together. For a different career direction, switch lanes first.</p>
          <a href={`/dashboard/jobs?laneId=${encodeURIComponent(lanes.active || "main")}`} className="t-focus mt-3 inline-flex min-h-touch items-center bg-purple-700 px-4 py-2 font-bold text-white">Find a job in this lane</a>
          <p className="mt-2 text-xs text-t-phos-dim">Already found the job? Enter its details below. Open a saved resume below when you want to continue an existing package.</p>
        </section>
        {/* R6: which approved baseline this tailoring restructures. Tailoring
            within a lane sharpens that baseline without downgrading it. */}
        <div className="mb-8">
          <BaselineSelector />
        </div>

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
                              your starting point from The Forge
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
              Already have a job posting?
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
              Which company?{" "}
              <span className="font-normal text-t-phos-dim">(required so we can tailor to a specific employer)</span>
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
            {doc.meta.jobListingUrl.trim() && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={fetchPostingFromUrl}
                  disabled={fetchingPosting}
                  className="t-focus text-sm font-medium text-t-amber-bright hover:text-t-amber disabled:opacity-50"
                >
                  {fetchingPosting ? "Reading the posting..." : "Read the posting from this link"}
                </button>
                <p className="text-xs text-t-phos-dim mt-1">
                  We try to pull the description so we can tailor to it. Some sites block
                  automatic reading. If that happens, just paste the text below.
                </p>
                {fetchPostingMsg && (
                  <p
                    className={`text-xs mt-1 ${
                      fetchPostingMsg.kind === "ok" ? "text-t-amber-bright" : "text-t-amber-bright"
                    }`}
                  >
                    {fetchPostingMsg.text}
                  </p>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-t-white block mb-1">
              Paste the job description{" "}
              <span className="font-normal text-t-phos-dim">(optional, but it makes the tailoring sharper)</span>
            </label>
            <textarea
              value={jobDescription}
              onChange={(e) => { setJobDescription(e.target.value); setJdFetchMeta(null); }}
              placeholder="Paste the posting's duties and requirements here. We tailor your resume to what this employer actually asks for, using only what's true about you."
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
            !!baseResume ||
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
                    disabled={!canTailor}
                    data-tour="tailor-generate"
                    className="t-focus w-full px-6 py-4 bg-t-amber text-white text-base font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright disabled:opacity-40 disabled:shadow-none transition-colors min-h-touch"
                  >
                    Tailor my resume for this job
                  </button>
                  <p className="text-xs text-t-phos-dim text-center">
                    {!canTailor
                      ? "Add the job title and the company to tailor your resume to a specific posting."
                      : jobDescription.trim()
                        ? "Uses your base resume and the job description you pasted. Only what's true about you, aimed at this posting."
                        : "Uses your base resume. Paste the job description above for a sharper match. Only what's true about you, aimed at this posting."}
                  </p>
                  <a
                    href={EDIT_RESUME_HREF}
                    className="t-focus block w-full text-center px-6 py-4 bg-transparent border border-t-amber text-t-amber-bright text-base font-bold hover:bg-t-amber/10 transition-colors min-h-touch"
                  >
                    Rebuild my base resume in the Forge
                  </a>
                </>
              ) : (
                <>
                  <a
                    href={EDIT_RESUME_HREF}
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
          <p className="text-xs text-t-phos-dim" data-testid="workspace-lane">
            Lane: <span className="font-semibold text-t-phos">{lanes.activeLane?.name ?? MAIN_LANE_LABEL}</span>
            {" "}
            <button
              type="button"
              data-testid="workspace-switch-lane"
              aria-expanded={showLanePicker}
              onClick={() => setShowLanePicker((v) => !v)}
              className="t-focus underline hover:text-t-white"
            >
              Switch lane
            </button>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {saveStatus === "error" && (
            <span className="text-xs text-t-red">Save failed</span>
          )}
          {saveStatus === "locked" && (
            <span className="text-xs text-t-amber-bright">
              Locked baseline. Edits are not saved. Unlock it in My resumes to change it.
            </span>
          )}
          <button
            onClick={startNewResume}
            className="text-xs text-t-phos-dim hover:text-t-white"
          >
            + New
          </button>
        </div>
      </div>

      {showLanePicker && (
        <div className="mb-4">
          <LaneSwitcher
            lanes={lanes}
            value={lanes.active}
            onChange={async (c) => {
              if (!await save()) return;
              if (!await lanes.setActive(c)) return;
              laneIdRef.current = laneIdForSave(c);
              setShowLanePicker(false);
              startNewResume();
            }}
          />
        </div>
      )}

      {/* What the truth check found in this tailored version */}
      {truthCheck && (
        <div className="mb-4 bg-t-panel border border-t-amber px-4 py-3">
          <p className="text-xs font-bold text-t-amber-bright uppercase mb-1">
            Check these before you send
          </p>
          {truthCheck.blocked && truthCheck.notice && (
            <p className="text-xs text-t-phos leading-relaxed mb-1">{truthCheck.notice}</p>
          )}
          {truthCheck.flags.length > 0 ? (
            <>
              <p className="text-xs text-t-phos leading-relaxed">
                The truth check found {truthCheck.flags.length === 1 ? "something" : "some things"} we could not match to what you told us. Look for each one and make sure it is true before you send this:
              </p>
              <ul className="mt-1.5 space-y-1">
                {truthCheck.flags.map((claim, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-t-phos">&ldquo;{claim}&rdquo;</li>
                ))}
              </ul>
            </>
          ) : (
            !truthCheck.blocked && (
              <p className="text-xs text-t-phos leading-relaxed">
                The truth check found something in this version it could not match to what you told us, but could not point to the exact words. Read every line before you send it.
              </p>
            )
          )}
        </div>
      )}

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
                <span className="text-t-phos-dim flex-shrink-0">-</span>
                {note}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-t-phos-dim mt-2 italic">
            Use these points in your disclosure and interview prep. They are where your profile and this job connect.
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
          <div className="px-6 pb-5">
            <p className="text-xs text-t-phos-dim bg-t-panel-2 border border-t-line px-3 py-2 leading-relaxed">
              <span className="font-semibold text-t-white">Make it yours before you send.</span>{" "}
              Download the .docx and personalize it. Confirm the hiring manager&rsquo;s
              name, drop in any specific details about the company, and adjust the
              opening if you want. A cover letter usually goes in your email body, so
              keep it editable. Save a PDF later, once it reads exactly how you want.
            </p>
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
          guided
          draft={exportRev?.status !== "finished"}
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
                onClick={() => targetApplicationId ? void downloadDocx("resume", formatResumeDownload(doc), "pdf") : printResumePdf(doc, { prepare: exportRevision })}
                className="t-focus px-4 py-3 bg-transparent border border-t-steel text-t-steel font-bold hover:bg-t-steel/10 transition-colors min-h-touch text-sm"
              >
                Save as PDF
              </button>
              {/* Phase 2.5: page-fit estimate of the exact .docx the Download
                  button produces -- same content-derivation (formatResumeDownload). */}
              <PageFitCheck getContent={() => formatResumeDownload(doc)} />
              {(exportRev || exportError) && (
                <p className="w-full text-xs text-t-phos" role="status" data-testid="workspace-version">
                  {exportError
                    ? exportError
                    : exportRev!.status === "finished"
                      ? `Version ${exportRev!.number}, finished. Downloads use this exact version.`
                      : exportRev!.recheck
                        ? <>{RECHECK_LINE} <a href={RECHECK_HREF} className="underline underline-offset-2" data-testid="workspace-recheck">Check it again</a></>
                        : "Draft: check it before you send it."}
                </p>
              )}
              {/* Phase 5 R2: the way out of DRAFT for a Tailor result: the same cards, saved as a revision of this resume. */}
              {artifactId && (
                <CheckAndFinish
                  key={`${artifactId}:${exportRev?.id ?? ""}`}
                  artifactId={artifactId}
                  status={exportRev ? exportRev.status : null}
                  showBadge={!exportRev}
                  className="w-full"
                />
              )}
            </>
          }
          actionsHint=".docx = editable in Word. PDF = keeps the formatting exactly. Save both."
        />
      )}
      {/* Ready to apply -- the Apply ladder (R8) plus what's next (R7). Appears
          once this resume is tied to a real saved job. */}
      {targetApplicationId && !generatingFull && (
        <div className="mb-4 bg-t-panel border border-t-amber p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="text-t-amber flex-shrink-0">
              <path d="M14 2L7 9M14 2l-4.5 12-2.5-5-5-2.5L14 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            <span className="text-sm font-bold text-t-amber-bright">
              {applyInfo.applied ? "Applied, nice work" : "Your next step: send this application"}
            </span>
          </div>
          <p className="text-xs text-t-phos-dim mb-3">
            {applyInfo.applied
              ? `You applied to ${doc.meta.targetCompany || "this job"}. Keep the momentum going.`
              : "Review your saved pages, then use the employer link below. We recommend working through each line with t.ROY; you can return to refine your Master Draft as you learn more."}
          </p>
          <div className="mb-4 flex flex-wrap gap-3">
            <button disabled={packageBusy || emailBusy} onClick={async()=>{const epoch=packageEpoch.current;setPackageBusy(true);try{await exportRevision();}finally{if(epoch===packageEpoch.current)setPackageBusy(false);}}} className="t-focus min-h-touch bg-purple-700 px-4 text-white disabled:opacity-50">{packageBusy ? "Saving your package…" : "Save package & review PDF"}</button>
            <button disabled={emailBusy || packageBusy} onClick={async()=>{const epoch=packageEpoch.current;const applicationId=targetApplicationId;setEmailBusy(true);setEmailState("");try{const revisionId=await exportRevision();if(!revisionId||epoch!==packageEpoch.current)return;const r=await fetch("/api/applications/email-package",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({applicationId,revisionId})});const result=await r.json();if(epoch!==packageEpoch.current)return;setEmailState(result.message||result.error||"Email could not be prepared.");}catch{if(epoch===packageEpoch.current)setEmailState("Email could not be prepared. Your saved files remain available.");}finally{if(epoch===packageEpoch.current)setEmailBusy(false);}}} className="t-focus min-h-touch border border-purple-400 px-4 text-purple-300 disabled:opacity-50">{emailBusy ? "Preparing your email…" : "Save & email this job package"}</button>
          </div>
          <p className="mb-3 text-xs text-t-phos-dim">Email includes this saved resume and cover letter, when present, with filenames and next steps for this job. Private disclosure notes stay in Refinery. Up to three package emails a day; downloads remain available.</p>
          {emailState && <p role="status" className="mb-3 text-sm text-t-phos">{emailState}</p>}
          {exportRev && <SavedPackagePreview revisionId={exportRev.id} applicationId={targetApplicationId} />}
          <ApplyActions
            applicationId={targetApplicationId}
            applyUrl={applyInfo.applyUrl}
            employerWebsite={applyInfo.employerWebsite}
            company={doc.meta.targetCompany || doc.meta.targetJob || "this employer"}
            applied={applyInfo.applied}
            onApplied={() => setApplyInfo((p) => ({ ...p, applied: true }))}
            forgeStrengths={workspaceStrengths()}
            candidateName={doc.contact.name}
            resumeArtifactId={artifactId}
          />
          <p className="mt-4 text-sm text-t-phos-dim">For a very similar role, reuse the useful wording and check it against the new posting. For a different role, find the job first and tailor from this lane’s baseline. A new career direction belongs in its own lane.</p>
          <a href={`/dashboard/jobs?laneId=${encodeURIComponent(laneIdRef.current || "main")}`} className="t-focus mt-2 inline-flex min-h-touch items-center text-purple-300 underline">Find another job in this lane</a>
          <a href="/dashboard/master" className="t-focus ml-4 inline-flex min-h-touch items-center text-purple-300 underline">Build my Master Draft</a>
          {/* What's next: the next saved job that still needs a tailored resume. */}
          <div className="mt-3 pt-3 border-t border-t-line">
            {nextJob ? (
              <a
                href={`/dashboard/application-tailor?job=${nextJob.id}`}
                className="t-focus text-xs font-medium text-t-steel underline underline-offset-2 hover:opacity-80"
              >
                Next: tailor your resume for {nextJob.title} &rarr;
              </a>
            ) : (
              <a
                href="/dashboard/applications"
                className="t-focus text-xs font-medium text-t-steel underline underline-offset-2 hover:opacity-80"
              >
                See all your saved jobs &rarr;
              </a>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
