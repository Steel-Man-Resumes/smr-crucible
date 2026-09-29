/**
 * An employer's city comes from the person, not from where they live (2026-09-28).
 *
 * The resume format asks for "JOB TITLE | Company | City, State | Years", and
 * when the person gave no city for a job the model filled in their home town. A
 * sample resume put a stamping plant the person named without a city in their
 * current city.
 *
 * The check is deliberately narrow (2026-09-29, after three reviews and a
 * labeled test set): a city is taken off a job line only when the person's own
 * words mention that city ONLY as where they live: their contact details (the
 * header, a signature block at the end, labeled fields like "City:"), or a
 * story phrase like "I live in Springfield now". Any other mention, in any
 * layout, keeps it. A city found nowhere in their words, or a neighbor job's
 * city, is left to the truth check. What is taken out is listed on the page.
 * Lines with fewer than four parts (contact lines) are not touched.
 */

const CITY_SEG = /^[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}$/;
const YEAR = /\b(19|20)\d\d\b/;
const COMPANY_NOISE = new Set(["inc", "llc", "co", "corp", "corporation", "company", "ltd", "the", "of", "and"]);
// Bounded pieces, so a long run of "@" or letters cannot make it slow.
const EMAIL = /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){0,4}\.[a-z]{2,10}\b/i;
const PHONE = /(?:\(\d{3}\)\s*|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/;
const STREET =
  /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?!(?:years?|yrs?|months?|miles?|hours?|hrs?|days?|weeks?|times?|stops?|loads?|trucks?|people|men|women|rooms?)\b)[A-Za-z0-9.]+(?:\s+[A-Za-z0-9.]+){0,2}\s+(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pl|place|pkwy|parkway|hwy|highway|cir|circle|ter|terrace)\b\.?(?=\s*(?:$|[,#|]|apt\b|unit\b|ste\b|suite\b|[A-Z]))/i;
const ZIP_PLACE = /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b|,\s*[A-Z][a-z]+\s+\d{5}\b/;
const PLACE_ONLY = /^\s*[A-Za-z][A-Za-z .'-]{1,40},?\s+(?:[A-Z]{2}|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)(?:\s+\d{5}(?:-\d{4})?)?\s*$/;
const LABELED = /^\s*(?:name|address|street|city|state|zip|location|home|hometown|lives? in|phone|cell|mobile|email|e-mail|contact)\s*:/i;
const LABELED_PLACE = /^\s*(?:address|city|location|home|hometown|lives? in)\s*:/i;
const PHONE_WORDS = /\b(?:phone|cell|mobile|call|text|number|reach me|contact me)\b/i;
// "I live in Springfield now", "moved to Lawton", "paroled to Houston".
const RESIDENCE_BEFORE = /\b(?:live|lives|living|stay|stays|staying|moved|move|reside|resides|residing|paroled|released|home is|based)\s+(?:now\s+)?(?:in|to|out of)\s+(?:the\s+)?$/i;
const SAME_TOWN = /\b(same (?:town|city)|home ?town|my (?:town|city)|our town|in town|right here|where i (?:live|stay)|local(?:ly)?)\b/i;

/** Lowercase words for finding a place. A possessive 's is dropped
 *  ("Chicago's O'Hare" names Chicago) and other apostrophes and hyphens split
 *  words, so "Dallas-Fort Worth" still names Dallas. St./Ft./Mt. read as Saint,
 *  Fort, Mount, and a few everyday short names read as the city ("Vegas", "KC"). */
function placeNorm(s: string): string {
  return ` ${s
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/\bst\.?\s/g, "saint ")
    .replace(/\bft\.?\s/g, "fort ")
    .replace(/\bmt\.?\s/g, "mount ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/(?<!\blas )\bvegas\b/g, "las vegas")
    .replace(/\bphilly\b/g, "philadelphia")
    .replace(/\bkc\b/g, "kansas city")
    .replace(/\bnyc\b/g, "new york")
    .replace(/\bmpls\b/g, "minneapolis")
    .replace(/\bstl\b/g, "saint louis")
    .replace(/\bnola\b/g, "new orleans")
    .trim()} `;
}

/** Company words, in the forms people write a name: "McDonald's", "McDonalds",
 *  "Wal-Mart", "Walmart", "Harbor St. Grill" for "Harbor Street Grill". */
function companyForms(s: string): string[] {
  const base = s
    .toLowerCase()
    .replace(/\b(?:street|saint|st)\b\.?/g, "st")
    .replace(/\b(?:avenue|ave)\b\.?/g, "ave")
    .replace(/\b(?:road|rd)\b\.?/g, "rd")
    .replace(/\b(?:mount|mt)\b\.?/g, "mt")
    .replace(/\b(?:fort|ft)\b\.?/g, "ft");
  const split = base.replace(/['’]s\b/g, "").replace(/[^a-z0-9]+/g, " ");
  const joined = base.replace(/(?<=[a-z0-9])['’.-](?=[a-z0-9])/g, "").replace(/[^a-z0-9]+/g, " ");
  return [` ${split.trim()} `, ` ${joined.trim()} `];
}

function companyWords(company: string): string[][] {
  return companyForms(company).map((f) => f.trim().split(" ").filter((w) => w && !COMPANY_NOISE.has(w)));
}

function namesCompany(lineForms: string[], words: string[][]): boolean {
  return words.some((ws) => ws.length > 0 && lineForms.some((f) => ws.every((w) => f.includes(` ${w} `))));
}

function contactish(l: string): boolean {
  return EMAIL.test(l) || PHONE.test(l) || STREET.test(l) || ZIP_PLACE.test(l) || PLACE_ONLY.test(l) || LABELED.test(l);
}

/** Which lines hold the person's own contact details:
 *  - the header: the first line (their name) and the lines right under it while
 *    each one looks like contact details, when the header has an email, phone,
 *    street address or a labeled place ("City: Macon");
 *  - a signature block at the end (the last block of at most six lines) with an
 *    email or phone, the same way;
 *  - elsewhere, a short line with an email, or a short labeled phone line
 *    ("Phone: 414-555-0182"), but not an employer's address line. */
function contactLines(lines: string[]): Set<number> {
  const out = new Set<number>();
  const short = (l: string) => l.length <= 200 && l.trim().split(/\s+/).length <= 15;
  const signal = (l: string) => EMAIL.test(l) || PHONE.test(l) || STREET.test(l) || LABELED_PLACE.test(l);
  const takeBlock = (idx: number[]) => {
    if (idx.some((i) => signal(lines[i]))) for (const i of idx) if (short(lines[i]) && !YEAR.test(lines[i])) out.add(i);
  };
  // Header: first line, then contact-looking lines until something else.
  const header: number[] = [];
  for (let i = 0; i < lines.length && header.length < 8; i++) {
    const l = lines[i];
    if (!l.trim()) { if (header.length) break; continue; }
    if (header.length && !contactish(l)) break;
    header.push(i);
  }
  takeBlock(header);
  // Signature block at the end.
  const tail: number[] = [];
  for (let i = lines.length - 1; i >= 0 && tail.length <= 6; i--) {
    if (!lines[i].trim()) { if (tail.length) break; continue; }
    tail.unshift(i);
  }
  // A job block at the end (dates, bullets) is not a signature.
  const jobLike = tail.some((i) => YEAR.test(lines[i]) || /^\s*[-\u2022*\u00b7]/.test(lines[i]));
  if (tail.length <= 6 && !jobLike && tail.some((i) => EMAIL.test(lines[i]) || PHONE.test(lines[i]))) {
    for (const i of tail) if (short(lines[i]) && !YEAR.test(lines[i]) && (contactish(lines[i]) || i === tail[0])) out.add(i);
  }
  lines.forEach((l, i) => {
    if (!short(l) || STREET.test(l)) return;
    if (EMAIL.test(l) || (PHONE.test(l) && (PHONE_WORDS.test(l) || LABELED.test(l)))) out.add(i);
  });
  return out;
}

/** Every mention of the city on this line is "where I live" ("I live in X now"). */
function onlyResidence(rawLine: string, city: string): boolean {
  const words = city.trim().split(" ");
  const norm = placeNorm(rawLine);
  let at = norm.indexOf(city);
  if (at < 0) return false;
  while (at >= 0) {
    // Map back roughly by words: the words before this mention in the normalized line.
    const before = norm.slice(0, at).trim();
    if (!RESIDENCE_BEFORE.test(before + " ")) return false;
    at = norm.indexOf(city, at + words.join(" ").length);
  }
  return true;
}

export function stripUnsupportedJobCities(
  resume: string,
  source: string
): { text: string; removed: number; removedCities: string[] } {
  const sourceLines = source.split("\n");
  const contact = contactLines(sourceLines);
  const placeLines = sourceLines.map(placeNorm);
  const formLines = sourceLines.map(companyForms);
  const removedCities: string[] = [];
  const lines = resume.split("\n").map((line) => {
    const segs = line.split(/\s+\|\s+/);
    if (segs.length < 4) return line; // a job line has title, company, place and years
    const company = segs[1].trim();
    const idx = segs.findIndex((seg, i) => i >= 2 && CITY_SEG.test(seg.trim()));
    if (idx < 0 || !company) return line;
    const city = placeNorm(segs[idx].split(",")[0]);
    if (!city.trim()) return line;
    const words = companyWords(company);
    // Every line of the person's words that mentions this city.
    const mentions = placeLines.map((l, i) => (l.includes(city) ? i : -1)).filter((i) => i >= 0);
    // Found nowhere: nothing to judge by here.
    if (!mentions.length) return line;
    // Found anywhere but where they live, or on a line that also names this
    // employer: the person gave it.
    const givenForJob = mentions.some(
      (i) => namesCompany(formLines[i], words) || (!contact.has(i) && !onlyResidence(sourceLines[i], city))
    );
    if (givenForJob) return line;
    // "Jewel-Osco, same town": the person tied the job to where they live.
    if (sourceLines.some((l, i) => namesCompany(formLines[i], words) && SAME_TOWN.test(l))) return line;
    removedCities.push(`${company}: ${segs[idx].trim()}`);
    return segs.filter((_, i) => i !== idx).join(" | ");
  });
  return { text: lines.join("\n"), removed: removedCities.length, removedCities };
}
