import type { ApplicationDocument } from "@crucible/core/src/applicationEvents";
import type { ArtifactRevision } from "@crucible/core/src/artifactRevision";
export interface SelectedApplication { id: string; company: string; job_title: string; resume_artifact_id: string | null; jd_full_text: string | null; jd_excerpt: string | null; jd_fetched_at: string | null; jd_truncated: boolean; }
export interface ApplicationContext { application: SelectedApplication; resumeSnapshot: ApplicationDocument | null; revision: ArtifactRevision | null; }
export interface ApplicationContextStore {
 application(userId: string, id: string): Promise<SelectedApplication | null>;
 documents(userId: string, id: string): Promise<ApplicationDocument[]>;
 latestRevision(userId: string, artifactId: string): Promise<ArtifactRevision | null>;
}
/** An authorized application comes first. Never query a supplied resume id or guess by title. */
export async function resolveApplicationContext(userId: string, id: string, store: ApplicationContextStore): Promise<ApplicationContext | null> {
 const application = await store.application(userId, id);
 if (!application) return null;
 const [documents, revision] = await Promise.all([store.documents(userId, id), application.resume_artifact_id ? store.latestRevision(userId, application.resume_artifact_id) : Promise.resolve(null)]);
 return { application, resumeSnapshot: documents.find(d => d.document_type === "resume") || null, revision };
}

export async function loadApplicationContext(userId: string, id: string): Promise<ApplicationContext | null> {
 if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
 const core = await import("@crucible/core");
 return resolveApplicationContext(userId, id, {
  application: (owner, appId) => core.getOneAsUser<SelectedApplication>(owner, `SELECT id, company, job_title, resume_artifact_id, jd_full_text, jd_excerpt, jd_fetched_at, jd_truncated FROM job_application WHERE id = $1 AND user_id = $2`, [appId, owner]),
  documents: core.listApplicationDocuments,
  latestRevision: core.getLatestRevision,
 });
}
