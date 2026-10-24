/**
 * Fact-strip checker (PURE). The AI may only put the person's own answers into
 * smoother words. Any sentence it writes that carries a fact the answers do not
 * hold is removed, and the caller tells the person how many lines came out.
 *
 * A sentence is removed when it has:
 *   - a number (digits, or three through twenty, hundred, thousand) not in the answers;
 *   - a capitalized name mid-sentence (a place, employer, program, person) not in the answers;
 *   - a claim word that would state a fact about the person (resolved, sealed,
 *     sober, reliable car, certified, never late...) not in the answers.
 * Removing too much is the safe failure: the plan's own lines are built from
 * the answers and stay whether or not any AI sentence survives.
 */

const NUMBER_WORDS = ["three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen","twenty","hundred","thousand","dozen"];

/** Phrases that state a fact about the person. Allowed only if the answers say them. */
export const CLAIM_PHRASES = [
  "expunged","expungement","sealed","pardon","pardoned","set aside","dismissed",
  "completed probation","finished probation","off probation","off parole","done with probation","done with parole","served my time","paid my debt",
  "resolved","taken care of","handled it","under control","in place","sorted out","figured out",
  "reliable car","reliable transportation","reliable ride","my own car","my car","a car","valid license","driver's license","drivers license",
  "childcare is set","backup childcare","backup care","daycare",
  "sober","clean","in recovery","recovery","relapse","diagnosed","diagnosis","disability","medication","therapy","treatment",
  "certified","certification","certificate","degree","diploma","ged","licensed",
  "never late","always on time","perfect attendance","never missed","promoted","promotion","supervisor","manager","lead",
  "years of experience","experienced","references","reference","vouch",
  "rehabilitated","changed man","changed woman","changed person","new person","learned my lesson","took responsibility","take full responsibility","remorse","regret","mistake","bad decisions","wrong crowd",
  "guarantee","guaranteed","will hire","will respect","they will understand","no problem",
  "housing is stable","stable housing","my own place","apartment",
  "approved","eligible","qualify","qualified",
];

const START_OK = new Set(["I","I'd","I'm","I've","I'll"]);
/** Product and common words that may be capitalized without being a new fact. */
const NAME_OK = new Set(["i","i'd","i'm","i've","i'll","t.roy","refinery","forge"]);

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
}

function hasPhrase(haystackNorm: string, phraseNorm: string): boolean {
  return (` ${haystackNorm} `).includes(` ${phraseNorm} `);
}

export function splitSentences(text: string): string[] {
  return text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=["'“]?[A-Z0-9])/).map((s) => s.trim()).filter(Boolean);
}

/** Why a sentence is not supported, or null when every fact in it is in the answers. */
export function unsupportedReason(sentence: string, sourceNorm: string): string | null {
  const norm = normalize(sentence);
  for (const d of sentence.match(/\d+(?:[.,]\d+)?/g) ?? []) {
    if (!hasPhrase(sourceNorm, normalize(d))) return `number ${d}`;
  }
  for (const w of NUMBER_WORDS) if (hasPhrase(norm, w) && !hasPhrase(sourceNorm, w)) return `number ${w}`;
  // Capitalized words after the first word of a clause are names.
  const tokens = sentence.replace(/[‘’]/g, "'").split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    const word = raw.replace(/^["'“(]+|[.,!?;:"'”)]+$/g, "");
    if (!/^[A-Z]/.test(word)) continue;
    const prev = i === 0 ? "" : tokens[i - 1];
    const clauseStart = i === 0 || /[.!?:;"“]$/.test(prev) || /^["“]/.test(raw);
    if (clauseStart || START_OK.has(word)) continue;
    const w = normalize(word);
    if (!w || NAME_OK.has(w)) continue;
    if (!hasPhrase(sourceNorm, w)) return `name ${word}`;
  }
  for (const p of CLAIM_PHRASES) {
    const pn = normalize(p);
    if (hasPhrase(norm, pn) && !hasPhrase(sourceNorm, pn)) return `claim "${p}"`;
  }
  return null;
}

export interface CheckResult { text: string; stripped: string[] }

/** Keep only the sentences whose facts are all in the person's answers. */
export function stripUnsupported(text: string, sources: string[]): CheckResult {
  const sourceNorm = normalize(sources.join(" . "));
  const kept: string[] = [];
  const stripped: string[] = [];
  for (const s of splitSentences(text ?? "")) {
    if (unsupportedReason(s, sourceNorm)) stripped.push(s);
    else kept.push(s);
  }
  return { text: kept.join(" "), stripped };
}
