/**
 * Backstop guards for the record check (D11).
 *
 * The safety layer is the DESIGN, not these filters (security r1 F1/F8): the
 * model only picks ids, and every word a person sees comes from the question
 * bank, the step bank, the dated source list, or what they typed. Model text
 * is never shown or stored, so there is nothing of the model's to filter or
 * redact.
 *
 * What remains here is a backstop on ONE slot value: the job the person
 * typed, before it is placed into a bank line. A job that reads like a
 * verdict, a link or a statute becomes "this work" instead. Source titles go
 * into the {source} slot unchecked: they come from the curated list
 * (sources.json), and some carry a statute number on purpose. And
 * safeErrorLabel(): logs carry fixed labels, never text.
 */

/** Normalize before matching: compatibility forms, zero-width and format
 *  characters removed, curly quotes straightened, whitespace collapsed. */
export function normalizeForCheck(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[​-‏‪-‮⁠-⁤﻿­]/g, "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Outcome words. Broad on purpose: a slot that trips one is replaced. */
export const VERDICT_PATTERNS: readonly RegExp[] = [
  /\bqualif/,
  /\beligib/,
  /\bineligib/,
  /\bdisqualif/,
  /\bbar(?:s|red|ring)?\b/,
  /\bban(?:s|ned)?\b/,
  /\bblock/,
  /\bapprov/,
  /\bdeni(?:ed|al)\b|\bdeny\b/,
  /\ballow/,
  /\bchance/,
  /\bodds\b/,
  /\blikely\b/,
  /\bguarantee/,
  /\bno problem\b/,
  /\bcount against\b|\bheld against\b/,
  /\byou(?:'re| are| will| won't| can't| cannot)\b/,
  /\blegal advice\b/,
];

/** Links and citations, including spelled-out and dotted forms. */
export const LINK_OR_CITATION_PATTERNS: readonly RegExp[] = [
  /h(?:tt|xx)ps?:?\/\//i,
  /\bwww\b/i,
  /\b[\w-]+(?:\.|\[\.\]|\s?dot\s?|[․．])[a-z]{2,}\b/i,
  /§/,
  /\bu\.?\s?s\.?\s?c\b/i,
  /\bc\.?\s?f\.?\s?r\b/i,
  /\b(?:mcl|mca|rsmo|ilcs|rcw|ors|nrs|rc)\b/i,
  /\b(?:revised code|statutes?|code ann|title [ivx\d]+)\b/i,
  /\bsec(?:tion|\.)\s*\d/i,
  /\bstat\.?\s*\d/i,
  /\d+\.\d+/,
  /\b\d{1,4}-\d{1,4}-\d{1,4}\b/,
  /\b(?:sb|hb|ab|hf|sf)\s?\d{2,}\b/i,
];

export function findVerdict(text: string): RegExp | null {
  const t = normalizeForCheck(text);
  return VERDICT_PATTERNS.find((re) => re.test(t)) ?? null;
}

export function hasLinkOrCitation(text: string): boolean {
  const t = normalizeForCheck(text);
  return LINK_OR_CITATION_PATTERNS.some((re) => re.test(t));
}

export const NEUTRAL_JOB = "this work";

/** The {job} slot: what the person typed, minus any link, or "this work"
 *  when it is empty, too long, or trips the backstop. */
export function safeJobSlot(job: string | null | undefined): string {
  if (!job) return NEUTRAL_JOB;
  const v = job.replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim();
  if (!v || v.length > 80) return NEUTRAL_JOB;
  if (findVerdict(v) || hasLinkOrCitation(v)) return NEUTRAL_JOB;
  return v;
}

/** A URL the person typed into the job field, if any (https only, one). */
export function typedUrlFrom(job: string | null | undefined): string | null {
  if (!job) return null;
  const m = job.match(/https:\/\/[^\s<>"']{4,300}/i);
  if (!m) return null;
  try {
    const u = new URL(m[0]);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A log-safe label for an error: a fixed word plus, for a provider error, its
 * HTTP status. Never the message body (a provider or parser can echo input).
 */
export function safeErrorLabel(err: unknown): string {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : typeof err === "string" ? err : "";
  const status = msg.match(/\b(?:Anthropic|OpenAI) API error: (\d{3})\b/);
  if (status) return `provider_error_${status[1]}`;
  if (/abort|timeout|timed out/i.test(msg)) return "timeout_or_cancelled";
  if (/not set|not configured/i.test(msg)) return "not_configured";
  if (/DOCUMENT_ENCRYPTION_KEY/.test(msg)) return "encryption_key_missing";
  return "error";
}
