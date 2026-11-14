/**
 * A person's Spanish answer, with its numbers written the way the English
 * number checks read them (Spanish first).
 *
 * The bullet workshop compares the figures in the model's English bullet with
 * the figures the person typed. In Spanish, "1.200" is twelve hundred (the dot
 * groups thousands) and "15,50" is fifteen and a half (the comma is the
 * decimal), the opposite of English; "mil doscientos", "menos de 50", "de 6 a
 * 10" and "por ciento" are numbers too. Read as English, "1,5" became 15 and a
 * made-up figure could pass. This turns the answer into English-readable text
 * first, and the existing checks run on that.
 *
 * Use it only on the person's Spanish answers, never on the model's English
 * output. English text that has no Spanish number form comes back with the
 * same numbers.
 */

const FOLD: Record<string, string> = { "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n" };
/** Lower case with accents off, one character in and one out. */
export function foldSpanish(s: string): string {
  return (s || "").toLowerCase().replace(/[áéíóúüñ]/g, (c) => FOLD[c] ?? c);
}

const UNITS: Record<string, number> = {
  cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintiun: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700,
  ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};
const isNumWord = (w: string) => w in UNITS || w in TENS || w in HUNDREDS || w === "mil" || w === "millon" || w === "millones";

/** Runs of Spanish number words become digits ("treinta y cinco" -> 35, "dos mil quinientos" -> 2500). */
function wordsToDigits(t: string): string {
  const parts = t.split(/(\s+)/); // keep spacing
  const out: string[] = [];
  let i = 0;
  while (i < parts.length) {
    const w = parts[i];
    if (!isNumWord(w)) { out.push(w); i++; continue; }
    // collect a run: number words, with "y" allowed between tens and units
    let total = 0, current = 0, count = 0, j = i, lastEnd = i, sawBig = false;
    while (j < parts.length) {
      const x = parts[j];
      if (/^\s+$/.test(x)) { j++; continue; }
      if (isNumWord(x)) {
        if (x in UNITS) current += UNITS[x];
        else if (x in TENS) current += TENS[x];
        else if (x in HUNDREDS) current += HUNDREDS[x];
        else if (x === "mil") { total += (current || 1) * 1000; current = 0; sawBig = true; }
        else { total += (current || 1) * 1000000; current = 0; sawBig = true; }
        count++; lastEnd = j; j++; continue;
      }
      // "treinta y cinco": y between a tens word and a units word
      const prev = parts.slice(i, j).filter((p) => isNumWord(p)).pop() ?? "";
      let k = j + 1; while (k < parts.length && /^\s+$/.test(parts[k])) k++;
      if (x === "y" && prev in TENS && parts[k] in UNITS) { j++; continue; }
      break;
    }
    const only = count === 1 ? parts[i] : "";
    // A lone "un", "una" or "uno" is an article or pronoun, not a count.
    if (count === 1 && (only === "un" || only === "una" || only === "uno")) { out.push(parts[i]); i++; continue; }
    out.push(String(total + current));
    i = lastEnd + 1;
    void sawBig;
  }
  return out.join("");
}

/**
 * The text with Spanish numbers in English form: digit groups and decimals,
 * number words, bounds and ranges, percent, and amount words.
 */
export function spanishAnswerToEnglish(text: string): string {
  let t = foldSpanish(text);
  // Digit formats: 1.200 and 1.200.000 group thousands; a comma is the decimal.
  t = t.replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d+)?(?!\d)/g, (m) => m.replace(/\./g, "").replace(",", "."));
  // English-style groups with commas (1,200,000) are thousands. "1,200" alone could be either, so both readings are kept.
  t = t.replace(/\b\d{1,3}(?:,\d{3}){2,}\b/g, (m) => m.replace(/,/g, ""));
  t = t.replace(/\b(\d{1,3}),(\d{3})\b(?!,\d)/g, "$1.$2 $1$2");
  t = t.replace(/\b(\d+),(\d+)\b/g, "$1.$2");
  // "5 mil" and "2 millones" with digits.
  t = t.replace(/\b(\d+(?:\.\d+)?)\s+mil\b/g, (_m, n: string) => String(Number(n) * 1000));
  t = t.replace(/\b(\d+(?:\.\d+)?)\s+millon(?:es)?\b/g, (_m, n: string) => String(Number(n) * 1000000));
  // Percent first: "ciento" is also the number word 100. Then number words, bounds and ranges.
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:por\s?ciento|porciento)\b/g, "$1%");
  t = wordsToDigits(t);
  const N = String.raw`(\d+(?:\.\d+)?)`;
  t = t.replace(new RegExp(String.raw`\b(?:menos\s+de|menos\s+que|hasta|como\s+maximo|maximo\s+de)\s+${N}`, "g"), "under $1");
  t = t.replace(new RegExp(String.raw`\b(?:mas\s+de|mas\s+que|sobre|mas\s+de\s+los)\s+${N}`, "g"), "more than $1");
  t = t.replace(new RegExp(String.raw`\b${N}\s+o\s+mas\b`, "g"), "$1 or more");
  t = t.replace(new RegExp(String.raw`\b${N}\s+o\s+${N}\b`, "g"), "$1 or $2");
  t = t.replace(new RegExp(String.raw`\b(?:de|entre)\s+${N}\s+(?:a|y)\s+${N}\b`, "g"), "$1 to $2");
  t = t.replace(new RegExp(String.raw`\b${N}\s+a\s+${N}\b`, "g"), "$1 to $2");
  // Amount words an answer may use without a digit.
  t = t.replace(/\bdocenas?\b/g, "dozen").replace(/\bcientos\b/g, "hundreds").replace(/\bmiles\b/g, "thousands")
    .replace(/\bmillones\b/g, "millions").replace(/\bdupli(?:c|qu)[a-z]*\b/g, "doubled")
    .replace(/\btripli(?:c|qu)[a-z]*\b/g, "tripled").replace(/\b(?:mitad|medio|media)\b/g, "half");
  return t;
}
