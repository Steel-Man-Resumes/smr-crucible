/**
 * The first reward on the "I have one" route (Phase 5 lane R2, Codex C):
 * show the person's own page right away, and the ONE most useful fix.
 *
 * Every fix is something the person types or confirms. Nothing here writes a
 * fact for them: a missing phone or email is asked for, a job with no end
 * date is asked about, a line that breaks a rule is handed back for them to
 * change. The only line this ever adds on its own is a plain section name
 * ("Work History") above jobs that are already on the page, and only when the
 * person taps to accept it.
 *
 * Pure and client-safe. No AI call, nothing stored.
 */

import { CONTACT_LINE_RE, isDateLine, isEntryHeader, runMintCheck } from "@crucible/core/src/resumeMintCheckShared";
import { EXPERIENCE_HEADING_RE } from "./free-check";
import { findDiscrepancies } from "./resume-discrepancies";

export type FirstFixKind = "add_contact" | "add_heading" | "edit_line" | "none";

export interface FirstFix {
  kind: FirstFixKind;
  /** One plain line: what to fix. */
  title: string;
  /** Why it matters, in plain words. */
  why: string;
  /** edit_line: the line as it is on the page now. */
  line?: string;
  /** What the input box starts with (the line, or the heading to add). */
  start: string;
  /** The label on the input box. */
  label: string;
}

const linesOf = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);

function hasContactNearTop(text: string): boolean {
  return linesOf(text).slice(0, 8).some((l) => CONTACT_LINE_RE.test(l));
}

function hasJobHeading(text: string): boolean {
  return linesOf(text).some((l) => l.length <= 40 && EXPERIENCE_HEADING_RE.test(l));
}

/** The first line that looks like a job entry (a title or employer with dates). */
function firstEntryLine(text: string): string | null {
  return linesOf(text).find((l) => isEntryHeader(l) || isDateLine(l)) ?? null;
}

/**
 * The single most useful fix for a page, in this order: a way to reach the
 * person; a section name machines look for; a rule the page breaks; a job
 * with no end date. Null-safe: an empty page gets "none".
 */
export function pickFirstFix(text: string, now?: number): FirstFix {
  const t = (text || "").trim();
  if (!t) return { kind: "none", title: "", why: "", start: "", label: "" };

  if (!hasContactNearTop(t)) {
    return {
      kind: "add_contact",
      title: "Add a phone number or email under your name.",
      why: "An employer who likes your page needs a way to reach you. Put it right under your name so a person and a machine both find it.",
      start: "",
      label: "Your phone or email",
    };
  }

  const entry = firstEntryLine(t);
  if (!hasJobHeading(t) && entry) {
    return {
      kind: "add_heading",
      title: "Name the section with your jobs.",
      why: "Hiring systems look for a section called Work History or Experience. Your jobs are on the page, they just need the name above them.",
      start: "Work History",
      label: "Section name",
    };
  }

  const mint = runMintCheck({ output: t, source: t, kind: "resume" }).findings.filter((f) => f.line && linesOf(t).includes(f.line.trim()));
  const block = mint.find((f) => f.severity === "BLOCK") ?? null;
  const open = findDiscrepancies(t, { sourceText: t, now }).find((d) => d.kind === "open_end_date" && linesOf(t).includes(d.evidence.trim())) ?? null;
  const pick = block ? { line: block.line.trim(), why: block.why } : open ? { line: open.evidence.trim(), why: open.question } : null;
  const fix = pick ?? (mint[0] ? { line: mint[0].line.trim(), why: mint[0].why } : null);
  if (fix) {
    return {
      kind: "edit_line",
      title: "Fix this line.",
      why: fix.why,
      line: fix.line,
      start: fix.line,
      label: "The line, the way it should read",
    };
  }

  return {
    kind: "none",
    title: "Your page passes the basic checks.",
    why: "Nothing to fix in the checks we ran. Save it now, and t.ROY checks every line with you next.",
    start: "",
    label: "",
  };
}

export type ApplyFixResult = { ok: true; text: string; typed: string } | { ok: false; problem: "empty" | "not_contact" | "unchanged" };

/** A phone number or an email, as the person typed it. */
export function looksLikeContact(s: string): boolean {
  return /@[^\s@]+\.[^\s@]+/.test(s) || /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(s);
}

/**
 * Apply the person's answer. Only what they typed goes on the page.
 *  add_contact: their phone or email goes on the line under the name.
 *  add_heading: the section name goes above the first job.
 *  edit_line:   the line is replaced with what they typed (empty cuts it).
 */
export function applyFirstFix(text: string, fix: FirstFix, typedRaw: string): ApplyFixResult {
  const typed = (typedRaw || "").replace(/\s+/g, " ").trim();
  const lines = (text || "").split("\n");
  if (fix.kind === "add_contact") {
    if (!typed) return { ok: false, problem: "empty" };
    if (!looksLikeContact(typed)) return { ok: false, problem: "not_contact" };
    const nameAt = lines.findIndex((l) => l.trim());
    const at = nameAt < 0 ? 0 : nameAt + 1;
    return { ok: true, text: [...lines.slice(0, at), typed, ...lines.slice(at)].join("\n"), typed };
  }
  if (fix.kind === "add_heading") {
    if (!typed) return { ok: false, problem: "empty" };
    const entry = firstEntryLine(text);
    const at = entry ? lines.findIndex((l) => l.trim() === entry) : -1;
    if (at < 0) return { ok: false, problem: "unchanged" };
    return { ok: true, text: [...lines.slice(0, at), typed.toUpperCase(), ...lines.slice(at)].join("\n"), typed };
  }
  if (fix.kind === "edit_line" && fix.line) {
    const at = lines.findIndex((l) => l.trim() === fix.line);
    if (at < 0) return { ok: false, problem: "unchanged" };
    if (typed === fix.line) return { ok: false, problem: "unchanged" };
    const next = typed ? [...lines.slice(0, at), typed, ...lines.slice(at + 1)] : [...lines.slice(0, at), ...lines.slice(at + 1)];
    return { ok: true, text: next.join("\n"), typed };
  }
  return { ok: false, problem: "unchanged" };
}

/** The plain message for a refused answer. */
export const FIX_PROBLEM_COPY: Record<"empty" | "not_contact" | "unchanged", string> = {
  empty: "Type it in the box first.",
  not_contact: "That doesn't look like a phone number or an email. Try again.",
  unchanged: "That's the same as before. Change it, or save the page as it is.",
};

/* ----------------------------------------------------- Build with me -- */

export interface FirstSection {
  name: string;
  contact: string;
  title: string;
  employer: string;
  years: string;
  duty: string;
}

export type FirstSectionCheck = { ok: true } | { ok: false; missing: (keyof FirstSection)[] };

/** What "Build with me" needs before it can save: a name, one job and one true duty. */
export function checkFirstSection(s: FirstSection): FirstSectionCheck {
  const missing: (keyof FirstSection)[] = [];
  if (!s.name.trim()) missing.push("name");
  if (!s.title.trim() && !s.employer.trim()) missing.push("title");
  if (s.duty.trim().length < 4) missing.push("duty");
  return missing.length ? { ok: false, missing } : { ok: true };
}

/**
 * The first section, exactly as typed: the name, how to reach them (when
 * given), the Work History heading, the job line and the duty as one bullet.
 * Nothing is reworded and nothing is added.
 */
export function firstSectionText(s: FirstSection): string {
  const clean = (v: string) => v.replace(/\s+/g, " ").trim();
  const head = [clean(s.title), clean(s.employer), clean(s.years)].filter(Boolean).join(" | ");
  const duty = clean(s.duty).replace(/^[-*•]\s*/, "");
  return [clean(s.name), clean(s.contact), "", "WORK HISTORY", head, `- ${duty}`].filter((l, i) => l || i === 2).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
