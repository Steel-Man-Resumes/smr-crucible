"use client";

/**
 * Observer Path -- Deep-Dive Tour
 *
 * Audience: scholars, funders, researchers, developers, partner organizations.
 * This is open-source software built for transparency. Nothing is hidden.
 * The full architecture, research foundation, behavioral protocol, and
 * privacy model are documented here -- no sign-in required.
 */

import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { useEffect } from "react";
import { TBtn } from "@crucible/consumer-ui";

const STATS = [
  { value: "70M+", label: "Americans with a criminal record" },
  { value: "<50%", label: "Employed in year one after release" },
  { value: "$7,500", label: "Median first-year earnings post-release" },
  { value: "0", label: "Tools that combined AI career analysis, legal navigation, and disclosure coaching in one place -- before this" },
];

const TROY_RULES = [
  {
    rule: "Name the feeling before solving the problem",
    why: "Affect labeling reduces amygdala reactivity before high-stakes work begins (Lieberman et al., 2007).",
  },
  {
    rule: "Strengths before gaps -- always",
    why: "Deficit-first framing activates threat response. Asset-first activates approach motivation.",
  },
  {
    rule: "Never volunteer legal interpretations",
    why: "t.ROY is a career guide, not a lawyer. It flags disclosure moments and points to resources.",
  },
  {
    rule: "Match complexity to the user's stated readiness",
    why: "Cognitive load theory: overwhelming someone mid-crisis loses them permanently.",
  },
  {
    rule: "Offer the next step -- never a lecture",
    why: "Autonomy-supportive language predicts sustained engagement (Deci & Ryan, 2000).",
  },
  {
    rule: "Use plain language. Always.",
    why: "The platform is written at a 6th-grade reading level. People in crisis don't need vocabulary tests.",
  },
  {
    rule: "Redemption arc, not deficit report",
    why: "People who construct bad-to-good story arcs show measurably better post-release outcomes (McAdams, 2013).",
  },
  {
    rule: "Consent before every data use",
    why: "Surveillance trauma is real. Trust must be built, not assumed.",
  },
  {
    rule: "Every recommendation requires a reason",
    why: "Unexplained AI advice erodes trust. t.ROY explains its reasoning in plain language every time.",
  },
  {
    rule: "If someone is in crisis, stop and redirect",
    why: "A crisis disclosure during career coaching requires a human, not a chatbot. Full stop.",
  },
];

const RESEARCH = [
  {
    finding: "Affect labeling reduces amygdala reactivity by up to 50%",
    source: "Lieberman et al., 2007 -- UCLA",
    detail: "Putting feelings into words activates prefrontal cortex and dampens the stress response. The Forge uses narrative reframing at every step -- not as therapy, but as a documented performance technique that lowers cognitive resistance before high-stakes work.",
  },
  {
    finding: "Redemption narrative sequences predict higher well-being and post-release stability",
    source: "McAdams, 2013 -- Northwestern",
    detail: "People who construct bad-to-good story arcs show measurably better outcomes across health, relationships, and stability. The Forge output is structured as a redemption arc, not a deficit report. This isn't a design flourish -- it's a replication of a documented psychological mechanism.",
  },
  {
    finding: "Autonomy, competence, and relatedness are the three non-negotiable psychological needs",
    source: "Deci & Ryan, 2000 -- Self-Determination Theory",
    detail: "Incarceration systematically strips all three. This platform rebuilds them: user-driven choices (autonomy), skills surfaced from real history (competence), and language grounded in lived experience rather than clinical distance (relatedness).",
  },
  {
    finding: "Stigma-based discrimination persists even in Ban-the-Box jurisdictions",
    source: "Agan & Starr, 2018 -- American Economic Review",
    detail: "Removing the checkbox doesn't remove the bias. The Refinery's disclosure coaching prepares users for the conversation that happens after the application -- not just the form.",
  },
  {
    finding: "Cognitive load undermines decision quality under economic stress",
    source: "Mullainathan & Shafir, 2013 -- Scarcity",
    detail: "Scarcity (of money, time, housing stability) taxes cognitive bandwidth directly. The platform is designed for people under maximum load: short prompts, no jargon, one question at a time, no decision fatigue.",
  },
  {
    finding: "Workforce reentry programs with wraparound support show 2-3x better employment retention",
    source: "MDRC / CEP Meta-Analysis",
    detail: "Employment alone doesn't stick. The Refinery is a wraparound: resume + disclosure + interview + applications + coaching, in one place, free.",
  },
];

const DIFFERENTIATORS = [
  {
    us: "AI career analysis built for justice-impacted people -- employment gaps, records, and barriers included in the model",
    them: "Generic resume builders that treat a 10-year gap as a red flag",
  },
  {
    us: "Record-aware disclosure coaching baked into the Refinery -- not an afterthought",
    them: "Job boards that surface Ban-the-Box listings but give no guidance on what to say when asked",
  },
  {
    us: "Every AI recommendation logged with input hash, model ID, explanation, and latency -- full audit trail",
    them: "Black-box recommendations with no accountability",
  },
  {
    us: "10 research-grounded behavioral rules that govern every t.ROY response -- non-negotiable, documented",
    them: "A generic chatbot tuned for engagement, not outcomes",
  },
  {
    us: "Consent-gated partner dashboard -- organizations can only see clients who have explicitly opted in",
    them: "Program tools that harvest participant data without meaningful consent",
  },
  {
    us: "Free at every step -- no paywall, no credit card, no data sold -- ever",
    them: "Freemium tools that paywall the parts people actually need",
  },
  {
    us: "Built by someone who navigated the same system -- not designed at a distance",
    them: "Tools designed by people who have never been incarcerated, for people who have",
  },
];

const JOURNEY = [
  {
    stage: "Stage 1",
    name: "The Forge",
    time: "~10 minutes",
    what: "Upload a resume or describe your work history. Answer a few questions about goals, barriers, readiness, and record. The Forge outputs: a resume, a cover letter, career paths matched to your background, and a resource plan -- all in plain language.",
    tech: "Claude Sonnet (Anthropic) with a custom prompt scaffold that enforces the 10 behavioral rules. Resume parsed via OCR + NLP. Output hashed and logged.",
    color: "amber",
  },
  {
    stage: "Stage 2",
    name: "Profile and Job Board",
    time: "5 minutes",
    what: "Fill in your contact info. Browse the verified fair-chance employer board -- real companies, real listings, manually verified to hire justice-impacted people.",
    tech: "Employers sourced from Airtable (SMR Employers base), imported to Neon PostgreSQL. Fair-chance verification is a manual human step -- not automated.",
    color: "phos",
  },
  {
    stage: "Stage 3",
    name: "Application Tailor",
    time: "Ongoing",
    what: "Build job-targeted resume versions for specific listings. The AI tailors language to the job description while preserving your story.",
    tech: "Refinery Artifact system: each resume is versioned, stored with metadata (target job, company, application ID), and linked to the job application tracker.",
    color: "steel",
  },
  {
    stage: "Stage 4",
    name: "Disclosure Planner",
    time: "15-30 minutes",
    what: "Plan when and how to talk about your record with specific employers. The planner walks through timing, framing, and what to say -- grounded in actual Ban-the-Box law and fair-chance employer research.",
    tech: "Structured coaching dialogue with t.ROY. Output saved as a disclosure_plan artifact. Nothing in the practice transcript is stored.",
    color: "amber",
  },
  {
    stage: "Stage 5",
    name: "Interview Practice",
    time: "Ongoing",
    what: "Text or live voice mock interviews tailored to your target role. Behavioral, situational, and disclosure-specific questions. Real-time feedback on framing, specificity, and narrative arc.",
    tech: "Text mode: Claude Sonnet. Voice mode: OpenAI Whisper (transcription) + Claude (feedback). Practice audio is never stored -- only the frame used and whether the point landed.",
    color: "phos",
  },
  {
    stage: "Stage 6",
    name: "Applications + Follow-Up",
    time: "Ongoing",
    what: "Track every application: company, status, dates, which resume version you used. Generate follow-up emails and save them to My Materials.",
    tech: "job_application table in Neon. Refinery Artifact system for follow-up emails and cover letters. My Materials = the vault of all your generated documents.",
    color: "steel",
  },
];

const BADGE_COLOR: Record<string, string> = {
  amber: "border-t-amber text-t-amber-bright",
  phos: "border-t-phos text-t-phos",
  steel: "border-t-steel text-t-steel",
};

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
    <div className="min-h-screen bg-t-bg">
      <div className="max-w-2xl mx-auto px-4 py-12">

        {/* Header */}
        <div className="mb-12">
          <p className="text-sm font-medium text-t-amber-bright mb-3 uppercase">
            Full Technical + Research Overview
          </p>
          <h1 className="text-3xl font-bold text-t-white mb-4 leading-tight">
            The tool that didn&apos;t exist.
          </h1>
          <p className="text-lg text-t-phos leading-relaxed mb-4">
            Justice-impacted people face a hiring system that treats their record
            as a disqualifier -- not a data point. No tool combined AI career
            analysis, record-aware legal navigation, and disclosure coaching in
            one place. Until now.
          </p>
          <p className="text-sm text-t-phos-dim leading-relaxed">
            This page is the complete documentation of what this platform is,
            how it works, what research grounds it, and how every decision was
            made. Open source. Nothing hidden. Designed to be read by scholars,
            funders, developers, and partner organizations.
          </p>
        </div>

        {/* The numbers */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-t-white mb-5">The gap</h2>
          <div className="grid grid-cols-2 gap-4">
            {STATS.map((s, i) => (
              <div
                key={i}
                className={`p-5 border ${
                  i === 3
                    ? "col-span-2 bg-t-panel-2 border-t-amber"
                    : "bg-t-panel border-t-line"
                }`}
              >
                <p className="text-2xl font-bold mb-1 text-t-amber-bright">
                  {s.value}
                </p>
                <p className="text-sm leading-snug text-t-phos-dim">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* The full journey */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-t-white mb-2">The full journey</h2>
          <p className="text-sm text-t-phos-dim mb-5">
            Six stages. One platform. Every stage builds on the last.
            Free at every step.
          </p>
          <div className="space-y-4">
            {JOURNEY.map((item) => (
              <div key={item.stage} className="p-5 border border-t-line bg-t-panel">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-bold px-2 py-0.5 border ${BADGE_COLOR[item.color]}`}>
                    {item.stage}
                  </span>
                  <span className="text-xs text-t-phos-dim">{item.time}</span>
                </div>
                <h3 className="font-bold text-t-white mb-1">{item.name}</h3>
                <p className="text-sm text-t-phos leading-relaxed mb-3">{item.what}</p>
                <div className="bg-t-bg/60 p-3 border border-t-line">
                  <p className="text-xs text-t-phos-dim leading-relaxed">
                    <span className="font-semibold text-t-white">Under the hood: </span>
                    {item.tech}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* t.ROY behavioral protocol */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-t-white mb-2">
            The behavioral protocol
          </h2>
          <p className="text-sm text-t-phos-dim mb-5">
            t.ROY follows 10 non-negotiable rules on every interaction.
            These are not personality guidelines -- they are hard constraints
            derived from peer-reviewed research and Troy&apos;s decade of direct
            service. They cannot be overridden by user prompting.
          </p>
          <div className="space-y-3">
            {TROY_RULES.map((r, i) => (
              <div key={i} className="border border-t-line p-4">
                <div className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-t-panel-2 border border-t-line text-t-amber-bright text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-semibold text-t-white text-sm mb-1">{r.rule}</p>
                    <p className="text-xs text-t-phos-dim leading-relaxed">{r.why}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* What makes it different */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-t-white mb-5">
            What makes it different
          </h2>
          <div className="space-y-3">
            {DIFFERENTIATORS.map((diff, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="flex-shrink-0 mt-0.5">
                  <div className="w-5 h-5 bg-t-panel-2 border border-t-line flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path
                        d="M2.5 6L5 8.5L9.5 3.5"
                        stroke="#c9973f"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-t-white">{diff.us}</p>
                  <p className="text-xs text-t-phos-dim mt-0.5">vs. {diff.them}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Privacy model */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-t-white mb-2">
            The privacy model
          </h2>
          <p className="text-base text-t-phos leading-relaxed mb-4">
            Surveillance trauma is real. Many justice-impacted people have
            been monitored, recorded, and reported on without their knowledge
            or consent for years. This platform is designed to actively undo
            that pattern.
          </p>
          <div className="space-y-3">
            {[
              {
                title: "Practice tools store frames, not words",
                detail: "The Disclosure Planner and Interview Practice tools store whether a coaching frame was used and whether the key point landed -- never the user's actual answers, transcript, or audio. The system can show you progress without survelling your process.",
              },
              {
                title: "Partner access is consent-gated",
                detail: "Partner organizations (nonprofits, reentry programs, job centers) can only see clients who have explicitly opted in to share their progress. The toggle is in Settings. Off by default. Cannot be enabled by the partner -- only by the user.",
              },
              {
                title: "Forge data stays local until you choose otherwise",
                detail: "The Forge runs client-side. Resume data, goals, and story answers are stored in your browser's localStorage -- not our servers -- until you create an account and choose to sync. You can complete the Forge and never create an account.",
              },
              {
                title: "No data sold -- ever",
                detail: "Steel Man Resumes LLC is not funded by advertising. There is no data monetization layer. This is documented in the AGPL-3.0 license and the source code is public.",
              },
              {
                title: "Right to deletion",
                detail: "Settings > Privacy > Delete all data removes everything server-side and clears localStorage. The deletion is immediate and irreversible.",
              },
            ].map((item, i) => (
              <div key={i} className="border border-t-line p-4">
                <p className="font-semibold text-t-white text-sm mb-1">{item.title}</p>
                <p className="text-xs text-t-phos-dim leading-relaxed">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Research */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-t-white mb-2">
            The research foundation
          </h2>
          <p className="text-sm text-t-phos-dim mb-5">
            Every design decision is grounded in peer-reviewed research.
            The behavioral protocol, the copy reading level, the narrative arc
            of the Forge output, and the privacy model all trace to specific
            empirical literature.
          </p>
          <div className="space-y-4">
            {RESEARCH.map((cite, i) => (
              <div key={i} className="border border-t-line p-5">
                <p className="font-semibold text-t-white text-sm mb-1">{cite.finding}</p>
                <p className="text-xs text-t-amber-bright font-medium mb-2">{cite.source}</p>
                <p className="text-sm text-t-phos-dim leading-relaxed">{cite.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Architecture */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-t-white mb-2">
            Architecture and accountability
          </h2>
          <p className="text-base text-t-phos leading-relaxed mb-4">
            Every AI recommendation is logged with an input hash, model ID,
            explanation, and latency. Full audit trail. No black box. Built
            for funder reporting, compliance review, and program evaluation.
          </p>
          <div className="bg-t-panel-2 px-5 py-4 text-xs text-t-phos-dim border border-t-line mb-4">
            <p className="text-t-phos-dim/70 mb-2">// Every AI decision logged:</p>
            <p>decision_log &#123;</p>
            <p className="pl-4">input_hash: sha256(user_input)[0:16]</p>
            <p className="pl-4">model_id: &quot;claude-sonnet-4-6&quot;</p>
            <p className="pl-4">explanation: &quot;why this recommendation&quot;</p>
            <p className="pl-4">latency_ms: 1247</p>
            <p className="pl-4">user_action: null | &quot;accepted&quot; | &quot;modified&quot;</p>
            <p>&#125;</p>
          </div>
          <div className="space-y-3 text-sm">
            {[
              "Neon PostgreSQL -- all structured data (users, profiles, artifacts, applications, consent records, decision log)",
              "Cloudflare R2 -- encrypted document storage (uploaded resumes, generated PDFs)",
              "Vercel -- serverless hosting, edge functions, preview deployments",
              "Resend -- transactional email (magic links only -- no marketing email)",
              "Airtable -- verified employer data source (manually curated, imported to PostgreSQL)",
            ].map((item, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="text-t-amber flex-shrink-0 text-xs mt-0.5">--</span>
                <p className="text-t-phos-dim leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </section>

        {/* For partners */}
        <section className="mb-12 border border-t-line p-6">
          <h2 className="text-xl font-bold text-t-white mb-2">
            For partner organizations
          </h2>
          <p className="text-sm text-t-phos-dim leading-relaxed mb-4">
            Reentry programs, workforce development orgs, legal aid societies,
            and job centers can integrate Steel Man Resumes into their client
            workflow. Access codes unlock higher AI usage limits and allow
            consent-gated progress tracking.
          </p>
          <div className="space-y-3 text-sm">
            {[
              { label: "Access code", detail: "One code per program. Clients enter it at sign-in to unlock higher limits. Codes are linked to your partner account." },
              { label: "Partner dashboard", detail: "See cohort progress -- stage, artifacts completed, last activity -- for clients who have opted in to share. CSV export for program reporting." },
              { label: "No vendor lock-in", detail: "AGPL-3.0 license. The source code is public. You can self-host a private instance for your program." },
              { label: "To get an access code", detail: "Email Steel Man Resumes LLC directly. Free for nonprofits and community organizations during the launch period." },
            ].map((item, i) => (
              <div key={i} className="border border-t-line p-4">
                <p className="font-semibold text-t-white mb-1">{item.label}</p>
                <p className="text-xs text-t-phos-dim leading-relaxed">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* For funders */}
        <section className="mb-12 border border-t-line p-6 bg-t-panel">
          <h2 className="text-xl font-bold text-t-white mb-2">
            For funders
          </h2>
          <p className="text-sm text-t-phos-dim leading-relaxed mb-4">
            Steel Man Resumes LLC (WI) is currently transitioning to a nonprofit
            structure. The platform is AGPL-3.0 open source and free to all users.
            No revenue is generated from user data.
          </p>
          <div className="space-y-3 text-sm">
            {[
              { label: "Measurable outputs", detail: "Every Forge completion, resume built, disclosure plan, interview session, and application tracked -- with user consent and without collecting PII in aggregate reports." },
              { label: "Audit trail", detail: "The decision_log table captures every AI recommendation with full provenance. Funders can request reports on AI performance, model usage, and outcome signals." },
              { label: "Target population", detail: "Justice-impacted adults in Wisconsin (initial), Midwest (expansion), national (AGPL self-host). Primary focus: people within 90 days of release or recently released." },
              { label: "No paywall -- by design", detail: "The platform will never charge users. Sustainability comes from organizational licensing, grants, and eventual nonprofit status." },
            ].map((item, i) => (
              <div key={i} className="bg-t-panel-2 p-4 border border-t-line">
                <p className="font-semibold text-t-white mb-1">{item.label}</p>
                <p className="text-xs text-t-phos-dim leading-relaxed">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Built by someone who lived it */}
        <section className="mb-12 bg-t-panel-2 border border-t-amber p-6">
          <p className="text-sm font-semibold text-t-amber-bright mb-2 uppercase">
            Built by someone who lived it
          </p>
          <p className="text-base text-t-white leading-relaxed mb-3">
            Steel Man Resumes was built by Troy Carr -- a justice-impacted
            workforce advocate with a decade of direct service navigating the
            same system these tools are designed to help people survive.
          </p>
          <p className="text-sm text-t-phos leading-relaxed mb-3">
            The platform reflects what he wished existed when he was in it:
            one place that understood records, didn&apos;t treat gaps as
            disqualifiers, and gave plain-language guidance instead of generic
            advice designed for people who have never been incarcerated.
          </p>
          <p className="text-sm text-t-phos leading-relaxed">
            The research is real. The behavioral rules are real. The employers
            are verified. The privacy model was designed with surveillance
            trauma in mind because Troy has lived that too.
          </p>
          <p className="text-xs text-t-phos-dim mt-4">
            Steel Man Resumes LLC -- Wisconsin -- AGPL-3.0 open source
          </p>
        </section>

        {/* CTAs */}
        <div className="space-y-3">
          <TBtn
            onClick={() => {
              updateSession({ isDemo: true, audience: "observer" });
              router.push("/welcome?demo=true");
            }}
            className="w-full"
          >
            see The Forge in action (demo mode)
          </TBtn>

          <button
            onClick={() => router.push("/intro")}
            className="t-focus w-full px-4 py-3 text-t-phos-dim text-sm hover:text-t-amber-bright transition-colors"
          >
            &larr; Back to the intro
          </button>
        </div>

      </div>
    </div>
  );
}
