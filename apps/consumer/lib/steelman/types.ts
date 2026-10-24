/**
 * Steel Man meter types. Pure: no database, no React.
 * Design record: the R1 meter-science memo (private session folder, 2026-10-23).
 */

/** The ten scored components, in hiring-process order (memo 3.2). */
export const COMPONENT_IDS = [
  "facts", "lines", "resumes", "lanes", "tailored",
  "sent", "practice", "disclosure", "proof", "feedback",
] as const;
export type ComponentId = typeof COMPONENT_IDS[number];

/** Unit counts per component. Missing ids count as zero. */
export type ComponentCounts = Partial<Record<ComponentId, number>>;

/** One scored unit that carries its own time (for the 30-day strip, streak and growth line). */
export interface DatedUnit { component: ComponentId; at: string }

export type BandId = "showing_up" | "in_the_game" | "covering_ground" | "putting_in_work" | "steel_man";

export interface SteelManRequirement { id: string; label: string; done: boolean; left: string }

export interface ComponentView {
  id: ComponentId; label: string; value: number; max: number; weight: number;
  count: number; cap: number; why: string; href: string;
}

export interface GainOption {
  id: ComponentId; points: number; minutes: number; perMinute: number;
  label: string; href: string;
}

export interface MeterMoment { key: string; label: string; at: string; kind: "milestone" | "bonus" }

export interface WeekStreak { weeks: number; reserveLeft: number; show: boolean }

/** GET /api/steelman, shared contract with the nav and tour lanes. */
export interface SteelManPayload {
  asOf: string;
  score: number;
  maxScore: number;
  band: { id: BandId; label: string; why: string };
  components: Array<Pick<ComponentView, "id" | "label" | "value" | "max" | "weight" | "why" | "href"> & { count: number; cap: number }>;
  steelMan: boolean;
  nextGain: { label: string; href: string };
  moments: MeterMoment[];
  /** Additive fields for the full stats page. The nav only reads the contract fields above. */
  marks?: Array<{ score: number; bandId: BandId; label: string }>;
  nextMark?: { score: number; label: string; pointsAway: number } | null;
  gains?: GainOption[];
  requirements?: SteelManRequirement[];
  days?: Array<{ day: string; units: number }>;
  streak?: WeekStreak;
  growth?: Array<{ day: string; score: number }>;
  reviewOffered?: boolean;
  /** Moments recorded by this read, so the client can ask the progress bar to celebrate. */
  awarded?: string[];
}
