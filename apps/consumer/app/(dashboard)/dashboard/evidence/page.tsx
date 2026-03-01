"use client";

/**
 * Evidence Deck — Auth-gated deep content for observers.
 *
 * Full research citations, competitive landscape, JBS compliance,
 * architecture decisions, and gap analysis.
 */

export default function EvidencePage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Evidence Deck
        </h1>
        <p className="text-body text-muted">
          The research, data, and architecture behind Steel Man Resumes.
        </p>
      </div>

      {/* Research Citations */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-foreground mb-4">
          Research Citations
        </h2>
        <div className="space-y-3">
          {CITATIONS.map((cite, i) => (
            <div key={i} className="bg-white rounded-lg p-4 border border-border">
              <p className="text-sm text-foreground font-medium">
                {cite.authors} ({cite.year})
              </p>
              <p className="text-sm text-muted italic mt-0.5">{cite.title}</p>
              {cite.finding && (
                <p className="text-sm text-sage-700 mt-2 bg-sage-50 rounded px-3 py-2">
                  {cite.finding}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Competitive Landscape */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-foreground mb-4">
          Competitive Landscape
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-sage-50">
                <th className="text-left px-4 py-3 font-semibold text-foreground border-b border-border">
                  Feature
                </th>
                <th className="text-center px-4 py-3 font-semibold text-foreground border-b border-border">
                  Steel Man
                </th>
                <th className="text-center px-4 py-3 font-semibold text-foreground border-b border-border">
                  Honest Jobs
                </th>
                <th className="text-center px-4 py-3 font-semibold text-foreground border-b border-border">
                  CareerOneStop
                </th>
                <th className="text-center px-4 py-3 font-semibold text-foreground border-b border-border">
                  Generic AI
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPETITIVE_MATRIX.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <td className="px-4 py-2.5 text-foreground border-b border-border">
                    {row.feature}
                  </td>
                  <td className="px-4 py-2.5 text-center border-b border-border">
                    {row.steelMan}
                  </td>
                  <td className="px-4 py-2.5 text-center border-b border-border">
                    {row.honestJobs}
                  </td>
                  <td className="px-4 py-2.5 text-center border-b border-border">
                    {row.careerOneStop}
                  </td>
                  <td className="px-4 py-2.5 text-center border-b border-border">
                    {row.genericAI}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* JBS Compliance */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-foreground mb-4">
          JBS Compliance Framework
        </h2>
        <div className="space-y-3">
          {COMPLIANCE_ITEMS.map((item, i) => (
            <div key={i} className="flex gap-3 items-start">
              <div className="flex-shrink-0 mt-1 w-5 h-5 rounded bg-sage-100 flex items-center justify-center">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M2.5 6L5 8.5L9.5 3.5" stroke="#4a7c59" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{item.requirement}</p>
                <p className="text-xs text-muted mt-0.5">{item.implementation}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Architecture Decisions */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-foreground mb-4">
          Architecture Decisions
        </h2>
        <div className="space-y-4">
          {ADRS.map((adr, i) => (
            <div key={i} className="bg-white rounded-xl p-5 border border-border">
              <div className="flex items-start gap-3">
                <span className="px-2 py-1 bg-sage-100 text-sage-700 rounded text-xs font-mono font-bold flex-shrink-0">
                  ADR-{String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="font-semibold text-foreground text-sm">{adr.title}</h3>
                  <p className="text-sm text-muted mt-1">{adr.decision}</p>
                  <p className="text-xs text-sage-600 mt-2 italic">{adr.rationale}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Decision Observability */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-foreground mb-4">
          Decision Observability Framework
        </h2>
        <p className="text-sm text-foreground leading-relaxed mb-4">
          Every AI decision in Steel Man Resumes is logged with the following schema.
          Input content is hashed (SHA-256, first 16 characters) for privacy. Full
          audit trail accessible for compliance review.
        </p>
        <div className="bg-gray-50 rounded-xl p-5 font-mono text-xs text-muted border border-border">
          <pre className="whitespace-pre-wrap">{`decision_log {
  id: uuid
  ts: ISO 8601 timestamp
  user_id: uuid | null (pre-auth sessions)
  session_id: string | null
  context_page: "analyze" | "assistant" | "disclosure" | ...
  model_provider: "anthropic"
  model_id: "claude-sonnet-4-20250514"
  input_hash: sha256(user_input)[0:16]
  explanation: "why this recommendation was made"
  output_summary: { type, counts, metadata }
  token_count: number | null
  latency_ms: number | null
  user_action: null | "accepted" | "modified" | "rejected"
}`}</pre>
        </div>
      </section>

      {/* Gap Analysis */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold text-foreground mb-4">
          The Gap — What No Other Tool Does
        </h2>
        <div className="space-y-3">
          {GAPS.map((gap, i) => (
            <div key={i} className="bg-warm-50 rounded-lg p-4 border border-warm-200">
              <p className="text-sm font-medium text-foreground">{gap.gap}</p>
              <p className="text-xs text-muted mt-1">{gap.detail}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const CITATIONS = [
  {
    authors: "Lieberman, M. D., Eisenberger, N. I., Crockett, M. J., Tom, S. M., Pfeifer, J. H., & Way, B. M.",
    year: 2007,
    title: "Putting feelings into words: Affect labeling disrupts amygdala activity in response to affective stimuli.",
    finding: "fMRI study showing that putting feelings into words reduces amygdala reactivity by up to 50%.",
  },
  {
    authors: "Kircanski, K., Lieberman, M. D., & Craske, M. G.",
    year: 2012,
    title: "Feelings into words: Contributions of language to exposure therapy.",
    finding: "Affect labeling outperforms cognitive reappraisal and distraction in reducing emotional reactivity.",
  },
  {
    authors: "Bandura, A.",
    year: 1977,
    title: "Self-efficacy: Toward a unifying theory of behavioral change.",
    finding: "Self-efficacy is built through mastery experiences — real accomplishments, not encouragement or verbal persuasion.",
  },
  {
    authors: "Prochaska, J. O., & DiClemente, C. C.",
    year: 1983,
    title: "Stages and processes of self-change of smoking: Toward an integrative model of change.",
    finding: "The Transtheoretical Model describes five stages of change. Intervention effectiveness depends on matching the user's current stage.",
  },
  {
    authors: "McAdams, D. P.",
    year: 2013,
    title: "The redemptive self: Stories Americans live by.",
    finding: "Redemption sequences (bad\u2192good narrative arcs) predict higher well-being and generativity. Contamination sequences predict the opposite.",
  },
  {
    authors: "Maruna, S.",
    year: 2001,
    title: "Making good: How ex-convicts reform and rebuild their lives.",
    finding: "Desistance from crime correlates with constructing a 'generative identity' — seeing oneself as someone who can contribute positively.",
  },
  {
    authors: "Deci, E. L., & Ryan, R. M.",
    year: 2000,
    title: "The 'what' and 'why' of goal pursuits: Human needs and the self-determination of behavior.",
    finding: "Autonomy, competence, and relatedness are core psychological needs. Autonomy-supportive environments produce better outcomes than controlling ones.",
  },
  {
    authors: "Wood, D., Bruner, J. S., & Ross, G.",
    year: 1976,
    title: "The role of tutoring in problem solving.",
    finding: "Scaffolding: provide structure that fades as competence grows. More support early, less later.",
  },
  {
    authors: "Dweck, C. S.",
    year: 2006,
    title: "Mindset: The new psychology of success.",
    finding: "Process praise ('You worked hard on that') builds growth mindset. Person praise ('You're smart') builds fixed mindset.",
  },
];

const COMPETITIVE_MATRIX = [
  { feature: "AI career analysis", steelMan: "\u2713", honestJobs: "\u2717", careerOneStop: "\u2717", genericAI: "\u2713" },
  { feature: "Record-aware legal navigation", steelMan: "\u2713", honestJobs: "Partial", careerOneStop: "\u2717", genericAI: "\u2717" },
  { feature: "Disclosure coaching", steelMan: "\u2713", honestJobs: "\u2717", careerOneStop: "\u2717", genericAI: "\u2717" },
  { feature: "Research-grounded behavioral rules", steelMan: "\u2713", honestJobs: "\u2717", careerOneStop: "\u2717", genericAI: "\u2717" },
  { feature: "Decision audit trail", steelMan: "\u2713", honestJobs: "\u2717", careerOneStop: "\u2717", genericAI: "\u2717" },
  { feature: "No login required", steelMan: "\u2713", honestJobs: "\u2717", careerOneStop: "\u2713", genericAI: "Varies" },
  { feature: "Narrative-first output", steelMan: "\u2713", honestJobs: "\u2717", careerOneStop: "\u2717", genericAI: "\u2717" },
  { feature: "Fair-chance job matching", steelMan: "\u2713", honestJobs: "\u2713", careerOneStop: "\u2717", genericAI: "\u2717" },
];

const COMPLIANCE_ITEMS = [
  { requirement: "Consent management", implementation: "Explicit consent before data processing. Visible consent status. Revocable at any time." },
  { requirement: "Data minimization", implementation: "Pre-auth: localStorage only. Post-auth: minimal PII stored. Input content hashed for logging." },
  { requirement: "Decision auditability", implementation: "Every AI decision logged with model ID, input hash, explanation, and latency." },
  { requirement: "Non-discrimination", implementation: "AI behavioral rules prohibit assumptions. Cultural sensitivity enforced at prompt level." },
  { requirement: "Data portability", implementation: "Results downloadable as text file. Full data export available in Settings." },
  { requirement: "Right to deletion", implementation: "Account and all associated data deletable from Settings. Immediate effect." },
  { requirement: "Transparency", implementation: "AI explains its reasoning. Model version visible. Methodology publicly documented." },
];

const ADRS = [
  {
    title: "Pre-auth Forge flow (no login wall)",
    decision: "The Forge operates without authentication. Users create value before being asked to sign up.",
    rationale: "Login walls cause 60-80% abandonment in vulnerable populations. Value-first conversion is both ethical and effective.",
  },
  {
    title: "LocalStorage for session persistence",
    decision: "Forge session data stored in localStorage, not server-side, until the user creates an account.",
    rationale: "Privacy-first. No server-side tracking of anonymous users. Data stays on the user's device.",
  },
  {
    title: "Narrative-first output (no scores/grades)",
    decision: "Forge output presents strengths, skills, and career paths as narrative text, never as scores or grades.",
    rationale: "Deficit-focused assessments reinforce negative self-perception. Redemption sequence framing predicts better outcomes (McAdams, 2013).",
  },
  {
    title: "Scaffolding that never auto-generates",
    decision: "The guided resume builder provides templates and prompts but never writes content for the user.",
    rationale: "Self-efficacy requires mastery experiences (Bandura, 1977). Auto-generated content builds dependence, not competence.",
  },
  {
    title: "Observability-first AI pipeline",
    decision: "Every AI call logged with input hash, model version, explanation, and latency before returning results.",
    rationale: "JBS compliance requires auditability. Logging is non-optional and failure-isolated (won't break the response).",
  },
];

const GAPS = [
  {
    gap: "No integrated AI + legal navigation for justice-impacted populations",
    detail: "Honest Jobs does job matching. Legal aid does navigation. No tool combines them with AI analysis.",
  },
  {
    gap: "No research-grounded behavioral framework for career AI",
    detail: "Generic AI coaches use personality prompts. Steel Man enforces 10 non-negotiable rules from behavioral science.",
  },
  {
    gap: "No decision observability in career tools",
    detail: "No competing tool logs AI decisions with audit trails. Most operate as black boxes.",
  },
  {
    gap: "No scaffolded career exploration for low-digital-literacy users",
    detail: "Most tools assume resume upload capability. Steel Man accepts photos, guided input, and platform imports.",
  },
];
