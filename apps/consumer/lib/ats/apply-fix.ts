/**
 * Applying a lens fix to resume text -- "easy change" and "easy insert".
 *
 * Pure string in, string out, so the same logic serves the Forge output page,
 * the Refinery workspace, and a test. Every function here returns the ORIGINAL
 * text unchanged when it cannot make the edit safely. A fix that silently does
 * something else is worse than a fix that declines.
 *
 * INTEGRITY: `confirm_then_add` adds a term the person has affirmed to their
 * skills list, and nothing else. It never writes an achievement, never invents
 * a bullet, and never attaches the term to a job. The person said they have
 * done it; a skills entry is the honest weight for that claim, and the place to
 * strengthen it is a bullet they write themselves.
 */

import type { LensFix } from "./lenses";

const SKILLS_HEADING_RE = /^(skills|core competencies|competencies|technical skills)\b/i;

/**
 * Replace one exact line, leaving its bullet glyph and indentation intact.
 *
 * Exported because the discrepancy panel replaces a weak bullet with the one
 * the workshop produced, and that has to behave identically to a lens fix --
 * including declining silently when the line has already moved.
 */
export function replaceResumeLine(text: string, find: string, replaceWith: string): string {
  const target = find.trim();
  if (!target) return text;

  const out = text.split("\n");
  let hit = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i].replace(/^\s*[-*•]\s*/, "").trim() === target) {
      hit = i;
      break;
    }
  }
  if (hit === -1) return text; // line moved or already edited; do nothing

  const prefix = out[hit].match(/^\s*(?:[-*•]\s*)?/)?.[0] ?? "";
  out[hit] = prefix + replaceWith.trim();
  return out.join("\n");
}

/** Append a term to the skills line, creating the section if there is none. */
function addSkill(text: string, term: string): string {
  const clean = term.trim();
  if (!clean) return text;
  if (new RegExp(`\\b${clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
    return text; // already there
  }

  const out = text.split("\n");
  const headingAt = out.findIndex((l) => SKILLS_HEADING_RE.test(l.trim()));

  if (headingAt === -1) {
    return `${text.replace(/\s*$/, "")}\n\nSKILLS\n${clean}\n`;
  }

  // First non-empty line under the heading is the skills run.
  for (let i = headingAt + 1; i < out.length; i++) {
    if (!out[i].trim()) continue;
    out[i] = `${out[i].replace(/[,\s]*$/, "")}, ${clean}`;
    return out.join("\n");
  }

  out.splice(headingAt + 1, 0, clean);
  return out.join("\n");
}

/**
 * Insert a missing section heading.
 *
 * An EXPERIENCE heading belongs immediately above the first job header -- those
 * job lines are the section it was missing. Every other heading belongs at the
 * END, because we have no idea which existing lines would go under it and
 * guessing drops a heading into the middle of someone's work history. (It did
 * exactly that in testing: "EDUCATION" landed between PROFESSIONAL EXPERIENCE
 * and its first job.)
 */
function addSection(text: string, section: string): string {
  if (new RegExp(`^\\s*${section}\\s*$`, "im").test(text)) return text;

  const isExperienceHeading = /experience|employment|work history/i.test(section);
  const out = text.split("\n");

  if (isExperienceHeading) {
    const jobAt = out.findIndex((l) =>
      /(?:19|20)\d{2}\s*(?:-{1,2}|–|—|to)\s*(?:(?:19|20)\d{2}|present|current)/i.test(l)
    );
    if (jobAt !== -1) {
      out.splice(jobAt, 0, "", section);
      return out.join("\n");
    }
  }

  return `${text.replace(/\s*$/, "")}\n\n${section}\n`;
}

/**
 * Apply `fix` to `text`.
 *
 * `confirm_then_add` is only ever reached after the person answered yes to the
 * fix's own question -- the caller is responsible for asking it.
 */
export function applyFix(text: string, fix: LensFix): string {
  switch (fix.kind) {
    case "replace":
      return replaceResumeLine(text, fix.find, fix.replaceWith);
    case "add_section":
      return addSection(text, fix.section);
    case "confirm_then_add":
      return addSkill(text, fix.term);
  }
}
