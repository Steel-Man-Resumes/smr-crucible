/**
 * Human names for ai_token_usage.endpoint and decision_log.context_page keys.
 *
 * The cost panel and the decision viewer both store a short machine key
 * (for example "resume-generate-full"). This module is the ONE place that
 * turns those keys into plain names a person can read ("Resume tailoring").
 *
 * Pure: no DB, no network, no React. Safe to unit-test.
 */

export const ENDPOINT_LABELS: Record<string, string> = {
  "interview-practice": "Interview practice (text)",
  interview: "Interview practice (text)",
  "interview-voice": "Interview practice (voice)",
  "resume-generate-full": "Resume tailoring",
  "resume-full": "Resume tailoring",
  "resume-generate": "Bullet suggestions",
  resume: "Bullet suggestions",
  "resume-assist": "Forge resume help",
  "forge-resume-assist": "Forge resume help",
  "job-search": "Job search enrichment",
  jobs: "Job search enrichment",
  "mini-forge": "Quick Forge",
  "disclosure-guide": "Disclosure planning",
  disclosure: "Disclosure planning",
  analyze: "Career analysis",
  "apply-email": "Application email draft",
  "follow-up": "Follow-up draft",
  parse: "Resume parsing",
  "fit-check": "Fit check",
  "next-step-why": "Next-step advice",
  assistant: "t.ROY chat",
  coach: "t.ROY chat",
  unknown: "Other AI work",
};

/**
 * Turn a machine key into a Title-Cased fallback name when it is not in the
 * map. "some-new_endpoint" -> "Some New Endpoint". Never throws.
 */
function titleCase(key: string): string {
  const cleaned = String(key ?? "").trim();
  if (!cleaned) return "Other AI work";
  return cleaned
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Human name for an endpoint or context-page key. Falls back gracefully. */
export function labelForEndpoint(key: string | null | undefined): string {
  if (key == null) return "Other AI work";
  const normalized = String(key).trim();
  if (ENDPOINT_LABELS[normalized]) return ENDPOINT_LABELS[normalized];
  return titleCase(normalized);
}

/**
 * Human name for a decision_log.context_page value. Decisions and endpoints
 * share the same vocabulary, so this reuses the endpoint map. Kept as its own
 * export so callers read clearly and a future divergence has a home.
 */
export function labelForContextPage(key: string | null | undefined): string {
  return labelForEndpoint(key);
}
