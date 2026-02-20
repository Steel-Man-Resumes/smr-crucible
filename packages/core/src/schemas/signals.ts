import { z } from 'zod';

const Barriers = z.object({
  criminal_record: z.boolean(),
  employment_gap: z.boolean(),
  addiction_recovery: z.boolean(),
  housing: z.boolean(),
  transportation: z.boolean(),
  childcare: z.boolean(),
  other: z.boolean(),
});

export const SignalsV1 = z.object({
  industry_primary: z.string(),
  industry_secondary: z.string().nullable(),
  seniority_level: z.enum(['entry', 'mid', 'senior', 'lead']),
  years_experience: z.number(),
  barriers: Barriers,
  barriers_any: z.boolean(),
  ats_score: z.number().min(0).max(100),
  skills_technical: z.array(z.string()),
  skills_soft: z.array(z.string()),
  target_roles: z.array(z.string()),
  target_salary_range: z.object({
    low: z.number(),
    high: z.number(),
    hourly: z.boolean(),
  }),
  risk_notes: z.array(z.string()),
});

export type SignalsV1 = z.infer<typeof SignalsV1>;
