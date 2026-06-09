"use client";

/**
 * Progress — Refinery Tool 6
 *
 * Three sections:
 *   1. Quick Wins — personalized next steps (rule-based, not AI)
 *   2. Career Roadmap — visual journey with lit-up nodes
 *   3. Activity Scoreboard — milestones + counts (existing)
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  getQuickWins,
  type QuickWin,
  type QuickWinContext,
  type ReadinessStage,
} from "@/lib/quick-wins";
import {
  generateRoadmap,
  getRoadmapProgress,
  PHASE_META,
  type RoadmapNode,
  type RoadmapPhase,
} from "@/lib/roadmap";
import {
  getCareerPaths,
  getSkillNames,
  getStrengthTitles,
} from "@/lib/forge-output";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ProgressData {
  forge_completed: boolean;
  skills_identified: number;
  strengths_found: number;
  career_paths: number;
  barriers_addressed: number;
  resumes_built: number;
  resume_bullets_written: number;
  disclosure_plans_created: number;
  interviews_started: number;
  interviews_completed: number;
  job_searches: number;
  resources_viewed: number;
  applications_sent: number;
  total_sessions: number;
}

// ─── Main ───────────────────────────────────────────────────────────────────

const DEFAULT_PROGRESS: ProgressData = {
  forge_completed: false,
  skills_identified: 0,
  strengths_found: 0,
  career_paths: 0,
  barriers_addressed: 0,
  resumes_built: 0,
  resume_bullets_written: 0,
  disclosure_plans_created: 0,
  interviews_started: 0,
  interviews_completed: 0,
  job_searches: 0,
  resources_viewed: 0,
  applications_sent: 0,
  total_sessions: 0,
};

interface UpcomingItem {
  date: string;
  company: string;
  role: string;
  status: string;
}

export default function ProgressPage() {
  const [progress, setProgress] = useState<ProgressData>(DEFAULT_PROGRESS);
  const [barriers, setBarriers] = useState<string[]>([]);
  const [readinessStage, setReadinessStage] =
    useState<ReadinessStage>("unknown");
  const [quickWins, setQuickWins] = useState<QuickWin[]>([]);
  const [roadmapNodes, setRoadmapNodes] = useState<RoadmapNode[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>([]);

  // Read the latest progress from localStorage (the tools write here as the user
  // works). Pulled out so it can re-run LIVE -- on focus, tab change, and the save
  // events the tools fire -- instead of only once on mount (Phase 5).
  const loadProgress = useCallback(() => {
    const data: Partial<ProgressData> = {};
    let userBarriers: string[] = [];
    let stage: ReadinessStage = "unknown";

    try {
      const stored = localStorage.getItem("forge_session");
      if (stored) {
        const session = JSON.parse(stored);
        if (session.readinessStage) stage = session.readinessStage;
        if (session.challenges) userBarriers = session.challenges;
        if (session.forgeOutput) {
          data.forge_completed = true;
          data.skills_identified = getSkillNames(session.forgeOutput, 200).length;
          data.strengths_found = getStrengthTitles(session.forgeOutput, 200).length;
          data.career_paths = getCareerPaths(session.forgeOutput).length;
          if (session.forgeOutput.barriers) data.barriers_addressed = session.forgeOutput.barriers.length;
        }
      }
    } catch {}

    try {
      const tracker = JSON.parse(localStorage.getItem("consumer_progress") || "{}");
      data.resumes_built = tracker.resumes_built || 0;
      data.resume_bullets_written = tracker.resume_bullets_written || 0;
      data.disclosure_plans_created = tracker.disclosure_plans_created || 0;
      data.interviews_started = tracker.interviews_started || 0;
      data.interviews_completed = tracker.interviews_completed || 0;
      data.job_searches = tracker.job_searches || 0;
      data.resources_viewed = tracker.resources_viewed || 0;
      data.applications_sent = tracker.applications_sent || 0;
      data.total_sessions = tracker.total_sessions || 1;
    } catch {}

    const merged = { ...DEFAULT_PROGRESS, ...data };
    setProgress(merged);
    setBarriers(userBarriers);
    setReadinessStage(stage);

    const ctx: QuickWinContext = {
      readinessStage: stage,
      barriers: userBarriers,
      forgeCompleted: !!data.forge_completed,
      activity: {
        resumes_built: merged.resumes_built,
        interviews_completed: merged.interviews_completed,
        interviews_started: merged.interviews_started,
        disclosure_plans_created: merged.disclosure_plans_created,
        job_searches: merged.job_searches,
        resources_viewed: merged.resources_viewed,
        applications_sent: merged.applications_sent,
      },
    };
    setQuickWins(getQuickWins(ctx));

    setRoadmapNodes(
      generateRoadmap({
        forgeCompleted: !!data.forge_completed,
        barriers: userBarriers,
        activity: {
          resumes_built: merged.resumes_built,
          interviews_completed: merged.interviews_completed,
          disclosure_plans_created: merged.disclosure_plans_created,
          job_searches: merged.job_searches,
          resources_viewed: merged.resources_viewed,
          applications_sent: merged.applications_sent,
          skills_identified: merged.skills_identified,
        },
      })
    );
  }, []);

  // Pull the upcoming timeline (application follow-ups) from the server (Phase 5).
  const loadUpcoming = useCallback(() => {
    fetch("/api/user/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !Array.isArray(d.applications)) return;
        const items: UpcomingItem[] = d.applications
          .filter((a: any) => a && a.followUpAt)
          .map((a: any) => ({
            date: a.followUpAt,
            company: a.company || "",
            role: a.role || "",
            status: a.status || "saved",
          }))
          .sort((x: UpcomingItem, y: UpcomingItem) => x.date.localeCompare(y.date));
        setUpcoming(items);
      })
      .catch(() => {});
  }, []);

  // Mount: load once, track the session, and wire LIVE refresh so the page
  // reflects work done elsewhere without a manual reload (Phase 5).
  useEffect(() => {
    loadProgress();
    loadUpcoming();

    try {
      const tracker = JSON.parse(localStorage.getItem("consumer_progress") || "{}");
      tracker.total_sessions = (tracker.total_sessions || 0) + 1;
      tracker.last_session = new Date().toISOString();
      if (!tracker.first_session) tracker.first_session = new Date().toISOString();
      localStorage.setItem("consumer_progress", JSON.stringify(tracker));
    } catch {}

    const refresh = () => {
      loadProgress();
      loadUpcoming();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const events = ["focus", "resume-saved", "disclosure-saved", "interview-saved", "application-saved", "job-search"];
    events.forEach((e) => window.addEventListener(e, refresh));
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", refresh);
    return () => {
      events.forEach((e) => window.removeEventListener(e, refresh));
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", refresh);
    };
  }, [loadProgress, loadUpcoming]);

  const roadmapProgress = getRoadmapProgress(roadmapNodes);
  const totalActions =
    progress.resumes_built +
    progress.interviews_completed +
    progress.job_searches +
    progress.disclosure_plans_created +
    progress.resources_viewed +
    progress.applications_sent;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-foreground mb-2">Your Progress</h1>
      <p className="text-body text-muted mb-8">
        Every step counts. Here&apos;s what you&apos;ve accomplished and
        what to do next.
      </p>

      {/* ── Quick Wins ──────────────────────────────────────────────────── */}
      {quickWins.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-bold text-foreground mb-4">
            What to Do Next
          </h2>
          <div className="space-y-3">
            {quickWins.map((win) => (
              <QuickWinCard key={win.id} win={win} />
            ))}
          </div>
        </section>
      )}

      {/* ── Upcoming timeline (Phase 5) ─────────────────────────────────── */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-foreground">Upcoming</h2>
          <Link
            href="/dashboard/applications"
            className="text-sm font-medium text-sage-700 hover:text-sage-900"
          >
            Manage applications
          </Link>
        </div>
        {upcoming.length > 0 ? (
          <div className="space-y-2">
            {upcoming.map((item, i) => {
              const d = new Date(item.date);
              const valid = !isNaN(d.getTime());
              const overdue = valid && d.getTime() < Date.now();
              return (
                <div
                  key={i}
                  className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 border border-border"
                >
                  <div className={`flex-shrink-0 w-14 text-center ${overdue ? "text-amber-700" : "text-sage-700"}`}>
                    <div className="text-xs font-semibold uppercase">
                      {valid ? d.toLocaleDateString("en-US", { month: "short" }) : "--"}
                    </div>
                    <div className="text-lg font-bold leading-none">
                      {valid ? d.getDate() : "--"}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-foreground block truncate">
                      Follow up{item.company ? ` -- ${item.company}` : ""}
                    </span>
                    <span className="text-xs text-muted block truncate">
                      {[item.role, item.status].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  {overdue && (
                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                      due
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-white px-5 py-8 text-center">
            <p className="text-sm text-muted">
              No follow-ups scheduled yet. Save a job and set a follow-up date in
              Applications, and it will show up here.
            </p>
          </div>
        )}
      </section>

      {/* ── Career Roadmap ──────────────────────────────────────────────── */}
      {roadmapNodes.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-foreground">
              Your Roadmap
            </h2>
            <span className="text-sm text-muted">
              {roadmapProgress.completed}/{roadmapProgress.total} steps
              ({roadmapProgress.percent}%)
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden mb-6">
            <div
              className="h-full bg-sage-500 rounded-full transition-all duration-500"
              style={{ width: `${roadmapProgress.percent}%` }}
            />
          </div>

          {/* Roadmap phases */}
          <div className="space-y-6">
            {(
              ["foundation", "preparation", "action", "momentum"] as RoadmapPhase[]
            ).map((phase) => {
              const phaseNodes = roadmapNodes.filter(
                (n) => n.phase === phase
              );
              if (phaseNodes.length === 0) return null;
              const meta = PHASE_META[phase];

              return (
                <div key={phase}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
                    {meta.label}
                  </h3>
                  <div className="space-y-2">
                    {phaseNodes.map((node) => (
                      <RoadmapNodeCard key={node.id} node={node} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Summary Stats ───────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-foreground mb-4">
          By the Numbers
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Skills Found"
            value={progress.skills_identified}
            color="sage"
          />
          <StatCard
            label="Career Paths"
            value={progress.career_paths}
            color="sky"
          />
          <StatCard
            label="Interviews"
            value={progress.interviews_completed}
            color="warm"
          />
          <StatCard
            label="Actions Taken"
            value={totalActions}
            color="earth"
          />
        </div>
      </section>

      {/* ── Refinery Activity ───────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-foreground mb-3">
          Activity Detail
        </h2>
        <div className="space-y-2">
          <ActivityRow
            label="Resumes built"
            value={progress.resumes_built}
            sub={
              progress.resume_bullets_written > 0
                ? `${progress.resume_bullets_written} bullets written`
                : undefined
            }
          />
          <ActivityRow
            label="Disclosure plans"
            value={progress.disclosure_plans_created}
          />
          <ActivityRow
            label="Practice interviews"
            value={progress.interviews_completed}
            sub={
              progress.interviews_started > progress.interviews_completed
                ? `${progress.interviews_started} started`
                : undefined
            }
          />
          <ActivityRow label="Job searches" value={progress.job_searches} />
          <ActivityRow
            label="Applications sent"
            value={progress.applications_sent}
          />
          <ActivityRow
            label="Board visits"
            value={progress.resources_viewed}
          />
        </div>
      </section>

      {/* ── Encouragement ───────────────────────────────────────────────── */}
      <div className="bg-warm-50 rounded-2xl p-5 border border-warm-200 text-center">
        <p className="text-sm text-earth-700 leading-relaxed">
          {totalActions === 0
            ? "Your journey starts with one step. Check out the suggestions above — pick whichever one feels right."
            : totalActions < 5
              ? "You're building momentum. Every action you take makes the next one easier."
              : totalActions < 15
                ? "You're putting in real work. This kind of preparation gives you a serious edge."
                : "You've shown serious commitment to your future. That dedication speaks volumes to any employer."}
        </p>
      </div>
    </div>
  );
}

// ─── Quick Win Card ─────────────────────────────────────────────────────────

function QuickWinCard({ win }: { win: QuickWin }) {
  const categoryColors: Record<string, string> = {
    foundation: "border-l-sage-500",
    "skill-building": "border-l-sky-500",
    action: "border-l-amber-500",
    wellbeing: "border-l-red-400",
  };

  return (
    <div
      className={`bg-white rounded-xl p-4 border border-border border-l-4 ${
        categoryColors[win.category] || "border-l-sage-500"
      }`}
    >
      <h3 className="font-semibold text-foreground mb-1">{win.title}</h3>
      <p className="text-sm text-muted leading-relaxed mb-3">
        {win.description}
      </p>
      {win.action.type === "link" && win.action.href ? (
        <Link
          href={win.action.href}
          className="inline-flex items-center px-4 py-2 bg-sage-600 text-white text-sm font-medium rounded-lg hover:bg-sage-700 transition-colors"
        >
          {win.action.label} &rarr;
        </Link>
      ) : win.action.type === "phone" && win.action.phone ? (
        <a
          href={`tel:${win.action.phone}`}
          className="inline-flex items-center px-4 py-2 bg-sage-600 text-white text-sm font-medium rounded-lg hover:bg-sage-700 transition-colors"
        >
          {win.action.label}
        </a>
      ) : null}
    </div>
  );
}

// ─── Roadmap Node Card ──────────────────────────────────────────────────────

function RoadmapNodeCard({ node }: { node: RoadmapNode }) {
  const content = (
    <div
      className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-colors ${
        node.completed
          ? "bg-sage-50 border-sage-200"
          : node.current
            ? "bg-white border-sage-400 shadow-sm"
            : "bg-gray-50 border-border"
      }`}
    >
      {/* Status indicator */}
      <div className="flex-shrink-0">
        {node.completed ? (
          <div className="w-6 h-6 rounded-full bg-sage-500 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3 7l3 3 5-5"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        ) : node.current ? (
          <div className="w-6 h-6 rounded-full border-2 border-sage-500 bg-white flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-sage-500 animate-pulse" />
          </div>
        ) : (
          <div className="w-6 h-6 rounded-full border-2 border-gray-200 bg-white" />
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <span
          className={`text-sm font-medium block ${
            node.completed
              ? "text-sage-700"
              : node.current
                ? "text-foreground"
                : "text-muted"
          }`}
        >
          {node.title}
        </span>
        <span className="text-xs text-muted block">{node.description}</span>
      </div>

      {/* Arrow for actionable items */}
      {node.toolLink && !node.completed && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          className="text-muted flex-shrink-0"
        >
          <path
            d="M6 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      )}
    </div>
  );

  if (node.toolLink && !node.completed) {
    return <Link href={node.toolLink}>{content}</Link>;
  }

  return content;
}

// ─── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "sage" | "sky" | "warm" | "earth";
}) {
  const colors = {
    sage: "bg-sage-50 border-sage-200 text-sage-700",
    sky: "bg-sky-50 border-sky-200 text-sky-700",
    warm: "bg-warm-50 border-warm-200 text-earth-700",
    earth: "bg-warm-50 border-warm-200 text-earth-700",
  };

  return (
    <div className={`rounded-xl p-4 border text-center ${colors[color]}`}>
      <span className="text-2xl font-bold block">{value}</span>
      <span className="text-xs">{label}</span>
    </div>
  );
}

// ─── Activity Row ───────────────────────────────────────────────────────────

function ActivityRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="flex items-center justify-between bg-white rounded-xl p-4 border border-border">
      <div>
        <span className="text-sm font-medium text-foreground">{label}</span>
        {sub && (
          <span className="text-xs text-muted block mt-0.5">{sub}</span>
        )}
      </div>
      <span
        className={`text-lg font-bold ${
          value > 0 ? "text-sage-600" : "text-gray-300"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
