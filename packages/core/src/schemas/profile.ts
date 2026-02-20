import { z } from 'zod';

const WorkHistoryEntry = z.object({
  company: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  raw_dates: z.string().optional(),
  bullets: z.array(z.string()),
  is_current: z.boolean().optional(),
});

const EducationEntry = z.object({
  institution: z.string(),
  credential: z.string(),
  field: z.string().nullable(),
  year: z.string().nullable(),
  is_completed: z.boolean().nullable().optional(),
});

const MilitaryInfo = z.object({
  branch: z.string().nullable(),
  rank: z.string().nullable(),
  years: z.string().nullable(),
  discharge: z.string().nullable(),
  mos: z.string().nullable().optional(),
}).nullable().optional();

export const ProfileV1 = z.object({
  full_name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zip: z.string().nullable(),
  work_history: z.array(WorkHistoryEntry),
  education: z.array(EducationEntry),
  certifications: z.array(z.string()),
  military: MilitaryInfo,
  raw_text: z.string(),
});

export type ProfileV1 = z.infer<typeof ProfileV1>;
