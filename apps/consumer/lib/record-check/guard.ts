/**
 * Output and log guards for the record check (D11).
 *
 * A checklist, never a verdict: any model line that tells the person they are
 * barred, qualify, or will or won't be blocked is dropped. Any model line that
 * carries a link or a statute citation is dropped too: the only links a person
 * sees come from the curated list (sources.json) or from what they typed, and
 * citations live in that list, never in model text.
 *
 * Logs: nothing the person typed is ever logged. safeErrorLabel() turns an
 * error into a fixed label (no message body), and scrubForLog() is the second
 * guard for anything that must carry text.
 */

/** Verdict phrases. Compared against normalized text (lowercase, curly quotes
 *  straightened, whitespace collapsed). Kept broad on purpose: a false drop
 *  costs one checklist line; a verdict that slips through can cost a person a
 *  career they never tried for. */
export const VERDICT_PATTERNS: readonly RegExp[] = [
  /\byou(?:'re| are| will be| would be| may be| might be| could be| should be)? ?(?:not |never )?(?:likely |probably |definitely |certainly |automatically |permanently )?(?:barred|banned|disqualified|ineligible|eligible|qualified|cleared|approved|denied|blocked|rejected|excluded)\b/,
  /\byou (?:do not|don't|will not|won't|would not|wouldn't|cannot|can't|can|will|would|should|probably|likely|definitely)? ?(?:not )?(?:qualify|be able to get|get (?:the|a|this|that) (?:license|job|certificate|permit))\b/,
  /\byou qualify\b/,
  /\b(?:this|that|it|your (?:record|conviction|offense|charge|felony|misdemeanor|case|history)) (?:will|won't|will not|would|wouldn't|would not|does not|doesn't|should not|shouldn't|cannot|can't|is going to|isn't going to) (?:be a problem|block|bar|stop|disqualify|prevent|keep you from|hold you back|matter|count against)\b/,
  /\b(?:is|are|isn't|is not|aren't|are not) (?:an? )?(?:automatic |permanent |lifetime )?(?:bar|barrier to licensure|disqualifier|disqualifying)\b/,
  /\b(?:automatically|permanently) (?:barred|banned|disqualified|denied|eligible|cleared)\b/,
  /\b(?:lifetime|permanent) ban\b/,
  /\bno problem\b/,
  /\bnothing to worry about\b/,
  /\byou(?:'re| are) (?:fine|all set|in the clear|good to go|safe)\b/,
  /\bguarantee/,
  /\b(?:my|this is|here is|here's) (?:legal advice|legal opinion)\b/,
  /\bas your (?:lawyer|attorney)\b/,
  /\byou (?:have|will have) a (?:good|strong|great|high|low|poor|slim) chance\b/,
  /\b(?:good|strong|great|high|low|poor|slim) (?:chance|odds|likelihood) (?:of|that)\b/,
];

/** Lines carrying a link or a statute citation. Model text may not carry either. */
export const LINK_OR_CITATION_PATTERNS: readonly RegExp[] = [
  /https?:\/\//i,
  /\bwww\./i,
  /\b[a-z0-9-]+\.(?:gov|org|com|net|us|edu|info)\b/i,
  /§/,
  /\bu\.?\s?s\.?\s?c\.?\b/i,
  /\bc\.?\s?f\.?\s?r\.?\b/i,
  /\b(?:mcl|mca|rsmo|ilcs|rcw|ors|nrs|cfr)\b/i,
  /\b(?:wis\.|fla\.|tex\.|cal\.|ohio|o\.)\s*(?:stat|r\.c|rev\.? code|code)\b/i,
  /\br\.c\.\s*\d/i,
  /\bstat\.\s*\d/i,
  /\bsection \d/i,
  /\b\d{1,4}[.-]\d{1,4}(?:[.-]\d{1,4})+\b/, // 37-1-203, 2953.25.1, 610.140.2
  /\b(?:act|law|bill|ordinance|order|directive) (?:no\.? )?\d{2,}/i,
  /\b(?:sb|hb|ab|hf|sf)\s?\d{2,}\b/i,
];

export function normalizeForCheck(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** The first verdict pattern a line matches, or null. */
export function findVerdict(text: string): RegExp | null {
  const t = normalizeForCheck(text);
  return VERDICT_PATTERNS.find((re) => re.test(t)) ?? null;
}

export function hasLinkOrCitation(text: string): boolean {
  return LINK_OR_CITATION_PATTERNS.some((re) => re.test(text));
}

/**
 * Replace the person's own offense words in a model line with "your record",
 * so a saved checklist does not quietly keep the offense when they chose not
 * to. Case-insensitive, whole typed string plus each word of 5+ letters that
 * is not an everyday word.
 */
const EVERYDAY = new Set([
  "about", "after", "again", "years", "their", "there", "which", "would", "could", "should", "where", "while",
  "felony", "felonies", "misdemeanor", "conviction", "convicted", "charge", "charges", "record", "records",
  "state", "first", "second", "third", "degree", "class", "count", "counts", "level", "offense", "offenses",
]);
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function offenseTerms(offense: string): string[] {
  const whole = offense.trim();
  const words = whole
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length >= 5 && !EVERYDAY.has(w) && !/^\d+$/.test(w));
  return Array.from(new Set([whole, ...words])).filter((w) => w.length >= 3);
}
export function redactOffense(text: string, offense: string): string {
  let out = text;
  for (const term of offenseTerms(offense).sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${escapeRe(term)}\\b`, "gi"), "your record");
  }
  return out;
}

/** True when a line still carries a term from the person's offense. */
export function mentionsOffense(text: string, offense: string): boolean {
  const t = text.toLowerCase();
  return offenseTerms(offense).some((term) => new RegExp(`\\b${escapeRe(term.toLowerCase())}\\b`).test(t));
}

export type LineDrop = "verdict" | "link_or_citation" | "empty" | "too_long";

/** Clean one model line. Returns the cleaned text, or why it was dropped. */
export function cleanLine(raw: unknown, offense: string | null, max = 320): { text: string } | { drop: LineDrop } {
  if (typeof raw !== "string") return { drop: "empty" };
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return { drop: "empty" };
  if (text.length > max) return { drop: "too_long" };
  if (findVerdict(text)) return { drop: "verdict" };
  if (hasLinkOrCitation(text)) return { drop: "link_or_citation" };
  if (offense) text = redactOffense(text, offense);
  // A redaction could build a verdict shape ("your record will block"): check again.
  if (findVerdict(text)) return { drop: "verdict" };
  return { text };
}

/** A URL the person typed into the job field, if any (https only, one). */
export function typedUrlFrom(job: string): string | null {
  const m = job.match(/https:\/\/[^\s<>"']{4,300}/i);
  if (!m) return null;
  try {
    const u = new URL(m[0]);
    if (u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * A log-safe label for an error: a fixed word plus, for a provider error, its
 * HTTP status. Never the message body (a provider or parser can echo input).
 */
export function safeErrorLabel(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const status = msg.match(/\b(?:Anthropic|OpenAI) API error: (\d{3})\b/);
  if (status) return `provider_error_${status[1]}`;
  if (/abort|timeout|timed out/i.test(msg)) return "timeout";
  if (/not set|not configured/i.test(msg)) return "not_configured";
  if (/JSON|Unexpected token|No JSON/i.test(msg)) return "bad_model_json";
  if (/DOCUMENT_ENCRYPTION_KEY/.test(msg)) return "encryption_key_missing";
  return "error";
}

/** Second guard for any text that must be logged: every secret replaced. */
export function scrubForLog(text: string, secrets: Array<string | null | undefined>): string {
  let out = String(text ?? "");
  for (const s of secrets) {
    if (!s || s.trim().length < 2) continue;
    for (const variant of new Set([s, s.trim(), JSON.stringify(s).slice(1, -1)])) {
      if (variant.length < 2) continue;
      out = out.split(variant).join("[redacted]");
    }
    for (const term of offenseTerms(s)) {
      out = out.replace(new RegExp(escapeRe(term), "gi"), "[redacted]");
    }
  }
  return out.slice(0, 300);
}
