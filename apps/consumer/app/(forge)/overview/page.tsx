"use client";

/**
 * Observer Path — Evidence Showcase
 *
 * For funders, academics, media, and curious visitors.
 * Evidence-first, impressive, quotable. Deep content gated behind auth.
 */

import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { useEffect } from "react";

const HEADLINE_CITATIONS = [
  {
    finding:
      "Affect labeling reduces amygdala reactivity by up to 50%",
    source: "Lieberman et al., 2007",
    detail:
      "fMRI study. Putting feelings into words activates prefrontal cortex and dampens amygdala response. Kircanski et al. (2012) confirmed it outperforms cognitive reappraisal.",
  },
  {
    finding:
      "Redemption sequences predict higher well-being and generativity",
    source: "McAdams, 2013",
    detail:
      "Narrative identity theory. People who construct bad\u2192good arcs show better outcomes than contamination sequences (good\u2192bad).",
  },
  {
    finding:
      "Autonomy, competence, and relatedness are core psychological needs",
    source: "Deci & Ryan, 2000",
    detail:
      "Self-Determination Theory. Incarceration systematically strips autonomy. This tool rebuilds it through user-driven choices at every step.",
  },
];

const DIFFERENTIATORS = [
  {
    us: "AI career analysis + record-aware legal navigation + disclosure coaching",
    them: "Generic resume builder or job board",
  },
  {
    us: "Every AI decision logged, auditable, explainable",
    them: "Black-box recommendations with no audit trail",
  },
  {
    us: "Research-grounded behavioral rules (10 non-negotiable)",
    them: "Generic chatbot personality without evidence base",
  },
  {
    us: "Narrative-first output \u2014 strengths before barriers",
    them: "Deficit-focused assessments and risk scores",
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
        <div className="mb-10">
          <p className="text-sm font-medium text-sage-600 mb-2 uppercase tracking-wide">
            Evidence &amp; Methodology
          </p>
          <h1 className="text-3xl font-bold text-foreground mb-4">
            The Tool That Didn&apos;t Exist
          </h1>
          <p className="text-body text-foreground leading-relaxed">
            No tool combines AI career analysis + record-aware legal
            navigation + disclosure coaching for justice-impacted people.
            Until now.
          </p>
        </div>

        {/* Section 1: The gap */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-foreground mb-4">
            The Numbers
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-sage-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-sage-700">70M+</p>
              <p className="text-sm text-muted mt-1">
                Americans with criminal records
              </p>
            </div>
            <div className="bg-sage-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-sage-700">&lt;50%</p>
              <p className="text-sm text-muted mt-1">
                Employed in year 1 post-release
              </p>
            </div>
            <div className="bg-sage-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-sage-700">$7,500</p>
              <p className="text-sm text-muted mt-1">
                Median earnings, first year
              </p>
            </div>
          </div>
        </section>

        {/* Section 2: Research */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-foreground mb-4">
            The Research
          </h2>
          <div className="space-y-4">
            {HEADLINE_CITATIONS.map((cite, i) => (
              <div
                key={i}
                className="border border-border rounded-xl p-4"
              >
                <p className="font-medium text-foreground text-sm mb-1">
                  {cite.finding}
                </p>
                <p className="text-xs text-sage-600 font-medium mb-2">
                  {cite.source}
                </p>
                <p className="text-sm text-muted leading-relaxed">
                  {cite.detail}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Section 3: Architecture */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-foreground mb-3">
            The Architecture
          </h2>
          <p className="text-body text-foreground leading-relaxed mb-3">
            Observability-first. Every AI recommendation is logged with an
            input hash, model ID, explanation, and latency. Full audit trail
            for JBS compliance and funder reporting.
          </p>
          <div className="bg-gray-50 rounded-lg px-4 py-3 font-mono text-xs text-muted">
            <p>decision_log &#123;</p>
            <p className="pl-4">input_hash: sha256(user_input)[0:16]</p>
            <p className="pl-4">model_id: &quot;claude-sonnet-4-20250514&quot;</p>
            <p className="pl-4">
              explanation: &quot;why this recommendation&quot;
            </p>
            <p className="pl-4">latency_ms: 1247</p>
            <p className="pl-4">user_action: null | &quot;accepted&quot; | &quot;modified&quot;</p>
            <p>&#125;</p>
          </div>
        </section>

        {/* Section 4: What makes it different */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-foreground mb-4">
            What Makes It Different
          </h2>
          <div className="space-y-3">
            {DIFFERENTIATORS.map((diff, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="flex-shrink-0 mt-1">
                  <div className="w-5 h-5 rounded-full bg-sage-100 flex items-center justify-center">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      aria-hidden="true"
                    >
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
                  <p className="text-sm font-medium text-foreground">
                    {diff.us}
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    vs. {diff.them}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTAs */}
        <div className="space-y-3">
          <button
            onClick={() => {
              updateSession({ isDemo: true, audience: "observer" });
              router.push("/welcome?demo=true");
            }}
            className="w-full px-6 py-4 bg-sage-600 text-white rounded-xl text-lg font-medium hover:bg-sage-700 transition-colors min-h-touch"
          >
            See it in action
          </button>

          <button
            onClick={() =>
              router.push("/login?callbackUrl=/dashboard/evidence")
            }
            className="w-full px-6 py-4 bg-white text-sage-600 border-2 border-sage-200 rounded-xl font-medium hover:bg-sage-50 transition-colors min-h-touch"
          >
            Sign in for full evidence deck
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
