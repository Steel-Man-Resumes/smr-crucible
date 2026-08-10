/**
 * Apply-destination classification (Phase 3.1 + 3.5d, 2026-08-10).
 *
 * The apply ladder used to render an apply link verbatim with a static label
 * ("Apply now") that could point at a job board, a Google-jobs redirect, or a
 * real employer form -- all reading identically. That is a small honesty gap:
 * "Apply now" on a LinkedIn link is not applying, it is signing up. This module
 * reads the URL and says, plainly, where the link actually goes and what to
 * expect when it opens -- no hype, no editorializing.
 *
 * Pure: no network, no DB, no env, no clock. The URL is UNTRUSTED input -- it is
 * parsed with the WHATWG URL parser and never executed, never HTML-injected.
 * The only outputs are a small fixed set of honest strings.
 */

export type ApplyDestinationKind =
  | "employer_ats"
  | "job_board"
  | "aggregator"
  | "google_jobs"
  | "employer_site"
  | "unknown"
  | "invalid";

export interface ApplyDestination {
  kind: ApplyDestinationKind;
  /** Bare registrable host shown to the user (no www.), or null when unreadable. */
  host: string | null;
  /** Honest one-line label for the button/link. */
  label: string;
  /** Honest one-sentence expectation of what opens. */
  expectation: string;
  /** Short, concrete prep checklist. Empty for invalid. */
  prep: string[];
}

/**
 * Applicant tracking systems: a link here opens a REAL employer application
 * form. An upload here usually goes straight to the employer.
 */
const ATS_DOMAINS = [
  "greenhouse.io",
  "boards.greenhouse.io",
  "lever.co",
  "jobs.lever.co",
  "myworkdayjobs.com",
  "icims.com",
  "taleo.net",
  "ashbyhq.com",
  "jobs.ashbyhq.com",
  "jobvite.com",
  "smartrecruiters.com",
  "bamboohr.com",
  "breezy.hr",
  "recruitee.com",
  "workable.com",
  "apply.workable.com",
];

/**
 * Job boards / marketplaces: a link here usually needs an account and re-entry
 * of your work history. Not the employer's own form.
 */
const BOARD_DOMAINS = [
  "linkedin.com",
  "indeed.com",
  "ziprecruiter.com",
  "monster.com",
  "dice.com",
  "glassdoor.com",
  "simplyhired.com",
  "jobleads.com",
];

/** Aggregators / API relays -- a search-layer link that is one more click from
 *  the real posting. */
const AGGREGATOR_DOMAINS = [
  "jsearch.io",
  "rapidapi.com",
  "jooble.org",
  "adzuna.com",
  "careerjet.com",
];

/** Whether `host` is exactly `domain` or a subdomain of it. */
function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith("." + domain);
}

function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** Is this a Google property being used as a jobs search / redirect? */
function isGoogleJobs(host: string, url: URL): boolean {
  const isGoogleHost =
    hostMatches(host, "google.com") ||
    /(^|\.)google\.[a-z.]+$/.test(host) ||
    host === "careers.google";
  if (!isGoogleHost) return false;
  // A Google search/redirect used for jobs, or the job_google_link relay
  // pattern. careers.google itself is Google's own careers page, but per the
  // apply-honesty plan we treat any Google hop as "one more click in".
  return true;
}

const HONEST: Record<ApplyDestinationKind, { label: (h: string | null) => string; expectation: string; prep: string[] }> = {
  employer_ats: {
    label: (h) => `Opens the employer's application system${h ? ` (${h})` : ""}`,
    expectation:
      "This is a real application form. Your resume upload usually goes straight to the employer.",
    prep: [
      "Have your resume file ready to upload",
      "Set aside 10 to 20 minutes to fill it out",
      "Save any account login somewhere safe",
    ],
  },
  job_board: {
    label: (h) => `Opens on ${h || "the job board"} -- an account may be required`,
    expectation:
      "You may need to sign in or make an account. Budget 20 to 40 minutes to re-enter your work history.",
    prep: [
      "Have your resume file ready to upload",
      "Expect to re-enter your work history",
      "Save your login somewhere safe",
    ],
  },
  aggregator: {
    label: (h) => `Opens on ${h || "a search site"} -- the real posting is one more click`,
    expectation:
      "This link may bounce you through a search page. The real employer posting is one more click in.",
    prep: [
      "Look for the employer's name and click through to their posting",
      "Confirm the posting is still open before you apply",
    ],
  },
  google_jobs: {
    label: () => "Opens a Google jobs search -- the real posting is one more click",
    expectation:
      "This link may bounce you through a search page. The real employer posting is one more click in.",
    prep: [
      "Look for the employer's name and click through to their posting",
      "Confirm the posting is still open before you apply",
    ],
  },
  employer_site: {
    label: (h) => `Opens ${h || "the employer's site"}`,
    expectation:
      "This opens the employer's own site. Look for a Careers or Jobs page, then find this posting.",
    prep: [
      "Look for a Careers or Jobs page",
      "Confirm the posting is still open before you apply",
    ],
  },
  unknown: {
    label: () => "Opens an outside link",
    expectation:
      "We could not tell where this link goes. Open it carefully and confirm it is the real employer.",
    prep: [
      "Confirm the site is the real employer before entering anything",
      "Do not enter payment details -- real jobs never ask for that",
    ],
  },
  invalid: {
    label: () => "We could not read this link",
    expectation:
      "We could not read this link, so we will not open it. Use the employer's own site or an email instead.",
    prep: [],
  },
};

/**
 * Classify an apply URL into an honest destination. A null / non-string / non
 * http(s) / unparseable URL returns kind "invalid" (the UI must NOT render a raw
 * broken link for it -- it falls to the next rung of the ladder).
 */
export function classifyApplyUrl(url: string | null): ApplyDestination {
  if (typeof url !== "string" || !url.trim()) {
    return build("invalid", null);
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return build("invalid", null);
  }

  // Only real web links open. javascript:, data:, file:, mailto:, etc. are
  // rejected as invalid rather than shown.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return build("invalid", null);
  }

  const rawHost = parsed.hostname.toLowerCase();
  if (!rawHost || !rawHost.includes(".")) {
    // No real host (e.g. http://localhost or a bare token) -> cannot vouch for it.
    return build("unknown", rawHost || null);
  }
  const host = stripWww(rawHost);

  if (isGoogleJobs(host, parsed)) return build("google_jobs", host);
  if (ATS_DOMAINS.some((d) => hostMatches(host, d))) return build("employer_ats", host);
  if (BOARD_DOMAINS.some((d) => hostMatches(host, d))) return build("job_board", host);
  if (AGGREGATOR_DOMAINS.some((d) => hostMatches(host, d))) return build("aggregator", host);

  // A real, readable host we do not recognize -> treat as the employer's own
  // site. It is the honest default: most direct apply links are employer sites.
  return build("employer_site", host);
}

function build(kind: ApplyDestinationKind, host: string | null): ApplyDestination {
  const copy = HONEST[kind];
  return {
    kind,
    host,
    label: copy.label(host),
    expectation: copy.expectation,
    prep: copy.prep,
  };
}

/** Rank order for apply links: a real employer form beats a board beats a
 *  search hop. Lower number = better. */
const RANK: Record<ApplyDestinationKind, number> = {
  employer_ats: 0,
  employer_site: 1,
  job_board: 2,
  aggregator: 3,
  google_jobs: 4,
  unknown: 5,
  invalid: 6,
};

export interface ApplyCandidate {
  url: string;
  type?: string;
}

/**
 * Phase 3.5d: order apply-link candidates best-first by destination quality
 * (employer_ats > employer_site > job_board > aggregator > google_jobs). Pure
 * and stable -- equal-rank candidates keep their input order.
 */
export function rankApplyLinks<T extends ApplyCandidate>(candidates: T[]): T[] {
  return candidates
    .map((c, i) => ({ c, i, rank: RANK[classifyApplyUrl(c.url).kind] }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.c);
}
