import { z } from 'zod';

export const PortfolioPrefsV1 = z.object({
  theme: z.enum(['forge', 'executive', 'midnight', 'steel', 'nature', 'ocean']),
  accent_color: z.string(),
  tagline_style: z.enum(['professional', 'bold', 'friendly']),
  sections_enabled: z.object({
    about: z.boolean(),
    skills: z.boolean(),
    experience: z.boolean(),
    education: z.boolean(),
    certifications: z.boolean(),
    contact: z.boolean(),
  }),
});

export type PortfolioPrefsV1 = z.infer<typeof PortfolioPrefsV1>;

export const DEFAULT_PORTFOLIO_PREFS: PortfolioPrefsV1 = {
  theme: 'forge',
  accent_color: '#D4A84B',
  tagline_style: 'professional',
  sections_enabled: {
    about: true,
    skills: true,
    experience: true,
    education: true,
    certifications: true,
    contact: true,
  },
};
