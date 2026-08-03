"use client";

/**
 * PartnerToolsOverview -- the methodology / tool-explainer view for partners.
 *
 * Extracted from the /dashboard partner branch (C9, role-clear wave). Org
 * leaders and staff now land on their OrgDashboard; this overview remains the
 * landing for partner-tier accounts WITHOUT an org link, and stays reachable
 * from the org dashboard ("How the tools work") for demos.
 */

import Link from "next/link";
import { TBtn } from "@crucible/consumer-ui";

const TOOL_OVERVIEW = [
  {
    title: "The Forge",
    href: "/intro",
    description:
      "8-page career analysis. Detects readiness stage, extracts skills, builds redemption narrative, maps career paths, and connects barriers to next steps. Free for all clients -- no account needed until they want to save.",
    research: "Stages of Change (Prochaska), Narrative Identity (McAdams), Giordano's hooks-for-change",
  },
  {
    title: "Application Tailor",
    href: "/dashboard/application-tailor",
    description:
      "Targeted resume, cover letter, and disclosure brief for a specific job. Pulls from the client's Forge profile -- every version is grounded in their actual skills and story, not a template.",
    research: "ATS optimization, Bandura mastery experiences",
  },
  {
    title: "Disclosure Planner",
    href: "/dashboard/disclosure",
    description:
      "Personalized plan for when and how to discuss a criminal record. Includes jurisdiction-specific ban-the-box guidance, a natural-sounding script, and a pivot strategy using the client's strengths.",
    research: "Pager structural barriers, WI §973.015, ban-the-box compliance",
  },
  {
    title: "Interview Practice",
    href: "/dashboard/interview",
    description:
      "AI mock interviews tailored to role, level, and disclosure needs. Includes written practice plus live voice rehearsal through OpenAI Realtime.",
    research: "SDT competence-building, Bandura performance accomplishments, voice practice for transfer",
  },
  {
    title: "Job Board",
    href: "/dashboard/jobs",
    description:
      "Real listings via JSearch API -- no hallucinated jobs. Fair-chance employers flagged and sorted first. No outbound links; everything renders natively.",
    research: "SHRM fair-chance employer data, Granovetter weak ties",
  },
  {
    title: "Fair-Chance Lanes",
    href: "/dashboard/resources",
    description:
      "Curated fair-chance opportunity lanes, employer signals, and handoffs into live listings, targeted resumes, interview practice, and disclosure planning.",
    research: "SHRM fair-chance hiring, CareerOneStop reentry guidance, Granovetter weak ties",
  },
];

export function PartnerToolsOverview({ noOrgCallout }: { noOrgCallout?: boolean }) {
  return (
    <div className="space-y-10">
      {/* Header */}
      <section className="bg-t-panel p-6 sm:p-8 border border-t-line">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-t-panel-2 border border-t-line flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="text-t-amber">
              <path d="M8 1C5.58 1 3 3.13 3 6v4c0 1 .5 2 1 2.5s1 1.5 1 2.5h6c0-1 .5-2 1-2.5S13 11 13 10V6c0-2.87-2.58-5-5-5z" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-t-amber-bright mb-1">Partner tools overview</p>
            <h1 className="text-2xl font-bold text-t-white mb-2">Welcome to The Refinery</h1>
            <p className="text-base text-t-phos-dim leading-relaxed">
              You&apos;re seeing this as a partner organization. The tools below are what your
              clients experience -- each one is built on peer-reviewed research and designed
              specifically for justice-impacted people. Walk through any tool to see it in
              action, or go deeper into the methodology.
            </p>
          </div>
        </div>
      </section>

      {noOrgCallout && (
        <section className="bg-t-panel border border-t-amber p-5">
          <h2 className="font-semibold text-t-white mb-1">
            Your account isn&apos;t linked to an organization yet
          </h2>
          <p className="text-sm text-t-phos-dim">
            Once your partner code is connected, this page becomes your organization&apos;s
            mission control: your team, your clients&apos; progress, and program reach.
            Reach out and we&apos;ll link it.
          </p>
        </section>
      )}

      {/* Deep methodology links */}
      <section className="grid sm:grid-cols-2 gap-4">
        <Link
          href="/dashboard/methodology"
          className="block bg-t-panel border border-t-amber p-6 hover:bg-t-panel-2 transition-colors"
        >
          <h3 className="font-semibold text-lg text-t-white mb-1">Full Methodology Playbook</h3>
          <p className="text-sm text-t-phos-dim">
            10 behavioral rules, research foundation, how each feature was designed. The full picture for program directors and case managers.
          </p>
        </Link>
        <Link
          href="/dashboard/evidence"
          className="block bg-t-panel border border-t-steel p-6 hover:bg-t-panel-2 transition-colors"
        >
          <h3 className="font-semibold text-lg text-t-white mb-1">Evidence & Outcomes</h3>
          <p className="text-sm text-t-phos-dim">
            Research citations, outcome data, differentiators. Built for funders, grant applications, and accreditation reviewers.
          </p>
        </Link>
      </section>

      {/* Try it with a client */}
      <section className="bg-t-panel border border-t-line p-6">
        <h2 className="font-semibold text-t-white mb-2">Try it with a client</h2>
        <p className="text-sm text-t-phos-dim mb-4">
          The Forge takes about 10 minutes. Walk through it yourself or sit with a client while
          they do -- you&apos;ll see exactly what they experience and what it produces.
        </p>
        <TBtn href="/intro" size="sm">start The Forge</TBtn>
      </section>

      {/* Tool-by-tool breakdown */}
      <section>
        <h2 className="text-lg font-bold text-t-white mb-4">What each tool does</h2>
        <div className="space-y-3">
          {TOOL_OVERVIEW.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="block bg-t-panel p-5 border border-t-line hover:border-t-phos-dim transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-t-white mb-1">{tool.title}</h3>
                  <p className="text-sm text-t-phos-dim leading-relaxed mb-2">{tool.description}</p>
                  <p className="text-xs text-t-amber-bright font-medium">Research basis: {tool.research}</p>
                </div>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-t-phos-dim flex-shrink-0 mt-1">
                  <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Settings */}
      <section className="border-t border-t-line pt-8">
        <Link
          href="/dashboard/settings"
          className="t-focus text-sm text-t-phos-dim hover:text-t-white bg-t-panel px-4 py-3 border border-t-line transition-colors"
        >
          Settings & privacy
        </Link>
      </section>
    </div>
  );
}
