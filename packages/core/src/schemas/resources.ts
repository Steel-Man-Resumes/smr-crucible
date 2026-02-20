import { z } from 'zod';

const ResourceEntry = z.object({
  name: z.string(),
  type: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  hours: z.string().nullable(),
  eligibility: z.string().nullable(),
  what_to_bring: z.string().nullable(),
  what_to_say_when_you_call: z.string().nullable(),
});

export const ResourcesV1 = z.object({
  resources: z.array(ResourceEntry),
  grouped_by_barrier_type: z.record(z.string(), z.array(z.string())),
  location_searched: z.string(),
});

export type ResourcesV1 = z.infer<typeof ResourcesV1>;
