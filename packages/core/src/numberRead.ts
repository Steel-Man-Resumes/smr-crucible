/**
 * Reading numbers the way people write them, compared by VALUE.
 *
 * "42", "forty-two" and "４２" are one claim (42). "$400,000" and "four
 * hundred thousand dollars" are one claim (400000). ".002" and "two
 * thousandths" are one claim (0.002). "A decade" is 10. Counts with no single
 * value ("hundreds", "a few hundred", "dozens") are compared by their scale
 * ("~100s"). Multipliers ("3x", "doubled", "in half") are "x3", "x2", "x0.5".
 * A rank ("ranked first", "1st place") is "#1".
 *
 * Not numbers: years (dates are checked on their own), phone numbers, ZIP
 * codes, emails, and a number word joined to a thing it describes
 * ("three-axis", "two-way", "one-on-one"). "One" alone and "first" outside a
 * rank are ordinary prose ("no one", "first aid") and are not read.
 *
 * Pure. Positions are kept so a finding names the exact line it is on.
 */

export interface NumberToken {
  /** The value, as compared ("42", "0.002", "~100s", "x2", "#1"). */
  value: string;
  /** Where it sits in the text given (after digit normalizing, same length). */
  index: number;
  length: number;
}

const YEAR_RE = /\b(?:19[5-9]\d|20[0-4]\d)\b/g;

/**
 * Fullwidth and other script digits to ASCII, keeping every character in
 * place (one char in, one char out) so positions still line up.
 */
export function normalizeDigits(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (/\p{Nd}/u.test(ch) && !(cp >= 48 && cp <= 57)) {
      // Unicode decimal digits come in runs of ten starting at a zero.
      const n = ch.normalize("NFKC");
      if (/^[0-9]$/.test(n)) {
        out += n;
        continue;
      }
      let zero = cp;
      while (zero > 0 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1)) && cp - (zero - 1) <= 9) zero--;
      out += String(cp - zero);
      continue;
    }
    // Keep one UTF-16 unit per original unit: astral chars are rare here.
    out += ch.length === 1 ? ch : " ".repeat(ch.length);
  }
  return out;
}

const UNITS: Record<string, number> = {
  zero: 0, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1000000, billion: 1000000000 };
const FRACTIONS: Record<string, number> = { tenths: 10, hundredths: 100, thousandths: 1000, tenth: 10, hundredth: 100, thousandth: 1000 };
const VAGUE: Record<string, string> = {
  dozens: "~12s", hundreds: "~100s", thousands: "~1000s", millions: "~1000000s", billions: "~1000000000s",
};
const MULT: Record<string, string> = {
  doubled: "x2", tripled: "x3", quadrupled: "x4", halved: "x0.5",
};
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

// Words after a number that name a kind of thing, not how many ("three-axis mill", "two-way radio").
const SPEC_WORDS = new Set(["axis", "way", "wheel", "wheeled", "ply", "dimensional", "phase", "speed", "color", "colour", "stage", "tier", "point", "on", "of", "star"]);

const fmt = (n: number) => String(Number(n.toPrecision(12)));

/** Blank out what is never a claimed number, keeping positions. */
function blankNonClaims(t: string): string {
  const blank = (s: string, re: RegExp) => s.replace(re, (m) => " ".repeat(m.length));
  let s = t;
  s = blank(s, /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g); // emails
  s = blank(s, /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g); // phone numbers
  s = blank(s, /\b\d{3}[\s.-]\d{4}\b/g); // short phone numbers
  s = blank(s, /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g); // ZIP after a state
  s = blank(s, YEAR_RE);
  return s;
}

/** Every number claim in a text, by value, with where it sits. */
export function numberTokens(text: string): NumberToken[] {
  const t = blankNonClaims(normalizeDigits(text || ""));
  const out: NumberToken[] = [];
  const lower = t.toLowerCase();

  // Digits, with a scale or multiplier right after ("12k", "1.5 million", "3x").
  const DIGIT_RE = /(?<![\w.$])(?:\$\s?)?(\d[\d,]*(?:\.\d+)?|\.\d+)(?:\s?(k|m|million|thousand|hundred|billion)\b|(x)(?![a-z]))?(st|nd|rd|th)?%?/gi;
  for (const m of lower.matchAll(DIGIT_RE)) {
    const raw = m[1].replace(/,(?=\d{3}\b)/g, "");
    let n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const scale = m[2];
    if (scale === "k" || scale === "thousand") n *= 1000;
    else if (scale === "m" || scale === "million") n *= 1000000;
    else if (scale === "hundred") n *= 100;
    else if (scale === "billion") n *= 1000000000;
    if (m[4]) {
      // "1st", "2nd": a count only as a rank ("ranked 1st", "1st place"); a
      // shift or a floor ("1st shift") is a name, not a claim.
      const before = lower.slice(0, m.index!).match(/([a-z]+)\s*$/)?.[1] ?? "";
      const after = lower.slice(m.index! + m[0].length).match(/^\s*([a-z]+)/)?.[1] ?? "";
      if (/^(?:ranked|rated|placed|finished|named|came)$/.test(before) || /^(?:place|among)$/.test(after)) {
        out.push({ value: `#${fmt(n)}`, index: m.index!, length: m[0].length });
      }
      continue;
    }
    const value = m[3] ? `x${fmt(n)}` : fmt(n);
    out.push({ value, index: m.index!, length: m[0].length });
  }

  // Words. Walk word by word, building a number from a run of number words.
  const words = Array.from(lower.matchAll(/[a-z]+(?:-[a-z]+)*/g)).map((m) => ({ w: m[0], i: m.index! }));
  const at = (k: number) => words[k]?.w ?? "";
  for (let k = 0; k < words.length; k++) {
    const { w, i } = words[k];
    const start = i;
    // Rank: "ranked first", "first place", "first among".
    if (ORDINALS[w] !== undefined) {
      const prev = at(k - 1);
      const next = at(k + 1);
      if (/^(?:ranked|rated|placed|finished|named|came)$/.test(prev) || /^(?:place|among)$/.test(next)) {
        out.push({ value: `#${ORDINALS[w]}`, index: i, length: w.length });
      }
      continue;
    }
    if (MULT[w]) {
      out.push({ value: MULT[w], index: i, length: w.length });
      continue;
    }
    if (w === "half" && (at(k - 1) === "in" || at(k - 1) === "by")) {
      out.push({ value: "x0.5", index: i, length: w.length });
      continue;
    }
    if (VAGUE[w]) {
      out.push({ value: VAGUE[w], index: i, length: w.length });
      continue;
    }
    if (w === "dozen") {
      out.push({ value: "12", index: i, length: w.length });
      continue;
    }
    // "a decade", "two decades"
    if (w === "decade" || w === "decades") {
      const prevVal = UNITS[at(k - 1)] ?? TENS[at(k - 1)];
      const n = w === "decade" ? 10 : prevVal ? prevVal * 10 : NaN;
      if (Number.isFinite(n)) out.push({ value: fmt(n), index: i, length: w.length });
      else out.push({ value: "~10s", index: i, length: w.length });
      continue;
    }
    // A hyphenated word: a number pair ("forty-two"), a count joined to what
    // it counts ("hundred-thousand-square-foot", "twelve-hour"), or a spec
    // that names a kind of thing, not a count ("three-axis", "two-way").
    let parts = w.split("-");
    if (parts.length > 1) {
      const isNum = (p: string) => UNITS[p] !== undefined || TENS[p] !== undefined || SCALES[p] !== undefined;
      let lead = 0;
      while (lead < parts.length && (isNum(parts[lead]) || (lead === 0 && (parts[0] === "a" || parts[0] === "one") && isNum(parts[1] ?? "")))) lead++;
      if (lead === 0) continue;
      if (lead < parts.length && SPEC_WORDS.has(parts[lead])) continue;
      parts = parts.slice(0, lead).filter((p) => p !== "a" && p !== "one");
      if (!parts.length) continue;
    }
    // Build a run: [a|an|one|few|couple|several] (units|tens[-units]) (scale ...)
    let total = 0;
    let current = 0;
    let any = false;
    let vague = false;
    let k2 = k;
    let end = i + w.length;
    const leadA = parts.length === 1 && (w === "a" || w === "an" || w === "one");
    const leadVague = parts.length === 1 && (w === "few" || w === "couple" || w === "several");
    if (leadA || leadVague) {
      // Only a scale (or few/couple/several then a scale) makes these a number.
      let j = k + 1;
      if (leadA && /^(?:few|couple)$/.test(at(j))) j++;
      if (at(j).includes("-")) continue; // "a hundred-thousand-square-foot": the hyphen word carries the number
      const sc = at(j);
      if (SCALES[sc] === undefined) continue;
      if (leadVague || /^(?:few|couple)$/.test(at(k + 1))) vague = true;
      current = 1;
      any = true;
      k2 = j - 1;
      parts = [];
    } else {
      for (const p of parts) {
        if (UNITS[p] !== undefined) current += UNITS[p];
        else if (TENS[p] !== undefined) current += TENS[p];
        else if (SCALES[p] !== undefined) {
          current = (current || 1) * SCALES[p];
          if (SCALES[p] >= 1000) {
            total += current;
            current = 0;
          }
        } else break;
        any = true;
      }
      if (!any) continue;
    }
    // Continue across following number words ("four hundred thousand", "forty two").
    let j = k2 + 1;
    while (j < words.length) {
      const nw = at(j);
      const np = nw.split("-");
      if (!np.every((p) => UNITS[p] !== undefined || TENS[p] !== undefined || SCALES[p] !== undefined || p === "and")) break;
      if (nw === "and" && !(UNITS[at(j + 1)] !== undefined || TENS[at(j + 1)] !== undefined)) break;
      for (const p of np) {
        if (p === "and") continue;
        if (UNITS[p] !== undefined) current += UNITS[p];
        else if (TENS[p] !== undefined) current += TENS[p];
        else {
          current = (current || 1) * SCALES[p];
          if (SCALES[p] >= 1000) {
            total += current;
            current = 0;
          }
        }
      }
      end = words[j].i + nw.length;
      j++;
    }
    let n = total + current;
    // "two thousandths" is 0.002.
    if (FRACTIONS[at(j)] !== undefined) {
      n = n / FRACTIONS[at(j)];
      end = words[j].i + at(j).length;
      j++;
    }
    if (vague) {
      const sc = Object.keys(SCALES).find((s) => n % SCALES[s] === 0 && n / SCALES[s] < 1000 && n >= SCALES[s]) ?? "hundred";
      out.push({ value: `~${SCALES[sc]}s`, index: start, length: end - start });
    } else {
      out.push({ value: fmt(n), index: start, length: end - start });
    }
    k = j - 1;
  }
  return out.sort((a, b) => a.index - b.index);
}

/** The values of every number claim in a text. */
export function numberValues(text: string): Set<string> {
  return new Set(numberTokens(text).map((x) => x.value));
}
