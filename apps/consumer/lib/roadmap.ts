/**
 * Career Roadmap Generator — Visual journey with lit-up nodes
 *
 * Deterministic, rule-based. Generates 8-12 nodes across 4 phases.
 * Each node links to a Refinery tool. Nodes light up based on
 * completion criteria derived from Forge output + activity data.
 *
 * Phases map roughly to Prochaska stages:
 *   Foundation    → Precontemplation / Contemplation
 *   Preparation   → Preparation
 *   Action        → Action
 *   Momentum      → Maintenance
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type RoadmapPhase =
  | "foundation"
  | "preparation"
  | "action"
  | "momentum";

export interface RoadmapNode {
  id: string;
  title: string;
  description: string;
  phase: RoadmapPhase;
  completed: boolean;
  current: boolean;
  toolLink?: string;
}

export interface RoadmapContext {
  forgeCompleted: boolean;
  barriers: string[];
  activity: {
    resumes_built: number;
    interviews_completed: number;
    disclosure_plans_created: number;
    job_searches: number;
    resources_viewed: number;
    applications_sent: number;
    skills_identified: number;
  };
}

export const PHASE_META: Record<
  RoadmapPhase,
  { label: string; color: string }
> = {
  foundation: { label: "Foundation", color: "sage" },
  preparation: { label: "Preparation", color: "sky" },
  action: { label: "Action", color: "warm" },
  momentum: { label: "Momentum", color: "earth" },
};

// ─── Node Definitions ───────────────────────────────────────────────────────

interface NodeDef {
  id: string;
  title: string;
  description: string;
  phase: RoadmapPhase;
  toolLink?: string;
  isCompleted: (ctx: RoadmapContext) => boolean;
  shouldShow: (ctx: RoadmapContext) => boolean;
}

const NODE_DEFS: NodeDef[] = [
  // ── FOUNDATION ────────────────────────────────────────────────────────
  {
    id: "complete-forge",
    title: "Complete The Forge",
    description: "Discover your skills, strengths, and career paths",
    phase: "foundation",
    toolLink: "/welcome",
    isCompleted: (ctx) => ctx.forgeCompleted,
    shouldShow: () => true,
  },
  {
    id: "review-skills",
    title: "Review your skills",
    description: "See what The Forge found — your starting lineup",
    phase: "foundation",
    toolLink: "/dashboard",
    isCompleted: (ctx) => ctx.activity.skills_identified > 0,
    shouldShow: () => true,
  },
  {
    id: "find-resources",
    title: "Review second-chance lanes",
    description: "Find realistic fair-chance starting points",
    phase: "foundation",
    toolLink: "/dashboard/resources",
    isCompleted: (ctx) => ctx.activity.resources_viewed >= 2,
    shouldShow: (ctx) => ctx.barriers.length > 0,
  },

  // ── PREPARATION ───────────────────────────────────────────────────────
  {
    id: "build-resume",
    title: "Build your first resume",
    description: "Your Forge data is already loaded — refine it",
    phase: "preparation",
    toolLink: "/dashboard/resume-builder",
    isCompleted: (ctx) => ctx.activity.resumes_built >= 1,
    shouldShow: () => true,
  },
  {
    id: "disclosure-plan",
    title: "Create a disclosure plan",
    description: "Know your rights. Build your script. Own the conversation.",
    phase: "preparation",
    toolLink: "/dashboard/disclosure",
    isCompleted: (ctx) => ctx.activity.disclosure_plans_created >= 1,
    shouldShow: (ctx) => ctx.barriers.includes("criminal_record"),
  },
  {
    id: "practice-interview",
    title: "Practice an interview",
    description: "5 minutes with AI feedback — get comfortable",
    phase: "preparation",
    toolLink: "/dashboard/interview",
    isCompleted: (ctx) => ctx.activity.interviews_completed >= 1,
    shouldShow: () => true,
  },

  // ── ACTION ────────────────────────────────────────────────────────────
  {
    id: "search-jobs",
    title: "Search for 5 jobs",
    description: "Real listings. Fair-chance employers first.",
    phase: "action",
    toolLink: "/dashboard/jobs",
    isCompleted: (ctx) => ctx.activity.job_searches >= 5,
    shouldShow: () => true,
  },
  {
    id: "apply-first",
    title: "Apply to your first job",
    description: "Pick your best match and go for it",
    phase: "action",
    toolLink: "/dashboard/jobs",
    isCompleted: (ctx) => ctx.activity.applications_sent >= 1,
    shouldShow: () => true,
  },
  {
    id: "tailor-resume",
    title: "Tailor a resume for a specific job",
    description: "Customize your resume to match what they want",
    phase: "action",
    toolLink: "/dashboard/resume-builder",
    isCompleted: (ctx) => ctx.activity.resumes_built >= 2,
    shouldShow: () => true,
  },

  // ── MOMENTUM ──────────────────────────────────────────────────────────
  {
    id: "five-applications",
    title: "Apply to 5 jobs",
    description: "Consistency wins. Every app is practice.",
    phase: "momentum",
    toolLink: "/dashboard/jobs",
    isCompleted: (ctx) => ctx.activity.applications_sent >= 5,
    shouldShow: () => true,
  },
  {
    id: "three-interviews-practice",
    title: "Complete 3 practice interviews",
    description: "By now you should feel ready for the real thing",
    phase: "momentum",
    toolLink: "/dashboard/interview",
    isCompleted: (ctx) => ctx.activity.interviews_completed >= 3,
    shouldShow: () => true,
  },
  {
    id: "keep-going",
    title: "Keep the momentum",
    description: "Check in weekly. Update your resume. Search new listings.",
    phase: "momentum",
    isCompleted: () => false, // Always ahead — the journey continues
    shouldShow: () => true,
  },
];

// ─── Generator ──────────────────────────────────────────────────────────────

export function generateRoadmap(ctx: RoadmapContext): RoadmapNode[] {
  const visible = NODE_DEFS.filter((n) => n.shouldShow(ctx));

  const nodes: RoadmapNode[] = visible.map((def) => ({
    id: def.id,
    title: def.title,
    description: def.description,
    phase: def.phase,
    completed: def.isCompleted(ctx),
    current: false,
    toolLink: def.toolLink,
  }));

  // Mark the first incomplete node as "current"
  const firstIncomplete = nodes.find((n) => !n.completed);
  if (firstIncomplete) {
    firstIncomplete.current = true;
  }

  return nodes;
}

export function getRoadmapProgress(nodes: RoadmapNode[]): {
  completed: number;
  total: number;
  percent: number;
} {
  const total = nodes.length;
  const completed = nodes.filter((n) => n.completed).length;
  return {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}
