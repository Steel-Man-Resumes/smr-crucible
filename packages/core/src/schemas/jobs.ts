import { z } from 'zod';

const JobEntry = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  salary: z.string().nullable(),
  url: z.string(),
  posted_date: z.string().nullable(),
  description_summary: z.string(),
  relevance_score: z.number().min(0).max(100),
  source: z.string(),
});

export const JobsV1 = z.object({
  jobs: z.array(JobEntry),
  query_used: z.string(),
  pages_fetched: z.number(),
  total_found: z.number(),
  fetched_at: z.string(),
});

export type JobsV1 = z.infer<typeof JobsV1>;
