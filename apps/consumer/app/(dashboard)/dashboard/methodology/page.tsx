"use client";

/**
 * Methodology Page — Tier-aware progressive disclosure.
 *
 * Client: simplified "how we help" + collapsed research details
 * Partner: full methodology playbook, all sections expanded
 * Observer: headline view + CTA to get partner access
 */

import { useUserTier } from "@/lib/useUserTier";
import { DisclosureSection } from "@/components/DisclosureSection";
import { TBtn } from "@crucible/consumer-ui";

export default function MethodologyPage() {
  const tier = useUserTier();
  const isPartnerOrAdmin = tier === "partner" || tier === "admin";
  const isObserver = tier === "observer";

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-t-white mb-2">
          {isPartnerOrAdmin ? "Methodology Playbook" : "How The Forge Works"}
        </h1>
        <p className="text-base text-t-phos-dim">
          {isPartnerOrAdmin
            ? "The research, rules, and implementation guide behind The Forge."
            : "The thinking behind the tools you’re using."}
        </p>
      </div>

      {/* Observer CTA */}
      {isObserver && (
        <div className="mb-8 bg-t-panel p-5 border border-t-line">
          <p className="text-sm text-t-phos mb-3">
            You&apos;re seeing a summary view. The full methodology playbook is
            available to partner organizations.
          </p>
          <div className="flex gap-3">
            <TBtn href="https://forge.steelmanresumes.com" size="sm">try The Forge</TBtn>
            <TBtn href="/dashboard/settings" variant="ghost" size="sm">enter partner code</TBtn>
          </div>
        </div>
      )}

      {/* How to use with clients — always visible, useful for everyone */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-t-white mb-4">
          {isPartnerOrAdmin ? "How to Use With Your Clients" : "What Happens When You Use The Forge"}
        </h2>
        <div className="space-y-4 text-sm text-t-phos leading-relaxed">
          <div className="bg-t-panel p-4 border border-t-line">
            <h3 className="font-semibold text-t-white mb-1">
              {isPartnerOrAdmin ? "Before the session" : "Getting started"}
            </h3>
            <p className="text-t-phos-dim">
              No prep needed. The Forge requires no login, no paperwork, and no
              prior resume. {isPartnerOrAdmin
                ? "Clients can start on any device with internet access. Point them to steelmanresumes.com and let t.ROY guide them."
                : "Just start answering questions honestly — t.ROY guides you through every step."}
            </p>
          </div>
          <div className="bg-t-panel p-4 border border-t-line">
            <h3 className="font-semibold text-t-white mb-1">
              {isPartnerOrAdmin ? "During the session" : "The process"}
            </h3>
            <p className="text-t-phos-dim">
              10-15 minutes. {isPartnerOrAdmin
                ? "Can be done independently or with a facilitator present. The AI assistant (t.ROY) is available on every page but never auto-opens. Clients can ask questions, talk through decisions, or skip sections they’re not ready for."
                : "You’ll share your resume (or build one), tell us what matters to you, and describe what’s in your way. t.ROY is there on every page if you need help."}
            </p>
          </div>
          <div className="bg-t-panel p-4 border border-t-line">
            <h3 className="font-semibold text-t-white mb-1">
              {isPartnerOrAdmin ? "After the session" : "What you get"}
            </h3>
            <p className="text-t-phos-dim">
              {isPartnerOrAdmin
                ? "Output can be downloaded immediately. For continued engagement, clients create a free account to access The Refinery (resume builder, disclosure planner, interview practice, job board, resources). Designed for 6+ month engagement."
                : "A personalized narrative about your strengths, skills matched to real careers, and resources for your specific situation. Download it or keep working in The Refinery."}
            </p>
          </div>
          {isPartnerOrAdmin && (
            <div className="bg-t-panel p-4 border border-t-line">
              <h3 className="font-semibold text-t-white mb-1">Outcome metrics</h3>
              <p className="text-t-phos-dim">
                Track completion rate (Forge), return rate (Refinery), time-to-first-application,
                disclosure confidence (pre/post), and employment outcomes at 30/90/180 days.
                All available via the Progress dashboard for authenticated users.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Research Foundation — progressive disclosure for clients, open for partners */}
      {!isObserver && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-t-white mb-4">
            {isPartnerOrAdmin ? "Research Foundation" : "The Science Behind It"}
          </h2>
          {!isPartnerOrAdmin && (
            <p className="text-sm text-t-phos-dim mb-4">
              Every feature is grounded in real research. Expand any section to learn more.
            </p>
          )}
          {isPartnerOrAdmin && (
            <p className="text-base text-t-phos leading-relaxed mb-4">
              The Forge is built on six workstreams of behavioral science
              research, each translated into concrete product features.
            </p>
          )}
          <div className="space-y-2">
            <DisclosureSection
              title="Behavioral Science Foundations"
              summary="How naming emotions and building self-efficacy drives real change"
              defaultOpen={isPartnerOrAdmin}
            >
              <ResearchBlock
                ws="WS1"
                researchers="Lieberman, Kircanski, Bandura, Prochaska & DiClemente"
                summary="Affect labeling reduces amygdala reactivity by up to 50% (Lieberman et al., 2007). Self-efficacy is built through mastery experiences, not encouragement (Bandura, 1977). Readiness for change follows predictable stages (Prochaska & DiClemente, 1983)."
                application="Every free-text input in The Forge serves a dual purpose: data collection and therapeutic affect labeling. The readiness page maps to Stages of Change without clinical language."
                showApplication={isPartnerOrAdmin}
              />
            </DisclosureSection>

            <DisclosureSection
              title="Narrative Identity & Desistance"
              summary="Why telling your story in a new way changes outcomes"
              defaultOpen={isPartnerOrAdmin}
            >
              <ResearchBlock
                ws="WS2"
                researchers="McAdams, Maruna, Deci & Ryan"
                summary="People who construct redemption sequences (bad→good arcs) show higher well-being and generativity (McAdams, 2013). Desistance from crime correlates with generative identity construction (Maruna, 2001). Autonomy is a core psychological need (Deci & Ryan, 2000)."
                application="Forge output uses narrative-first framing. Strengths presented before barriers. Career paths framed as possibilities, never prescriptions. User autonomy preserved at every step."
                showApplication={isPartnerOrAdmin}
              />
            </DisclosureSection>

            {isPartnerOrAdmin && (
              <>
                <DisclosureSection
                  title="Competitive Landscape"
                  defaultOpen
                >
                  <ResearchBlock
                    ws="WS3"
                    researchers=""
                    summary="No existing tool combines AI career analysis + record-aware legal navigation + disclosure coaching in a single platform. CareerOneStop, Honest Jobs, and generic AI coaches each cover fragments."
                    application="The Forge fills the integration gap. One flow, one output, covering skills + barriers + legal context + career matching."
                    showApplication
                  />
                </DisclosureSection>

                <DisclosureSection
                  title="AI UX for Marginalized Users"
                  defaultOpen
                >
                  <ResearchBlock
                    ws="WS4"
                    researchers="Wood, Bruner, Ross (scaffolding)"
                    summary="Scaffolded interfaces reduce cognitive load and abandonment. Multi-path intake (upload, import, guided builder) accommodates different digital literacy levels. Progressive disclosure prevents overwhelm."
                    application="Four resume intake paths. One-question-per-screen pattern. Maximum 50 words of display text per page. Guided builder never auto-generates."
                    showApplication
                  />
                </DisclosureSection>

                <DisclosureSection
                  title="JBS Compliance Framework"
                  defaultOpen
                >
                  <ResearchBlock
                    ws="WS5"
                    researchers=""
                    summary="Job Board System compliance requires auditability, consent management, and non-discrimination. Every AI decision must be explainable and logged."
                    application="Decision logging with input hash, model ID, explanation, and latency. Consent status visible on every page. Data export and deletion available."
                    showApplication
                  />
                </DisclosureSection>

                <DisclosureSection
                  title="Scaffolding Philosophy"
                  defaultOpen
                >
                  <ResearchBlock
                    ws="WS6"
                    researchers="Wood, Bruner, Ross, 1976"
                    summary="Scaffolding provides structure that fades as competence grows. More support early, less later. The goal is independence, not dependence on the tool."
                    application="The Forge provides heavy scaffolding (structured inputs, guidance). The Refinery fades scaffolding (open-ended tools, user-directed). t.ROY guides but never does the work."
                    showApplication
                  />
                </DisclosureSection>
              </>
            )}
          </div>
        </section>
      )}

      {/* 10 Behavioral Rules — always collapsed for clients, open for partners */}
      {!isObserver && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-t-white mb-4">
            {isPartnerOrAdmin ? "The 10 Behavioral Rules" : "How t.ROY Is Built to Help"}
          </h2>
          {isPartnerOrAdmin && (
            <p className="text-sm text-t-phos-dim mb-4">
              Non-negotiable. Enforced at the AI system prompt level.
            </p>
          )}
          {!isPartnerOrAdmin && (
            <p className="text-sm text-t-phos-dim mb-4">
              t.ROY follows strict rules designed to respect your time, your
              autonomy, and your privacy.
            </p>
          )}
          <div className="space-y-3">
            {RULES.map((rule, i) => (
              <div key={i} className="bg-t-panel p-4 border border-t-line">
                <p className="font-medium text-t-white text-sm">
                  {i + 1}. {rule.name}
                </p>
                {isPartnerOrAdmin ? (
                  <>
                    <p className="text-sm text-t-phos-dim mt-1">{rule.description}</p>
                    {rule.citation && (
                      <p className="text-xs text-t-amber-bright mt-1 italic">{rule.citation}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-t-phos-dim mt-1">{rule.clientFacing}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ResearchBlock({
  ws,
  researchers,
  summary,
  application,
  showApplication = true,
}: {
  ws: string;
  researchers: string;
  summary: string;
  application: string;
  showApplication?: boolean;
}) {
  return (
    <div className="bg-t-panel p-4 border border-t-line">
      <div className="flex items-start gap-3">
        <span className="px-2 py-1 bg-t-panel-2 border border-t-amber text-t-amber-bright text-xs font-bold flex-shrink-0">
          {ws}
        </span>
        <div>
          {researchers && (
            <p className="text-xs text-t-amber-bright mb-1">{researchers}</p>
          )}
          <p className="text-sm text-t-phos-dim leading-relaxed">{summary}</p>
          {showApplication && (
            <p className="text-sm text-t-phos mt-2 leading-relaxed">
              <span className="font-medium text-t-white">Application:</span> {application}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const RULES = [
  {
    name: "Invite naming, prompt causal reasoning",
    description:
      "Help users put words to their experiences. Naming emotions activates prefrontal cortex and dampens amygdala response.",
    clientFacing: "t.ROY helps you find the words for what you’re going through.",
    citation: "Lieberman et al., 2007; Kircanski et al., 2012",
  },
  {
    name: "Never prescribe — offer options",
    description:
      "Present choices. The user decides. Autonomy is sacred, especially for populations whose autonomy has been systematically stripped.",
    clientFacing: "You always decide. t.ROY shows options, never tells you what to do.",
    citation: "Deci & Ryan, 2000 (Self-Determination Theory)",
  },
  {
    name: "Reflect and affirm",
    description:
      "Mirror the user’s words back, organized and validated. Builds the redemption narrative that predicts positive reentry outcomes.",
    clientFacing: "t.ROY listens to what you say and reflects it back clearly.",
    citation: "Maruna, 2001 (generative identity); McAdams, 2013",
  },
  {
    name: "Meet readiness level",
    description:
      "Adjust guidance intensity based on the user’s stage of change. Don’t push someone in precontemplation; celebrate someone in action.",
    clientFacing: "t.ROY meets you where you are — no pressure, no rushing.",
    citation: "Prochaska & DiClemente, 1983 (Transtheoretical Model)",
  },
  {
    name: "Explain yourself",
    description:
      "Always explain why you’re suggesting something. Transparency builds trust and satisfies observability requirements.",
    clientFacing: "t.ROY always tells you why it’s suggesting something.",
    citation: null,
  },
  {
    name: "Scaffold then fade",
    description:
      "More structure early, less as the user progresses. The goal is user independence, not dependence on the tool.",
    clientFacing: "More help when you’re starting out, less as you get comfortable.",
    citation: "Wood, Bruner, Ross, 1976",
  },
  {
    name: "Process praise only",
    description:
      "Reference what the user DID, not what they ARE. ‘You did a great job describing that’ — never ‘You’re a natural.’",
    clientFacing: "t.ROY celebrates what you do, not labels about who you are.",
    citation: "Dweck, 2006 (growth mindset)",
  },
  {
    name: "Cultural sensitivity",
    description:
      "No assumptions about background, family structure, education level, or values. Ask, don’t assume. Plain language (6th grade reading level).",
    clientFacing: "No assumptions about your background. Plain language. Always.",
    citation: null,
  },
  {
    name: "Know when to connect humans",
    description:
      "Crisis detection routes to 211.org and Crisis Text Line (741741). The AI is a force multiplier, not a replacement for human connection.",
    clientFacing: "If you need more than a tool can give, t.ROY connects you to real people.",
    citation: null,
  },
  {
    name: "Never share personal data in responses",
    description:
      "Even if the user disclosed sensitive information, refer to it obliquely: ‘the situation you described’ — never repeat specifics.",
    clientFacing: "t.ROY never repeats your personal details back to you in chat.",
    citation: null,
  },
];
