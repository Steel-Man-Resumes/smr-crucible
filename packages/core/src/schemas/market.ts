import { z } from 'zod';

export const MarketV1 = z.object({
  target_role: z.string(),
  target_location: z.string(),
  salary_low: z.number(),
  salary_mid: z.number(),
  salary_high: z.number(),
  hourly_equivalent: z.object({
    low: z.number(),
    mid: z.number(),
    high: z.number(),
  }),
  sources: z.array(z.string()),
  confidence: z.enum(['low', 'medium', 'high']),
  negotiation_leverage_points: z.array(z.string()),
});

export type MarketV1 = z.infer<typeof MarketV1>;
