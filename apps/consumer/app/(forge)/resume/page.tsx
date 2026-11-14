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
import { useTranslations, useLocale } from "next-intl";
import { useForgeSession } from "@/lib/forge-context";
import { DEMO_SESSION } from "@/lib/demo-data";
import { getOpusMessage } from "@/lib/opus-messages";
import { FlowPage, GhostGuide, TroyAttention } from "@crucible/consumer-ui";
import { parseTextToResume, profileToResume } from "@/components/resume/resumeParsers";
import { formatResumeDownload, type ResumeDocument } from "@/components/resume/resumeModel";
import { ResumeBuilder } from "@/components/forge/ResumeBuilder";
import { SpeechInputButton } from "@/components/SpeechInputButton";
import { GroundingGauge } from "@/components/GroundingGauge";
import { computeGrounding, jobsFromParsedProfile } from "@/lib/grounding";
import { FORGE_UPLOAD_SIGN_IN_MESSAGE, forgeUploadAuthAction, forgeUploadErrorMessage, isUploadReturn } from "@/lib/forge-upload-error";
import { datedJobs, isLanesFirst, nextPath, planForgePath, resumeVariant, type ConfirmJob } from "@/lib/forge-path";
import type { ForgeSessionData } from "@/lib/forge-context";
import { useSession } from "next-auth/react";
import { sessionPending } from "@/lib/session-policy";
import { FirstReward, QuickBuild } from "@/components/forge/lanes/FirstSave";
import { IntakeHelp, PasteInline } from "@/components/forge/lanes/IntakeExtras";
import { REBUILD_PARAM } from "@/lib/lane-task";

/**
 * "Is this right?": the jobs and dates we read, shown back so the person
 * confirms them instead of typing them again (lib/forge-path.ts, rule R3).
 */
function JobsToConfirm({ jobs, heading }: { jobs: ConfirmJob[]; heading: string }) {
  const t = useTranslations("forgeResume.intake");
  return (
    <section className="mb-4 border border-t-line bg-t-panel" aria-labelledby="jobs-to-confirm" data-testid="jobs-to-confirm">
      <h2 id="jobs-to-confirm" className="border-b border-t-line bg-t-panel-2 px-4 py-2.5 text-sm font-semibold text-t-white">
        {heading}
      </h2>
      <ul className="divide-y divide-t-line">
        {jobs.map((j, i) => (
          <li key={i} className="px-4 py-3">
            <p className="font-medium text-t-white">
              {j.title || j.company}
              {j.title && j.company && <span className="font-normal text-t-phos">{" "}{t("jobsToConfirm.at", { company: j.company })}</span>}
            </p>
            <p className="mt-0.5 font-term text-xs text-t-phos-dim">
              {t("jobsToConfirm.range", { start: j.start, end: j.end || t("jobsToConfirm.now") })}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const jobsFromProfile = (profile: any): ConfirmJob[] =>
  datedJobs(
    (Array.isArray(profile?.work_history) ? profile.work_history : []).map((w: any) => ({
      title: w?.title,
      company: w?.company,
      start: w?.start_date,
      end: w?.end_date,
    }))
  );

const jobsFromDoc = (doc: ResumeDocument | undefined): ConfirmJob[] =>
  datedJobs(
    (doc?.experience ?? []).map((e) => ({ title: e.title, company: e.company, start: e.startDate, end: e.endDate }))
  );

type IntakePath = "upload" | "import" | "external" | "guided" | "paste" | "quick" | null;

/**
 * What forgeUploadErrorMessage (lib/forge-upload-error.ts) answers when the
 * server sent no message of its own. Compared at the render site only, so the
 * two client-made messages can be shown in the site language; a message that
 * came from the server is shown as it came.
 */
const UPLOAD_GENERIC_ERROR_EN = "Something went wrong. Try again?";

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
  const t = useTranslations("forgeResume.intake");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { session, updateSession } = useForgeSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDemo = session.isDemo === true;
  const audience = session.audience || "client";
  // Lanes first (Phase 5 R2, lib/forge-path.ts R9): two choices, the first
  // reward right away, and help tucked into a panel.
  const lanes = isLanesFirst(session);
  const { data: authData, status: authStatus } = useSession();
  const signedIn = authStatus === "authenticated" && !!authData?.user && !sessionPending(authData.user as any);
  // The page the person gave (paste), shown with its one fix (lanes first).
  const [rewardText, setRewardText] = useState<string | null>(null);

  // Track page visit
  useEffect(() => {
    updateSession({
      pagesVisited: Array.from(new Set([...(session.pagesVisited || []), "resume"])),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [activePath, setActivePath] = useState<IntakePath>(null);
  // The first Forge decision already chose a way in. Do not ask it twice.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const entry = new URLSearchParams(window.location.search).get("entry");
    if (entry === "upload" || entry === "quick") setActivePath(entry);
  }, []);
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
  // A saved resume is confirmed, not asked for again. "Use a different one"
  // opens the chooser without erasing the saved one until a new one lands.
  const [replacing, setReplacing] = useState(false);
  // FU1: back from a sign-in step. Open the file step and ask for the file
  // once more (a browser cannot keep it across the trip).
  const [pickAgain, setPickAgain] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !isUploadReturn(window.location.search)) return;
    setActivePath("upload");
    setPickAgain(true);
  }, []);

  // Phase 6 (plan Q1): "Build it with t.ROY" / "Rewrite it with t.ROY" on a
  // saved resume (lib/lane-task.ts rebuildHref). The person's newest saved
  // version (owner only, read as them) becomes the writer's source, and the
  // build runs. The saved resume itself is never changed here.
  const [rebuild, setRebuild] = useState<{ id: string; error?: string } | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get(REBUILD_PARAM);
    if (id) setRebuild({ id });
  }, []);
  useEffect(() => {
    if (!rebuild || rebuild.error || authStatus === "loading") return;
    const failed = t("rebuild.couldNotOpen");
    if (!signedIn) {
      setRebuild({ id: rebuild.id, error: t("rebuild.signInNeeded") });
      return;
    }
    let live = true;
    (async () => {
      try {
        // Round 2/3 (CC's truth rulings): the SERVER decides, owner only, what
        // on this saved resume counts as the person's own words, and the writer
        // reads them itself. The browser gets only the page (shown, and the
        // build's starting text). The run's own resume text, the one the account
        // keeps, is never changed by a rebuild (review r1 M3).
        const res = await fetch(`/api/revisions/rebuild?artifactId=${encodeURIComponent(rebuild.id)}`, { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as { pageText?: unknown } | null;
        const page = typeof data?.pageText === "string" ? data.pageText : "";
        if (!live) return;
        if (!res.ok || !page.trim()) {
          setRebuild({ id: rebuild.id, error: failed });
          return;
        }
        // A new build from that page: the documents of an earlier build no longer match.
        updateSession({
          originalResumeText: page,
          rebuild: { id: rebuild.id, page, resumeAt: session.resumeText ?? "" },
          forgeOutput: undefined,
          forgeFinish: undefined,
          laneParkedLetter: undefined,
          laneTask: session.laneTask || "resume",
          lastPageVisited: "resume",
        });
        router.replace("/goals");
      } catch {
        if (live) setRebuild({ id: rebuild.id, error: failed });
      }
    })();
    return () => {
      live = false;
    };
    // session is read for its lane only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuild, signedIn, authStatus]);

  /** Save, then go where this person's path goes next (not always goals). */
  function continueWith(updates: Partial<ForgeSessionData>) {
    updateSession(updates);
    router.push(nextPath(planForgePath({ ...session, ...updates }), "resume"));
  }

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
          // FU1: a half-finished sign-in goes to the step it is waiting on and
          // comes back to this file step (lib/forge-upload-error.ts).
          const next = forgeUploadAuthAction(res.status, data);
          if (next?.kind === "go") {
            window.location.assign(next.url);
            return;
          }
          setUploadError(forgeUploadErrorMessage(res.status, data?.error));
          return;
        }

        updateSession({
          resumeText: data.resumeText,
          originalResumeText: data.resumeText,
          resumeFileName: file.name,
          resumeMethod: "upload",
        });

        setParsedName(data.profile?.full_name || null);
        setParsedEmail(data.profile?.email || "");
        setParsedPhone(data.profile?.phone || "");
        setParsedProfile(data.profile || null);
        setUploadSuccess(true);
        setPickAgain(false);
      } catch (err) {
        setUploadError(t("upload.couldNotRead"));
      } finally {
        setUploading(false);
      }
    },
    [updateSession, t]
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

  // Phase 6 (Q1): opening a saved resume for the writer.
  if (rebuild) {
    return (
      <FlowPage
        title={rebuild.error ? t("rebuild.failedTitle") : t("rebuild.loadingTitle")}
        subtitle={rebuild.error ?? t("rebuild.loadingSubtitle")}
        showBack={!!rebuild.error}
        onBack={() => router.push("/dashboard/vault")}
      >
        <div data-testid="rebuild-status" data-state={rebuild.error ? "error" : "loading"} />
      </FlowPage>
    );
  }

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

  // Lanes first: the first reward. The page they gave and the one fix, then
  // the writer (Phase 6 Q1): the page is its source, never saved as the resume.
  if (lanes && !isDemo && (rewardText !== null || uploadSuccess)) {
    const text = rewardText ?? session.resumeText ?? "";
    return (
      <FirstReward
        text={text}
        onBack={() => {
          setRewardText(null);
          setUploadSuccess(false);
          setActivePath("upload");
        }}
        onBuild={() => continueWith({ lastPageVisited: "resume" })}
        onDoMore={() => continueWith({ pathExtras: Array.from(new Set([...(session.pathExtras || []), "preferences"])), lastPageVisited: "resume" })}
        onEditor={(t) => enterBuilder(t, { name: parsedName || undefined, email: parsedEmail || undefined, phone: parsedPhone || undefined }, rewardText === null ? parsedProfile : null)}
      />
    );
  }

  // Lanes first: "Build with me", one job and one true duty.
  if (lanes && !isDemo && activePath === "quick") {
    return (
      <QuickBuild
        signedIn={signedIn}
        onBack={() => setActivePath(null)}
        onContinue={() => continueWith({ lastPageVisited: "resume" })}
        onDoMore={() => continueWith({ pathExtras: Array.from(new Set([...(session.pathExtras || []), "preferences"])), lastPageVisited: "resume" })}
      />
    );
  }

  // Demo mode: show pre-filled resume and continue
  if (isDemo) {
    return (
      <FlowPage
        title={t("demo.title")}
        subtitle={t("demo.subtitle")}
        actionLabel={tc("actions.next")}
        onAction={() =>
          continueWith({
            resumeText: DEMO_SESSION.resumeText,
            resumeFileName: DEMO_SESSION.resumeFileName,
            resumeMethod: DEMO_SESSION.resumeMethod,
            lastPageVisited: "resume",
          })
        }
        showBack
        onBack={() => router.push("/welcome")}
      >
        <GhostGuide
          message={getOpusMessage("resume", audience, true, locale)}
          pageId="resume"
        />
        <div className="bg-t-panel-2 px-4 py-3 mb-4 border border-t-amber">
          <p className="text-sm text-t-amber-bright font-medium">
            {t("demo.banner")}
          </p>
        </div>
        <div className="bg-t-panel p-5 border border-t-line">
          <p className="text-sm text-t-phos font-medium mb-2">{t("demo.sample")}</p>
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
        title={t("rush.title")}
        subtitle={t("rush.subtitle")}
        actionLabel={tc("actions.continue")}
        onAction={() => continueWith({ lastPageVisited: "resume" })}
        showBack
        onBack={() => router.push("/welcome")}
        footer={
          <button
            onClick={() => {
              updateSession({ resumeText: undefined, originalResumeText: undefined, resumeMethod: undefined });
            }}
            className="text-t-amber-bright underline underline-offset-2 hover:text-t-amber"
          >
            {t("rush.useDifferent")}
          </button>
        }
      >
        <GhostGuide
          message={getOpusMessage("resume", audience, false, locale)}
          pageId="resume"
        />
        <div className="bg-t-panel p-5 border border-t-line">
          <p className="text-sm text-t-phos font-medium mb-2">
            {t("rush.from")}
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
    continueWith({
      resumeDoc: doc,
      resumeText: formatResumeDownload(doc),
      lastPageVisited: "resume",
    });
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

    const readJobs = jobsFromProfile(parsedProfile);

    return (
      <FlowPage
        title={parsedName ? t("read.gotItName", { name: parsedName }) : t("read.gotIt")}
        subtitle={
          readJobs.length
            ? t("read.subtitleJobs")
            : t("read.subtitleNoJobs")
        }
        actionLabel={readJobs.length ? t("read.actionJobs") : t("read.actionNoJobs")}
        onAction={commitAndContinue}
        showBack
        onBack={() => {
          setUploadSuccess(false);
          setActivePath("upload");
        }}
      >
        {/* The question this screen asks first: are these your jobs and dates? */}
        {readJobs.length > 0 && <JobsToConfirm jobs={readJobs} heading={t("jobsToConfirm.heading")} />}

        {/* Grounding gauge -- the honest contract: how much true material we have. */}
        {parsedProfile && (
          <GroundingGauge score={computeGrounding(jobsFromParsedProfile(parsedProfile))} />
        )}

        {/* Full resume preview */}
        <div className="bg-t-panel border border-t-line mb-4 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-t-line bg-t-panel-2">
            <p className="text-xs font-semibold text-t-phos uppercase">
              {t("read.previewLabel")}
            </p>
            <p className="text-xs text-t-phos-dim">{t("read.characters", { count: previewText.length })}</p>
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
            {t("read.doesntLookRight")}
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => { setUploadSuccess(false); setActivePath("upload"); }}
              className="t-focus flex-1 px-4 py-2.5 bg-transparent border border-t-line text-t-phos text-sm font-medium hover:border-t-phos-dim hover:text-t-white transition-colors"
            >
              {t("read.reupload")}
            </button>
            <button
              onClick={() => { setUploadSuccess(false); setActivePath("paste"); }}
              className="t-focus flex-1 px-4 py-2.5 bg-transparent border border-t-line text-t-phos text-sm font-medium hover:border-t-phos-dim hover:text-t-white transition-colors"
            >
              {t("read.pasteInstead")}
            </button>
          </div>
        </div>

        {/* Optional contact info -- only show fields that are missing */}
        {(!parsedEmail || !parsedPhone) && (
          <div className="bg-t-panel p-5 border border-t-line">
            <p className="text-sm font-medium text-t-white mb-1">
              {t("read.missingTitle")}
            </p>
            <p className="text-xs text-t-phos-dim mb-3">
              {t("read.missingNote")}
            </p>
            <div className="space-y-3">
              {!parsedPhone && (
                <div>
                  <label className="text-xs font-medium text-t-phos-dim block mb-1">
                    {t("read.phone")}
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
                    {t("read.email")}
                  </label>
                  <input
                    type="email"
                    value={parsedEmail}
                    onChange={(e) => setParsedEmail(e.target.value)}
                    placeholder={t("read.emailPlaceholder")}
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

  // --- A resume is already saved (coming back, or returning later) ---
  if (!activePath && !replacing && resumeVariant(session) === "saved") {
    const savedJobs = jobsFromDoc(session.resumeDoc);
    return (
      <FlowPage
        title={t("rush.title")}
        subtitle={savedJobs.length ? t("saved.subtitleJobs") : t("saved.subtitleNoJobs")}
        actionLabel={t("saved.action")}
        onAction={() => continueWith({ lastPageVisited: "resume" })}
        showBack
        onBack={() => router.push(lanes ? "/start?change=1" : "/welcome")}
        footer={
          <button
            onClick={() => setReplacing(true)}
            className="text-t-amber-bright underline underline-offset-2 hover:text-t-amber"
          >
            {t("saved.useDifferent")}
          </button>
        }
      >
        <GhostGuide message={getOpusMessage("resume", audience, false, locale)} pageId="resume" />
        {savedJobs.length > 0 ? (
          <JobsToConfirm jobs={savedJobs} heading={t("jobsToConfirm.heading")} />
        ) : (
          <div className="mb-4 border border-t-line bg-t-panel p-4">
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-t-phos-dim">
              {(session.resumeText || "").slice(0, 500)}
              {(session.resumeText || "").length > 500 ? "..." : ""}
            </p>
          </div>
        )}
        {session.resumeDoc && (
          <button
            type="button"
            onClick={() => setBuilderDoc(session.resumeDoc!)}
            className="t-focus min-h-touch w-full border border-t-line bg-t-panel px-4 py-2.5 text-sm font-medium text-t-phos transition-colors hover:border-t-phos-dim hover:text-t-white"
          >
            {t("saved.openEditor")}
          </button>
        )}
      </FlowPage>
    );
  }

  // --- Path Selection, lanes first: two choices, help in a panel ---
  if (!activePath && lanes) {
    return (
      <FlowPage
        title={t("choose.title")}
        subtitle={t("choose.lanesSubtitle")}
        showBack
        onBack={() => (replacing ? setReplacing(false) : router.push("/start?change=1"))}
      >
        <div className="flex flex-col gap-3" data-testid="intake-choices">
          <button
            onClick={() => setActivePath("upload")}
            className="t-focus w-full text-left px-5 py-4 border border-t-amber bg-t-panel-2 hover:border-t-amber-bright transition-all min-h-touch"
            data-testid="intake-have-one"
          >
            <span className="font-medium text-t-white">{t("choose.haveOneLabel")}</span>
            <p className="text-sm text-t-phos-dim mt-0.5">{t("choose.haveOneBody")}</p>
          </button>
          <button
            onClick={() => setActivePath("quick")}
            className="t-focus w-full text-left px-5 py-4 border border-t-line bg-t-panel hover:border-t-phos-dim transition-all min-h-touch"
            data-testid="intake-build"
          >
            <span className="font-medium text-t-white">{t("choose.buildLabel")}</span>
            <p className="text-sm text-t-phos-dim mt-0.5">{t("choose.buildBody")}</p>
          </button>
        </div>
        <p className="mt-5 text-sm text-t-phos-dim">{t("choose.hint")}</p>
        <IntakeHelp />
      </FlowPage>
    );
  }

  // --- Path Selection ---
  if (!activePath) {
    return (
      <FlowPage
        title={t("choose.title")}
        subtitle={t("choose.subtitle")}
        showBack
        onBack={() => (replacing ? setReplacing(false) : router.push("/welcome"))}
      >
        <GhostGuide
          message={getOpusMessage("resume", audience, false, locale)}
          pageId="resume"
        />
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setActivePath("paste")}
            className="t-focus w-full text-left px-5 py-4 border border-t-amber bg-t-panel-2 hover:border-t-amber-bright transition-all min-h-touch"
          >
            <span className="font-medium text-t-white">{t("choose.pasteLabel")}</span>
            <p className="text-sm text-t-phos-dim mt-0.5">
              {t("choose.pasteBody")}
            </p>
          </button>

          <button
            onClick={() => setActivePath("upload")}
            className="t-focus w-full text-left px-5 py-4 border border-t-line bg-t-panel hover:border-t-phos-dim transition-all min-h-touch"
          >
            <span className="font-medium text-t-white">{t("choose.uploadLabel")}</span>
            <p className="text-sm text-t-phos-dim mt-0.5">
              {t("choose.uploadBody")}
            </p>
          </button>

          <button
            onClick={() => setActivePath("import")}
            className="t-focus w-full text-left px-5 py-4 border border-t-line bg-t-panel hover:border-t-phos-dim transition-all min-h-touch"
          >
            <span className="font-medium text-t-white">{t("choose.importLabel")}</span>
            <p className="text-sm text-t-phos-dim mt-0.5">
              {t("choose.importBody")}
            </p>
          </button>

          <button
            onClick={() => setActivePath("external")}
            className="t-focus w-full text-left px-5 py-4 border border-t-line bg-t-panel hover:border-t-phos-dim transition-all min-h-touch"
          >
            <span className="font-medium text-t-white">{t("choose.externalLabel")}</span>
            <p className="text-sm text-t-phos-dim mt-0.5">
              {t("choose.externalBody")}
            </p>
          </button>

          {/* Divider */}
          <div className="relative my-1">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-t-line" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-t-bg px-3 text-xs text-t-phos-dim">{t("choose.divider")}</span>
            </div>
          </div>

          <button
            onClick={handleNoResume}
            className="t-focus w-full text-left px-5 py-4 border border-t-line bg-t-panel hover:border-t-phos-dim transition-all min-h-touch"
          >
            <span className="font-medium text-t-white">{t("choose.scratchLabel")}</span>
            <p className="text-sm text-t-phos-dim mt-0.5">
              {t("choose.scratchBody")}
            </p>
          </button>

          {/* Record-history recovery -- for users who can't recall employers/dates */}
          <div className="mt-2 bg-t-panel p-4 border border-t-line">
            <p className="text-sm font-medium text-t-white mb-1">
              {t("choose.recallTitle")}
            </p>
            <p className="text-xs text-t-phos-dim mb-3">
              {t("choose.recallNote")}
            </p>
            <div className="space-y-2">
              <a
                href="https://www.irs.gov/individuals/get-transcript"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-t-steel hover:text-t-amber-bright underline underline-offset-2"
              >
                {t("choose.recallIrs")}
              </a>
              <a
                href="https://www.theworknumber.com/employees"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-t-steel hover:text-t-amber-bright underline underline-offset-2"
              >
                {t("choose.recallWorkNumber")}
              </a>
              <a
                href="https://www.credly.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-t-steel hover:text-t-amber-bright underline underline-offset-2"
              >
                {t("choose.recallCredly")}
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
        title={t("upload.title")}
        subtitle={t("upload.subtitle")}
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
              <div className="relative w-36 border border-t-amber bg-t-bg p-3 text-left shadow-[5px_5px_0_rgba(155,109,29,0.22)]" aria-hidden="true">
                <div className="mb-2 h-1 w-16 bg-t-amber" />
                <div className="mb-1 h-1 w-full bg-t-line" />
                <div className="mb-1 h-1 w-3/4 bg-t-line" />
                <div className="h-1 w-5/6 bg-t-line" />
                <div className="absolute -right-3 -top-3 flex h-7 w-7 items-center justify-center border border-t-amber bg-t-panel motion-safe:animate-pulse"><span className="h-3 w-3 border-b-2 border-r-2 border-t-amber" /></div>
              </div>
              <p className="font-medium text-t-white">{t("upload.reading")}</p>
              <p className="text-sm text-t-phos-dim">{t("upload.readingSub")}</p>
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
                  {t("upload.drop")}
                </p>
                <p className="text-sm text-t-phos-dim mt-1">
                  {t("upload.dropTypes")}
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
          aria-label={t("upload.inputAria")}
        />

        {pickAgain && !uploadError && !uploading && (
          <p role="status" className="mt-4 p-4 bg-t-panel border border-t-amber text-sm text-t-white" data-testid="upload-pick-again">
            {t("upload.pickAgain")}
          </p>
        )}

        {uploadError && (
          <div className="mt-4 p-4 bg-t-panel border border-t-red">
            <p className="text-sm text-t-red">
              {uploadError === FORGE_UPLOAD_SIGN_IN_MESSAGE
                ? t("upload.signInMessage")
                : uploadError === UPLOAD_GENERIC_ERROR_EN
                  ? t("upload.genericError")
                  : uploadError}
            </p>
            <button
              onClick={lanes ? () => setActivePath("quick") : handleNoResume}
              className="text-sm text-t-amber-bright underline mt-2"
            >
              {t("upload.buildInstead")}
            </button>
          </div>
        )}

        {/* Lanes first: paste sits on the same screen, so there is nothing more to choose. */}
        {lanes && <PasteInline onDone={(text) => setRewardText(text)} />}
      </FlowPage>
    );
  }

  // --- Path B: Platform Import ---
  if (activePath === "import") {
    return (
      <FlowPage
        title={t("import.title")}
        subtitle={t("import.subtitle")}
        showBack
        onBack={() => setActivePath(null)}
        actionLabel={t("import.action")}
        onAction={() => setActivePath("upload")}
      >
        <div className="space-y-4">
          <div className="bg-t-panel p-5 border border-t-line">
            <h3 className="font-semibold text-t-white mb-2">{t("import.linkedinTitle")}</h3>
            <ol className="text-sm text-t-phos-dim space-y-1.5 list-decimal list-inside">
              <li>{t("import.linkedinStep1")}</li>
              <li>
                {t("import.linkedinStep2")}
              </li>
              <li>{t("import.linkedinStep3")}</li>
              <li>{t("import.linkedinStep4")}</li>
            </ol>
          </div>

          <div className="bg-t-panel p-5 border border-t-line">
            <h3 className="font-semibold text-t-white mb-2">{t("import.indeedTitle")}</h3>
            <ol className="text-sm text-t-phos-dim space-y-1.5 list-decimal list-inside">
              <li>
                {t("import.indeedStep1")}{" "}
                <a
                  href="https://profile.indeed.com/resume"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-t-steel underline"
                >
                  profile.indeed.com/resume
                </a>
              </li>
              <li>{t("import.indeedStep2")}</li>
              <li>{t("import.indeedStep3")}</li>
              <li>{t("import.indeedStep4")}</li>
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
        title={t("external.title")}
        subtitle={t("external.subtitle")}
        showBack
        onBack={() => setActivePath(null)}
        actionLabel={t("external.action")}
        onAction={() => setActivePath("upload")}
        footer={
          <button
            onClick={handleNoResume}
            className="text-t-amber-bright underline underline-offset-2"
          >
            {t("external.footer")}
          </button>
        }
      >
        <div className="space-y-3">
          {[
            {
              id: "canva",
              name: t("external.canvaName"),
              url: "https://www.canva.com/resumes/",
              note: t("external.canvaNote"),
            },
            {
              id: "docs",
              name: t("external.docsName"),
              url: "https://docs.google.com/document/u/0/?tgif=d&ftv=1",
              note: t("external.docsNote"),
            },
            {
              id: "indeed",
              name: t("external.indeedName"),
              url: "https://www.indeed.com/career-services/?collectorID=subnav",
              note: t("external.indeedNote"),
            },
          ].map((builder) => (
            <a
              key={builder.id}
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
  | "job-info"
  | "job-duties"
  | "job-more"
  | "skills"
  | "education"
  | "extras"
  | "review";

interface JobEntry {
  title: string;
  company: string;
  dates: string;
  duties: string;
}
const EMPTY_JOB: JobEntry = { title: "", company: "", dates: "", duties: "" };

function GuidedBuilder({
  onComplete,
  onBack,
}: {
  onComplete: (text: string) => void;
  onBack: () => void;
}) {
  const { updateSession } = useForgeSession();
  const t = useTranslations("forgeResume.guided");
  const tc = useTranslations("common");
  const [step, setStep] = useState<BuilderStep>("intro");
  // Work history is a dynamic list -- no cap. A long career is never stranded (F14).
  const [jobs, setJobs] = useState<JobEntry[]>([{ ...EMPTY_JOB }]);
  const [jobIdx, setJobIdx] = useState(0);
  const [answers, setAnswers] = useState({
    name: "",
    phone: "",
    email: "",
    city: "",
    skills: "",
    education: "",
    extras: "",
  });

  function set(field: string, value: string | boolean) {
    setAnswers((prev) => ({ ...prev, [field]: value }));
  }

  const curJob = jobs[jobIdx] ?? EMPTY_JOB;
  function setJobField(field: keyof JobEntry, value: string) {
    setJobs((prev) => prev.map((j, i) => (i === jobIdx ? { ...j, [field]: value } : j)));
  }

  function goNext() {
    switch (step) {
      case "intro":        setStep("name"); break;
      case "name":         setStep("contact"); break;
      case "contact":      setStep("job-info"); break;
      case "job-info":     setStep("job-duties"); break;
      case "job-duties":   setStep("job-more"); break;
      // "job-more" advances via its own Yes/No buttons (addAnotherJob / finishJobs).
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
      case "job-info":
        // Back out of an added job returns to the previous job's "add another?" prompt.
        if (jobIdx === 0) { setStep("contact"); }
        else { setJobIdx(jobIdx - 1); setStep("job-more"); }
        break;
      case "job-duties":  setStep("job-info"); break;
      case "job-more":    setStep("job-duties"); break;
      case "skills":      setStep("job-more"); break;
      case "education":   setStep("skills"); break;
      case "extras":      setStep("education"); break;
      case "review":      setStep("extras"); break;
    }
  }

  function addAnotherJob() {
    setJobs((prev) => [...prev, { ...EMPTY_JOB }]);
    setJobIdx(jobs.length); // new entry's index
    setStep("job-info");
  }
  function finishJobs() {
    setStep("skills");
  }

  function assembleResume(): string {
    const lines: string[] = [];
    lines.push(answers.name.trim());

    const contactParts = [answers.phone, answers.email, answers.city].filter(Boolean);
    if (contactParts.length) lines.push(contactParts.join(" | "));

    lines.push("");
    lines.push("WORK HISTORY");
    lines.push("");

    for (const job of jobs) {
      if (!(job.title || job.company || job.duties)) continue;
      const h = [job.title, job.company, job.dates].filter(Boolean).join(" | ");
      if (h) lines.push(h);
      if (job.duties) lines.push(job.duties.trim());
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
        title={t("intro.title")}
        subtitle={t("intro.subtitle")}
        actionLabel={t("intro.action")}
        onAction={goNext}
        showBack
        onBack={goBack}
      >
        <div className="space-y-4">
          <div className="bg-t-panel p-5 border border-t-line">
            <p className="text-sm text-t-phos leading-relaxed mb-3">
              {t.rich("intro.p1", { b: (chunks) => <strong className="text-t-white">{chunks}</strong> })}
            </p>
            <p className="text-sm text-t-phos-dim leading-relaxed">
              {t("intro.p2")}
            </p>
          </div>
          <div className="bg-t-panel-2 p-4 border border-t-line">
            <p className="text-xs font-medium text-t-white mb-1">{t("intro.gapsTitle")}</p>
            <p className="text-xs text-t-phos-dim leading-relaxed">
              {t("intro.gapsBody")}
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
        title={t("name.title")}
        subtitle={t("name.subtitle")}
        actionLabel={tc("actions.next")}
        actionDisabled={!answers.name.trim()}
        onAction={goNext}
        showBack
        onBack={goBack}
      >
        <input
          value={answers.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder={t("name.placeholder")}
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
        title={t("contact.title")}
        subtitle={t("contact.subtitle")}
        actionLabel={tc("actions.next")}
        onAction={goNext}
        showBack
        onBack={goBack}
        footer={
          <button onClick={goNext} className="text-t-phos-dim text-sm underline underline-offset-2 hover:text-t-amber-bright">
            {t("skipForNow")}
          </button>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-t-phos-dim block mb-1">{t("contact.phone")}</label>
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
            <label className="text-xs font-medium text-t-phos-dim block mb-1">{t("contact.email")}</label>
            <input
              value={answers.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder={t("contact.emailPlaceholder")}
              type="email"
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-t-phos-dim block mb-1">{t("contact.city")}</label>
            <input
              value={answers.city}
              onChange={(e) => set("city", e.target.value)}
              placeholder={t("contact.cityPlaceholder")}
              className={inputClass}
            />
          </div>
        </div>
      </FlowPage>
    );
  }

  // --- Job Info (one per job; the list is unbounded) ---
  if (step === "job-info") {
    const first = jobIdx === 0;
    return (
      <FlowPage
        title={first ? t("job.titleFirst") : t("job.titleNth", { number: jobIdx + 1 })}
        subtitle={
          first
            ? t("job.subtitleFirst")
            : t("job.subtitleNth")
        }
        actionLabel={tc("actions.next")}
        actionDisabled={!curJob.title.trim() && !curJob.company.trim()}
        onAction={goNext}
        showBack
        onBack={goBack}
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-t-phos-dim block mb-1">{t("job.titleLabel")}</label>
            <input
              value={curJob.title}
              onChange={(e) => setJobField("title", e.target.value)}
              placeholder={t("job.titlePlaceholder")}
              className={inputClass}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-t-phos-dim block mb-1">{t("job.companyLabel")}</label>
            <input
              value={curJob.company}
              onChange={(e) => setJobField("company", e.target.value)}
              placeholder={t("job.companyPlaceholder")}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-t-phos-dim block mb-1">{t("job.whenLabel")}</label>
            <input
              value={curJob.dates}
              onChange={(e) => setJobField("dates", e.target.value)}
              placeholder={t("job.whenPlaceholder")}
              className={inputClass}
            />
          </div>
        </div>
      </FlowPage>
    );
  }

  // --- Job Duties ---
  if (step === "job-duties") {
    return (
      <FlowPage
        title={t("duties.title")}
        subtitle={t("duties.subtitle")}
        actionLabel={tc("actions.next")}
        actionDisabled={!curJob.duties.trim()}
        onAction={goNext}
        showBack
        onBack={goBack}
        footer={
          <p className="text-xs text-muted">{t("duties.footer")}</p>
        }
      >
        <textarea
          id="forge-duties"
          value={curJob.duties}
          onChange={(e) => setJobField("duties", e.target.value)}
          placeholder={t("duties.placeholder")}
          rows={5}
          className={textareaClass}
          autoFocus
        />
        {/* Hardest screen #1: a blank box asking someone to describe years of
            their own work. This is where people write "responsible for" and
            move on, and where the whole resume is won or lost. */}
        <TroyAttention
          targetSelector="#forge-duties"
          surfaceId="forge-duties"
          enabled={!curJob.duties.trim()}
          message={t("duties.attention")}
        />
      </FlowPage>
    );
  }

  // --- Job More (add another? -- loops back to job-info, no cap) ---
  if (step === "job-more") {
    const count = jobs.filter((j) => j.title || j.company || j.duties).length;
    return (
      <FlowPage
        title={t("more.title")}
        subtitle={t("more.subtitle")}
        showBack
        onBack={goBack}
      >
        {count > 0 && (
          <p className="text-sm text-t-phos-dim mb-3">
            {t("more.count", { count })}
          </p>
        )}
        <div className="flex flex-col gap-3">
          <button
            onClick={addAnotherJob}
            className="t-focus w-full text-left px-5 py-4 border border-t-amber bg-t-panel-2 hover:border-t-amber-bright transition-all min-h-touch"
          >
            <span className="font-medium text-t-white">{t("more.yesLabel")}</span>
            <p className="text-sm text-t-phos-dim mt-0.5">{t("more.yesBody")}</p>
          </button>
          <button
            onClick={finishJobs}
            className="t-focus w-full text-left px-5 py-4 border border-t-line bg-t-panel hover:border-t-phos-dim transition-all min-h-touch"
          >
            <span className="font-medium text-t-white">{t("more.noLabel")}</span>
            <p className="text-sm text-t-phos-dim mt-0.5">{t("more.noBody")}</p>
          </button>
        </div>
      </FlowPage>
    );
  }

  // --- Skills ---
  if (step === "skills") {
    return (
      <FlowPage
        title={t("skills.title")}
        subtitle={t("skills.subtitle")}
        actionLabel={tc("actions.next")}
        actionDisabled={!answers.skills.trim()}
        onAction={goNext}
        showBack
        onBack={goBack}
        footer={
          <button onClick={goNext} className="text-t-phos-dim text-sm underline underline-offset-2 hover:text-t-amber-bright">
            {t("skipForNow")}
          </button>
        }
      >
        <textarea
          value={answers.skills}
          onChange={(e) => set("skills", e.target.value)}
          placeholder={t("skills.placeholder")}
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
        title={t("education.title")}
        subtitle={t("education.subtitle")}
        actionLabel={tc("actions.next")}
        onAction={goNext}
        showBack
        onBack={goBack}
        footer={
          <button onClick={goNext} className="text-t-phos-dim text-sm underline underline-offset-2 hover:text-t-amber-bright">
            {t("skipForNow")}
          </button>
        }
      >
        <textarea
          value={answers.education}
          onChange={(e) => set("education", e.target.value)}
          placeholder={t("education.placeholder")}
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
        title={t("extras.title")}
        subtitle={t("extras.subtitle")}
        actionLabel={tc("actions.next")}
        onAction={goNext}
        showBack
        onBack={goBack}
        footer={
          <button onClick={goNext} className="text-t-phos-dim text-sm underline underline-offset-2 hover:text-t-amber-bright">
            {t("extras.skip")}
          </button>
        }
      >
        <textarea
          value={answers.extras}
          onChange={(e) => set("extras", e.target.value)}
          placeholder={t("extras.placeholder")}
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
    const groundingJobs = jobs
      .filter((j) => j.title || j.company || j.duties)
      .map((j) => ({ employer: j.company, title: j.title, dates: j.dates, duties: j.duties }));
    return (
      <FlowPage
        title={t("review.title")}
        subtitle={t("review.subtitle")}
        actionLabel={t("review.action")}
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
              {t("review.draft")}
            </p>
            <p className="text-xs text-t-phos-dim">{t("review.characters", { count: assembled.length })}</p>
          </div>
          <div className="p-4 max-h-80 overflow-y-auto">
            <pre className="text-xs text-t-phos whitespace-pre-wrap leading-relaxed">
              {assembled}
            </pre>
          </div>
        </div>
        <p className="text-xs text-t-phos-dim">
          {t("review.note")}
        </p>
      </FlowPage>
    );
  }

  return null;
}

// --- Paste Resume sub-component ---

// Prompt the user can hand to their own AI (ChatGPT/Claude/etc.), then paste
// the reply back here. Server-side markdown stripping + AI parsing handles
// whatever formatting their AI produces. The prompt is what the person reads
// and what they copy, so it comes from the catalog (forgeResume.paste.aiPrompt).

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
  const t = useTranslations("forgeResume.paste");
  const tc = useTranslations("common");
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
      originalResumeText: finalText,
      resumeMethod: "paste",
      lastPageVisited: "resume",
    });
    setParsing(false);
    onComplete(finalText, seed, profile);
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(t("aiPrompt"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {}
  }

  return (
    <FlowPage
      title={t("title")}
      subtitle={t("subtitle")}
      actionLabel={parsing ? t("reading") : tc("actions.continue")}
      actionDisabled={text.trim().length < 20 || parsing}
      onAction={handleSubmit}
      showBack
      onBack={onBack}
      footer={
        <p className="text-xs text-t-phos-dim">
          {t("minimum")}
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
            {t("aiHelp")}
          </span>
          <span className="text-t-phos-dim text-sm ml-2">{showAiHelp ? t("hide") : t("show")}</span>
        </button>
        {showAiHelp && (
          <div className="px-4 pb-4 border-t border-t-line pt-3">
            <p className="text-xs text-t-phos-dim mb-2">
              {t("aiHelpNote")}
            </p>
            <div className="bg-t-panel-2 border border-t-line p-3 text-xs text-t-phos leading-relaxed mb-2">
              {t("aiPrompt")}
            </div>
            <button
              type="button"
              onClick={copyPrompt}
              className="t-focus px-3 py-1.5 text-xs font-bold bg-t-amber text-white hover:bg-t-amber-bright transition-colors"
            >
              {copied ? t("copied") : t("copy")}
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
        placeholder={t("placeholder")}
        rows={10}
        className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors resize-y min-h-[200px]"
        autoFocus
      />
      {text.length > 0 && text.trim().length < 20 && (
        <p className="text-xs text-t-amber-bright mt-2">
          {t("keepGoing")}
        </p>
      )}
    </FlowPage>
  );
}
