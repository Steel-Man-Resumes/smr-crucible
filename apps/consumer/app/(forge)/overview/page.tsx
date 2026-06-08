"use client";

/**
 * Observer Path -- Evidence Showcase
 *
 * For funders, partner organizations, researchers, and curious visitors.
 * Leads with the problem and the gap, shows what the platform actually does,
 * backs it with research and architecture. Evidence-first, but built to compel.
 */

import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { useEffect } from "react";

const STATS = [
  { value: "70M+", label: "Americans with a criminal record" },
  { value: "<50%", label: "Employed in year one after release" },
  { value: "$7,500", label: "Median first-year earnings post-release" },
  { value: "0", label: "Tools that combined AI career analysis + legal navigation + disclosure coaching -- before this" },
];

const HOW_IT_WORKS = [
  {
    step: "1",
    name: "The Forge",
    time: "~10 minutes",
    desc: "Upload a resume or build one from scratch. Answer a few questions about goals, barriers, and readiness. The Forge analyzes your strengths, maps career paths, and outputs a resume, cover letter, and resource plan -- all in plain language.",
    color: "warm",
  },
  {
    step: "2",
    name: "The Refinery",
    time: "Ongoing",
    desc: "Targeted resume versions for specific jobs. A fair-chance employer board with real verified companies. AI interview practice with disclosure coaching built in. An application tracker. Materials vault. And t.ROY -- a career guide available on every page.",
    color: "sage",
  },
  {
    step: "3",
    name: "The Mini Forge",
    time: "2 minutes",
    desc: "Fast-track for people who need to apply somewhere today. Not recommended -- but it exists because real lives don't wait. Takes the most critical inputs and outputs a usable resume faster.",
    color: "sky",
  },
];

const RESEARCH = [
  {
    finding: "Affect labeling reduces amygdala reactivity by up to 50%",
    source: "Lieberman et al., 2007",
    detail: "Putting feelings into words activates prefrontal cortex and dampens stress response. The Forge uses narrative reframing at every step -- not as therapy, but as a documented performance technique.",
  },
  {
    finding: "Redemption narrative sequences predict higher well-being and post-release stability",
    source: "McAdams, 2013",
    detail: "People who construct bad-to-good story arcs show measurably better outcomes. The Forge output is structured as a redemption arc, not a deficit report.",
  },
  {
    finding: "Autonomy, competence, and relatedness are the three non-negotiable psychological needs",
    source: "Deci & Ryan, 2000 (Self-Determination Theory)",
    detail: "Incarceration systematically strips all three. This platform rebuilds them: user-driven choices (autonomy), skill recognition (competence), and peer-grounded language (relatedness).",
  },
];

const DIFFERENTIATORS = [
  {
    us: "AI career analysis tuned for justice-impacted people -- barriers, gaps, and records included",
    them: "Generic resume builder that treats a 10-year gap as a red flag",
  },
  {
    us: "Record-aware legal navigation and disclosure coaching baked into the Refinery",
    them: "Job boards that surface Ban-the-Box postings but give no guidance on what to say",
  },
  {
    us: "Every AI recommendation logged with input hash, model ID, explanation, and latency -- full audit trail",
    them: "Black-box recommendations with no accountability",
  },
  {
    us: "10 research-grounded behavioral rules that govern every t.ROY response",
    them: "A generic chatbot personality tuned for engagement, not outcomes",
  },
  {
    us: "Free, no credit card, no data sold -- ever",
    them: "Freemium tools that paywall the parts people actually need",
  },
];

export default function OverviewPage() {
  const router = useRouter();
  const { updateSession } = useForgeSession();

  useEffect(() => {
    updateSession({
      pagesVisited: ["intro", "overview"],
      lastPageVisited: "overview",
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-4 py-12">

        {/* Header */}
        <div className="mb-12">
          <p className="text-sm font-medium text-sage-600 mb-3 uppercase tracking-wide">
            Platform Overview
          </p>
          <h1 className="text-3xl font-bold text-foreground mb-4 leading-tight">
            The tool that didn&apos;t exist.
          </h1>
          <p className="text-body text-foreground leading-relaxed text-lg">
            Justice-impacted people face a hiring system that treats their record
            as a disqualifier -- not a data point. No tool combined AI career
            analysis, record-aware legal navigation, and disclosure coaching in
            one place. Until now.
          </p>
        </div>

        {/* The gap */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-foreground mb-5">
            The numbers
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {STATS.map((s, i) => (
              <div
                key={i}
                className={`rounded-xl p-5 border ${
                  i === 3
                    ? "col-span-2 bg-sage-600 border-sage-600 text-white"
                    : "bg-sage-50 border-sage-200"
                }`}
              >
                <p className={`text-2xl font-bold mb-1 ${i === 3 ? "text-white" : "text-sage-700"}`}>
                  {s.value}
                </p>
                <p className={`text-sm leading-snug ${i === 3 ? "text-sage-100" : "text-muted"}`}>
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-foreground mb-2">
            How it works
          </h2>
          <p className="text-sm text-muted mb-5">
            Three tools. One platform. Free at every step.
          </p>
          <div className="space-y-4">
            {HOW_IT_WORKS.map((item) => (
              <div
                key={item.step}
                className={`rounded-xl p-5 border ${
                  item.color === "warm"
                    ? "bg-warm-50 border-warm-200"
                    : item.color === "sage"
                    ? "bg-sage-50 border-sage-200"
                    : "bg-sky-50 border-sky-200"
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded ${
                      item.color === "warm"
                        ? "bg-warm-200 text-earth-800"
                        : item.color === "sage"
                        ? "bg-sage-200 text-sage-800"
                        : "bg-sky-200 text-sky-800"
                    }`}
                  >
                    {item.time}
                  </span>
                </div>
                <h3 className="font-bold text-foreground mb-1">{item.name}</h3>
                <p className="text-sm text-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* What makes it different */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-foreground mb-5">
            What makes it different
          </h2>
          <div className="space-y-3">
            {DIFFERENTIATORS.map((diff, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="flex-shrink-0 mt-0.5">
                  <div className="w-5 h-5 rounded-full bg-sage-100 flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path
                        d="M2.5 6L5 8.5L9.5 3.5"
                        stroke="#4a7c59"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{diff.us}</p>
                  <p className="text-xs text-muted mt-0.5">vs. {diff.them}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Research */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-foreground mb-2">
            The research foundation
          </h2>
          <p className="text-sm text-muted mb-5">
            Every design decision is grounded in peer-reviewed research.
            t.ROY follows 10 non-negotiable behavioral rules derived from this literature.
          </p>
          <div className="space-y-4">
            {RESEARCH.map((cite, i) => (
              <div key={i} className="border border-border rounded-xl p-5">
                <p className="font-semibold text-foreground text-sm mb-1">{cite.finding}</p>
                <p className="text-xs text-sage-600 font-medium mb-2">{cite.source}</p>
                <p className="text-sm text-muted leading-relaxed">{cite.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Architecture */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-foreground mb-2">
            Built for accountability
          </h2>
          <p className="text-body text-foreground leading-relaxed mb-4">
            Every AI recommendation is logged with an input hash, model ID,
            explanation, and latency. Full audit trail. No black box. Built
            for funder reporting, compliance review, and program evaluation.
          </p>
          <div className="bg-gray-50 rounded-xl px-5 py-4 font-mono text-xs text-muted border border-border">
            <p className="text-gray-500 mb-2">// Every AI decision logged:</p>
            <p>decision_log &#123;</p>
            <p className="pl-4">input_hash: sha256(user_input)[0:16]</p>
            <p className="pl-4">model_id: &quot;claude-sonnet-4-20250514&quot;</p>
            <p className="pl-4">explanation: &quot;why this recommendation&quot;</p>
            <p className="pl-4">latency_ms: 1247</p>
            <p className="pl-4">user_action: null | &quot;accepted&quot; | &quot;modified&quot;</p>
            <p>&#125;</p>
          </div>
          <p className="text-xs text-muted mt-3">
            Consent-gated partner dashboard lets organizations track cohort
            progress -- only for clients who have opted in. CSV export for
            program reporting. No data shared without explicit user permission.
          </p>
        </section>

        {/* Built by someone who lived it */}
        <section className="mb-12 bg-sage-600 rounded-2xl p-6 text-white">
          <p className="text-sm font-semibold text-sage-200 mb-2 uppercase tracking-wide">
            Built by someone who lived it
          </p>
          <p className="text-base leading-relaxed">
            Steel Man Resumes was built by Troy Carr -- a justice-impacted
            workforce advocate with a decade of direct service. The platform
            reflects what he wished existed when he was navigating the same
            system these tools are designed to help people survive.
          </p>
          <p className="text-sm text-sage-200 mt-3">
            Steel Man Resumes LLC &mdash; Wisconsin &mdash; AGPL-3.0 open source
          </p>
        </section>

        {/* CTAs */}
        <div className="space-y-3">
          <button
            onClick={() => {
              updateSession({ isDemo: true, audience: "observer" });
              router.push("/welcome?demo=true");
            }}
            className="w-full px-6 py-4 bg-sage-600 text-white rounded-xl text-base font-semibold hover:bg-sage-700 transition-colors min-h-touch"
          >
            See The Forge in action
          </button>

          <button
            onClick={() => router.push("/login?callbackUrl=/dashboard/evidence")}
            className="w-full px-6 py-4 bg-white text-sage-600 border-2 border-sage-200 rounded-xl font-medium hover:bg-sage-50 transition-colors min-h-touch"
          >
            Sign in for the full evidence deck
          </button>

          <button
            onClick={() => router.push("/intro")}
            className="w-full px-4 py-3 text-muted text-sm hover:text-foreground transition-colors"
          >
            &larr; Back
          </button>
        </div>

      </div>
    </div>
  );
}
