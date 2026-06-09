"use client";

/**
 * Fair-Chance Lanes -- Refinery Tool 5
 *
 * Curated fair-chance job lanes plus live-search handoffs.
 * This page does not invent openings. It points users toward realistic
 * fair-chance searches and preparation tools.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TierGate } from "@/components/TierGate";
import { GhostGuide } from "@crucible/consumer-ui";
import { getOpusMessage } from "@/lib/opus-messages";
import { getCareerPaths, getSkillNames } from "@/lib/forge-output";
import {
  CATEGORY_LABELS,
  rankSecondChanceOpportunities,
  type OpportunityCategory,
  type SecondChanceOpportunity,
} from "@/lib/second-chance-board";

type CategoryFilter = OpportunityCategory | "all";

const CATEGORY_ORDER: CategoryFilter[] = [
  "all",
  "warehouse",
  "manufacturing",
  "food_service",
  "transportation",
  "customer_service",
  "trades",
  "support",
];

export default function SecondChanceBoardPageWrapper() {
  return (
    <TierGate requiredTier="client">
      <SecondChanceBoardPage />
    </TierGate>
  );
}

function SecondChanceBoardPage() {
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [careerTitles, setCareerTitles] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [barriers, setBarriers] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("forge_session");
      if (!stored) return;
      const session = JSON.parse(stored) as {
        forgeOutput?: unknown;
        challenges?: string[];
        preferences?: { location?: string };
      };
      const paths = getCareerPaths(session.forgeOutput);
      setCareerTitles(paths.map((path) => path.title).slice(0, 4));
      setSkills(getSkillNames(session.forgeOutput, 12));
      setBarriers(Array.isArray(session.challenges) ? session.challenges : []);
      setLocation(session.preferences?.location || "");
    } catch {}

    try {
      const tracker = JSON.parse(
        localStorage.getItem("consumer_progress") || "{}"
      );
      tracker.resources_viewed = (tracker.resources_viewed || 0) + 1;
      tracker.second_chance_board_views =
        (tracker.second_chance_board_views || 0) + 1;
      localStorage.setItem("consumer_progress", JSON.stringify(tracker));
    } catch {}
  }, []);

  const ranked = useMemo(
    () => rankSecondChanceOpportunities({ careerTitles, skills, barriers }),
    [careerTitles, skills, barriers]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ranked.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (!needle) return true;
      const haystack = [
        item.title,
        item.searchTerm,
        ...item.roles,
        ...item.employerExamples,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [category, query, ranked]);

  const topMatchIds = new Set(ranked.slice(0, 3).map((item) => item.id));

  return (
    <div className="max-w-5xl space-y-8">
      <header className="max-w-3xl">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          Fair-Chance Lanes
        </h1>
        <GhostGuide message={getOpusMessage("resources")} pageId="resources" />
        <p className="text-body text-muted leading-relaxed">
          Start with job lanes and employers more likely to evaluate people
          individually, then move into live listings, targeted resumes,
          interview practice, and disclosure planning.
        </p>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900 leading-relaxed">
            Fair-chance does not mean automatic approval. Background checks
            still vary by role, location, timing, and the relationship between
            the record and the job.
          </p>
        </div>
      </header>

      {(careerTitles.length > 0 || barriers.includes("criminal_record")) && (
        <section className="rounded-xl border border-sage-200 bg-sage-50 p-4">
          <h2 className="font-semibold text-sage-800 mb-2">
            Matched From Your Forge Results
          </h2>
          <div className="flex flex-wrap gap-2">
            {careerTitles.slice(0, 4).map((title) => (
              <span
                key={title}
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-sage-700 border border-sage-200"
              >
                {title}
              </span>
            ))}
            {barriers.includes("criminal_record") && (
              <span className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-sage-700 border border-sage-200">
                record-aware matching
              </span>
            )}
            {location && (
              <span className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-sage-700 border border-sage-200">
                {location}
              </span>
            )}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">
              Opportunity Lanes
            </h2>
            <p className="text-sm text-muted">
              Use these as starting points, then search live openings.
            </p>
          </div>
          <label className="block sm:w-72">
            <span className="sr-only">Search roles or employers</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search role or employer"
              className="w-full rounded-xl border border-border bg-white px-4 py-3 text-sm outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-100"
            />
          </label>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {CATEGORY_ORDER.map((id) => (
            <button
              key={id}
              onClick={() => setCategory(id)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                category === id
                  ? "bg-sage-600 text-white"
                  : "bg-white text-muted border border-border hover:border-sage-300 hover:text-foreground"
              }`}
            >
              {CATEGORY_LABELS[id]}
            </button>
          ))}
        </div>

        {filtered.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {filtered.map((item) => (
              <OpportunityCard
                key={item.id}
                opportunity={item}
                matched={topMatchIds.has(item.id)}
                expanded={expanded === item.id}
                onToggle={() =>
                  setExpanded(expanded === item.id ? null : item.id)
                }
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-white p-8 text-center">
            <p className="text-sm text-muted">
              No board lanes match that filter. Try a broader role term.
            </p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-foreground">
              Still need local support before work?
            </h2>
            <p className="text-sm text-muted">
              Housing, transport, IDs, legal aid, and crisis help can still
              decide whether a job is realistic this week.
            </p>
          </div>
          <a
            href="tel:211"
            className="inline-flex min-h-touch items-center justify-center rounded-xl bg-sage-600 px-5 py-3 text-sm font-medium text-white hover:bg-sage-700"
          >
            Call 211
          </a>
        </div>
      </section>
    </div>
  );
}

function OpportunityCard({
  opportunity,
  matched,
  expanded,
  onToggle,
}: {
  opportunity: SecondChanceOpportunity;
  matched: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const searchHref = `/dashboard/jobs?q=${encodeURIComponent(
    opportunity.searchTerm
  )}`;
  const resumeHref = `/dashboard/resume-builder?role=${encodeURIComponent(
    opportunity.searchTerm
  )}`;
  const employersHref = `/dashboard/employers?q=${encodeURIComponent(
    opportunity.searchTerm
  )}`;

  return (
    <article className="rounded-xl border border-border bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-foreground">
              {opportunity.title}
            </h3>
            {matched && (
              <span className="rounded-full bg-sage-100 px-2 py-0.5 text-[10px] font-semibold text-sage-700">
                matched
              </span>
            )}
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
              {opportunity.hiringSignal}
            </span>
          </div>
          <p className="text-sm text-muted leading-relaxed">
            {opportunity.whyItFits}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {opportunity.roles.slice(0, 4).map((role) => (
          <span
            key={role}
            className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700"
          >
            {role}
          </span>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
        <p className="text-xs text-amber-900">
          <span className="font-semibold">Watch out: </span>
          {opportunity.watchOut}
        </p>
      </div>

      {expanded && (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase text-muted">
              Employer Examples
            </h4>
            <div className="flex flex-wrap gap-2">
              {opportunity.employerExamples.map((employer) => (
                <span
                  key={employer}
                  className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
                >
                  {employer}
                </span>
              ))}
            </div>
          </div>

          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase text-muted">
              Best Move
            </h4>
            <p className="text-sm text-foreground leading-relaxed">
              {opportunity.bestMove}
            </p>
          </div>

          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase text-muted">
              Source Note
            </h4>
            <p className="text-xs text-muted leading-relaxed">
              {opportunity.sourceNote}
            </p>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href={searchHref}
          className="inline-flex min-h-touch items-center justify-center rounded-xl bg-sage-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sage-700"
        >
          Search live jobs
        </Link>
        <Link
          href={resumeHref}
          className="inline-flex min-h-touch items-center justify-center rounded-xl border border-sage-200 bg-white px-4 py-2.5 text-sm font-medium text-sage-700 hover:bg-sage-50"
        >
          Build a resume
        </Link>
        <Link
          href={employersHref}
          className="inline-flex min-h-touch items-center justify-center rounded-xl border border-sky-200 bg-white px-4 py-2.5 text-sm font-medium text-sky-700 hover:bg-sky-50"
        >
          Verified employers
        </Link>
      </div>

      <button
        onClick={onToggle}
        className="mt-4 text-sm font-medium text-muted hover:text-foreground"
      >
        {expanded ? "Hide details" : "Show details"}
      </button>
    </article>
  );
}
