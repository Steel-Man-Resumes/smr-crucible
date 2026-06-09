/**
 * Forge-to-Refinery Pre-Architecture
 *
 * When Forge identifies career paths, barriers, and skills,
 * the Refinery pre-builds artifacts waiting for the user.
 *
 * This module reads Forge output and produces pre-built data
 * for each Refinery tool. Tools check for this on mount.
 */

import { getCareerPaths, getSkillNames } from "@/lib/forge-output";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ForgePreload {
  // Application Tailor: pre-populated skeleton
  resumeSkeleton: {
    professionalSummary: string;
    skills: string[];
    experience: Array<{
      title: string;
      company: string;
      dates: string;
      bullets: string[];
    }>;
    education: Array<{ institution: string; degree: string; year?: string }>;
    certifications: string[];
  } | null;

  // Job Board: pre-loaded searches based on career paths
  savedSearches: Array<{
    role: string;
    location: string;
  }>;

  // Disclosure Planner: pre-filled context
  disclosureContext: {
    recordType: string | null;
    recordDetails: string | null;
    jurisdiction: string | null;
  } | null;

  // Interview Practice: pre-filled target roles
  interviewRoles: string[];

  // Second Chance Board: priority categories from barriers
  priorityCategories: string[];
}

// ─── Builder ────────────────────────────────────────────────────────────────

export function buildForgePreload(forgeSession: Record<string, unknown>): ForgePreload {
  const output = forgeSession.forgeOutput as Record<string, unknown> | undefined;
  const preferences = forgeSession.preferences as Record<string, unknown> | undefined;
  const challenges = forgeSession.challenges as string[] | undefined;
  const criminalRecord = forgeSession.criminalRecord as Record<string, unknown> | undefined;

  // Resume skeleton
  let resumeSkeleton: ForgePreload["resumeSkeleton"] = null;
  if (output) {
    const narrative = output.narrative as Record<string, string> | undefined;
    const parsed = forgeSession.parsed as Record<string, unknown> | undefined;

    resumeSkeleton = {
      professionalSummary: narrative?.summary || "",
      skills: getSkillNames(output, 15),
      experience: extractExperience(parsed),
      education: extractEducation(parsed),
      certifications: extractCertifications(parsed),
    };
  }

  // Saved searches from career paths
  const savedSearches: ForgePreload["savedSearches"] = [];
  const careerPaths = getCareerPaths(output);
  if (careerPaths.length) {
    const location = (preferences?.location as string) || "Milwaukee, WI";
    for (const cp of careerPaths.slice(0, 3)) {
      savedSearches.push({ role: cp.title, location });
    }
  }

  // Disclosure context
  let disclosureContext: ForgePreload["disclosureContext"] = null;
  if (challenges?.includes("criminal_record")) {
    disclosureContext = {
      recordType: (criminalRecord?.type as string) || null,
      recordDetails: (criminalRecord?.details as string) || null,
      jurisdiction: (preferences?.location as string) || null,
    };
  }

  // Interview roles
  const interviewRoles: string[] = [];
  if (careerPaths.length) {
    for (const cp of careerPaths.slice(0, 3)) interviewRoles.push(cp.title);
  }

  // Priority resource categories from barriers
  const priorityCategories: string[] = [];
  if (challenges) {
    const barrierMap: Record<string, string[]> = {
      housing: ["housing"],
      transportation: ["transportation"],
      criminal_record: ["legal", "employment"],
      recovery: ["substance", "mental_health"],
      health: ["mental_health"],
      no_degree: ["education"],
      no_id: ["id_documents"],
    };
    for (const barrier of challenges) {
      const cats = barrierMap[barrier];
      if (cats) priorityCategories.push(...cats);
    }
  }

  return {
    resumeSkeleton,
    savedSearches,
    disclosureContext,
    interviewRoles,
    priorityCategories,
  };
}

// ─── Storage ────────────────────────────────────────────────────────────────

const PRELOAD_KEY = "forge_preload";

export function saveForgePreload(preload: ForgePreload): void {
  try {
    localStorage.setItem(PRELOAD_KEY, JSON.stringify(preload));
  } catch {}
}

export function loadForgePreload(): ForgePreload | null {
  try {
    const stored = localStorage.getItem(PRELOAD_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return null;
}

// ─── Extractors ─────────────────────────────────────────────────────────────

function extractExperience(
  parsed: Record<string, unknown> | undefined
): Array<{ title: string; company: string; dates: string; bullets: string[] }> {
  if (!parsed?.workHistory || !Array.isArray(parsed.workHistory)) return [];
  return (parsed.workHistory as Array<Record<string, unknown>>).slice(0, 5).map((w) => ({
    title: String(w.title || w.position || ""),
    company: String(w.company || w.employer || ""),
    dates: String(w.dates || w.period || ""),
    bullets: Array.isArray(w.bullets)
      ? w.bullets.map(String).slice(0, 5)
      : Array.isArray(w.responsibilities)
        ? w.responsibilities.map(String).slice(0, 5)
        : [],
  }));
}

function extractEducation(
  parsed: Record<string, unknown> | undefined
): Array<{ institution: string; degree: string; year?: string }> {
  if (!parsed?.education || !Array.isArray(parsed.education)) return [];
  return (parsed.education as Array<Record<string, unknown>>).slice(0, 3).map((e) => ({
    institution: String(e.institution || e.school || ""),
    degree: String(e.degree || e.program || ""),
    year: e.year ? String(e.year) : undefined,
  }));
}

function extractCertifications(
  parsed: Record<string, unknown> | undefined
): string[] {
  if (!parsed?.certifications || !Array.isArray(parsed.certifications)) return [];
  return (parsed.certifications as Array<unknown>).slice(0, 5).map(String);
}
