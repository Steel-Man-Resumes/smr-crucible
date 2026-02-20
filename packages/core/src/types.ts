// --- Enums ---

export type OrgRole = 'admin' | 'staff' | 'user';

export type ProjectStatus = 'active' | 'archived';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export type ActorType = 'user' | 'staff' | 'system' | 'ai' | 'admin';

export type Severity = 'info' | 'warn' | 'error';

export type DataClassification = 'public' | 'internal' | 'pii' | 'sensitive_pii';

export type RetentionClass = 'short' | 'standard' | 'long' | 'research_eligible';

export type ConsentScope = 'service' | 'analytics' | 'research';

export type ConsentStatus = 'granted' | 'revoked';

export type DocumentKind =
  | 'upload_pdf'
  | 'upload_docx'
  | 'upload_txt'
  | 'upload_image'
  | 'extracted_text'
  | 'normalized_json'
  | 'ai_output';

export type DocumentSource = 'user_upload' | 'ai_generated' | 'system_derived';

// --- Event Types ---

export type EventType =
  // Project lifecycle
  | 'PROJECT_CREATED'
  | 'PROJECT_UPDATED'
  | 'PROJECT_ARCHIVED'
  // Field changes (research gold)
  | 'FIELD_SET'
  | 'FIELD_BULK_SET'
  | 'FIELD_UNSET'
  | 'FIELD_CORRECTION_APPLIED'
  // Documents
  | 'DOC_UPLOAD_COMPLETED'
  | 'DOC_TEXT_EXTRACTED'
  | 'DOC_PARSE_COMPLETED'
  | 'DOC_PARSE_FAILED'
  // Workflow execution
  | 'RUN_QUEUED'
  | 'RUN_STARTED'
  | 'RUN_COMPLETED'
  | 'RUN_FAILED'
  | 'STEP_STARTED'
  | 'STEP_COMPLETED'
  | 'STEP_FAILED'
  | 'STEP_SKIPPED'
  // AI calls
  | 'AI_CALL_STARTED'
  | 'AI_CALL_COMPLETED'
  | 'AI_CALL_FAILED'
  | 'AI_FALLBACK_USED'
  // Human review
  | 'HUMAN_REVIEW_STARTED'
  | 'HUMAN_REVIEW_EDIT_APPLIED'
  | 'HUMAN_REVIEW_APPROVED'
  | 'HUMAN_REVIEW_REJECTED'
  | 'HUMAN_REVIEW_COMPLETED'
  // Artifacts
  | 'ARTIFACT_GENERATED'
  | 'ARTIFACT_DOWNLOADED'
  // Consent
  | 'CONSENT_GRANTED'
  | 'CONSENT_REVOKED';

// --- Event Envelope ---

export interface CrucibleEvent {
  id: string;
  org_id: string;
  project_id: string | null;
  run_id: string | null;
  step_id: string | null;
  ts: Date;
  event_type: EventType;
  severity: Severity;
  actor_type: ActorType;
  actor_user_id: string | null;
  actor_label: string | null;
  data_classification: DataClassification;
  retention_class: RetentionClass;
  correlation_id: string | null;
  parent_event_id: string | null;
  payload: Record<string, unknown>;
  sensitive_ref: string | null;
}
