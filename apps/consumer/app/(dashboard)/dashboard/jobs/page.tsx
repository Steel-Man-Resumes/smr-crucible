"use client";

/**
 * Second-Chance Job Board — Refinery Tool 4
 *
 * Curated: only fair-chance employers.
 * Record-aware matching by user's situation and jurisdiction.
 * Links to actual postings — user applies themselves.
 */

import { useState, useEffect } from "react";

interface JobListing {
  title: string;
  company: string;
  location: string;
  salary?: string;
  url?: string;
  description: string;
  second_chance: boolean;
  posted?: string;
}

interface UserContext {
  targetRole: string;
  location: string;
  skills: string[];
  hasRecord: boolean;
  recordType?: string;
}

const COMMON_ROLES = [
  "Warehouse Associate",
  "Customer Service Representative",
  "Forklift Operator",
  "General Labor",
  "Production Worker",
  "CDL Driver",
  "Food Service",
  "Construction",
  "Janitorial / Cleaning",
  "Retail Associate",
];

export default function JobBoardPage() {
  const [context, setContext] = useState<UserContext>({
    targetRole: "",
    location: "",
    skills: [],
    hasRecord: false,
  });
  const [jobs, setJobs] = useState<JobListing[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [fairChanceInfo, setFairChanceInfo] = useState<string>("");
  const [rateLimitError, setRateLimitError] = useState("");

  // Load from Forge session
  useEffect(() => {
    try {
      const stored = localStorage.getItem("forge_session");
      if (stored) {
        const session = JSON.parse(stored);
        const ctx: Partial<UserContext> = {};

        if (session.forgeOutput?.careerPaths?.[0]?.title) {
          ctx.targetRole = session.forgeOutput.careerPaths[0].title;
        }
        if (session.preferences?.location) {
          ctx.location = session.preferences.location;
        }
        if (session.forgeOutput?.skills) {
          const allSkills: string[] = [];
          for (const cat of Object.values(session.forgeOutput.skills)) {
            if (Array.isArray(cat)) allSkills.push(...cat);
          }
          ctx.skills = allSkills.slice(0, 10);
        }
        if (session.challenges?.includes("criminal_record")) {
          ctx.hasRecord = true;
          ctx.recordType = session.criminalRecord?.type;
        }

        setContext((prev) => ({ ...prev, ...ctx }));
      }
    } catch {}
  }, []);

  async function searchJobs() {
    if (!context.targetRole && !context.location) return;
    setSearching(true);
    setSearched(true);
    setRateLimitError("");

    try {
      const res = await fetch("/api/job-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context),
      });

      if (res.status === 429) {
        const data = await res.json();
        setRateLimitError(data.error);
      } else if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
        setFairChanceInfo(data.fair_chance_info || "");
      }
    } catch {
      setJobs([]);
    } finally {
      setSearching(false);
    }

    // Track search
    try {
      const tracker = JSON.parse(
        localStorage.getItem("consumer_progress") || "{}"
      );
      tracker.job_searches = (tracker.job_searches || 0) + 1;
      tracker.last_job_search = new Date().toISOString();
      localStorage.setItem("consumer_progress", JSON.stringify(tracker));
    } catch {}
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-foreground mb-2">
        Second-Chance Job Board
      </h1>
      <p className="text-body text-muted mb-8">
        Employers who believe in fair chances. Every listing here is from a
        company known to consider applicants with records.
      </p>

      {/* Search form */}
      <div className="bg-white rounded-2xl p-5 border border-border mb-6">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1">
              What kind of work?
            </label>
            <input
              value={context.targetRole}
              onChange={(e) =>
                setContext({ ...context, targetRole: e.target.value })
              }
              placeholder="e.g., Warehouse, Customer Service, CDL"
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white min-h-touch"
            />
            {/* Quick picks */}
            <div className="flex flex-wrap gap-2 mt-2">
              {COMMON_ROLES.slice(0, 5).map((role) => (
                <button
                  key={role}
                  onClick={() => setContext({ ...context, targetRole: role })}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    context.targetRole === role
                      ? "bg-sage-100 border-sage-300 text-sage-700"
                      : "bg-gray-50 border-gray-200 text-muted hover:border-sage-300"
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Where?</label>
            <input
              value={context.location}
              onChange={(e) =>
                setContext({ ...context, location: e.target.value })
              }
              placeholder="City, State (e.g., Milwaukee, WI)"
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white min-h-touch"
            />
          </div>

          <button
            onClick={searchJobs}
            disabled={searching || (!context.targetRole && !context.location)}
            className="w-full px-6 py-4 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 disabled:bg-gray-300 transition-colors min-h-touch"
          >
            {searching ? "Searching..." : "Find Fair-Chance Jobs"}
          </button>
        </div>
      </div>

      {/* Rate limit warning */}
      {rateLimitError && (
        <div className="bg-amber-50 rounded-2xl p-5 border border-amber-200 mb-6">
          <p className="text-sm text-amber-800">{rateLimitError}</p>
        </div>
      )}

      {/* Fair chance info box */}
      {fairChanceInfo && (
        <div className="bg-sky-50 rounded-2xl p-5 border border-sky-200 mb-6">
          <h2 className="font-semibold text-sky-800 mb-2">
            Fair-Chance Hiring in Your Area
          </h2>
          <p className="text-sm text-sky-700 leading-relaxed">
            {fairChanceInfo}
          </p>
        </div>
      )}

      {/* Results */}
      {searching && (
        <div className="flex items-center gap-3 py-12 justify-center text-muted">
          <div className="w-5 h-5 border-2 border-sage-600 border-t-transparent rounded-full animate-spin" />
          Finding fair-chance employers...
        </div>
      )}

      {!searching && searched && jobs.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted mb-3">
            We couldn&apos;t find specific listings right now. Try broadening
            your search or check these resources:
          </p>
          <div className="space-y-2">
            <a
              href="https://www.70millionjobs.com"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm text-sky-600 hover:text-sky-700"
            >
              70 Million Jobs — Job board for people with records ↗
            </a>
            <a
              href="https://www.honestrecruiters.com"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm text-sky-600 hover:text-sky-700"
            >
              Honest Recruiters — Fair-chance employment network ↗
            </a>
            <a
              href="https://www.careeronestop.org"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm text-sky-600 hover:text-sky-700"
            >
              CareerOneStop — Free career counseling at American Job Centers ↗
            </a>
          </div>
        </div>
      )}

      {!searching && jobs.length > 0 && (
        <div className="space-y-3">
          {jobs.map((job, i) => (
            <div
              key={i}
              className="bg-white rounded-xl p-4 border border-border"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-foreground">
                      {job.title}
                    </h3>
                    {job.second_chance && (
                      <span className="text-[10px] font-medium bg-sage-100 text-sage-700 px-2 py-0.5 rounded-full">
                        Fair Chance
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted">{job.company}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                    {job.location && <span>{job.location}</span>}
                    {job.salary && (
                      <span className="font-medium text-sage-600">
                        {job.salary}
                      </span>
                    )}
                    {job.posted && <span>{job.posted}</span>}
                  </div>
                  <p className="text-sm text-muted mt-2 leading-relaxed">
                    {job.description}
                  </p>
                </div>
              </div>
              {job.url && (
                <div className="mt-3 pt-3 border-t border-border">
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-sky-600 hover:text-sky-700 font-medium"
                  >
                    View & Apply ↗
                  </a>
                </div>
              )}
            </div>
          ))}

          <p className="text-xs text-muted text-center py-4">
            Always verify job details directly with the employer. Listings are
            AI-generated suggestions based on known fair-chance employers.
          </p>
        </div>
      )}

      {/* Always-visible resources */}
      <div className="mt-8 pt-6 border-t border-border">
        <h2 className="text-sm font-semibold text-foreground mb-3">
          National Job Resources
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a
            href="https://www.70millionjobs.com"
            target="_blank"
            rel="noopener noreferrer"
            className="p-3 bg-warm-50 rounded-xl border border-warm-200 hover:border-warm-300 transition-colors"
          >
            <span className="text-sm font-medium block">70 Million Jobs</span>
            <span className="text-xs text-muted">
              America&apos;s leading employment platform for people with records
            </span>
          </a>
          <a
            href="https://www.careeronestop.org/LocalHelp/AmericanJobCenters/find-american-job-centers.aspx"
            target="_blank"
            rel="noopener noreferrer"
            className="p-3 bg-warm-50 rounded-xl border border-warm-200 hover:border-warm-300 transition-colors"
          >
            <span className="text-sm font-medium block">
              American Job Centers
            </span>
            <span className="text-xs text-muted">
              Free career counseling, resume help, and job training near you
            </span>
          </a>
          <a
            href="https://nationalreentryresourcecenter.org"
            target="_blank"
            rel="noopener noreferrer"
            className="p-3 bg-warm-50 rounded-xl border border-warm-200 hover:border-warm-300 transition-colors"
          >
            <span className="text-sm font-medium block">
              National Reentry Resource Center
            </span>
            <span className="text-xs text-muted">
              State-by-state guides for employment, housing, and legal aid
            </span>
          </a>
          <a
            href="https://www.dol.gov/agencies/eta/reentry"
            target="_blank"
            rel="noopener noreferrer"
            className="p-3 bg-warm-50 rounded-xl border border-warm-200 hover:border-warm-300 transition-colors"
          >
            <span className="text-sm font-medium block">
              DOL Reentry Employment
            </span>
            <span className="text-xs text-muted">
              Federal programs supporting employment for justice-involved
              individuals
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}
