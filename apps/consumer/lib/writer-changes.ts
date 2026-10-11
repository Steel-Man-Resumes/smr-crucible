/**
 * The writer's change list (Phase 6, lane S2; contract in the Phase 6 plan).
 *
 * The Forge writer writes the resume, then a CHANGES block: the lines it
 * changed from the person's own page, each with one plain sentence of why.
 * The finish page plays them back while t.ROY works (old line struck
 * through, new line in place, the reason under it).
 *
 * The server never trusts the list as written. An entry is kept only when
 *   - its `old` is in the person's own resume text (the text the writer saw,
 *     record lines held back), and
 *   - its `new` is in the FINAL resume, after the truth check and every
 *     deterministic backstop,
 * both compared with spacing, bullet marks, quotes and dash look-alikes
 * evened out. At most CHANGES_MAX entries. Missing, broken or empty means
 * no reveal, never an error.
 *
 * The list is not part of what the writer receipt signs (resume, letter,
 * grounding): it is display only, and the page can never use it to change
 * what is saved.
 *
 * Pure: no I/O.
 */

import { plainPunctuationText } from "./legal-sanitize";
import { isJusticeSensitive } from "./grounding-verify";

/** The line that starts the writer's change list. */
export const CHANGES_MARKER = "===CHANGES===";
/** The most entries the server keeps. */
export const CHANGES_MAX = 40;

export interface WriterChange {
  old: string;
  new: string;
  why: string;
  rule: string;
}

/**
 * Split the writer's raw reply into the resume and its change list. The
 * resume never carries any of the block: everything from the marker on is
 * cut, and a trailing JSON list the writer printed without the marker is cut
 * too, so a broken block can never reach a page.
 */
export function splitWriterOutput(raw: string): { resume: string; changes: unknown } {
  const text = typeof raw === "string" ? raw : "";
  const lines = text.split("\n");
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().replace(/^[`*#\s]+|[`*#\s]+$/g, "") === CHANGES_MARKER) {
      at = i;
      break;
    }
  }
  let resumeLines = at >= 0 ? lines.slice(0, at) : lines;
  let tail = at >= 0 ? lines.slice(at + 1).join("\n") : "";
  if (at < 0) {
    // No marker: a JSON list of changes printed at the very end still never ships.
    const start = resumeLines.findIndex((l, i) => /^\s*\[\s*\{\s*"old"\s*:/.test(l) && resumeLines.slice(i).join("\n").trim().endsWith("]"));
    if (start >= 0) {
      tail = resumeLines.slice(start).join("\n");
      resumeLines = resumeLines.slice(0, start);
    }
  }
  const resume = resumeLines.join("\n").replace(/\s+$/, "");
  return { resume, changes: parseList(tail) };
}

function parseList(tail: string): unknown {
  const s = tail.indexOf("[");
  const e = tail.lastIndexOf("]");
  if (s < 0 || e <= s) return [];
  try {
    return JSON.parse(tail.slice(s, e + 1));
  } catch {
    return [];
  }
}

/** Spacing, bullet marks, curly quotes and dash look-alikes evened out, lower case. */
export function normalizeChangeText(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*\u2022\u25AA\u25CF\u2023\u2043]|\d+[.)])\s+/, ""))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The whole line of `text` this snippet is, when it is a whole line (bullet mark off); else the snippet. */
function wholeLine(text: string, snippet: string): string {
  const want = normalizeChangeText(snippet);
  for (const l of text.split("\n")) {
    if (normalizeChangeText(l) === want) return l.trim().replace(/^(?:[-*\u2022]\s+)/, "");
  }
  return snippet.trim();
}

const RULE_RE = /^[a-z][a-z_]{1,31}$/;
const WHY_MAX = 240;
const LINE_MAX = 400;

/**
 * Keep only the entries the server can stand behind (see the file note).
 * `ownResumeText` is the person's resume text the writer saw; `finalResume`
 * is exactly what the response returns as the resume.
 */
export function validateWriterChanges(
  raw: unknown,
  ctx: { ownResumeText: string | undefined; finalResume: string; keepInsideLines?: boolean }
): WriterChange[] {
  if (!Array.isArray(raw)) return [];
  const own = ctx.ownResumeText || "";
  const ownN = normalizeChangeText(own);
  const finalN = normalizeChangeText(ctx.finalResume || "");
  if (!ownN || !finalN) return [];
  const out: WriterChange[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= CHANGES_MAX) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.old !== "string" || typeof r.new !== "string" || typeof r.why !== "string") continue;
    const oldRaw = r.old.trim();
    // The final resume went through the dash sweep; the writer's copy of a line must too.
    const newRaw = plainPunctuationText(r.new.trim()).text.trim();
    if (oldRaw.length < 3 || newRaw.length < 3 || oldRaw.length > LINE_MAX || newRaw.length > LINE_MAX) continue;
    const oldN = normalizeChangeText(oldRaw);
    const newN = normalizeChangeText(newRaw);
    if (oldN.length < 3 || newN.length < 3 || oldN === newN) continue;
    if (!ownN.includes(oldN) || !finalN.includes(newN)) continue;
    const why = plainPunctuationText(r.why.replace(/\s+/g, " ").trim()).text.trim().slice(0, WHY_MAX);
    if (!why) continue;
    // The reason is t.ROY talking about the page, never about a record.
    if (!ctx.keepInsideLines && isJusticeSensitive(why)) continue;
    const ruleRaw = typeof r.rule === "string" ? r.rule.trim().toLowerCase() : "";
    const rule = RULE_RE.test(ruleRaw) ? ruleRaw : "reword";
    const key = `${oldN}\u0000${newN}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ old: wholeLine(own, oldRaw), new: wholeLine(ctx.finalResume, newRaw), why, rule });
  }
  return out;
}
