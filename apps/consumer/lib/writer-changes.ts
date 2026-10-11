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
/** The sentinel pair the writer puts around its change list (r2 M-B): unique, so nothing else matches it. */
export const CHANGES_START = "<<<SMR-CHANGES>>>";
export const CHANGES_END = "<<<END-SMR-CHANGES>>>";
/** The most entries the server keeps. */
export const CHANGES_MAX = 40;

export interface WriterChange {
  old: string;
  new: string;
  why: string;
  rule: string;
}

// A marker or label line for the block, however the writer dressed it: "===CHANGES===",
// "=== CHANGES ===", "CHANGES:", "**CHANGES**", "## Changes", "CHANGES BLOCK", optionally with "[]".
const MARKER_LINE_RE = /^[\s`*#=_~-]*(?:t\.?roy'?s?\s+)?changes(?:\s+(?:block|list|made))?[\s`*#=_~-]*:?[\s`*#=_~-]*(?:\[\s*\])?[\s`*#=_~-]*$/i;
const FENCE_LINE_RE = /^\s*```[a-z]*\s*$/i;
// A JSON list of change objects: "[{" with an "old" key anywhere in its first object (any key order).
const LIST_START_RE = /\[\s*\{[^{}]{0,400}?["']old["']\s*:/g;

/** The index just past the "]" that closes the "[" at `start` (string-aware), or the text's end when it never closes. */
function closeOf(text: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") depth++;
    else if ((ch === "]" || ch === "}") && --depth === 0) return i + 1;
  }
  return text.length;
}

function parseChangeList(block: string): unknown {
  const t = block.trim();
  for (const candidate of [t, t.slice(t.indexOf("["), t.lastIndexOf("]") + 1)]) {
    if (!candidate) continue;
    try {
      const v = JSON.parse(candidate);
      if (Array.isArray(v)) return v;
      if (v && typeof v === "object" && Array.isArray((v as { changes?: unknown }).changes)) return (v as { changes: unknown[] }).changes;
    } catch {
      /* try the next shape */
    }
  }
  return [];
}

// What a change list looks like when it slipped past the sentinels: a key of a change object, a line of only
// brackets, braces and commas, a quoted old -> new pair, or an object wrapper.
// Round 4 (review r3 L3-1): only lines that clearly are the list: a change object's key at the start of the
// line, a line with both an "old" and a "new" key, a line of only brackets and commas, or a quoted pair
// joined by an arrow. Ordinary prose with quotes, "became", "to" or the word "new" stays.
const LEFTOVER_LINE_RE = /^\s*[{[]*\s*["'](?:old|new|why|rule|changes)["']\s*:|["']old["']\s*:.*["']new["']\s*:|^[\s[\]{}(),`]+$|^\s*[-*\u2022]?\s*["\u201C][^"\u201D]{1,300}["\u201D]\s*(?:->|=>|\u2192)\s*["\u201C]/i;
/** A marker or label line that is clearly the list's: decorated ("===CHANGES===", "CHANGES:", "**Changes**") or "Changes made/block/list". A bare "Changes" heading is not. */
const isMarkerLine = (l: string) => MARKER_LINE_RE.test(l) && /changes/i.test(l) && (/[=*#:`_~]/.test(l) || /changes\s+(?:block|list|made)|t\.?roy/i.test(l));

/**
 * Split the writer's raw reply into the resume and its change list.
 *
 * Round 3 (review r2 M-B): the writer puts its list between a unique sentinel pair; everything between them is
 * cut, and from the start sentinel to the end of the reply when the end sentinel is missing. Replies in older
 * shapes (a "CHANGES" marker or label, a bare or fenced list) are still handled: a marker or label line with a
 * resume above it cuts everything from it to the end; a list printed first or mid-page is cut out with the
 * resume kept on both sides. A last guard strips any line still shaped like the change list. The route
 * refuses (502) a page that is not a usable resume after all of this, before any check or receipt.
 */
export function splitWriterOutput(raw: string): { resume: string; changes: unknown } {
  let text = typeof raw === "string" ? raw.replace(/\r\n?/g, "\n") : "";
  let changes: unknown = [];
  let found = false;

  // 1. The sentinel pair.
  for (let guard = 0; guard < 5; guard++) {
    const s = text.indexOf(CHANGES_START);
    if (s < 0) break;
    const e = text.indexOf(CHANGES_END, s + CHANGES_START.length);
    const block = text.slice(s + CHANGES_START.length, e < 0 ? text.length : e);
    if (!found) {
      changes = parseChangeList(block);
      found = true;
    }
    text = `${text.slice(0, s).replace(/\s+$/, "")}\n\n${e < 0 ? "" : text.slice(e + CHANGES_END.length).replace(/^\s+/, "")}`;
  }
  text = text.split(CHANGES_END).join("");

  // 2. A marker or label line with a resume above it. When a JSON list or object follows it, the marker and
  //    that block are cut and anything after stays (a block printed mid-page never drops the page's end);
  //    when anything else follows (bullets, prose), everything from the marker to the end is the list.
  const lines = text.split("\n");
  const at = lines.findIndex((l, i) => isMarkerLine(l) && isUsableResume(lines.slice(0, i).join("\n")));
  if (at >= 0) {
    const markerStart = lines.slice(0, at).join("\n").length + (at > 0 ? 1 : 0);
    const afterMarker = markerStart + lines[at].length;
    const rest = text.slice(afterMarker);
    const lead = rest.match(/^(?:\s|```[a-z]*)*/i)?.[0] ?? "";
    const opener = rest.charAt(lead.length);
    if (opener === "[" || opener === "{") {
      const blockStart = afterMarker + lead.length;
      let end = closeOf(text, blockStart);
      if (!found) {
        changes = parseChangeList(text.slice(blockStart, end));
        found = true;
      }
      const tail = text.slice(end).replace(/^[\s`]*\n/, "\n");
      text = `${text.slice(0, markerStart).replace(/\s+$/, "")}\n\n${tail.replace(/^\s+/, "")}`;
    } else {
      if (!found) {
        changes = parseChangeList(rest);
        found = true;
      }
      text = lines.slice(0, at).join("\n");
    }
  }

  // 3. A list printed first or mid-page (no usable resume above its marker): cut it, keep both sides.
  for (let guard = 0; guard < 5; guard++) {
    LIST_START_RE.lastIndex = 0;
    const m = LIST_START_RE.exec(text);
    if (!m) break;
    let start = m.index;
    let end = closeOf(text, start);
    if (!found) {
      try {
        changes = JSON.parse(text.slice(start, end));
      } catch {
        changes = [];
      }
      found = true;
    }
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const before = text.slice(lineStart, start);
    if (!before.trim() || MARKER_LINE_RE.test(before) || FENCE_LINE_RE.test(before)) start = lineStart;
    while (start > 0) {
      const prevStart = text.lastIndexOf("\n", start - 2) + 1;
      const prev = text.slice(prevStart, start - 1);
      if (!prev.trim() || FENCE_LINE_RE.test(prev) || MARKER_LINE_RE.test(prev)) start = prevStart;
      else break;
    }
    const lineEnd = text.indexOf("\n", end);
    const restOfLine = lineEnd < 0 ? text.slice(end) : text.slice(end, lineEnd);
    if (!restOfLine.replace(/`/g, "").trim()) end = lineEnd < 0 ? text.length : lineEnd;
    while (end < text.length) {
      const nextEnd = text.indexOf("\n", end + 1);
      const next = text.slice(end + 1, nextEnd < 0 ? text.length : nextEnd);
      if (FENCE_LINE_RE.test(next)) end = nextEnd < 0 ? text.length : nextEnd;
      else break;
    }
    text = `${text.slice(0, start).replace(/\s+$/, "")}\n\n${text.slice(end).replace(/^\s+/, "")}`;
  }

  // 4. Last guard: no line shaped like the change list ships.
  const resume = text
    .split("\n")
    .filter((l) => !isMarkerLine(l) && !LEFTOVER_LINE_RE.test(l) && !FENCE_LINE_RE.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { resume, changes };
}

/** A resume worth checking and signing: a name line and some body, not a stray label or an empty reply (review M3). */
export function isUsableResume(text: string): boolean {
  const t = (text || "").trim();
  return t.length >= 40 && t.split("\n").filter((l) => /[A-Za-z]{2,}/.test(l)).length >= 3;
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
  // Review L2: `old` is a whole line of theirs (a "Label:" in front of it aside), never a fragment.
  const ownLines = new Set<string>();
  for (const l of own.split("\n")) {
    const n = normalizeChangeText(l);
    if (!n) continue;
    ownLines.add(n);
    const unlabeled = normalizeChangeText(l.replace(/^\s*[A-Za-z][A-Za-z &/]{1,30}:\s*/, ""));
    if (unlabeled) ownLines.add(unlabeled);
  }
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
    if (!ownLines.has(oldN) || !finalN.includes(newN)) continue;
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
