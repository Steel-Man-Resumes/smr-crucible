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

const NUMBER_WORDS = ["one","two","first","second","third","once","twice","single","couple","few","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen","twenty","hundred","thousand","dozen"];

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
  "owned it","own it","grown","grew","growth","since then","behind me","moved on","past me","better person",
  "valid","reinstated","restored","renewed","dependable","truck","own a","bought","close to","near","nearby","flexible","understanding","mind",
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

const NEGATIONS = ["not","no","never","don't","doesn't","didn't","isn't","aren't","wasn't","weren't","won't","can't","cannot","couldn't","shouldn't","haven't","hasn't","without","nothing","none"];
/** Promise and prediction words: a plan built from answers has no reason to forecast. */
const MODALS = ["will","won't","would","going to","gonna","sure to","always"];
/** Words a sentence may start with without being a name. */
const COMMON_STARTS = new Set(("you your yours i i'd i'm i've i'll if the this that these those it it's when then what which who how why where ask find write keep make call check look try get go start bring say tell use pick plan add take put a an and but so or some for before after with most many any each every there here today right now next also only just maybe see let we our they their he she his her as at by from in on of to up out over about once while because since though although even all both either neither more less yes still yet").split(" "));

function negatedAt(tokens: string[], i: number): boolean {
  for (let j = Math.max(0, i - 3); j < i; j++) if (NEGATIONS.includes(tokens[j])) return true;
  return false;
}

/** Does every place the phrase appears in the sentence have the same polarity somewhere in the source? */
function polarityMatches(sentNorm: string, sourceNorm: string, phraseNorm: string): boolean {
  const st = sentNorm.split(" "), so = sourceNorm.split(" "), ph = phraseNorm.split(" ");
  const at = (toks: string[]) => { const out: number[] = []; for (let i = 0; i + ph.length <= toks.length; i++) if (ph.every((w, k) => toks[i + k] === w)) out.push(i); return out; };
  const srcPol = new Set(at(so).map((i) => negatedAt(so, i)));
  return at(st).every((i) => srcPol.has(negatedAt(st, i)));
}

/** Why a sentence is not supported, or null when every fact in it is in the answers. */
export function unsupportedReason(sentence: string, sourceNorm: string): string | null {
  const norm = normalize(sentence);
  const ntoks = norm.split(" ");
  // A negation must be one the answers already hold, with the word after it.
  for (let i = 0; i < ntoks.length; i++) {
    if (!NEGATIONS.includes(ntoks[i])) continue;
    const pair = ntoks.slice(i, i + 2).join(" ");
    if (!hasPhrase(sourceNorm, pair)) return `negation "${pair}"`;
  }
  for (const m of MODALS) if (hasPhrase(norm, m) && !hasPhrase(sourceNorm, m)) return `prediction "${m}"`;
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
    if (START_OK.has(word)) continue;
    const w = normalize(word);
    if (!w || NAME_OK.has(w)) continue;
    // A capital at the start of a clause is a name unless it is a common word.
    if (clauseStart && COMMON_STARTS.has(w)) continue;
    if (!hasPhrase(sourceNorm, w)) return `name ${word}`;
  }
  for (const p of CLAIM_PHRASES) {
    const pn = normalize(p);
    if (!hasPhrase(norm, pn)) continue;
    if (!hasPhrase(sourceNorm, pn)) return `claim "${p}"`;
    // "You have a car" is not supported by "You don't have a car".
    if (!polarityMatches(norm, sourceNorm, pn)) return `claim "${p}" flips the answer`;
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
