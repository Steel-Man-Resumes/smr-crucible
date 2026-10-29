/**
 * Research notes and public text share one column (employer evidence `limitations`), so the
 * public feed serves a cleaned copy. Pure functions only: no database, no I/O.
 *
 * Rule: a sentence (or a "; " clause of one) that carries a research-log marker is dropped;
 * the rest is kept as written. A parenthetical aside with a marker is cut and its sentence kept,
 * unless the aside names who ruled (a person or an AI): then the sentence goes whole.
 */

/** Who decided or wrote the note. A sentence that names one is never public. */
const AUTHOR = /\bboss\b|\bTroy\b|\bCodex\b|\bClaude\b|\bfound_by\b|\bthis session\b/i;
const AUTHOR_CASED = /\bCC\b/;

/** How the research was done, ranked or stored. Case-insensitive. */
const RESEARCH_LOG = new RegExp([
  // promotion between bands: "may promote to B/A", "promoted from C", "Promote if", "Would promote"
  String.raw`\b(?:would|may|should|could)\s+(?:promot|demot)\w*`,
  String.raw`\b(?:promot|demot)\w*\s+if\b`,
  String.raw`\bdemot\w*`,
  String.raw`\bterm of art\b`, String.raw`\bschema\b`, String.raw`\bnormali[sz]ed\b`,
  String.raw`\bconnector\b`, String.raw`\bMCP\b`, String.raw`\bjk\b`,
  // snake_case field names: source_url, organization_type, found_by, ...
  String.raw`\b[a-z]+_[a-z_]+\b`,
  String.raw`\bbatch\b`, String.raw`\b(?:import|ingest)(?:ed|er|s|ing)?\b`,
  String.raw`\bledger\b`, String.raw`\breviewer\b`, String.raw`\bruling\b`,
  String.raw`\bstage\s+\d\b`, String.raw`\bwave\s+\d\b`, String.raw`\bbrief\b`, String.raw`\bcaveat\b`,
  String.raw`\bcurl\b`, String.raw`\bplaywright\b`, String.raw`\bspam\b`, String.raw`\bskip-link\b`, String.raw`-?\d+px\b`,
  String.raw`\bmy reading\b`, String.raw`\bfloor\b`, String.raw`\bbeyond the law\b`, String.raw`\bgoes (?:well )?beyond it\b`, String.raw`\bclears it\b`,
  String.raw`\bearns? (?:nothing|this|the mark)\b`, String.raw`\b\d-employer bar\b`, String.raw`\bNehemiah\b`,
  // notes to ourselves: style rules, link rules, capture details
  String.raw`\bour copy\b`, String.raw`\bsay so\b`, String.raw`\bnever link\b`, String.raw`\bcit(?:e|ed|ing)\b`, String.raw`\blead only\b`,
  String.raw`\bsame publisher\b`, String.raw`\bcity set to\b`, String.raw`\binbox\b`, String.raw`\binnerText\b`, String.raw`\bpage HTML\b`,
  String.raw`\bPyMuPDF\b`, String.raw`\bextracted\b`, String.raw`\bcapture\b`, String.raw`\brequested as\b`, String.raw`\b[0-9a-f]{12,}\b`,
  String.raw`\b(?:next|this|separate|previous)\s+records?\b`, String.raw`\brecord-language\b`, String.raw`\brows?\b`,
  String.raw`\bsame (?:employer )?page as\b`, String.raw`\bnot (?:an )?independent\b`,
  String.raw`\bcounts?\s+(?:\w+\s+)?(?:as|toward|only)\b`, String.raw`\bcounted because\b`, String.raw`\bfor the count\b`,
  String.raw`\baccepted(?:\s+as|:)`, String.raw`\bTODO\b`,
].join("|"), "i");

/** The words publicCaveat dropped before 2026-10-28, kept exactly (substring match) so nothing it hid comes back. */
const LEGACY = /ledger|re-?verified|re-?check|prior|sweep|airtable|found_by|curated|\bCC\b|agent|this session|today|ban.the.box|fair.chance|individualized.assessment/i;

/** Markers that only count in capitals: band letters (A/B/C, never the word "a"), tier codes
 * (T1..T11, R1..R4), ruling ids (W2-3), lane, FIX. */
const BAND_MOVE = /\b(?:[Pp]romot|[Dd]emot)\w*\s+(?:to|from)\s+(?:[Bb]and\s+)?[ABC]\b|\b[Bb]and\s+[ABC]\b|\b[ABC]\/[ABC]\b|\b[Gg]rade\s+[A-C]\b/;
const RESEARCH_LOG_CASED = new RegExp(BAND_MOVE.source + String.raw`|\b[TR]\d{1,2}\b|\bW\d+-\d+\w?\b|\blanes?\b|\bFIX\b`);

/** True when the text carries any research-log marker. */
export function hasResearchMarker(text: string): boolean {
  return AUTHOR.test(text) || AUTHOR_CASED.test(text) || LEGACY.test(text) || RESEARCH_LOG.test(text) || RESEARCH_LOG_CASED.test(text);
}

function isAuthored(text: string): boolean {
  return AUTHOR.test(text) || AUTHOR_CASED.test(text);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A period after one of these does not end a sentence ("St. Louis", "Fla. Stat. 112", "115 E. Jefferson"). */
const ABBREVIATION = /(?:^|[\s(])(?:[A-Z]|St|Stat|Fla|Inc|Ave|Rd|Blvd|Ste|Co|Corp|Dr|Mr|Ms|Mrs|No|vs|etc|Jr|Sr|Mt|Ft|e\.g|i\.e|[A-Z]\.[A-Z])\.$/;

/** Sentences: a break is a newline, or [.!?] (a closing quote may follow) then space, never an ellipsis "..."; abbreviations rejoin. */
function sentences(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.split(/\n+|(?<=[.!?]['"\u2019\u201d)]?)(?<!\.\.\.)\s+/)) {
    const t = piece.trim();
    if (!t) continue;
    if (out.length && ABBREVIATION.test(out[out.length - 1])) out[out.length - 1] += " " + t;
    else out.push(t);
  }
  return out;
}

/** One sentence, cleaned: null when nothing a visitor needs is left. */
function cleanSentence(sentence: string): string | null {
  // A name inside an aside ("(Troy)", "(boss ruling 1)") means the whole sentence is a ruling.
  if (/\(([^()]*)\)/.test(sentence) && [...sentence.matchAll(/\(([^()]*)\)/g)].some((m) => isAuthored(m[1]))) return null;
  // Cut a research aside in parentheses; the sentence around it can still stand.
  const s = sentence.replace(/\s*\(([^()]*)\)/g, (m, inner: string) => (hasResearchMarker(inner) ? "" : m)).trim();
  const end = /[.!?]['"\u2019\u201d)]?$/.exec(s)?.[0] ?? ".";
  const body = end === "." && !s.endsWith(".") ? s : s.slice(0, s.length - end.length);
  const clauses = body.split(/;\s+/).map((c) => c.trim()).filter((c) => c && !hasResearchMarker(c));
  if (!clauses.length) return null;
  return capitalize(clauses.join("; ") + end);
}

/**
 * The caveat a visitor reads, without the research log. Null when nothing public is left
 * (the page then shows its own default line).
 */
export function publicNote(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // A bracketed review note can hold a caveat a job seeker needs (a background-check
  // requirement); keep its text, minus the "who reviewed it, date:" label.
  let text = raw.replace(/\[([^\]]*)\]/g, (_m, inner: string) => {
    const t = inner.replace(/^[^:]{0,60}\d{4}-\d{2}-\d{2}:\s*/, "").trim();
    return "\n" + (/[.!?]$/.test(t) ? t : t + ".") + "\n";
  });
  // The page already labels this "Know this:"; a "caveat:" label inside is noise.
  text = text.replace(/\b[Cc]aveat:\s*(\S)/g, (_m, c: string) => c.toUpperCase());
  const kept = sentences(text)
    .map(cleanSentence)
    .filter((x): x is string => !!x);
  if (!kept.length) return null;
  const out = kept.join(" ").replace(/\s{2,}/g, " ").trim();
  return out || null;
}

/**
 * Evidence is usually the employer's own words, so only unmistakable log text is cut
 * (who ruled, field names, band moves). Ordinary words such as "promoted" stay.
 */
export function publicEvidence(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const strict = /\bboss\b|\bTroy\b|\bCodex\b|\bClaude\b|\b[a-z]+_[a-z_]+\b|\bMCP\b|\bterm of art\b/i;
  const cased = new RegExp(BAND_MOVE.source + String.raw`|\bCC\b|\b[TR]\d{1,2}\b`);
  const all = sentences(raw);
  const kept = all.filter((x) => !strict.test(x) && !cased.test(x));
  if (kept.length === all.length) return raw; // nothing to cut: the employer's words, exactly as published
  const out = kept.join(" ").trim();
  return out || null;
}
