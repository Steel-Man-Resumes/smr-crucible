"use client";

/**
 * Progress -- Refinery Tool 6
 *
 * Sections:
 *   1. Quick Wins -- personalized next steps (rule-based, not AI)
 *   2. Upcoming -- application follow-ups
 *   3. Career Roadmap -- visual journey; nodes expand in place
 *   4. Pipeline -- live application stages (saved -> offered)
 *   5. Milestones + Streak -- private, grace-based (Phase 4.3)
 *   6. By the Numbers / Activity Detail -- server-truth counts
 *
 * Phase 4.2: every number here maps to a NAMED server fact (see
 * lib/progress-sources.ts). The page no longer READS the localStorage
 * "consumer_progress" tracker as its source of truth -- activity comes from
 * /api/user/journey (the user_progress_event ledger), forge counts from
 * /api/user/context (the server forge profile), and the pipeline from
 * /api/applications (job_application.status). If a fetch fails the page shows a
 * graceful empty state, never a stale localStorage number.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { Milestone, StreakResult } from "@crucible/core";
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
} from "@/lib/forge-output";
import { CompletionConfetti } from "@/components/CompletionConfetti";
import { trackProgress } from "@/lib/track-progress";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ProgressData {
  forge_completed: boolean;
  skills_identified: number;
  career_paths: number;
  resumes_built: number;
  disclosure_plans_created: number;
  interviews_started: number;
  interviews_completed: number;
  job_searches: number;
  resources_viewed: number;
  applications_sent: number;
  total_sessions: number;
}

const DEFAULT_PROGRESS: ProgressData = {
  forge_completed: false,
  skills_identified: 0,
  career_paths: 0,
  resumes_built: 0,
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

interface PipelineCounts {
  saved: number;
  applied: number;
  heard_back: number;
  interviewing: number;
  offered: number;
}

const PIPELINE_STAGES: { key: keyof PipelineCounts; label: string }[] = [
  { key: "saved", label: "Saved" },
  { key: "applied", label: "Applied" },
  { key: "heard_back", label: "Heard back" },
  { key: "interviewing", label: "Interviewing" },
  { key: "offered", label: "Offered" },
];

const TERMINAL_STATUSES = ["declined", "rejected"];

// localStorage key that remembers which milestones we already celebrated, so
// the confetti fires ONCE per newly earned milestone, not on every page load.
// This is a "have I congratulated this yet" marker only -- the milestone truth
// itself always comes from the server.
const CELEBRATED_KEY = "celebrated_milestones";

// ─── Main ───────────────────────────────────────────────────────────────────

export default function ProgressPage() {
  const [progress, setProgress] = useState<ProgressData>(DEFAULT_PROGRESS);
  const [barriers, setBarriers] = useState<string[]>([]);
  const [readinessStage, setReadinessStage] =
    useState<ReadinessStage>("unknown");
  const [quickWins, setQuickWins] = useState<QuickWin[]>([]);
  const [roadmapNodes, setRoadmapNodes] = useState<RoadmapNode[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>([]);
  const [pipeline, setPipeline] = useState<PipelineCounts | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [streak, setStreak] = useState<StreakResult | null>(null);
  const [celebrate, setCelebrate] = useState<{ id: string; title: string; fact: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // Activity truth: the server event ledger (user_progress_event) via the
  // journey snapshot, plus milestones + streak folded into the same fetch.
  const loadJourney = useCallback(() => {
    return fetch("/api/user/journey")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const m = d?.snapshot?.metrics;
        if (m) {
          setProgress((prev) => ({
            ...prev,
            resumes_built: m.resumesBuilt ?? 0,
            disclosure_plans_created: m.disclosurePlansCreated ?? 0,
            interviews_started: m.interviewsStarted ?? 0,
            interviews_completed: m.interviewsCompleted ?? 0,
            job_searches: m.jobSearches ?? 0,
            resources_viewed: m.resourcesViewed ?? 0,
            applications_sent: m.applicationsSent ?? 0,
            total_sessions: m.totalSessions ?? 0,
          }));
        }
        if (Array.isArray(d?.milestones)) {
          setMilestones(d.milestones);
          maybeCelebrate(d.milestones);
        }
        if (d?.streak) setStreak(d.streak);
      })
      .catch(() => {
        // Graceful: leave defaults (zeros). Never fall back to localStorage.
      });
  }, []);

  // Forge-derived truth: the server forge profile. Normalized with the same
  // tested helpers used everywhere else, so the counts match the rest of the app.
  const loadContext = useCallback(() => {
    return fetch("/api/user/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;

        const forge = d.forge;
        const forgeCompleted = !!forge;
        const skills = forge ? getSkillNames({ skills: forge.skills }, 200).length : 0;
        const paths = forge ? getCareerPaths({ career_paths: forge.careerPaths }).length : 0;
        const userBarriers: string[] = forge
          ? [
              ...(forge.hasCriminalRecord ? ["criminal_record"] : []),
              ...(Array.isArray(forge.barriers) ? forge.barriers : []),
            ]
          : [];
        const stage: ReadinessStage = (forge?.readinessStage as ReadinessStage) || "unknown";

        setProgress((prev) => ({
          ...prev,
          forge_completed: forgeCompleted,
          skills_identified: skills,
          career_paths: paths,
        }));
        setBarriers(userBarriers);
        setReadinessStage(stage);

        // Upcoming follow-ups come from the same payload.
        if (Array.isArray(d.applications)) {
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
        }
      })
      .catch(() => {});
  }, []);

  // Live pipeline: group job_application.status the same way the Applications
  // page does (ownership-scoped route). Real numbers only.
  const loadPipeline = useCallback(() => {
    return fetch("/api/applications")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const rows: any[] = Array.isArray(d?.applications) ? d.applications : [];
        const active = rows.filter((a) => !TERMINAL_STATUSES.includes(a.status));
        const counts: PipelineCounts = {
          saved: 0,
          applied: 0,
          heard_back: 0,
          interviewing: 0,
          offered: 0,
        };
        for (const a of active) {
          if (a.status in counts) counts[a.status as keyof PipelineCounts]++;
        }
        setPipeline(counts);
      })
      .catch(() => {});
  }, []);

  // Fire the celebration burst once per newly earned milestone. Compares the
  // freshly-earned set against the ones we've already congratulated (persisted
  // in localStorage), so a reload never re-fires an old celebration.
  function maybeCelebrate(list: Milestone[]) {
    try {
      const earned = list.filter((m) => m.earned);
      const raw = localStorage.getItem(CELEBRATED_KEY);
      // First visit after this shipped: seed the marker with everything already
      // earned and celebrate NONE. Without this, a user who sent their first
      // application weeks ago would see "you just hit a milestone" as if it
      // happened now -- the fact is real but the timing would be a lie. Only
      // milestones earned AFTER this seed get a live celebration.
      if (raw === null) {
        localStorage.setItem(CELEBRATED_KEY, JSON.stringify(earned.map((m) => m.id)));
        return;
      }
      const already: string[] = JSON.parse(raw);
      const fresh = earned.filter((m) => !already.includes(m.id));
      if (fresh.length > 0) {
        // Record every fresh milestone as celebrated, but surface the newest one
        // in the banner (a burst per co-earned milestone would stack awkwardly).
        const first = fresh[0];
        setCelebrate({ id: first.id, title: first.title, fact: first.earnedFact });
        localStorage.setItem(
          CELEBRATED_KEY,
          JSON.stringify([...already, ...fresh.map((m) => m.id)])
        );
      }
    } catch {
      // localStorage unavailable -- skip the burst, the milestone still shows.
    }
  }

  // Mount: load all server truth, track the session, wire LIVE refresh.
  useEffect(() => {
    Promise.all([loadJourney(), loadContext(), loadPipeline()]).finally(() =>
      setLoading(false)
    );

    // Dual-write only -- session is COUNTED server-side (session_start event).
    trackProgress("session_start");

    const refresh = () => {
      loadJourney();
      loadContext();
      loadPipeline();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const events = [
      "focus",
      "resume-saved",
      "disclosure-saved",
      "interview-saved",
      "application-saved",
      "job-search",
    ];
    events.forEach((e) => window.addEventListener(e, refresh));
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      events.forEach((e) => window.removeEventListener(e, refresh));
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadJourney, loadContext, loadPipeline]);

  // Derive Quick Wins + Roadmap from server-truth state whenever it changes.
  useEffect(() => {
    const ctx: QuickWinContext = {
      readinessStage,
      barriers,
      forgeCompleted: progress.forge_completed,
      activity: {
        resumes_built: progress.resumes_built,
        interviews_completed: progress.interviews_completed,
        interviews_started: progress.interviews_started,
        disclosure_plans_created: progress.disclosure_plans_created,
        job_searches: progress.job_searches,
        resources_viewed: progress.resources_viewed,
        applications_sent: progress.applications_sent,
      },
    };
    setQuickWins(getQuickWins(ctx));

    setRoadmapNodes(
      generateRoadmap({
        forgeCompleted: progress.forge_completed,
        barriers,
        activity: {
          resumes_built: progress.resumes_built,
          interviews_completed: progress.interviews_completed,
          disclosure_plans_created: progress.disclosure_plans_created,
          job_searches: progress.job_searches,
          resources_viewed: progress.resources_viewed,
          applications_sent: progress.applications_sent,
          skills_identified: progress.skills_identified,
        },
      })
    );
  }, [progress, barriers, readinessStage]);

  const roadmapProgress = getRoadmapProgress(roadmapNodes);
  const totalActions =
    progress.resumes_built +
    progress.interviews_completed +
    progress.job_searches +
    progress.disclosure_plans_created +
    progress.resources_viewed +
    progress.applications_sent;
  const pipelineTotal = pipeline
    ? PIPELINE_STAGES.reduce((sum, s) => sum + pipeline[s.key], 0)
    : 0;

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-12 justify-center text-t-phos-dim">
        <div className="w-5 h-5 border-2 border-t-amber border-t-transparent animate-spin" />
        Loading your progress...
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      {celebrate && (
        <>
          <CompletionConfetti key={celebrate.id} />
          <div
            className="bg-t-panel-2 border border-t-amber p-5 mb-8"
            role="status"
          >
            <p className="text-sm font-semibold text-t-amber-bright mb-1">
              You just hit a milestone: {celebrate.title}
            </p>
            {celebrate.fact && (
              <p className="text-sm text-t-phos leading-relaxed">
                {celebrate.fact}
              </p>
            )}
          </div>
        </>
      )}

      <h1 className="text-2xl font-bold text-t-white mb-2">Your Progress</h1>
      <p className="text-base text-t-phos-dim mb-8">
        Every step counts. Here&apos;s what you&apos;ve accomplished and
        what to do next.
      </p>

      {/* ── Quick Wins ──────────────────────────────────────────────────── */}
      {quickWins.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-bold text-t-white mb-4">
            What to Do Next
          </h2>
          <div className="space-y-3">
            {quickWins.map((win) => (
              <QuickWinCard key={win.id} win={win} />
            ))}
          </div>
        </section>
      )}

      {/* ── Upcoming timeline ───────────────────────────────────────────── */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-t-white">Upcoming</h2>
          <Link
            href="/dashboard/applications"
            className="text-sm font-medium text-t-amber-bright hover:text-t-amber"
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
                  className="flex items-center gap-3 bg-t-panel px-4 py-3 border border-t-line"
                >
                  <div className={`flex-shrink-0 w-14 text-center ${overdue ? "text-t-red" : "text-t-amber-bright"}`}>
                    <div className="text-xs font-semibold uppercase">
                      {valid ? d.toLocaleDateString("en-US", { month: "short" }) : "--"}
                    </div>
                    <div className="text-lg font-bold leading-none">
                      {valid ? d.getDate() : "--"}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-t-white block truncate">
                      Follow up{item.company ? ` -- ${item.company}` : ""}
                    </span>
                    <span className="text-xs text-t-phos-dim block truncate">
                      {[item.role, item.status].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  {overdue && (
                    <span className="text-[10px] font-semibold text-t-red border border-t-red px-2 py-0.5">
                      due
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="border border-t-line bg-t-panel px-5 py-8 text-center">
            <p className="text-sm text-t-phos-dim">
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
            <h2 className="text-lg font-bold text-t-white">
              Your Roadmap
            </h2>
            <span className="text-sm text-t-phos-dim">
              {roadmapProgress.completed}/{roadmapProgress.total} steps
              ({roadmapProgress.percent}%)
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 w-full bg-t-line overflow-hidden mb-6">
            <div
              className="h-full bg-t-amber transition-all duration-500"
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
                  <h3 className="text-xs font-semibold uppercase text-t-phos-dim mb-2">
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

      {/* ── Pipeline ────────────────────────────────────────────────────── */}
      {pipeline && pipelineTotal > 0 && (
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-t-white">Your Pipeline</h2>
            <Link
              href="/dashboard/applications"
              className="text-sm font-medium text-t-amber-bright hover:text-t-amber"
            >
              Open tracker
            </Link>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {PIPELINE_STAGES.map((stage) => (
              <div
                key={stage.key}
                className="flex-1 min-w-[80px] p-3 border text-center bg-t-panel border-t-line"
              >
                <span className="text-xl font-bold block text-t-amber-bright">
                  {pipeline[stage.key]}
                </span>
                <span className="text-xs text-t-phos-dim">{stage.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Milestones + Streak (private) ───────────────────────────────── */}
      {(milestones.length > 0 || streak) && (
        <section className="mb-10">
          <h2 className="text-lg font-bold text-t-white mb-1">Milestones</h2>
          <p className="text-sm text-t-phos-dim mb-4">
            Just for you. Each one is backed by something you actually did.
          </p>

          {streak && (
            <div className="bg-t-panel border border-t-line p-4 mb-4">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-t-amber-bright">
                  {streak.current}
                </span>
                <span className="text-sm text-t-white">
                  active {streak.current === 1 ? "day" : "days"}
                </span>
                {streak.protected && (
                  <span className="text-[10px] font-semibold text-t-phos border border-t-phos px-2 py-0.5 ml-auto">
                    protected
                  </span>
                )}
              </div>
              <p className="text-sm text-t-phos-dim mt-1">{streak.message}</p>
              {streak.longest > streak.current && (
                <p className="text-xs text-t-phos-dim mt-1">
                  Your longest run so far: {streak.longest} days.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            {milestones.map((m) => (
              <MilestoneRow key={m.id} milestone={m} />
            ))}
          </div>
        </section>
      )}

      {/* ── Summary Stats ───────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-t-white mb-4">
          By the Numbers
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Skills Found"
            value={progress.skills_identified}
            color="amber"
          />
          <StatCard
            label="Career Paths"
            value={progress.career_paths}
            color="steel"
          />
          <StatCard
            label="Interviews"
            value={progress.interviews_completed}
            color="phos"
          />
          <StatCard
            label="Actions Taken"
            value={totalActions}
            color="amber"
          />
        </div>
      </section>

      {/* ── Refinery Activity ───────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-t-white mb-3">
          Activity Detail
        </h2>
        <div className="space-y-2">
          {/* NOTE (Phase 4.2): the old "N bullets written" sub-line is gone.
              The 'bullet_written' event type exists but nothing writes it, so
              that number was localStorage-only -- dropped rather than faked. */}
          <ActivityRow
            label="Resumes built"
            value={progress.resumes_built}
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
      <div className="bg-t-panel p-5 border border-t-amber text-center">
        <p className="text-sm text-t-phos leading-relaxed">
          {totalActions === 0
            ? "Your journey starts with one step. Check out the suggestions above -- pick whichever one feels right."
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
    foundation: "border-l-t-amber",
    "skill-building": "border-l-t-steel",
    action: "border-l-t-phos",
    wellbeing: "border-l-t-phos-dim",
  };

  return (
    <div
      className={`bg-t-panel p-4 border border-t-line border-l-2 ${
        categoryColors[win.category] || "border-l-t-amber"
      }`}
    >
      <h3 className="font-semibold text-t-white mb-1">{win.title}</h3>
      <p className="text-sm text-t-phos-dim leading-relaxed mb-3">
        {win.description}
      </p>
      {win.action.type === "link" && win.action.href ? (
        <Link
          href={win.action.href}
          className="t-focus inline-flex items-center px-4 py-2 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright transition-colors"
        >
          {win.action.label} &rarr;
        </Link>
      ) : win.action.type === "phone" && win.action.phone ? (
        <a
          href={`tel:${win.action.phone}`}
          className="t-focus inline-flex items-center px-4 py-2 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright transition-colors"
        >
          {win.action.label}
        </a>
      ) : null}
    </div>
  );
}

// ─── Roadmap Node Card (expands in place) ───────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  "/welcome": "The Forge",
  "/intro": "The Forge",
  "/dashboard": "your dashboard",
  "/dashboard/resources": "Resources",
  "/dashboard/application-tailor": "the Resume Tailor",
  "/dashboard/disclosure": "Disclosure",
  "/dashboard/interview": "Interview Practice",
  "/dashboard/jobs": "the Job Board",
};

function toolLabel(link?: string): string {
  if (!link) return "this tool";
  return TOOL_LABELS[link] || "this tool";
}

function RoadmapNodeCard({ node }: { node: RoadmapNode }) {
  const [open, setOpen] = useState(false);
  const panelId = `roadmap-panel-${node.id}`;

  const status = node.completed
    ? "Done"
    : node.current
      ? "In progress"
      : "Not started yet";

  return (
    <div
      className={`border ${
        node.completed
          ? "bg-t-panel-2 border-t-amber"
          : node.current
            ? "bg-t-panel border-t-phos-dim"
            : "bg-t-bg border-t-line"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="t-focus w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        {/* Status indicator */}
        <div className="flex-shrink-0">
          {node.completed ? (
            <div className="w-6 h-6 bg-t-amber flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M3 7l3 3 5-5"
                  stroke="#14100a"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          ) : node.current ? (
            <div className="w-6 h-6 border border-t-amber bg-t-panel flex items-center justify-center">
              <div className="w-2 h-2 bg-t-amber animate-pulse" />
            </div>
          ) : (
            <div className="w-6 h-6 border border-t-line bg-t-panel" />
          )}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <span
            className={`text-sm font-medium block ${
              node.completed
                ? "text-t-amber-bright"
                : node.current
                  ? "text-t-white"
                  : "text-t-phos-dim"
            }`}
          >
            {node.title}
          </span>
          <span className="text-xs text-t-phos-dim block">{node.description}</span>
        </div>

        {/* Expand chevron */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          className={`text-t-phos-dim flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
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
      </button>

      {open && (
        <div
          id={panelId}
          className="px-4 pb-4 pt-0 border-t border-t-line"
        >
          <p className="text-xs text-t-phos-dim mt-3 mb-1">
            <span className="font-semibold text-t-white">Status:</span> {status}
          </p>
          <p className="text-sm text-t-phos leading-relaxed mb-3">
            {node.description}
          </p>
          {node.toolLink && (
            <Link
              href={node.toolLink}
              className="t-focus inline-flex items-center px-4 py-2 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright transition-colors"
            >
              {node.completed ? "Revisit " : "Go to "}
              {toolLabel(node.toolLink)} &rarr;
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Milestone Row ──────────────────────────────────────────────────────────

function MilestoneRow({ milestone }: { milestone: Milestone }) {
  return (
    <div
      className={`flex items-start gap-3 p-4 border ${
        milestone.earned
          ? "bg-t-panel-2 border-t-amber"
          : "bg-t-panel border-t-line"
      }`}
    >
      <div className="flex-shrink-0 mt-0.5">
        {milestone.earned ? (
          <div className="w-6 h-6 bg-t-amber flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3 7l3 3 5-5"
                stroke="#14100a"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        ) : (
          <div className="w-6 h-6 border border-t-line bg-t-panel" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span
          className={`text-sm font-semibold block ${
            milestone.earned ? "text-t-amber-bright" : "text-t-white"
          }`}
        >
          {milestone.title}
        </span>
        {milestone.earned ? (
          <>
            <p className="text-sm text-t-phos leading-relaxed mt-0.5">
              {milestone.celebration}
            </p>
            {milestone.earnedFact && (
              <p className="text-xs text-t-phos-dim mt-1">{milestone.earnedFact}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-t-phos-dim leading-relaxed mt-0.5">
            {milestone.nextUp}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "amber" | "steel" | "phos";
}) {
  const colors = {
    amber: "bg-t-panel border-t-amber text-t-amber-bright",
    steel: "bg-t-panel border-t-steel text-t-steel",
    phos: "bg-t-panel border-t-phos text-t-phos",
  };

  return (
    <div className={`p-4 border text-center ${colors[color]}`}>
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
    <div className="flex items-center justify-between bg-t-panel p-4 border border-t-line">
      <div>
        <span className="text-sm font-medium text-t-white">{label}</span>
        {sub && (
          <span className="text-xs text-t-phos-dim block mt-0.5">{sub}</span>
        )}
      </div>
      <span
        className={`text-lg font-bold ${
          value > 0 ? "text-t-amber-bright" : "text-t-line"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
