/**
 * Zod schemas for consumer domain entities.
 * These validate data flowing through the Forge and Refinery.
 */

import { z } from "zod";

// --- Readiness Stage (Prochaska & DiClemente) ---

export const ReadinessStage = z.enum([
  "precontemplation",
  "contemplation",
  "preparation",
  "action",
  "maintenance",
]);

// --- Criminal Record Data ---

export const CriminalRecordData = z.object({
  type: z.enum(["misdemeanor", "felony", "both"]),
  charge_count: z.enum(["1", "2-3", "4+"]),
  most_recent: z.enum(["<1 year", "1-3 years", "3-5 years", "5-10 years", "10+ years"]),
  supervision: z.enum(["yes", "completed", "no"]),
  context: z.string().default(""),
});

// --- Consumer Profile ---

export const ConsumerProfileV1 = z.object({
  readiness_stage: ReadinessStage.optional(),
  profile_data: z.object({
    full_name: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
  }).passthrough().default({}),
  narrative_data: z.object({
    strengths: z.array(z.string()).default([]),
    story_arc: z.string().optional(),
    identity_narrative: z.string().optional(),
    goals_narrative: z.string().optional(),
  }).passthrough().default({ strengths: [] }),
  preferences: z.record(z.string(), z.unknown()).default({}),
  skills: z.array(z.object({
    name: z.string(),
    category: z.enum(["hard", "soft", "transferable"]),
    source: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  })).default([]),
  career_paths: z.array(z.object({
    title: z.string(),
    industry: z.string().optional(),
    match_reason: z.string().optional(),
    salary_range: z.string().optional(),
    barriers_addressed: z.array(z.string()).default([]),
  })).default([]),
});

// --- Consent Record ---

export const ConsentRecordV1 = z.object({
  consent_layer: z.enum(["core", "enhanced", "research", "sharing"]),
  status: z.enum(["granted", "revoked"]),
  consent_text_version: z.string(),
  collection_method: z.string().default("ui_toggle"),
});

// --- Forge Session ---

export const ForgeSessionV1 = z.object({
  session_id: z.string(),
  current_page: z.string().default("landing"),
  page_data: z.record(z.string(), z.unknown()).default({}),
  resume_text: z.string().optional(),
  parsed_profile: z.unknown().optional(),
  forge_output: z.unknown().optional(),
  status: z.enum(["in_progress", "completed", "abandoned"]).default("in_progress"),
});

// --- Decision Log ---

export const DecisionLogV1 = z.object({
  context_page: z.string(),
  model_provider: z.string(),
  model_id: z.string(),
  input_hash: z.string(),
  explanation: z.string().min(1, "AI must explain its recommendation"),
  output_summary: z.record(z.string(), z.unknown()).default({}),
  token_count: z.number().int().positive().optional(),
  latency_ms: z.number().int().min(0).optional(),
});

// --- Refinery Artifact ---

export const RefineryArtifactV1 = z.object({
  artifact_type: z.enum([
    "resume", "cover_letter", "disclosure_plan",
    "interview_prep", "resource_list", "job_match",
  ]),
  target_context: z.object({
    job_title: z.string().optional(),
    company: z.string().optional(),
    industry: z.string().optional(),
  }).passthrough().default({}),
  content: z.record(z.string(), z.unknown()),
  iteration_number: z.number().int().positive().default(1),
  scaffold_level: z.number().min(0).max(1).default(1.0),
});

// --- Forge Output (the narrative reconstruction) ---

export const ForgeOutputV1 = z.object({
  schema_version: z.literal("forge_output.v1"),
  generated_at: z.string(),
  // Strengths: what user can do (from resume + narrative)
  strengths: z.array(z.object({
    title: z.string(),
    evidence: z.string(),
    source: z.enum(["resume", "narrative", "ai_inferred"]),
  })),
  // Skills extracted
  skills: z.array(z.object({
    name: z.string(),
    category: z.enum(["hard", "soft", "transferable"]),
  })),
  // Barriers with matched resources
  barriers: z.array(z.object({
    type: z.string(),
    user_narrative: z.string().optional(),
    resources: z.array(z.object({
      name: z.string(),
      type: z.string(),
      url: z.string().optional(),
      description: z.string(),
    })),
    legal_notes: z.string().optional(),
  })).default([]),
  // Career paths with evidence
  career_paths: z.array(z.object({
    title: z.string(),
    industry: z.string().optional(),
    match_reason: z.string(),
    salary_range: z.string().optional(),
    next_steps: z.array(z.string()),
  })),
  // The narrative itself (user's words, reorganized and affirmed)
  narrative: z.object({
    headline: z.string(),
    summary: z.string(),
    reflection: z.string().optional(),
  }),
});
