/**
 * Spanish for text the server or a lib module builds (Spanish beta).
 *
 * Many participant-visible lines are not in a component: API error and notice
 * messages, honesty-check wording, usage and limit lines, password rules. They
 * are plain English literals in 190 route files and a few dozen lib modules.
 * Instead of editing each one, the English literals and their Spanish live in
 * ONE list (messages/{en,es}/server-text.json, same keys) that a bilingual
 * reader can review in one sitting, and this module turns an English line into
 * its Spanish:
 *   - an exact match wins;
 *   - a line with a variable part ("{count}", "{name}") matches by pattern and the
 *     captured parts are put into the Spanish line.
 * A line with no entry comes back unchanged (English), never an error and never
 * a guess. The English message catalogs are the dictionary of what to match, so
 * lib/__tests__/server-text.test.ts also checks every entry still exists in the
 * source: an English line that is edited fails the test instead of silently
 * leaking English.
 *
 * Pure: no I/O, safe in tests, the browser and the server.
 */

export type ServerTextDict = {
  exact: Map<string, string>;
  patterns: Array<{ re: RegExp; names: string[]; es: string; len: number }>;
};

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build the lookup from the English and Spanish catalogs (same keys). */
export function buildServerTextDict(en: Record<string, string>, es: Record<string, string>): ServerTextDict {
  const exact = new Map<string, string>();
  const patterns: ServerTextDict["patterns"] = [];
  for (const [key, enText] of Object.entries(en)) {
    const esText = es[key];
    if (typeof enText !== "string" || typeof esText !== "string" || !enText.trim() || !esText.trim()) continue;
    const names = Array.from(enText.matchAll(PLACEHOLDER), (m) => m[1]);
    if (!names.length) {
      exact.set(enText, esText);
      continue;
    }
    if (new Set(names).size !== names.length) continue; // a repeated placeholder is not matchable
    let source = "";
    let last = 0;
    for (const m of enText.matchAll(PLACEHOLDER)) {
      source += escapeRe(enText.slice(last, m.index)) + `(?<${m[1]}>[\\s\\S]+?)`;
      last = (m.index ?? 0) + m[0].length;
    }
    source += escapeRe(enText.slice(last));
    patterns.push({ re: new RegExp(`^${source}$`), names, es: esText, len: enText.length });
  }
  patterns.sort((a, b) => b.len - a.len); // the longer, more specific line first
  return { exact, patterns };
}

/** The Spanish for an English line, or the line itself when there is none. */
export function translateServerText(text: string, dict: ServerTextDict | null | undefined): string {
  if (!dict || typeof text !== "string" || !text) return text;
  const hit = dict.exact.get(text);
  if (hit !== undefined) return hit;
  const trimmed = text.trim();
  if (trimmed !== text) {
    const t = dict.exact.get(trimmed);
    if (t !== undefined) return text.replace(trimmed, t);
  }
  for (const p of dict.patterns) {
    const m = p.re.exec(trimmed);
    if (!m?.groups) continue;
    const out = p.es.replace(PLACEHOLDER, (_all, name: string) => m.groups![name] ?? "");
    return trimmed === text ? out : text.replace(trimmed, out);
  }
  return text;
}

/** JSON fields whose string values are text a person reads. Anything else is data and is never touched. */
export const SERVER_TEXT_FIELDS = new Set([
  "error", "errors", "message", "messages", "warning", "warnings", "notice", "notices", "reason", "blockedReason",
  "detail", "hint", "note", "notes", "summary", "label", "line", "question", "why", "explanation", "headline",
  "description", "title", "body", "status_reason", "decisionNote",
]);

/**
 * Fields a person's own text can sit in (a document title, a note they wrote). A short value there
 * ("Today") is more likely their word than ours, so over the network only a longer line is translated.
 * Error and message fields have no such limit.
 */
export const SERVER_TEXT_USER_PRONE = new Set(["title", "label", "description", "body", "note", "notes", "summary", "line", "headline"]);
export const SERVER_TEXT_USER_PRONE_MIN = 24;

/**
 * A copy of a parsed JSON response with the readable fields translated.
 * Only the fields named above change, only when a line has an entry, and
 * only to a bounded depth and size, so a big data response is left alone.
 */
export function translateJsonDeep<T>(value: T, translate: (s: string) => string): { value: T; changed: boolean } {
  let changed = false;
  let budget = 4000;
  const walk = (v: unknown, readable: boolean, depth: number, prone: boolean): unknown => {
    if (budget-- <= 0 || depth > 7) return v;
    if (typeof v === "string") {
      if (!readable) return v;
      if (prone && v.length < SERVER_TEXT_USER_PRONE_MIN) return v;
      const t = translate(v);
      if (t !== v) changed = true;
      return t;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, readable, depth + 1, prone));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(x, readable || SERVER_TEXT_FIELDS.has(k), depth + 1, SERVER_TEXT_FIELDS.has(k) ? SERVER_TEXT_USER_PRONE.has(k) : prone);
      }
      return out;
    }
    return v;
  };
  const result = walk(value, false, 0, false) as T;
  return { value: changed ? result : value, changed };
}
