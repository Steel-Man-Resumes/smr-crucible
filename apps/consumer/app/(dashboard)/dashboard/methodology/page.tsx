"use client";

/**
 * Methodology Playbook — Auth-gated deep content for partners.
 *
 * Full research foundation, behavioral rules with citations,
 * Forge flow methodology, scaffolding philosophy, and implementation guide.
 */

export default function MethodologyPage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Methodology Playbook
        </h1>
        <p className="text-body text-muted">
          The research, rules, and implementation guide behind The Forge.
        </p>
      </div>

      {/* Research Foundation */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-foreground mb-4">
          Research Foundation
        </h2>
        <p className="text-sm text-foreground leading-relaxed mb-4">
          The Forge is built on six workstreams of behavioral science
          research, each translated into concrete product features.
        </p>
        <div className="space-y-4">
          <ResearchBlock
            ws="WS1"
            title="Behavioral Science Foundations"
            researchers="Lieberman, Kircanski, Bandura, Prochaska & DiClemente"
            summary="Affect labeling reduces amygdala reactivity by up to 50% (Lieberman et al., 2007). Self-efficacy is built through mastery experiences, not encouragement (Bandura, 1977). Readiness for change follows predictable stages (Prochaska & DiClemente, 1983)."
            application="Every free-text input in The Forge serves a dual purpose: data collection and therapeutic affect labeling. The readiness page maps to Stages of Change without clinical language."
          />
          <ResearchBlock
            ws="WS2"
            title="Narrative Identity & Desistance"
            researchers="McAdams, Maruna, Deci & Ryan"
            summary="People who construct redemption sequences (bad&rarr;good arcs) show higher well-being and generativity (McAdams, 2013). Desistance from crime correlates with generative identity construction (Maruna, 2001). Autonomy is a core psychological need (Deci & Ryan, 2000)."
            application="Forge output uses narrative-first framing. Strengths presented before barriers. Career paths framed as possibilities, never prescriptions. User autonomy preserved at every step."
          />
          <ResearchBlock
            ws="WS3"
            title="Competitive Landscape"
            researchers=""
            summary="No existing tool combines AI career analysis + record-aware legal navigation + disclosure coaching in a single platform. CareerOneStop, Honest Jobs, and generic AI coaches each cover fragments."
            application="The Forge fills the integration gap. One flow, one output, covering skills + barriers + legal context + career matching."
          />
          <ResearchBlock
            ws="WS4"
            title="AI UX for Marginalized Users"
            researchers="Wood, Bruner, Ross (scaffolding)"
            summary="Scaffolded interfaces reduce cognitive load and abandonment. Multi-path intake (upload, import, guided builder) accommodates different digital literacy levels. Progressive disclosure prevents overwhelm."
            application="Four resume intake paths. One-question-per-screen pattern. Maximum 50 words of display text per page. Guided builder never auto-generates."
          />
          <ResearchBlock
            ws="WS5"
            title="JBS Compliance Framework"
            researchers=""
            summary="Job Board System compliance requires auditability, consent management, and non-discrimination. Every AI decision must be explainable and logged."
            application="Decision logging with input hash, model ID, explanation, and latency. Consent status visible on every page. Data export and deletion available."
          />
          <ResearchBlock
            ws="WS6"
            title="Scaffolding Philosophy"
            researchers="Wood, Bruner, Ross, 1976"
            summary="Scaffolding provides structure that fades as competence grows. More support early, less later. The goal is independence, not dependence on the tool."
            application="The Forge provides heavy scaffolding (structured inputs, guidance). The Refinery fades scaffolding (open-ended tools, user-directed). t.ROY guides but never does the work."
          />
        </div>
      </section>

      {/* 10 Behavioral Rules */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-foreground mb-4">
          The 10 Behavioral Rules
        </h2>
        <p className="text-sm text-muted mb-4">
          Non-negotiable. Enforced at the AI system prompt level.
        </p>
        <div className="space-y-3">
          {RULES.map((rule, i) => (
            <div key={i} className="bg-sage-50 rounded-lg p-4 border border-sage-200">
              <p className="font-medium text-foreground text-sm">
                {i + 1}. {rule.name}
              </p>
              <p className="text-sm text-muted mt-1">{rule.description}</p>
              {rule.citation && (
                <p className="text-xs text-sage-600 mt-1 italic">{rule.citation}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* How to use with clients */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-foreground mb-4">
          How to Use With Your Clients
        </h2>
        <div className="space-y-4 text-sm text-foreground leading-relaxed">
          <div className="bg-white rounded-lg p-4 border border-border">
            <h3 className="font-semibold mb-1">Before the session</h3>
            <p className="text-muted">
              No prep needed. The Forge requires no login, no paperwork, and no
              prior resume. Clients can start on any device with internet access.
              Point them to steelmanresumes.com and let t.ROY guide them.
            </p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-border">
            <h3 className="font-semibold mb-1">During the session</h3>
            <p className="text-muted">
              10-15 minutes. Can be done independently or with a facilitator
              present. The AI assistant (t.ROY) is available on every page but
              never auto-opens. Clients can ask questions, talk through
              decisions, or skip sections they&apos;re not ready for.
            </p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-border">
            <h3 className="font-semibold mb-1">After the session</h3>
            <p className="text-muted">
              Output can be downloaded immediately as a text file. For continued
              engagement, clients create a free account to access The Refinery
              (resume builder, disclosure planner, interview practice, job board,
              resources). Designed for 6+ month engagement.
            </p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-border">
            <h3 className="font-semibold mb-1">Outcome metrics</h3>
            <p className="text-muted">
              Track completion rate (Forge), return rate (Refinery), time-to-first-application,
              disclosure confidence (pre/post), and employment outcomes at 30/90/180 days.
              All available via the Progress dashboard for authenticated users.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function ResearchBlock({
  ws,
  title,
  researchers,
  summary,
  application,
}: {
  ws: string;
  title: string;
  researchers: string;
  summary: string;
  application: string;
}) {
  return (
    <div className="bg-white rounded-xl p-5 border border-border">
      <div className="flex items-start gap-3">
        <span className="px-2 py-1 bg-sage-100 text-sage-700 rounded text-xs font-mono font-bold flex-shrink-0">
          {ws}
        </span>
        <div>
          <h3 className="font-semibold text-foreground text-sm">{title}</h3>
          {researchers && (
            <p className="text-xs text-sage-600 mt-0.5">{researchers}</p>
          )}
          <p className="text-sm text-muted mt-2 leading-relaxed">{summary}</p>
          <p className="text-sm text-foreground mt-2 leading-relaxed">
            <span className="font-medium">Application:</span> {application}
          </p>
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
    citation: "Lieberman et al., 2007; Kircanski et al., 2012",
  },
  {
    name: "Never prescribe — offer options",
    description:
      "Present choices. The user decides. Autonomy is sacred, especially for populations whose autonomy has been systematically stripped.",
    citation: "Deci & Ryan, 2000 (Self-Determination Theory)",
  },
  {
    name: "Reflect and affirm",
    description:
      "Mirror the user's words back, organized and validated. Builds the redemption narrative that predicts positive reentry outcomes.",
    citation: "Maruna, 2001 (generative identity); McAdams, 2013",
  },
  {
    name: "Meet readiness level",
    description:
      "Adjust guidance intensity based on the user's stage of change. Don't push someone in precontemplation; celebrate someone in action.",
    citation: "Prochaska & DiClemente, 1983 (Transtheoretical Model)",
  },
  {
    name: "Explain yourself",
    description:
      "Always explain why you're suggesting something. Transparency builds trust and satisfies observability requirements.",
    citation: null,
  },
  {
    name: "Scaffold then fade",
    description:
      "More structure early, less as the user progresses. The goal is user independence, not dependence on the tool.",
    citation: "Wood, Bruner, Ross, 1976",
  },
  {
    name: "Process praise only",
    description:
      "Reference what the user DID, not what they ARE. 'You did a great job describing that' — never 'You're a natural.'",
    citation: "Dweck, 2006 (growth mindset)",
  },
  {
    name: "Cultural sensitivity",
    description:
      "No assumptions about background, family structure, education level, or values. Ask, don't assume. Plain language (6th grade reading level).",
    citation: null,
  },
  {
    name: "Know when to connect humans",
    description:
      "Crisis detection routes to 211.org and Crisis Text Line (741741). The AI is a force multiplier, not a replacement for human connection.",
    citation: null,
  },
  {
    name: "Never share personal data in responses",
    description:
      "Even if the user disclosed sensitive information, refer to it obliquely: 'the situation you described' — never repeat specifics.",
    citation: null,
  },
];
