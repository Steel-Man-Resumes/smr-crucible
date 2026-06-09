/**
 * Quick Wins Engine — Deterministic, rule-based next steps
 *
 * No AI. Pure rules. Fast, auditable, white-label-configurable.
 * Returns 3-5 personalized, achievable actions based on:
 *   1. Readiness stage (Prochaska)
 *   2. Barriers (from Forge)
 *   3. Activity counts (from Refinery progress)
 *   4. Forge completion status
 *
 * Critical rule: NEVER suggest something above the user's current capacity.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type ReadinessStage =
  | "precontemplation"
  | "contemplation"
  | "preparation"
  | "action"
  | "maintenance"
  | "unknown";

export interface QuickWinContext {
  readinessStage: ReadinessStage;
  barriers: string[];
  forgeCompleted: boolean;
  activity: {
    resumes_built: number;
    interviews_completed: number;
    interviews_started: number;
    disclosure_plans_created: number;
    job_searches: number;
    resources_viewed: number;
    applications_sent: number;
  };
}

export interface QuickWin {
  id: string;
  title: string;
  description: string;
  action: {
    type: "link" | "phone";
    label: string;
    href?: string;
    phone?: string;
  };
  category: "foundation" | "skill-building" | "action" | "wellbeing";
}

// ─── Win Definitions ────────────────────────────────────────────────────────

interface WinRule {
  id: string;
  priority: number; // lower = show first
  win: QuickWin;
  condition: (ctx: QuickWinContext) => boolean;
}

const RULES: WinRule[] = [
  // ── FOUNDATION: Pre-Forge ─────────────────────────────────────────────
  {
    id: "start-forge",
    priority: 1,
    win: {
      id: "start-forge",
      title: "Explore The Forge",
      description:
        "Takes about 10 minutes. We find your skills, match you to careers, and point you toward realistic next steps. Everything stays private.",
      action: { type: "link", label: "Start The Forge", href: "/welcome" },
      category: "foundation",
    },
    condition: (ctx) => !ctx.forgeCompleted,
  },

  // ── WELLBEING: Urgent barriers first ──────────────────────────────────
  {
    id: "housing-211",
    priority: 5,
    win: {
      id: "housing-211",
      title: "Call 211 about housing",
      description:
        "Free. Confidential. They connect you to shelters and apartments near you. Available 24/7.",
      action: { type: "phone", label: "Call 211", phone: "211" },
      category: "wellbeing",
    },
    condition: (ctx) =>
      ctx.barriers.includes("housing") && ctx.activity.resources_viewed < 2,
  },
  {
    id: "crisis-988",
    priority: 4,
    win: {
      id: "crisis-988",
      title: "Talk to someone — 988 Lifeline",
      description:
        "Free, confidential support anytime. Call or text 988. Trained counselors help with emotional distress, substance use, and more.",
      action: { type: "phone", label: "Call or text 988", phone: "988" },
      category: "wellbeing",
    },
    condition: (ctx) =>
      ctx.barriers.includes("health") || ctx.barriers.includes("recovery"),
  },
  {
    id: "browse-second-chance-board",
    priority: 15,
    win: {
      id: "browse-second-chance-board",
      title: "Review second-chance job lanes",
      description:
        "Start with fair-chance-friendly lanes, then search live jobs that match your skills and constraints.",
      action: {
        type: "link",
        label: "Open Job Board",
        href: "/dashboard/resources",
      },
      category: "action",
    },
    condition: (ctx) =>
      ctx.forgeCompleted &&
      ctx.barriers.length > 0 &&
      ctx.activity.resources_viewed === 0,
  },

  // ── SKILL-BUILDING: Resume, Disclosure, Interview ─────────────────────
  {
    id: "build-first-resume",
    priority: 10,
    win: {
      id: "build-first-resume",
      title: "Build your first resume",
      description:
        "Your Forge data is already loaded — skills, experience, and a professional summary are ready. You refine it, not start from scratch.",
      action: {
        type: "link",
        label: "Open Application Tailor",
        href: "/dashboard/application-tailor",
      },
      category: "skill-building",
    },
    condition: (ctx) =>
      ctx.forgeCompleted &&
      ctx.activity.resumes_built === 0 &&
      ctx.readinessStage !== "precontemplation",
  },
  {
    id: "first-interview",
    priority: 12,
    win: {
      id: "first-interview",
      title: "Run one practice interview",
      description:
        "5 minutes. Private. You can redo it as many times as you want. The AI gives you real feedback on what to improve.",
      action: {
        type: "link",
        label: "Start Practice Interview",
        href: "/dashboard/interview",
      },
      category: "skill-building",
    },
    condition: (ctx) =>
      ctx.forgeCompleted &&
      ctx.activity.interviews_completed === 0 &&
      ctx.readinessStage !== "precontemplation",
  },
  {
    id: "disclosure-plan",
    priority: 13,
    win: {
      id: "disclosure-plan",
      title: "Create a disclosure plan",
      description:
        "You've practiced interviews — now prep the record conversation. Get a script, timing advice, and legal context for your area.",
      action: {
        type: "link",
        label: "Open Disclosure Planner",
        href: "/dashboard/disclosure",
      },
      category: "skill-building",
    },
    condition: (ctx) =>
      ctx.forgeCompleted &&
      ctx.barriers.includes("criminal_record") &&
      ctx.activity.disclosure_plans_created === 0 &&
      ctx.activity.interviews_completed >= 1,
  },
  {
    id: "disclosure-plan-early",
    priority: 14,
    win: {
      id: "disclosure-plan-early",
      title: "Start your disclosure plan",
      description:
        "Having a record doesn't have to stop you. A disclosure plan helps you control the conversation. Know your rights, build your script.",
      action: {
        type: "link",
        label: "Open Disclosure Planner",
        href: "/dashboard/disclosure",
      },
      category: "skill-building",
    },
    condition: (ctx) =>
      ctx.forgeCompleted &&
      ctx.barriers.includes("criminal_record") &&
      ctx.activity.disclosure_plans_created === 0 &&
      ctx.activity.interviews_completed === 0 &&
      ctx.readinessStage !== "precontemplation" &&
      ctx.readinessStage !== "contemplation",
  },
  {
    id: "another-interview",
    priority: 20,
    win: {
      id: "another-interview",
      title: "Practice another interview",
      description:
        "Each time you practice, you get more comfortable. Try a different interview type — behavioral, industry-specific, or disclosure-focused.",
      action: {
        type: "link",
        label: "Practice Again",
        href: "/dashboard/interview",
      },
      category: "skill-building",
    },
    condition: (ctx) =>
      ctx.activity.interviews_completed >= 1 &&
      ctx.activity.interviews_completed < 5 &&
      ctx.activity.job_searches === 0,
  },

  // ── ACTION: Job search, applications ──────────────────────────────────
  {
    id: "first-job-search",
    priority: 16,
    win: {
      id: "first-job-search",
      title: "Search for jobs that match your skills",
      description:
        "Real listings from employers hiring right now. Fair-chance companies highlighted. Save the ones that look good.",
      action: {
        type: "link",
        label: "Open Job Board",
        href: "/dashboard/jobs",
      },
      category: "action",
    },
    condition: (ctx) =>
      ctx.forgeCompleted &&
      ctx.activity.resumes_built >= 1 &&
      ctx.activity.job_searches === 0,
  },
  {
    id: "search-more-jobs",
    priority: 18,
    win: {
      id: "search-more-jobs",
      title: "Search for 3 more jobs",
      description:
        "You've started looking — keep the momentum. Try different roles or expand your search area.",
      action: {
        type: "link",
        label: "Search Jobs",
        href: "/dashboard/jobs",
      },
      category: "action",
    },
    condition: (ctx) =>
      ctx.activity.job_searches >= 1 &&
      ctx.activity.job_searches < 5 &&
      ctx.activity.applications_sent === 0,
  },
  {
    id: "apply-to-one",
    priority: 19,
    win: {
      id: "apply-to-one",
      title: "Apply to one saved job",
      description:
        "You've been researching. Pick your best match, tailor your resume, and go for it. Mark it as applied to track your progress.",
      action: {
        type: "link",
        label: "View Saved Jobs",
        href: "/dashboard/jobs",
      },
      category: "action",
    },
    condition: (ctx) =>
      ctx.activity.job_searches >= 3 && ctx.activity.applications_sent === 0,
  },
  {
    id: "keep-applying",
    priority: 22,
    win: {
      id: "keep-applying",
      title: "Apply to 2 more jobs this week",
      description:
        "Consistency wins. Every application is practice, and the more you send, the better your odds.",
      action: {
        type: "link",
        label: "Search Jobs",
        href: "/dashboard/jobs",
      },
      category: "action",
    },
    condition: (ctx) =>
      ctx.activity.applications_sent >= 1 &&
      ctx.activity.applications_sent < 5,
  },

  // ── MAINTENANCE: Keep going ───────────────────────────────────────────
  {
    id: "refine-resume",
    priority: 25,
    win: {
      id: "refine-resume",
      title: "Tailor your resume for a specific job",
      description:
        "A generic resume gets ignored. Pick one job you really want and customize your resume to match what they're looking for.",
      action: {
        type: "link",
        label: "Open Application Tailor",
        href: "/dashboard/application-tailor",
      },
      category: "skill-building",
    },
    condition: (ctx) =>
      ctx.activity.resumes_built >= 1 &&
      ctx.activity.job_searches >= 3 &&
      ctx.activity.resumes_built < 3,
  },
  {
    id: "check-security",
    priority: 30,
    win: {
      id: "check-security",
      title: "Review your privacy settings",
      description:
        "Your data is private and secure. Take a minute to see exactly how we protect your information.",
      action: {
        type: "link",
        label: "View Security & Privacy",
        href: "/dashboard/security",
      },
      category: "foundation",
    },
    condition: (ctx) => ctx.forgeCompleted && ctx.activity.resumes_built >= 1,
  },
];

// ─── Engine ─────────────────────────────────────────────────────────────────

export function getQuickWins(ctx: QuickWinContext, max = 5): QuickWin[] {
  const matching = RULES.filter((r) => r.condition(ctx)).sort(
    (a, b) => a.priority - b.priority
  );

  // Deduplicate by category — max 2 per category for variety
  const seen = new Map<string, number>();
  const result: QuickWin[] = [];

  for (const rule of matching) {
    if (result.length >= max) break;
    const catCount = seen.get(rule.win.category) || 0;
    if (catCount >= 2) continue;
    seen.set(rule.win.category, catCount + 1);
    result.push(rule.win);
  }

  return result;
}
