"use client";

/**
 * Partner Path — Methodology Showcase
 *
 * For AJC staff, DOC program directors, nonprofit partners.
 * Shows enough to understand what the tool does and why.
 * Deep methodology is gated behind auth.
 */

import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { useEffect } from "react";

const BEHAVIORAL_RULES = [
  {
    rule: "Invite naming, prompt causal reasoning",
    why: "Naming emotions reduces amygdala activation by up to 50%",
  },
  {
    rule: "Never prescribe \u2014 offer options",
    why: "Autonomy is a core psychological need, especially post-incarceration",
  },
  {
    rule: "Reflect and affirm",
    why: "Mirror words back organized and validated \u2014 builds redemption narrative",
  },
  {
    rule: "Meet readiness level",
    why: "Adjust guidance intensity based on stage of change",
  },
  {
    rule: "Explain yourself",
    why: "Every AI recommendation includes reasoning \u2014 transparency builds trust",
  },
  {
    rule: "Scaffold then fade",
    why: "More structure early, less later \u2014 builds independence, not dependence",
  },
  {
    rule: "Process praise only",
    why: 'Reference what they DID, not what they ARE \u2014 "You described that well"',
  },
  {
    rule: "Cultural sensitivity",
    why: "No assumptions about background, family, education, or values",
  },
  {
    rule: "Know when to connect humans",
    why: "Crisis detection routes to 211.org and Crisis Text Line (741741)",
  },
  {
    rule: "Never share personal data in responses",
    why: '"The situation you described" \u2014 never repeats sensitive details',
  },
];

const FORGE_STEPS = [
  {
    name: "Readiness",
    what: "Self-reported stage of change (Prochaska model). No clinical assessment.",
  },
  {
    name: "Resume",
    what: "Multi-path intake \u2014 upload, import, or guided builder. AI extracts skills from anything.",
  },
  {
    name: "Goals",
    what: "Purpose before job titles. What matters to them \u2014 stability, growth, meaning.",
  },
  {
    name: "Barriers",
    what: "Structured criminal record input + free-text narrative for affect labeling.",
  },
  {
    name: "Output",
    what: "Narrative-first analysis: strengths, skills, career paths, barrier-to-resource mapping.",
  },
];

export default function PartnerPage() {
  const router = useRouter();
  const { updateSession } = useForgeSession();

  useEffect(() => {
    updateSession({
      pagesVisited: ["intro", "partner"],
      lastPageVisited: "partner",
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-10">
          <p className="text-sm font-medium text-sage-600 mb-2 uppercase tracking-wide">
            For Partner Organizations
          </p>
          <h1 className="text-3xl font-bold text-foreground mb-4">
            How The Forge Works With Your Clients
          </h1>
          <p className="text-body text-muted leading-relaxed">
            The Forge is a free, research-grounded career exploration tool
            designed for justice-impacted populations. No login required. No
            data sold. Built on behavioral science, not guesswork.
          </p>
        </div>

        {/* Section 1: What it does */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-foreground mb-3">
            What This Tool Does
          </h2>
          <p className="text-body text-foreground leading-relaxed">
            In about 10 minutes, your clients walk through a guided
            career exploration that surfaces their strengths, maps their
            skills, identifies career paths, and connects barriers to
            real resources. The output is narrative-first &mdash; never
            scored, never graded. It&apos;s built to be the starting
            point for meaningful career planning.
          </p>
        </section>

        {/* Section 2: The 10 Rules */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-foreground mb-4">
            10 Behavioral Rules (Research-Grounded)
          </h2>
          <div className="space-y-3">
            {BEHAVIORAL_RULES.map((item, i) => (
              <div
                key={i}
                className="flex gap-3 px-4 py-3 bg-sage-50 rounded-lg"
              >
                <span className="text-sage-600 font-semibold text-sm mt-0.5 flex-shrink-0">
                  {i + 1}.
                </span>
                <div>
                  <p className="font-medium text-foreground text-sm">
                    {item.rule}
                  </p>
                  <p className="text-xs text-muted mt-0.5">{item.why}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section 3: Research foundation */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-foreground mb-3">
            Research Foundation
          </h2>
          <p className="text-body text-foreground leading-relaxed mb-3">
            Built on Bandura (self-efficacy), Maruna (desistance and
            generative identity), Lieberman (affect labeling), Prochaska
            &amp; DiClemente (stages of change), Deci &amp; Ryan
            (self-determination theory), and McAdams (narrative identity).
          </p>
          <div className="bg-sage-50 rounded-lg px-4 py-3">
            <p className="text-sm text-sage-700 italic">
              &ldquo;People who construct redemption sequences &mdash;
              narratives where bad experiences lead to good outcomes &mdash;
              show higher well-being and generativity.&rdquo;
              <span className="not-italic text-sage-500 ml-1">
                &mdash; McAdams, 2013
              </span>
            </p>
          </div>
        </section>

        {/* Section 4: How it works */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-foreground mb-4">
            The Forge Flow
          </h2>
          <div className="space-y-3">
            {FORGE_STEPS.map((step, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="w-8 h-8 rounded-full bg-sage-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-sage-600 font-semibold text-sm">
                    {i + 1}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-foreground text-sm">
                    {step.name}
                  </p>
                  <p className="text-sm text-muted">{step.what}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section 5: Sample output preview */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-foreground mb-3">
            Sample Output Preview
          </h2>
          <div className="bg-gray-50 rounded-xl border border-border p-5">
            <p className="text-sm text-muted mb-2 uppercase tracking-wide font-medium">
              Sample &mdash; Anonymized
            </p>
            <p className="font-semibold text-foreground mb-2">
              &ldquo;A Leader on the Rise&rdquo;
            </p>
            <p className="text-sm text-foreground leading-relaxed mb-3">
              Three years of consistent warehouse operations with a track
              record that speaks louder than any title. Training new hires,
              99.2% accuracy, and leading an 8-person crew &mdash; all
              without the formal promotion. The pattern is clear: this
              person doesn&apos;t wait to be told to lead.
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="px-2 py-1 bg-sage-100 text-sage-700 rounded text-xs">
                Team Leadership
              </span>
              <span className="px-2 py-1 bg-sage-100 text-sage-700 rounded text-xs">
                Inventory Management
              </span>
              <span className="px-2 py-1 bg-sage-100 text-sage-700 rounded text-xs">
                Safety Compliance
              </span>
              <span className="px-2 py-1 bg-sage-100 text-sage-700 rounded text-xs">
                Process Optimization
              </span>
            </div>
            <p className="text-xs text-muted">
              Career paths: Logistics Coordinator ($42-58K), Warehouse
              Supervisor ($45-62K), Operations Associate ($38-55K)
            </p>
          </div>
        </section>

        {/* CTAs */}
        <div className="space-y-3">
          <button
            onClick={() => {
              updateSession({ isDemo: true, audience: "partner" });
              router.push("/welcome?demo=true");
            }}
            className="w-full px-6 py-4 bg-sage-600 text-white rounded-xl text-lg font-medium hover:bg-sage-700 transition-colors min-h-touch"
          >
            Watch it work
          </button>

          <button
            onClick={() =>
              router.push("/login?callbackUrl=/dashboard/methodology")
            }
            className="w-full px-6 py-4 bg-white text-sage-600 border-2 border-sage-200 rounded-xl font-medium hover:bg-sage-50 transition-colors min-h-touch"
          >
            Sign in for full methodology playbook
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
