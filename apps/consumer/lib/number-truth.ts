/**
 * Numbers on a resume are the person's, never the model's (2026-09-28).
 *
 * The bullet workshop asks "How many?" and, when someone cannot give an exact
 * figure, offers a few ranges to pick from. Whatever they type or pick is their
 * answer. A model writing the bullet may only use numbers that appear in those
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

export type QuantityUnit = "people" | "crew" | "orders" | "loads" | "units" | "hours" | "shifts" | "miles";

/**
 * Ranges offered after someone picks a unit. Fixed here, never written by a
 * model, so the choices on screen can never be an invented figure. `fill` is
 * exactly what goes into the answer box, and the person can still edit it.
 */
export const RANGE_CHOICES: Record<QuantityUnit, { label: string; fill: string }[]> = {
  people: [
    { label: "1 to 5", fill: "about 1 to 5 people" },
    { label: "6 to 10", fill: "about 6 to 10 people" },
    { label: "11 to 25", fill: "about 11 to 25 people" },
    { label: "more than 25", fill: "more than 25 people" },
  ],
  crew: [
    { label: "2 to 5", fill: "a crew of about 2 to 5" },
    { label: "6 to 10", fill: "a crew of about 6 to 10" },
    { label: "11 to 20", fill: "a crew of about 11 to 20" },
    { label: "more than 20", fill: "a crew of more than 20" },
  ],
  orders: [
    { label: "under 50 a day", fill: "under 50 orders a day" },
    { label: "50 to 200 a day", fill: "about 50 to 200 orders a day" },
    { label: "200 to 500 a day", fill: "about 200 to 500 orders a day" },
    { label: "more than 500 a day", fill: "more than 500 orders a day" },
  ],
  loads: [
    { label: "under 10 a day", fill: "under 10 loads a day" },
    { label: "10 to 25 a day", fill: "about 10 to 25 loads a day" },
    { label: "25 to 50 a day", fill: "about 25 to 50 loads a day" },
    { label: "more than 50 a day", fill: "more than 50 loads a day" },
  ],
  units: [
    { label: "under 100 a day", fill: "under 100 units a day" },
    { label: "100 to 500 a day", fill: "about 100 to 500 units a day" },
    { label: "500 to 1,000 a day", fill: "about 500 to 1,000 units a day" },
    { label: "more than 1,000 a day", fill: "more than 1,000 units a day" },
  ],
  hours: [
    { label: "under 20 a week", fill: "under 20 hours a week" },
    { label: "20 to 40 a week", fill: "about 20 to 40 hours a week" },
    { label: "40 to 60 a week", fill: "about 40 to 60 hours a week" },
    { label: "more than 60 a week", fill: "more than 60 hours a week" },
  ],
  shifts: [
    { label: "1 or 2 a week", fill: "1 or 2 shifts a week" },
    { label: "3 or 4 a week", fill: "3 or 4 shifts a week" },
    { label: "5 or more a week", fill: "5 or more shifts a week" },
  ],
  miles: [
    { label: "under 100 a day", fill: "under 100 miles a day" },
    { label: "100 to 300 a day", fill: "about 100 to 300 miles a day" },
    { label: "more than 300 a day", fill: "more than 300 miles a day" },
  ],
};

export const QUANTITY_UNITS = Object.keys(RANGE_CHOICES) as QuantityUnit[];

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
