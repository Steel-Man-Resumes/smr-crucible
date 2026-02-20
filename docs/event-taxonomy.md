# Event Taxonomy

All events emitted to the `event` table follow the `CrucibleEvent` envelope defined in `@crucible/core`.

## Event Categories

### Project Lifecycle
| Event Type | Description |
|---|---|
| `PROJECT_CREATED` | New project initialized |
| `PROJECT_UPDATED` | Project metadata changed |
| `PROJECT_ARCHIVED` | Project archived |

### Field Changes
| Event Type | Description |
|---|---|
| `FIELD_SET` | Single field value set or updated |
| `FIELD_BULK_SET` | Multiple fields set in one operation |
| `FIELD_UNSET` | Field value cleared |
| `FIELD_CORRECTION_APPLIED` | AI or human correction applied to a field |

### Documents
| Event Type | Description |
|---|---|
| `DOC_UPLOAD_COMPLETED` | File upload finished and stored in R2 |
| `DOC_TEXT_EXTRACTED` | Text extraction from document completed |
| `DOC_PARSE_COMPLETED` | Document parsing/structuring succeeded |
| `DOC_PARSE_FAILED` | Document parsing/structuring failed |

### Workflow Execution
| Event Type | Description |
|---|---|
| `RUN_QUEUED` | Workflow run added to job queue |
| `RUN_STARTED` | Worker picked up the run |
| `RUN_COMPLETED` | Run finished successfully |
| `RUN_FAILED` | Run failed |
| `STEP_STARTED` | Individual step within a run started |
| `STEP_COMPLETED` | Step completed successfully |
| `STEP_FAILED` | Step failed |
| `STEP_SKIPPED` | Step skipped (conditional logic) |

### AI Calls
| Event Type | Description |
|---|---|
| `AI_CALL_STARTED` | AI API call initiated |
| `AI_CALL_COMPLETED` | AI API call returned successfully |
| `AI_CALL_FAILED` | AI API call failed |
| `AI_FALLBACK_USED` | Primary AI failed, fallback provider used |

### Human Review
| Event Type | Description |
|---|---|
| `HUMAN_REVIEW_STARTED` | Artifact entered human review |
| `HUMAN_REVIEW_EDIT_APPLIED` | Reviewer made an edit |
| `HUMAN_REVIEW_APPROVED` | Reviewer approved the artifact |
| `HUMAN_REVIEW_REJECTED` | Reviewer rejected the artifact |
| `HUMAN_REVIEW_COMPLETED` | Review process completed |

### Artifacts
| Event Type | Description |
|---|---|
| `ARTIFACT_GENERATED` | Final deliverable generated |
| `ARTIFACT_DOWNLOADED` | User downloaded an artifact |

### Consent
| Event Type | Description |
|---|---|
| `CONSENT_GRANTED` | Subject granted consent for a scope |
| `CONSENT_REVOKED` | Subject revoked consent for a scope |

## Event Envelope Fields

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Unique event ID |
| `org_id` | UUID | Organization context |
| `project_id` | UUID? | Associated project (nullable) |
| `run_id` | UUID? | Associated workflow run (nullable) |
| `step_id` | UUID? | Associated step (nullable) |
| `ts` | Timestamp | Event timestamp |
| `event_type` | String | Event type from taxonomy above |
| `severity` | info/warn/error | Event severity |
| `actor_type` | user/staff/system/ai/admin | Who triggered the event |
| `actor_user_id` | UUID? | User ID if actor is human |
| `actor_label` | String? | Human-readable actor label |
| `data_classification` | public/internal/pii/sensitive_pii | Data sensitivity |
| `retention_class` | short/standard/long/research_eligible | How long to keep |
| `correlation_id` | UUID? | Links related events |
| `parent_event_id` | UUID? | Parent event for hierarchies |
| `payload` | JSONB | Event-specific data |
| `sensitive_ref` | String? | Reference to sensitive data stored separately |
