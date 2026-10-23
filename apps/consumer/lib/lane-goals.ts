/** Goal presets use existing document kinds and the person's shared fact history. */
import type { LaneKind } from "@crucible/core/src/careerLaneShared";

export interface LaneGoalPreset {
  id: string;
  label: string;
  kind: LaneKind;
  name: string;
  example: string;
  description: string;
}

export const LANE_GOAL_PRESETS: readonly LaneGoalPreset[] = [
  { id: "employment", label: "Employment", kind: "resume", name: "Employment", example: "Production supervisor", description: "Aim a resume and job versions at the work you want." },
  { id: "self-employment", label: "Self-employment or a business", kind: "resume", name: "Self-employment", example: "Housecleaning business", description: "Gather your work experience and evidence for working for yourself. Start with what you know, what you need to find out, and local support. This lane uses the existing resume tools." },
  { id: "freelance", label: "Freelance, contract or consulting", kind: "resume", name: "Freelance & consulting", example: "Freelance bookkeeping", description: "Show the projects, services and work you can back up. This lane uses the existing resume and letter tools." },
  { id: "apprenticeship", label: "Trade or apprenticeship", kind: "resume", name: "Trade & apprenticeship", example: "Electrical apprenticeship", description: "Bring together real work, training and credentials for a trade or apprenticeship application." },
  { id: "creative", label: "Creative work", kind: "creative", name: "Creative work", example: "Visual art", description: "Keep a practice record for an artist resume, bio and work samples. Your artist statement stays yours." },
  { id: "cv", label: "Academic or professional CV", kind: "cv", name: "Professional CV", example: "Teaching or clinical work", description: "Build a dated CV from your education, teaching, research or clinical work." },
  { id: "performer", label: "Performer", kind: "performer", name: "Performer", example: "Acting or music", description: "Keep credits, training and skills for a performer page." },
];

export function laneToolHref(kind: LaneKind, id: string): string | null {
  return kind === "resume" ? null : `/dashboard/${kind}?lane=${encodeURIComponent(id)}`;
}
