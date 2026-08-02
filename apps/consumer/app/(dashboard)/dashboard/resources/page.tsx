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
        <h1 className="text-2xl font-bold text-t-white mb-2">
          Fair-Chance Lanes
        </h1>
        <GhostGuide message={getOpusMessage("resources")} pageId="resources" />
        <p className="text-base text-t-phos-dim leading-relaxed">
          Start with job lanes and employers more likely to evaluate people
          individually, then move into live listings, targeted resumes,
          interview practice, and disclosure planning.
        </p>
        <div className="mt-4 border border-t-amber bg-t-panel-2 px-4 py-3">
          <p className="text-sm text-t-amber-bright leading-relaxed">
            Fair-chance does not mean automatic approval. Background checks
            still vary by role, location, timing, and the relationship between
            the record and the job.
          </p>
        </div>
      </header>

      {(careerTitles.length > 0 || barriers.includes("criminal_record")) && (
        <section className="border border-t-line bg-t-panel p-4">
          <h2 className="font-semibold text-t-amber-bright mb-2">
            Matched From Your Forge Results
          </h2>
          <div className="flex flex-wrap gap-2">
            {careerTitles.slice(0, 4).map((title) => (
              <span
                key={title}
                className="bg-t-panel-2 px-3 py-1.5 text-xs font-medium text-t-phos border border-t-line"
              >
                {title}
              </span>
            ))}
            {barriers.includes("criminal_record") && (
              <span className="bg-t-panel-2 px-3 py-1.5 text-xs font-medium text-t-phos border border-t-line">
                record-aware matching
              </span>
            )}
            {location && (
              <span className="bg-t-panel-2 px-3 py-1.5 text-xs font-medium text-t-phos border border-t-line">
                {location}
              </span>
            )}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-t-white">
              Opportunity Lanes
            </h2>
            <p className="text-sm text-t-phos-dim">
              Use these as starting points, then search live openings.
            </p>
          </div>
          <label className="block sm:w-72">
            <span className="sr-only">Search roles or employers</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search role or employer"
              className="w-full border border-t-line bg-t-panel px-4 py-3 text-sm text-t-white outline-none focus:border-t-amber"
            />
          </label>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {CATEGORY_ORDER.map((id) => (
            <button
              key={id}
              onClick={() => setCategory(id)}
              className={`t-focus whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors border ${
                category === id
                  ? "bg-t-amber text-white border-t-amber font-bold"
                  : "bg-t-panel text-t-phos-dim border-t-line hover:border-t-phos-dim hover:text-t-white"
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
          <div className="border border-t-line bg-t-panel p-8 text-center">
            <p className="text-sm text-t-phos-dim">
              No board lanes match that filter. Try a broader role term.
            </p>
          </div>
        )}
      </section>

      <section className="border border-t-line bg-t-panel p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-t-white">
              Still need local support before work?
            </h2>
            <p className="text-sm text-t-phos-dim">
              Housing, transport, IDs, legal aid, and crisis help can still
              decide whether a job is realistic this week.
            </p>
          </div>
          <a
            href="tel:211"
            className="t-focus inline-flex min-h-touch items-center justify-center bg-t-amber px-5 py-3 text-sm font-bold text-white hover:bg-t-amber-bright"
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
  const resumeHref = `/dashboard/application-tailor?role=${encodeURIComponent(
    opportunity.searchTerm
  )}`;
  const employersHref = `/dashboard/employers?q=${encodeURIComponent(
    opportunity.searchTerm
  )}`;

  return (
    <article className="border border-t-line bg-t-panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-t-white">
              {opportunity.title}
            </h3>
            {matched && (
              <span className="border border-t-amber px-2 py-0.5 text-[10px] font-semibold text-t-amber-bright">
                matched
              </span>
            )}
            <span className="border border-t-line px-2 py-0.5 text-[10px] font-semibold text-t-phos-dim">
              {opportunity.hiringSignal}
            </span>
          </div>
          <p className="text-sm text-t-phos-dim leading-relaxed">
            {opportunity.whyItFits}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {opportunity.roles.slice(0, 4).map((role) => (
          <span
            key={role}
            className="border border-t-steel bg-t-panel-2 px-2.5 py-1 text-xs font-medium text-t-steel"
          >
            {role}
          </span>
        ))}
      </div>

      <div className="mt-4 border border-t-amber bg-t-panel-2 px-3 py-2">
        <p className="text-xs text-t-amber-bright">
          <span className="font-semibold">Watch out: </span>
          {opportunity.watchOut}
        </p>
      </div>

      {expanded && (
        <div className="mt-4 space-y-4 border-t border-t-line pt-4">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase text-t-phos-dim">
              Employer Examples
            </h4>
            <div className="flex flex-wrap gap-2">
              {opportunity.employerExamples.map((employer) => (
                <span
                  key={employer}
                  className="bg-t-panel-2 px-2.5 py-1 text-xs text-t-phos-dim border border-t-line"
                >
                  {employer}
                </span>
              ))}
            </div>
          </div>

          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase text-t-phos-dim">
              Best Move
            </h4>
            <p className="text-sm text-t-phos leading-relaxed">
              {opportunity.bestMove}
            </p>
          </div>

          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase text-t-phos-dim">
              Source Note
            </h4>
            <p className="text-xs text-t-phos-dim leading-relaxed">
              {opportunity.sourceNote}
            </p>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href={searchHref}
          className="t-focus inline-flex min-h-touch items-center justify-center bg-t-amber px-4 py-2.5 text-sm font-bold text-white hover:bg-t-amber-bright"
        >
          Search live jobs
        </Link>
        <Link
          href={resumeHref}
          className="t-focus inline-flex min-h-touch items-center justify-center border border-t-amber bg-transparent px-4 py-2.5 text-sm font-bold text-t-amber-bright hover:bg-t-amber/10"
        >
          Build a resume
        </Link>
        <Link
          href={employersHref}
          className="t-focus inline-flex min-h-touch items-center justify-center border border-t-steel bg-transparent px-4 py-2.5 text-sm font-bold text-t-steel hover:bg-t-steel/10"
        >
          Verified employers
        </Link>
      </div>

      <button
        onClick={onToggle}
        className="mt-4 text-sm font-medium text-t-phos-dim hover:text-t-white"
      >
        {expanded ? "Hide details" : "Show details"}
      </button>
    </article>
  );
}
