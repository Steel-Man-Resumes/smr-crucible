/**
 * An employer's city comes from the person, not from where they live (2026-09-28).
 *
 * The resume format asks for "JOB TITLE | Company | City, State | Years", and
 * when the person gave no city for a job the model filled in their home town. A
 * sample resume put a stamping plant the person named without a city in their
 * current city. A city stays on a job line only if the person gave it near that
 * same employer in their own words; otherwise that part of the line is taken
 * out. When the employer cannot be found in their words at all, nothing can be
 * judged and the city stays. Lines with fewer than four parts (contact lines)
 * are not touched.
 */

const CITY_SEG = /^[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}$/;
const YEAR = /\b(19|20)\d\d\b/;
const BULLET = /^\s*[-\u2022*]/;
const COMPANY_NOISE = new Set(["inc", "llc", "co", "corp", "corporation", "company", "ltd", "the", "of", "and"]);
const STATE_CODES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" ")
);
const ABBREV: Record<string, string> = { saint: "st", fort: "ft", mount: "mt" };

function norm(s: string): string {
  return ` ${s
    .toLowerCase()
    .replace(/\bst\.?\s/g, "saint ")
    .replace(/\bft\.?\s/g, "fort ")
    .replace(/\bmt\.?\s/g, "mount ")
    // "McDonald's", "Wal-Mart", "A.O. Smith": one word each
    .replace(/(?<=[a-z0-9])['\u2019.-](?=[a-z0-9])/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function mainWords(company: string): string[] {
  return norm(company).trim().split(" ").filter((w) => w && !COMPANY_NOISE.has(w));
}

/** State codes the person wrote right after this city: real uppercase codes only,
 *  so "Kansas City to" or "Grand Rapids in 2013" is never read as a state. */
function statesAfter(rawText: string, city: string): string[] {
  const words = city.split(" ").map((w) => (ABBREV[w] ? `(?:${w}|${ABBREV[w]}\\.?)` : w));
  const re = new RegExp(String.raw`\b${words.join(String.raw`[\s.,'-]+`)}\b[\s,]+([A-Za-z]{2})\b`, "gi");
  return Array.from(rawText.matchAll(re), (m) => m[1]).filter((c) => c === c.toUpperCase() && STATE_CODES.has(c));
}

/** The employer's block in the person's words: the line naming it, the line
 *  before it when that is a short line with no date (a title or a place), and
 *  the lines after it until a blank line, a "|" line or the next job's dates. */
function blockAround(lines: string[], i: number): string[] {
  const block: string[] = [];
  const prev = lines[i - 1];
  if (prev && prev.trim() && !YEAR.test(prev) && !prev.includes(" | ") && prev.trim().split(/\s+/).length <= 6) block.push(prev);
  block.push(lines[i]);
  let sawYear = YEAR.test(lines[i]);
  for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
    const l = lines[j];
    if (!l.trim() || l.includes(" | ")) break;
    if (!BULLET.test(l) && YEAR.test(l)) {
      if (sawYear) break; // the next job's dates
      sawYear = true;
    }
    block.push(l);
  }
  return block;
}

export function stripUnsupportedJobCities(
  resume: string,
  source: string
): { text: string; removed: number; removedCities: string[] } {
  const sourceLines = source.split("\n");
  const removedCities: string[] = [];
  const lines = resume.split("\n").map((line) => {
    const segs = line.split(/\s+\|\s+/);
    if (segs.length < 4) return line; // a job line has title, company, place and years
    const company = segs[1].trim();
    const idx = segs.findIndex((seg, i) => i >= 2 && CITY_SEG.test(seg.trim()));
    if (idx < 0 || !company) return line;
    const words = mainWords(company);
    const city = norm(segs[idx].split(",")[0]).trim();
    const state = (segs[idx].split(",")[1] || "").trim().toUpperCase();
    if (!words.length || !city) return line;
    let named = false;
    let supported = false;
    sourceLines.forEach((l, i) => {
      if (supported) return;
      const nl = norm(l);
      if (!words.every((w) => nl.includes(` ${w} `))) return;
      named = true;
      const block = blockAround(sourceLines, i);
      // A city that is only part of the company name does not count: take the
      // company name out as a whole phrase, then look for the city.
      let text = norm(block.join(" "));
      for (const phrase of [norm(company), ` ${words.join(" ")} `]) text = text.split(phrase).join(" ");
      if (!text.includes(` ${city} `)) return;
      // If the person wrote a state right after the city, it has to match.
      const given = statesAfter(block.join("\n"), city);
      if (given.length && state && !given.includes(state)) return;
      supported = true;
    });
    // If we cannot find the employer in the person's words, we cannot judge its
    // city either, so it stays.
    if (supported || !named) return line;
    removedCities.push(`${company}: ${segs[idx].trim()}`);
    return segs.filter((_, i) => i !== idx).join(" | ");
  });
  return { text: lines.join("\n"), removed: removedCities.length, removedCities };
}
