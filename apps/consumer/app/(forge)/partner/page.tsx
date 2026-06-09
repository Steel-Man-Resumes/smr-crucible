"use client";

/**
 * Partner Path -- For partner organizations
 *
 * Audience: nonprofit reentry programs, workforce development orgs,
 * AJC/DOC staff, job centers, legal aid societies.
 *
 * This page covers the operational picture: how to use this with your
 * clients, what the partner dashboard gives you, how access codes work,
 * and what funder reporting looks like. Not a methodology deep-dive --
 * that's the observer path. This is "how do I actually run this."
 */

import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { useEffect } from "react";

const CLIENT_WORKFLOW = [
  {
    step: "1",
    title: "Share The Forge link",
    detail: "Send your clients to forge.steelmanresumes.com. No login required to start. They complete the 10-minute intake on any device.",
  },
  {
    step: "2",
    title: "They get their output",
    detail: "Career narrative, strengths, skills, career paths, and resources -- all in plain language. Downloadable resume and cover letter. No scores, no grades.",
  },
  {
    step: "3",
    title: "They create a free account",
    detail: "At the end of the Forge, they're invited into The Refinery. If they enter your partner code at sign-up, their daily AI limit increases and they get linked to your cohort.",
  },
  {
    step: "4",
    title: "They opt in to share progress",
    detail: "In Settings, each client has a toggle to share their journey with your program. Off by default. You can't see anyone who hasn't explicitly opted in -- that's not a limitation, it's the design.",
  },
  {
    step: "5",
    title: "You monitor in your partner dashboard",
    detail: "See stage progression, artifacts completed, last activity date for every client who has shared. Export to CSV for your funder reports.",
  },
];

const DASHBOARD_FEATURES = [
  {
    feature: "Cohort progress view",
    detail: "Each client's current stage (1-7), what they've completed (resume, disclosure plan, interview practice, applications), and when they were last active.",
  },
  {
    feature: "CSV export",
    detail: "One-click export of your full cohort for program reporting. Stage data, completion rates, artifact counts -- what your funders ask for.",
  },
  {
    feature: "Consent transparency",
    detail: "You can only see clients who have opted in. The dashboard shows the opt-in date so your records are clean.",
  },
  {
    feature: "Access code management",
    detail: "Your code is tied to your partner account. Redemptions are tracked. You can see how many clients have used it.",
  },
];

const WHAT_CLIENTS_GET = [
  { tool: "The Forge", desc: "10-minute career intake -- resume, cover letter, strengths analysis, career paths, resources" },
  { tool: "Job Board", desc: "Verified fair-chance employer listings -- real companies, manually checked" },
  { tool: "Application Tailor", desc: "Targeted resume, cover letter, and disclosure for a specific job, with AI guidance at each step" },
  { tool: "Disclosure Planner", desc: "When and how to talk about their record with specific employers" },
  { tool: "Interview Practice", desc: "Text or voice mock interviews, including disclosure-specific questions" },
  { tool: "Applications Tracker", desc: "Track every application -- company, status, which resume version, follow-up emails" },
  { tool: "My Materials", desc: "Vault of all generated documents -- resumes, cover letters, disclosure plans, follow-ups" },
  { tool: "t.ROY (AI coach)", desc: "Available on every page. Research-grounded, 10 behavioral rules, never prescriptive" },
];

const PARTNER_FAQ = [
  {
    q: "How much does it cost?",
    a: "Free for nonprofit and community organizations during the launch period. No contracts. No per-seat licensing. If that ever changes, existing partners get advance notice.",
  },
  {
    q: "Does it replace my case management system?",
    a: "No. It's a career tools platform, not a case management system. It doesn't track housing, legal, or wraparound service data. Use it alongside your existing workflow.",
  },
  {
    q: "What data do you collect on my clients?",
    a: "Only what they give the platform directly: email, resume content, career goals, job applications. Nothing shared with third parties. No advertising layer. AGPL-3.0 open source -- the code is public.",
  },
  {
    q: "Can I self-host it for my program?",
    a: "Yes. The AGPL-3.0 license allows any organization to run their own instance. The source code is available at github.com/Steel-Man-Resumes/smr-crucible (public August 2025).",
  },
  {
    q: "What if my client is in crisis during the session?",
    a: "t.ROY detects crisis disclosures and stops. It routes immediately to 211.org (resource line) and Crisis Text Line (741741). It does not attempt to coach through a crisis.",
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
        <div className="mb-12">
          <p className="text-sm font-medium text-sage-600 mb-3 uppercase tracking-wide">
            For Partner Organizations
          </p>
          <h1 className="text-3xl font-bold text-foreground mb-4 leading-tight">
            Run this with your clients.
          </h1>
          <p className="text-body text-foreground leading-relaxed text-lg mb-3">
            Steel Man Resumes is built to plug into reentry programs, workforce
            development orgs, AJC offices, and legal aid societies. Your clients
            use the tools. You see their progress -- with their consent.
          </p>
          <p className="text-sm text-muted leading-relaxed">
            This page covers the operational picture: how your workflow looks,
            what the partner dashboard gives you, how access codes work, and
            what your clients actually receive.
          </p>
        </div>

        {/* How the workflow runs */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-foreground mb-2">How it works with your program</h2>
          <p className="text-sm text-muted mb-5">Five steps from referral to funder report.</p>
          <div className="space-y-4">
            {CLIENT_WORKFLOW.map((item) => (
              <div key={item.step} className="flex gap-4 items-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-sage-600 text-white flex items-center justify-center font-bold text-sm">
                  {item.step}
                </div>
                <div className="pt-0.5">
                  <p className="font-semibold text-foreground text-sm mb-0.5">{item.title}</p>
                  <p className="text-sm text-muted leading-relaxed">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* What your clients get */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-foreground mb-2">What your clients get</h2>
          <p className="text-sm text-muted mb-5">Every tool, free, no paywall.</p>
          <div className="space-y-2">
            {WHAT_CLIENTS_GET.map((item, i) => (
              <div key={i} className="flex gap-3 p-4 bg-sage-50 border border-sage-200 rounded-xl items-start">
                <div className="flex-shrink-0 w-2 h-2 rounded-full bg-sage-500 mt-1.5" />
                <div>
                  <span className="font-semibold text-foreground text-sm">{item.tool}</span>
                  <span className="text-sm text-muted"> -- {item.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Partner dashboard */}
        <section className="mb-12 border border-sage-200 rounded-2xl p-6">
          <h2 className="text-xl font-bold text-foreground mb-2">Your partner dashboard</h2>
          <p className="text-sm text-muted leading-relaxed mb-5">
            Once you have a partner account and your clients have opted in,
            you get a real-time view of your cohort.
          </p>
          <div className="space-y-3">
            {DASHBOARD_FEATURES.map((item, i) => (
              <div key={i} className="bg-white rounded-xl p-4 border border-border">
                <p className="font-semibold text-foreground text-sm mb-1">{item.feature}</p>
                <p className="text-xs text-muted leading-relaxed">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Access codes */}
        <section className="mb-12 bg-warm-50 border border-warm-200 rounded-2xl p-6">
          <h2 className="text-xl font-bold text-foreground mb-2">Access codes</h2>
          <p className="text-sm text-muted leading-relaxed mb-4">
            Your organization gets one partner access code. Your clients
            enter it at sign-up to unlock higher AI usage limits and link
            their account to your cohort.
          </p>
          <div className="space-y-3">
            {[
              { label: "What it unlocks", detail: "200 AI calls/day for each client who redeems it (vs. the default free limit). That's enough for full daily use of every Refinery tool." },
              { label: "How clients use it", detail: "They enter the code at login/sign-up, or later in Settings > Partner Access Code. It takes 10 seconds." },
              { label: "How to get one", detail: "Email steelmanresumes@gmail.com with your organization name and program type. Free for nonprofits and community organizations. Typically set up within 24 hours." },
              { label: "No expiration by default", detail: "Codes stay active as long as your program is running. You can request a new one if you need separate tracking for different cohorts." },
            ].map((item, i) => (
              <div key={i} className="bg-white rounded-xl p-4 border border-warm-200">
                <p className="font-semibold text-foreground text-sm mb-1">{item.label}</p>
                <p className="text-xs text-muted leading-relaxed">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-foreground mb-5">Common questions</h2>
          <div className="space-y-3">
            {PARTNER_FAQ.map((item, i) => (
              <div key={i} className="border border-border rounded-xl p-4">
                <p className="font-semibold text-foreground text-sm mb-1">{item.q}</p>
                <p className="text-sm text-muted leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTAs */}
        <div className="space-y-3">
          <button
            onClick={() => {
              updateSession({ isDemo: true, audience: "partner" });
              router.push("/welcome?demo=true");
            }}
            className="w-full px-6 py-4 bg-sage-600 text-white rounded-xl text-base font-semibold hover:bg-sage-700 transition-colors min-h-touch"
          >
            See what your clients experience (demo)
          </button>

          <button
            onClick={() => router.push("/login?callbackUrl=/dashboard/partner")}
            className="w-full px-6 py-4 bg-white text-sage-600 border-2 border-sage-200 rounded-xl font-medium hover:bg-sage-50 transition-colors min-h-touch"
          >
            Sign in to the partner dashboard
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
