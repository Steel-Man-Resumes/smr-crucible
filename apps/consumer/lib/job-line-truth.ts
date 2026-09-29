/**
 * An employer's city comes from the person, not from where they live (2026-09-28).
 *
 * The resume format asks for "JOB TITLE | Company | City, State | Years", and
 * when the person gave no city for a job the model filled in their home town. A
 * sample resume put a stamping plant the person named without a city in their
 * current city.
 *
 * The check is deliberately narrow, because deleting a true city is the worse
 * mistake and resume layouts are too varied to read reliably (two reviews found
 * layout rules that deleted true cities). A city is taken off a job line only
 * when the person's words mention that city ONLY on their contact lines (email,
 * phone, street address, or the "City, ST" line in their header). Any other
 * mention anywhere, in any layout, keeps it. A city found nowhere in their
 * words, or a neighbor job's city borrowed, is left to the truth check. Lines
 * with fewer than four parts (contact lines) are not touched.
 */

const CITY_SEG = /^[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}$/;
const YEAR = /\b(19|20)\d\d\b/;
const SAME_TOWN = /\b(same (?:town|city)|home ?town|in town|right here|here in town|local(?:ly)?)\b/i;
const COMPANY_NOISE = new Set(["inc", "llc", "co", "corp", "corporation", "company", "ltd", "the", "of", "and"]);
const EMAIL = /\S+@\S+\.[a-z]{2,}/i;
const PHONE = /(?:\(\d{3}\)\s*|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/;
const STREET = /\b\d+\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9.]+(?:\s+[A-Za-z0-9.]+){0,2}\s+(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pl|place|pkwy|parkway|hwy|highway|cir|circle|ter|terrace|apt|unit)\b/i;

/** Lowercase words. Apostrophes inside a word join it ("McDonald's" is
 *  "mcdonalds"); hyphens split it, so "Dallas-Fort Worth" still names Dallas.
 *  `joined` also joins hyphens and periods, used only to find a company
 *  ("Wal-Mart" as "walmart", "A.O. Smith" as "ao smith"). */
function norm(s: string, joined = false): string {
  return ` ${s
    .toLowerCase()
    .replace(/\bst\.?\s/g, "saint ")
    .replace(/\bft\.?\s/g, "fort ")
    .replace(/\bmt\.?\s/g, "mount ")
    .replace(joined ? /(?<=[a-z0-9])['’.-](?=[a-z0-9])/g : /(?<=[a-z0-9])['’](?=[a-z0-9])/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function companyWords(company: string, joined: boolean): string[] {
  return norm(company, joined).trim().split(" ").filter((w) => w && !COMPANY_NOISE.has(w));
}

function namesCompany(line: string, company: string): boolean {
  const has = (text: string, ws: string[]) => ws.length > 0 && ws.every((w) => text.includes(` ${w} `));
  return has(norm(line), companyWords(company, false)) || has(norm(line, true), companyWords(company, true));
}

const SHORT = (l: string) => l.trim().split(/\s+/).length <= 15;

/** Indexes of the person's contact lines. The header is the first block of
 *  lines (up to a blank line or a date, at most six lines); when it holds an
 *  email, phone or street address, its short lines without a date are contact
 *  lines. Outside the header, only a short line with an email or phone counts:
 *  a long story line that happens to include a phone number is not a contact
 *  line, and neither is an employer's street address. */
function contactLines(lines: string[]): Set<number> {
  const out = new Set<number>();
  const header: number[] = [];
  for (let i = 0; i < lines.length && header.length < 6; i++) {
    if (!lines[i].trim()) { if (header.length) break; continue; }
    if (YEAR.test(lines[i])) break;
    header.push(i);
  }
  const hasContact = (l: string) => EMAIL.test(l) || PHONE.test(l) || STREET.test(l);
  if (header.some((i) => hasContact(lines[i]))) {
    for (const i of header) if (SHORT(lines[i]) && lines[i].length <= 200) out.add(i);
  }
  lines.forEach((l, i) => {
    if (SHORT(l) && (EMAIL.test(l) || PHONE.test(l))) out.add(i);
  });
  return out;
}

export function stripUnsupportedJobCities(
  resume: string,
  source: string
): { text: string; removed: number; removedCities: string[] } {
  const sourceLines = source.split("\n");
  const contact = contactLines(sourceLines);
  const removedCities: string[] = [];
  const lines = resume.split("\n").map((line) => {
    const segs = line.split(/\s+\|\s+/);
    if (segs.length < 4) return line; // a job line has title, company, place and years
    const company = segs[1].trim();
    const idx = segs.findIndex((seg, i) => i >= 2 && CITY_SEG.test(seg.trim()));
    if (idx < 0 || !company) return line;
    const city = norm(segs[idx].split(",")[0]);
    if (!city.trim()) return line;
    // Every line of the person's words that mentions this city.
    const mentions = sourceLines.map((l, i) => (norm(l).includes(city) ? i : -1)).filter((i) => i >= 0);
    // Found nowhere: nothing to judge by here. Found anywhere but a contact line
    // (or on a contact line that also names this employer): the person gave it.
    if (!mentions.length) return line;
    if (mentions.some((i) => !contact.has(i) || namesCompany(sourceLines[i], company))) return line;
    // "Jewel-Osco, same town": the person tied the job to where they live.
    if (sourceLines.some((l) => namesCompany(l, company) && SAME_TOWN.test(l))) return line;
    removedCities.push(`${company}: ${segs[idx].trim()}`);
    return segs.filter((_, i) => i !== idx).join(" | ");
  });
  return { text: lines.join("\n"), removed: removedCities.length, removedCities };
}
