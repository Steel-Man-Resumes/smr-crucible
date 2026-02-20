import { z } from 'zod';

const ArtifactTask = z.object({
  artifact_key: z.string(),
  job_key: z.string(),
  consumes: z.array(z.string()),
  params: z.record(z.string(), z.unknown()).optional(),
  review_required: z.boolean(),
});

export const RunPlanV1 = z.object({
  tasks: z.array(ArtifactTask),
  conditional_exclusions: z.array(z.object({
    artifact_key: z.string(),
    reason: z.string(),
  })),
  estimated_cost_cents: z.number().optional(),
  estimated_duration_ms: z.number().optional(),
});

export type RunPlanV1 = z.infer<typeof RunPlanV1>;
