/**
 * Numbers on a resume are the person's, never the model's (2026-09-28).
 *
 * The bullet workshop asks "How many?" and shows what could be counted for the
 * line; the person types the figure. No range or figure is ever offered.
 * Whatever they type is their answer. A model writing the bullet may only use numbers that appear in those
 * answers. This module is the deterministic check behind that rule, so it holds
 * even when a prompt is ignored.
 */

const UNITS_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const WORD_NUMBERS: Record<string, number> = {
  ...UNITS_WORDS,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS_WORDS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
// Words that state an amount without a digit. Each must appear in the person's
// own answers to be used; "hundreds of orders" is a claim like any number.
const VAGUE_WORDS: Record<string, string> = {
  dozen: "dozen", dozens: "dozen", hundred: "hundred", hundreds: "hundred",
  thousand: "thousand", thousands: "thousand", million: "million", millions: "million",
  twice: "double", double: "double", doubled: "double", triple: "triple", tripled: "triple",
  half: "half", halved: "half",
};

/** Spelled-out numbers become digits ("twenty-five" -> "25", "three" -> "3").
 *  "one" is left alone: it is usually not a count ("one-on-one", "no one"). */
function spellOut(text: string): string {
  const tens = Object.keys(TENS_WORDS).join("|");
  const units = Object.keys(UNITS_WORDS).concat("one").join("|");
  return text
    .replace(new RegExp(`\\b(${tens})[- ](${units})\\b`, "gi"), (_m, t: string, u: string) =>
      String(TENS_WORDS[t.toLowerCase()] + (u.toLowerCase() === "one" ? 1 : UNITS_WORDS[u.toLowerCase()])))
    .replace(new RegExp(`\\b(${tens})\\b`, "gi"), (w) => String(TENS_WORDS[w.toLowerCase()]))
    .replace(new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join("|")})\\b`, "gi"), (w) => String(WORD_NUMBERS[w.toLowerCase()]));
}

const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const TOKEN_RE = new RegExp(String.raw`(\$\s?)?(${NUM})\s?(%|percent\b|[kK]\b|thousand\b|[mM]\b|million\b)?`, "g");

function normNum(n: string): string {
  return n.replace(/,/g, "");
}
function normSuffix(sfx?: string): string {
  if (!sfx) return "";
  const s = sfx.toLowerCase();
  if (s === "%" || s === "percent") return "%";
  if (s === "k" || s === "thousand") return "k";
  return "m";
}

/** Every amount in the text as a comparable token: "1,000" and "1000" match;
 *  "200", "200K", "$200" and "200%" are different amounts; amount words
 *  ("hundreds", "doubled") become word tokens. */
export function numbersIn(text: string): string[] {
  const t = spellOut(text);
  const out: string[] = [];
  for (const m of Array.from(t.matchAll(TOKEN_RE))) {
    out.push(`${m[1] ? "$" : ""}${normNum(m[2])}${normSuffix(m[3])}`);
  }
  for (const m of Array.from(t.matchAll(/\b[a-z]+\b/gi))) {
    const v = VAGUE_WORDS[m[0].toLowerCase()];
    if (v) out.push(`w:${v}`);
  }
  return out;
}

type Qualified = { key: string; nums: string[] };

/** Range and bound phrases ("about 6 to 10", "under 50", "more than 25",
 *  "1 or 2", "5 or more") as keys that must survive whole. */
function qualifiedPhrases(text: string): Qualified[] {
  const t = spellOut(text);
  const out: Qualified[] = [];
  const add = (key: string, ...nums: string[]) => out.push({ key, nums: nums.map(normNum) });
  for (const m of Array.from(t.matchAll(new RegExp(String.raw`(${NUM})\s*(?:to|-|\u2013)\s*(${NUM})`, "gi")))) add(`range:${normNum(m[1])}:${normNum(m[2])}`, m[1], m[2]);
  for (const m of Array.from(t.matchAll(new RegExp(String.raw`\b(?:under|fewer than|less than|up to)\s+(${NUM})`, "gi")))) add(`under:${normNum(m[1])}`, m[1]);
  for (const m of Array.from(t.matchAll(new RegExp(String.raw`\b(?:more than|over)\s+(${NUM})`, "gi")))) add(`over:${normNum(m[1])}`, m[1]);
  for (const m of Array.from(t.matchAll(new RegExp(String.raw`\b(${NUM})\s+or\s+more\b`, "gi")))) add(`ormore:${normNum(m[1])}`, m[1]);
  for (const m of Array.from(t.matchAll(new RegExp(String.raw`\b(${NUM})\s+or\s+(${NUM})\b`, "gi")))) add(`or:${normNum(m[1])}:${normNum(m[2])}`, m[1], m[2]);
  return out;
}

/**
 * Amounts in `output` the person did not give. Empty means every amount is theirs.
 * `source` is their plain answers (what they did, how often, what improved):
 * any amount in it may be used. `quantity` is their "How many?" answer: a
 * range or bound there ("about 6 to 10", "under 50") has to stay whole, so a
 * picked range can never turn into one exact figure.
 */
export function unsupportedNumbers(output: string, source: string, quantity = ""): string[] {
  const free = new Set(numbersIn(source));
  const qualified = qualifiedPhrases(quantity);
  const inQualified = new Set(qualified.flatMap((q) => q.nums));
  for (const n of numbersIn(quantity)) if (!inQualified.has(n)) free.add(n);
  const outKeys = new Set(qualifiedPhrases(output).map((q) => q.key));
  const allowed = (tok: string) => free.has(tok) || (!tok.startsWith("$") && !tok.startsWith("w:") && free.has(`$${tok}`));
  const bad: string[] = [];
  for (const tok of Array.from(new Set(numbersIn(output)))) {
    if (allowed(tok)) continue;
    const kept = qualified.some((q) => q.nums.includes(tok) && outKeys.has(q.key));
    if (!kept) bad.push(tok);
  }
  return bad;
}

// No ranges or figures are offered anywhere (decision D2, 2026-10-07): the
// workshop shows what to count (lib/count-prompts.ts) and the person types the
// number. Ranges a person picked on an older build are still kept whole above.

/** The person's own workshop answers saved on an approved resume, as text the
 *  truth check can trust. Reads only the answer fields, never the bullet, and
 *  only for bullets still on the resume: answers behind a deleted or rewritten
 *  line no longer speak for anything. */
export function evidenceAnswerText(doc: unknown): string[] {
  const experience = (doc as { experience?: unknown })?.experience;
  if (!Array.isArray(experience)) return [];
  const out: string[] = [];
  for (const entry of experience) {
    const evidence = (entry as { evidence?: unknown })?.evidence;
    if (!Array.isArray(evidence)) continue;
    const bullets = (entry as { bullets?: unknown })?.bullets;
    const current = new Set(Array.isArray(bullets) ? bullets.filter((b): b is string => typeof b === "string").map((b) => b.trim()) : []);
    for (const ev of evidence) {
      const bullet = (ev as { bullet?: unknown })?.bullet;
      if (typeof bullet !== "string" || !current.has(bullet.trim())) continue;
      for (const key of ["did", "tools", "often", "quantity", "improved"] as const) {
        const v = (ev as Record<string, unknown>)?.[key];
        if (typeof v === "string" && v.trim()) out.push(v.trim());
      }
    }
  }
  return out;
}
