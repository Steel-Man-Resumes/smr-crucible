import { z } from 'zod';

const EmployerBase = z.object({
  name: z.string(),
  industry: z.string(),
  location: z.string(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  score: z.number(),
  job_count: z.number(),
  second_chance_friendly: z.boolean().nullable(),
  why_good_fit: z.string(),
});

const Tier1Employer = EmployerBase.extend({
  tier: z.literal(1),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  approach_strategy: z.string(),
  talking_points: z.array(z.string()),
  application_channel: z.string(),
  company_intel: z.string(),
  contact_name: z.string().nullable(),
});

const Tier2Employer = EmployerBase.extend({
  tier: z.literal(2),
  website: z.string().nullable(),
  application_channel: z.string(),
});

const Tier3Employer = EmployerBase.extend({
  tier: z.literal(3),
});

export const EmployersV1 = z.object({
  tier1: z.array(Tier1Employer),
  tier2: z.array(Tier2Employer),
  tier3: z.array(Tier3Employer),
  total_count: z.number(),
  tier_counts: z.object({
    tier1: z.number(),
    tier2: z.number(),
    tier3: z.number(),
  }),
});

export type EmployersV1 = z.infer<typeof EmployersV1>;

// Enriched version: employers.v1 base + Tier 1 contact enrichment
export const EmployersEnrichedV1 = EmployersV1;
export type EmployersEnrichedV1 = z.infer<typeof EmployersEnrichedV1>;
