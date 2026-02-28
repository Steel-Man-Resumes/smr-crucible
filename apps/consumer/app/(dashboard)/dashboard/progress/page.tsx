"use client";

/**
 * Progress Tracker — Refinery Tool 6
 *
 * Process-focused metrics: sessions, skills, resumes, interviews.
 * Celebrates process, not outcomes.
 * Visualizes growth over time.
 */

import { useState, useEffect } from "react";

interface ProgressData {
  // Forge
  forge_completed: boolean;
  forge_completed_at?: string;
  skills_identified: number;
  strengths_found: number;
  career_paths: number;
  barriers_addressed: number;

  // Refinery
  resumes_built: number;
  resume_bullets_written: number;
  disclosure_plans_created: number;
  interviews_started: number;
  interviews_completed: number;
  job_searches: number;
  resources_viewed: number;

  // Sessions
  total_sessions: number;
  last_session?: string;
  first_session?: string;
}

const MILESTONES = [
  { key: "forge_completed", label: "Completed The Forge", threshold: true },
  {
    key: "skills_identified",
    label: "skills identified",
    thresholds: [5, 10, 20],
  },
  {
    key: "resume_bullets_written",
    label: "resume bullets written",
    thresholds: [3, 10, 25],
  },
  {
    key: "interviews_completed",
    label: "practice interviews completed",
    thresholds: [1, 3, 5],
  },
  { key: "job_searches", label: "job searches run", thresholds: [1, 5, 10] },
];

export default function ProgressTrackerPage() {
  const [progress, setProgress] = useState<ProgressData>({
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
    total_sessions: 0,
  });

  useEffect(() => {
    const data: Partial<ProgressData> = {};

    // Load Forge data
    try {
      const forgeSession = localStorage.getItem("forge_session");
      if (forgeSession) {
        const session = JSON.parse(forgeSession);

        if (session.forgeOutput) {
          data.forge_completed = true;
          data.forge_completed_at = session.completedAt;

          // Count skills
          if (session.forgeOutput.skills) {
            let count = 0;
            for (const cat of Object.values(session.forgeOutput.skills)) {
              if (Array.isArray(cat)) count += cat.length;
            }
            data.skills_identified = count;
          }

          // Count strengths
          if (session.forgeOutput.strengths) {
            data.strengths_found = session.forgeOutput.strengths.length;
          }

          // Count career paths
          if (session.forgeOutput.careerPaths) {
            data.career_paths = session.forgeOutput.careerPaths.length;
          }

          // Count barriers
          if (session.forgeOutput.barriers) {
            data.barriers_addressed = session.forgeOutput.barriers.length;
          }
        }
      }
    } catch {}

    // Load Refinery progress
    try {
      const tracker = JSON.parse(
        localStorage.getItem("consumer_progress") || "{}"
      );
      data.resumes_built = tracker.resumes_built || 0;
      data.resume_bullets_written = tracker.resume_bullets_written || 0;
      data.disclosure_plans_created = tracker.disclosure_plans_created || 0;
      data.interviews_started = tracker.interviews_started || 0;
      data.interviews_completed = tracker.interviews_completed || 0;
      data.job_searches = tracker.job_searches || 0;
      data.resources_viewed = tracker.resources_viewed || 0;
      data.total_sessions = tracker.total_sessions || 1;
      data.first_session = tracker.first_session;
      data.last_session = tracker.last_session;
    } catch {}

    setProgress((prev) => ({ ...prev, ...data }));

    // Track this session
    try {
      const tracker = JSON.parse(
        localStorage.getItem("consumer_progress") || "{}"
      );
      tracker.total_sessions = (tracker.total_sessions || 0) + 1;
      tracker.last_session = new Date().toISOString();
      if (!tracker.first_session) {
        tracker.first_session = new Date().toISOString();
      }
      localStorage.setItem("consumer_progress", JSON.stringify(tracker));
    } catch {}
  }, []);

  // Calculate active milestones
  const achievedMilestones: string[] = [];
  for (const m of MILESTONES) {
    if (m.threshold === true) {
      if (progress[m.key as keyof ProgressData]) {
        achievedMilestones.push(m.label);
      }
    } else if (m.thresholds) {
      const val = progress[m.key as keyof ProgressData] as number;
      for (const t of m.thresholds) {
        if (val >= t) {
          achievedMilestones.push(`${t}+ ${m.label}`);
        }
      }
    }
  }

  const totalActions =
    progress.resumes_built +
    progress.interviews_completed +
    progress.job_searches +
    progress.disclosure_plans_created +
    progress.resources_viewed;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-foreground mb-2">Your Progress</h1>
      <p className="text-body text-muted mb-8">
        Every step counts. Here&apos;s what you&apos;ve accomplished.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
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
          label="Practice Interviews"
          value={progress.interviews_completed}
          color="warm"
        />
        <StatCard label="Actions Taken" value={totalActions} color="earth" />
      </div>

      {/* Forge completion */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-foreground mb-3">The Forge</h2>
        <div
          className={`rounded-2xl p-5 border ${
            progress.forge_completed
              ? "bg-sage-50 border-sage-200"
              : "bg-gray-50 border-border"
          }`}
        >
          {progress.forge_completed ? (
            <div>
              <p className="font-medium text-sage-700 mb-2">
                Forge complete
              </p>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted block">Skills identified</span>
                  <span className="font-semibold text-foreground">
                    {progress.skills_identified}
                  </span>
                </div>
                <div>
                  <span className="text-muted block">Strengths found</span>
                  <span className="font-semibold text-foreground">
                    {progress.strengths_found}
                  </span>
                </div>
                <div>
                  <span className="text-muted block">Career paths</span>
                  <span className="font-semibold text-foreground">
                    {progress.career_paths}
                  </span>
                </div>
                <div>
                  <span className="text-muted block">Barriers addressed</span>
                  <span className="font-semibold text-foreground">
                    {progress.barriers_addressed}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-muted mb-2">
                You haven&apos;t completed The Forge yet.
              </p>
              <a
                href="/"
                className="text-sm text-sage-600 hover:text-sage-700 font-medium"
              >
                Start The Forge →
              </a>
            </div>
          )}
        </div>
      </section>

      {/* Refinery activity */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-foreground mb-3">
          Refinery Activity
        </h2>
        <div className="space-y-3">
          <ActivityRow
            label="Resumes built"
            value={progress.resumes_built}
            sub={`${progress.resume_bullets_written} bullets written`}
          />
          <ActivityRow
            label="Disclosure plans created"
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
          <ActivityRow
            label="Job searches"
            value={progress.job_searches}
          />
          <ActivityRow
            label="Resources explored"
            value={progress.resources_viewed}
          />
        </div>
      </section>

      {/* Milestones */}
      {achievedMilestones.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-bold text-foreground mb-3">
            Milestones Reached
          </h2>
          <div className="flex flex-wrap gap-2">
            {achievedMilestones.map((m, i) => (
              <span
                key={i}
                className="text-sm bg-warm-100 text-earth-700 px-3 py-1.5 rounded-full font-medium"
              >
                {m}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Encouragement */}
      <div className="bg-warm-50 rounded-2xl p-5 border border-warm-200 text-center">
        <p className="text-sm text-earth-700 leading-relaxed">
          {totalActions === 0
            ? "Your journey starts with one step. Explore the tools above and come back to see your progress grow."
            : totalActions < 5
              ? "You're building momentum. Every resume bullet, every practice interview, every search — it all adds up."
              : totalActions < 15
                ? "You're putting in real work. The preparation you're doing now gives you a real advantage."
                : "You've shown serious commitment to your future. That dedication speaks volumes to any employer."}
        </p>
      </div>
    </div>
  );
}

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
        {sub && <span className="text-xs text-muted block mt-0.5">{sub}</span>}
      </div>
      <span
        className={`text-lg font-bold ${value > 0 ? "text-sage-600" : "text-gray-300"}`}
      >
        {value}
      </span>
    </div>
  );
}
