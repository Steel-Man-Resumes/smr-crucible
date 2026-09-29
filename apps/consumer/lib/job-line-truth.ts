/**
 * An employer's city comes from the person, not from where they live (2026-09-28).
 *
 * The resume format asks for "JOB TITLE | Company | City, State | Years", and
 * when the person gave no city for a job the model filled in their home town. A
 * sample resume put a stamping plant the person named without a city in their
 * current city. A city stays on a job line only if the person gave it near that
 * same employer in their own words; otherwise that part of the line is taken
 * out. Lines with fewer than four parts (contact lines) are not touched.
 */

const CITY_SEG = /^[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}$/;
const COMPANY_NOISE = new Set(["inc", "llc", "co", "corp", "corporation", "company", "ltd", "the", "of", "and"]);

function norm(s: string): string {
  return ` ${s
    .toLowerCase()
    .replace(/\bst\.?\s/g, "saint ")
    .replace(/\bft\.?\s/g, "fort ")
    .replace(/\bmt\.?\s/g, "mount ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function mainWords(company: string): string[] {
  return norm(company).trim().split(" ").filter((w) => w && !COMPANY_NOISE.has(w));
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
    if (!words.length || !city) return line;
    // The employer's block in the person's words: each line naming it, plus the
    // lines right after it until a blank line.
    let supported = false;
    sourceLines.forEach((l, i) => {
      if (supported) return;
      const nl = norm(l);
      if (!words.every((w) => nl.includes(` ${w} `))) return;
      const block: string[] = [l];
      for (let j = i + 1; j < Math.min(sourceLines.length, i + 4) && sourceLines[j].trim(); j++) block.push(sourceLines[j]);
      // A city that is only part of the company name does not count: take the
      // company name out as a whole phrase, then look for the city.
      let text = norm(block.join(" "));
      for (const phrase of [norm(company), ` ${words.join(" ")} `]) text = text.split(phrase).join(" ");
      if (text.includes(` ${city} `)) supported = true;
    });
    if (supported) return line;
    removedCities.push(`${company}: ${segs[idx].trim()}`);
    return segs.filter((_, i) => i !== idx).join(" | ");
  });
  return { text: lines.join("\n"), removed: removedCities.length, removedCities };
}
