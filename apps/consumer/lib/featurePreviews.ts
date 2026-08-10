/**
 * Feature-preview registry (Phase 4.1).
 *
 * Every locked client tool now leads to a PREVIEW instead of a dead end. This
 * registry is the single source the preview page, the sidebar nav, and the
 * OnboardingGate lock screen all read, so what a locked tool advertises stays
 * consistent everywhere.
 *
 * Each entry carries:
 *   - what the tool does, in plain words
 *   - an example of its output, deliberately FAKE and labeled "Sample" (house
 *     rule: obviously-fake placeholder data, whimsical, never realistic filler)
 *   - a small "trial taste" (one sample interview question, a 2-line sample
 *     disclosure script) so a locked user gets a real feel for the tool
 *   - requiredState: the gate state at which the real tool unlocks
 *   - href: the real tool page (still gated at action depth by OnboardingGate --
 *     a preview NEVER bypasses that gate)
 *
 * SAMPLE_LABEL is the marker string the previews render and the adversarial
 * suite asserts on -- never remove the label from a sampleOutput.
 */

import type { GateState } from "@crucible/core";

export const SAMPLE_LABEL = "Sample";

export interface FeaturePreview {
  /** Registry id, also the last path segment of the real tool and the preview URL. */
  id: string;
  /** Human title shown at the top of the preview. */
  title: string;
  /** Plain, 6th-grade explanation of what the tool does. */
  whatItDoes: string;
  /** An obviously-fake, "Sample"-labeled example of the tool's output. */
  sampleOutput: string;
  /** A small real taste of the tool (a sample question / a 2-line sample script). */
  trialTaste: string;
  /** The gate state at which this tool unlocks for a client. */
  requiredState: GateState;
  /** The real tool page. */
  href: string;
}

export const FEATURE_PREVIEWS: Record<string, FeaturePreview> = {
  disclosure: {
    id: "disclosure",
    title: "Disclosure Planner",
    whatItDoes:
      "It helps you plan when and how to talk about your record with an employer, and gives you a short script you can practice out loud.",
    sampleOutput:
      "Sample plan for a made-up job at Rocketship Bagels (Planet Zorp): wait until after they offer you the job, then use your script. This is only a Sample so you can see the shape of a real plan.",
    trialTaste:
      "Sample script (2 lines): \"I want to be upfront -- I have something on my record from a while back, and I handled it. What I bring now is that I show up, I work hard, and I am ready to prove it here.\"",
    requiredState: "full_access",
    href: "/dashboard/disclosure",
  },
  interview: {
    id: "interview",
    title: "Interview Prep",
    whatItDoes:
      "It runs mock interviews for your target job by text or voice, then gives you feedback so the real interview feels familiar.",
    sampleOutput:
      "Sample feedback for a pretend role of Chief Nap Officer at Rocketship Bagels: \"Strong, honest answer. Try naming one number next time, like how many people you trained.\" Sample only -- your real feedback uses your real answers.",
    trialTaste:
      "Sample interview question: \"Tell me about a time you had to learn something fast on the job. What did you do?\"",
    requiredState: "full_access",
    href: "/dashboard/interview",
  },
  jobs: {
    id: "jobs",
    title: "Job Board",
    whatItDoes:
      "It finds real job listings from fair-chance employers who are hiring now, so you have a target to tailor your resume to.",
    sampleOutput:
      "Sample listing: \"Bagel Launch Technician -- Rocketship Bagels, Planet Zorp. Pay: 400 gold coins per week. Fair-chance employer.\" A Sample only -- real listings come from real employers near you.",
    trialTaste:
      "Sample match reason: \"This role fits because it values reliability and hands-on work, two of your listed strengths.\"",
    requiredState: "needs_resume",
    href: "/dashboard/jobs",
  },
  vault: {
    id: "vault",
    title: "My Materials",
    whatItDoes:
      "It keeps every resume, cover letter, and plan you make in one place, so you can reopen or reuse them anytime.",
    sampleOutput:
      "Sample saved item: \"Resume -- Bagel Launch Technician (Sample), saved 2 moons ago.\" This is a Sample so you can see how your saved work will be listed.",
    trialTaste:
      "Once you tailor your first resume, it lands here automatically so you never lose your work.",
    requiredState: "needs_resume",
    href: "/dashboard/vault",
  },
  applications: {
    id: "applications",
    title: "Applications",
    whatItDoes:
      "It tracks each job you apply to, from saved to applied to offered, and reminds you when it is time to follow up.",
    sampleOutput:
      "Sample tracker row: \"Rocketship Bagels -- Applied, follow up in 3 days.\" Sample only -- your tracker fills in from the real jobs you apply to.",
    trialTaste:
      "Sample reminder: \"It has been a week since you applied to Rocketship Bagels. A short follow-up note keeps you on their radar.\"",
    requiredState: "full_access",
    href: "/dashboard/applications",
  },
};

/** Look up a preview by id (or by a tool href's last path segment). */
export function getFeaturePreview(id: string | null | undefined): FeaturePreview | null {
  if (!id) return null;
  return FEATURE_PREVIEWS[id] ?? null;
}

/** Map a nav/tool href like "/dashboard/jobs" to its preview id, if one exists. */
export function previewIdForHref(href: string): string | null {
  const seg = href.split("/").filter(Boolean).pop() ?? "";
  return FEATURE_PREVIEWS[seg] ? seg : null;
}
