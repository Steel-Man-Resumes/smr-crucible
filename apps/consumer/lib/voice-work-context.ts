import { createHash } from "node:crypto";
import type { ApplicationContext } from "@/lib/application-context";
import type { VoiceSessionBody } from "./voice-instructions";
import { sanitizeOrEmpty } from "./sanitize";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface VoiceWorkSelection {
  applicationId?: string;
  /** null deliberately selects general practice; undefined uses the saved job attachment. */
  resumeArtifactId?: string | null;
  resumeRevisionId?: string;
  resumeFingerprint?: string;
  postingFingerprint?: string;
}
export interface VoiceWorkContext {
  resumeText: string;
  resumeSource: "application_snapshot" | "saved_revision" | "saved_resume" | "none";
  jobDescription: string;
  jobSource: "saved_posting" | "pasted_posting" | "none";
  jobFetchedAt: string | null;
  jobTruncated: boolean;
}
export interface VoiceWorkStore {
  application(userId: string, id: string): Promise<ApplicationContext | null>;
  resume(userId: string, artifactId: string, revisionId?: string): Promise<{ text: string; revisionId?: string } | null>;
  snapshotText(context: ApplicationContext): string;
}
function selectedId(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("invalid_selection");
  return value.toLowerCase();
}
/** Browser IDs select owned work; browser text never substitutes for a saved document. */
export async function resolveVoiceWork(userId: string, input: VoiceSessionBody, store: VoiceWorkStore) {
  const raw = input && typeof input === "object" ? input : {};
  const selection: VoiceWorkSelection = {
    applicationId: selectedId(raw.applicationId),
    resumeArtifactId: raw.resumeArtifactId === null ? null : selectedId(raw.resumeArtifactId),
    resumeRevisionId: selectedId(raw.resumeRevisionId),
  };
  if (selection.resumeRevisionId && !selection.resumeArtifactId) throw new Error("selection_mismatch");
  const app = selection.applicationId ? await store.application(userId, selection.applicationId) : null;
  if (selection.applicationId && !app) throw new Error("selected_work_unavailable");
  const work: VoiceWorkContext = { resumeText: "", resumeSource: "none", jobDescription: "", jobSource: "none", jobFetchedAt: null, jobTruncated: false };
  const config = raw.config && typeof raw.config === "object" ? { ...raw.config } : {};
  if (app) {
    config.targetRole = [app.application.job_title, app.application.company].filter(Boolean).join(" at ");
    const posting = app.application.jd_full_text || app.application.jd_excerpt || app.application.description || "";
    work.jobDescription = posting.slice(0, 12000);
    work.jobSource = posting ? "saved_posting" : "none";
    work.jobFetchedAt = app.application.jd_fetched_at;
    work.jobTruncated = !!app.application.jd_truncated || posting.length > 12000;
    if (selection.resumeArtifactId === undefined) selection.resumeArtifactId = app.application.resume_artifact_id;
  } else {
    const posting = typeof raw.jobDescription === "string" ? raw.jobDescription.trim() : "";
    work.jobDescription = posting.slice(0, 12000);
    work.jobSource = posting ? "pasted_posting" : "none";
    work.jobTruncated = posting.length > 12000;
  }
  // Explicit general practice never borrows a resume from the account or lane.
  if (selection.resumeArtifactId) {
    if (app?.resumeSnapshot && selection.resumeArtifactId === app.application.resume_artifact_id && !selection.resumeRevisionId) {
      work.resumeText = store.snapshotText(app).slice(0, 12000);
      work.resumeSource = "application_snapshot";
    } else {
      const resume = await store.resume(userId, selection.resumeArtifactId, selection.resumeRevisionId);
      if (!resume) throw new Error("selected_work_unavailable");
      work.resumeText = resume.text.slice(0, 12000);
      work.resumeSource = resume.revisionId ? "saved_revision" : "saved_resume";
      selection.resumeRevisionId = resume.revisionId;
    }
  }
  // A document edited between reservation, call and report must not silently
  // change this practice's source material. These hashes contain no source text.
  const fingerprint = (text: string) => createHash("sha256").update(text).digest("hex");
  selection.resumeFingerprint = fingerprint(work.resumeText);
  selection.postingFingerprint = fingerprint(work.jobDescription);
  for (const field of ["resumeFingerprint", "postingFingerprint"] as const) {
    if (raw[field] !== undefined && raw[field] !== selection[field]) throw new Error("selected_work_changed");
  }
  // Only declared coaching inputs survive. In particular, ignore a supplied work/resume block.
  const body: VoiceSessionBody = { config: { targetRole: sanitizeOrEmpty(config.targetRole, 160), interviewType: sanitizeOrEmpty(config.interviewType, 80), includeDisclosure: config.includeDisclosure === true, focusAreas: Array.isArray(config.focusAreas) ? config.focusAreas.filter((v): v is string => typeof v === "string").slice(0, 4) : [] }, forgeContext: raw.forgeContext, ...selection, jobDescription: app ? undefined : work.jobDescription };
  return { body, work, selection };
}
export async function loadVoiceWork(userId: string, body: VoiceSessionBody) {
  const core = await import("@crucible/core");
  const { loadApplicationContext } = await import("@/lib/application-context");
  const { formatResumeDownload } = await import("@/components/resume/resumeModel");
  return resolveVoiceWork(userId, body, {
    application: loadApplicationContext,
    snapshotText: (context) => formatResumeDownload(context.resumeSnapshot!.content_snapshot as any),
    resume: async (owner, artifactId, revisionId) => {
      const artifact = await core.getArtifact(artifactId, owner);
      if (!artifact || artifact.is_demo || artifact.artifact_type !== "resume") return null;
      const revision = revisionId ? await core.getRevision(owner, revisionId) : await core.getLatestRevision(owner, artifactId);
      if (revisionId && (!revision || revision.artifact_id !== artifactId)) return null;
      return { text: revision?.resume_text || formatResumeDownload(artifact.content as any), revisionId: revision?.id };
    },
  });
}
