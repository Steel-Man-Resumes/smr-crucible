/**
 * Creative lanes: the pure half shared by the routes, the screens and the
 * renderer. No db import.
 *
 * A creative lane holds a document set for one practice: an artist resume
 * (College Art Association order), a bio in three lengths, the person's own
 * statement, and a work-sample list. Every document is ASSEMBLED from the
 * practice record (practiceRecordShared), never written fresh, so each line
 * traces to an entry the person typed. The lane keeps choices only
 * (kind_settings): page cap, which entries to show, how a title that names a
 * facility shows, the bio's disclosure mode.
 *
 * Length (decision C1): an artist resume is 1 to 2 pages; up to 4 only when a
 * call allows it, which is a per-lane setting the person turns on.
 */

import {
  type PracticeEntry,
  type PracticeSection,
  type TitleMode,
  isTitleMode,
  cleanLine,
  yearsOf,
  placeOf,
} from "./practiceRecordShared";

// --------------------------------------------------------------- settings --

export const BIO_PRONOUNS = ["name", "they", "she", "he"] as const;
export type BioPronoun = (typeof BIO_PRONOUNS)[number];

/** Default artist resume cap, and the most a call can allow (C1). */
export const ARTIST_RESUME_DEFAULT_PAGES = 2;
export const ARTIST_RESUME_MAX_PAGES = 4;

export interface CreativeKindSettings {
  /** The name to print, as the person wants it. */
  displayName?: string;
  /** What they make, in their words ("Painter", "Poet and printmaker"). */
  discipline?: string;
  /** Where they are based, in their words ("Detroit, MI"). */
  basedIn?: string;
  email?: string;
  phone?: string;
  website?: string;
  /** The call in front of them allows up to 4 pages. Off by default. */
  callAllowsMore?: boolean;
  /** entry id -> how this lane shows an entry that names a facility. */
  titleModes?: Record<string, TitleMode>;
  /** null/absent: every entry. A list: only these ("Selected" headings). */
  selection?: string[] | null;
  bioPronoun?: BioPronoun;
  /** CV lanes: research or teaching interests, in the person's own words. */
  interests?: string;
  /** CV lanes: languages and skills, in the person's own words. */
  languages?: string;
  /** CV lanes: the reference the person chose to list first. */
  leadReference?: string;
  /** Revision of these settings; every save must be based on the current one. */
  rev?: number;
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Caps that keep the cleaned settings under the database's 16,000-byte check
 * (075): 150 selected ids and 120 title choices, about 12 KB at most.
 */
const MAX_SELECTION = 150;
const MAX_TITLE_MODES = 120;

function ids(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) if (typeof x === "string" && ID_RE.test(x) && !out.includes(x.toLowerCase())) out.push(x.toLowerCase());
  return out.slice(0, MAX_SELECTION);
}

function cleanTitleModes(tm: unknown): Record<string, TitleMode> {
  const modes: Record<string, TitleMode> = {};
  if (tm && typeof tm === "object" && !Array.isArray(tm)) {
    for (const [k, m] of Object.entries(tm as Record<string, unknown>).slice(0, MAX_TITLE_MODES)) {
      if (ID_RE.test(k) && isTitleMode(m)) modes[k.toLowerCase()] = m;
    }
  }
  return modes;
}

/**
 * Merge an input over the current settings and clean it. Unknown keys are
 * dropped; a bad value for a known key is dropped too (never guessed).
 *
 * Facility choices (titleModes) are NEVER taken from the input here: a whole
 * map sent by a tab loaded earlier could undo a newer "leave it off". They
 * change one entry at a time through applyTitleMode, under a revision check.
 * The revision (rev) is the stored one; the caller bumps it on save.
 */
export function cleanKindSettings(input: unknown, current?: unknown): CreativeKindSettings {
  const cur = (current && typeof current === "object" && !Array.isArray(current) ? current : {}) as Record<string, unknown>;
  const inp = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const v = (k: string) => (k in inp ? inp[k] : cur[k]);
  const out: CreativeKindSettings = {};
  const str = (k: keyof CreativeKindSettings, max: number) => {
    const s = cleanLine(v(k), max);
    if (s) (out as Record<string, unknown>)[k] = s;
  };
  str("displayName", 120);
  str("discipline", 120);
  str("basedIn", 120);
  str("email", 160);
  str("phone", 40);
  str("website", 200);
  str("interests", 600);
  str("languages", 300);
  const lr = v("leadReference");
  if (typeof lr === "string" && ID_RE.test(lr)) out.leadReference = lr.toLowerCase();
  if (v("callAllowsMore") === true) out.callAllowsMore = true;
  const modes = cleanTitleModes(cur.titleModes);
  if (Object.keys(modes).length) out.titleModes = modes;
  const sel = v("selection");
  if (Array.isArray(sel)) out.selection = ids(sel);
  const bp = v("bioPronoun");
  if (typeof bp === "string" && (BIO_PRONOUNS as readonly string[]).includes(bp)) out.bioPronoun = bp as BioPronoun;
  const rev = Number(cur.rev ?? 0);
  if (Number.isInteger(rev) && rev > 0) out.rev = rev;
  return out;
}

/** A lane's STORED settings, cleaned (facility choices and revision included). Use this to read; cleanKindSettings to merge an input. */
export function readKindSettings(stored: unknown): CreativeKindSettings {
  return cleanKindSettings({}, stored);
}

/** The settings revision (0 for none). */
export function settingsRev(s: { rev?: unknown } | null | undefined): number {
  const r = Number(s?.rev ?? 0);
  return Number.isInteger(r) && r >= 0 ? r : 0;
}

/** One facility choice for one entry, merged into the current settings. Null for a bad id or mode. */
export function applyTitleMode(current: unknown, entryId: unknown, mode: unknown): CreativeKindSettings | null {
  if (typeof entryId !== "string" || !ID_RE.test(entryId) || !isTitleMode(mode)) return null;
  const base = cleanKindSettings({}, current);
  const modes = { ...(base.titleModes ?? {}), [entryId.toLowerCase()]: mode };
  if (Object.keys(modes).length > MAX_TITLE_MODES) return null;
  return { ...base, titleModes: modes };
}

/** The page cap this lane allows: 2, or 4 when the person says a call allows it. */
export function artistResumePageCap(s: CreativeKindSettings | null | undefined): number {
  return s?.callAllowsMore ? ARTIST_RESUME_MAX_PAGES : ARTIST_RESUME_DEFAULT_PAGES;
}

/**
 * How this lane shows an entry. Entries that do not name a facility always
 * show their true title. One that does shows only as the person picked; until
 * they pick, it is left off and asked about (never shown softened).
 */
export function titleModeFor(entry: Pick<PracticeEntry, "id" | "names_facility">, s: CreativeKindSettings | null | undefined): TitleMode | "unset" {
  if (!entry.names_facility) return "true_title";
  return s?.titleModes?.[entry.id.toLowerCase()] ?? "unset";
}

/**
 * Lowercase words joined by single spaces, padded, so phrase checks match
 * whole words only. Case, punctuation, accents and apostrophes never matter
 * ("Riker's" and "RIKERS" are the same word).
 */
function wordsOf(text: string): string {
  const plain = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['`‘’ʼ]/g, "");
  return ` ${plain.replace(/[^a-z0-9]+/g, " ").trim()} `;
}

const RUN_STOPWORDS = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
/**
 * Words that say what KIND of place a facility is, not WHICH one (review s2r2
 * N-H1). Directions and numbers count as generic too. Every other word of a
 * hidden name is distinctive: "San Quentin State Prison" leaves "san" and
 * "quentin".
 */
export const FACILITY_GENERIC_WORDS: ReadonlySet<string> = new Set([
  "state", "county", "federal", "city", "department",
  "correctional", "correction", "corrections", "prison", "prisons", "jail", "jails", "penitentiary", "penitentiaries",
  "facility", "facilities", "institution", "institutions", "center", "centers", "centre", "centres",
  "detention", "unit", "units", "camp", "camps", "complex",
  "north", "south", "east", "west", "northern", "southern", "eastern", "western",
  "northeast", "northwest", "southeast", "southwest", "central",
]);
/** A word that names a kind of facility: a title carrying one is treated like a place name. */
const FACILITY_KIND_WORDS = new Set(["correctional", "correction", "corrections", "prison", "prisons", "jail", "jails", "penitentiary", "penitentiaries", "facility", "facilities", "institution", "institutions", "detention"]);
const isNumberWord = (w: string) => /^\d+(?:st|nd|rd|th)?$/.test(w) || /^(?=[ivx]+$)x{0,3}(?:ix|iv|v?i{0,3})$/.test(w);
const isRealWord = (w: string) => !RUN_STOPWORDS.has(w) && !isNumberWord(w);

/** Every run of 2+ words inside a hidden name (at least two real words, not "of the"), so part of a name still counts. */
function wordRuns(term: string): string[] {
  const w = wordsOf(term).trim().split(" ").filter(Boolean);
  const out: string[] = [];
  for (let len = 2; len < w.length; len++) {
    for (let i = 0; i + len <= w.length; i++) {
      const run = w.slice(i, i + len);
      if (run.filter(isRealWord).length >= 2) out.push(run.join(" "));
    }
  }
  return out;
}

/** The words of a name that pick out WHICH place it is: not generic, not a number, not "of", three letters or more. */
export function distinctiveWords(term: string): string[] {
  return Array.from(new Set(wordsOf(term).trim().split(" ").filter((w) => w.length >= 3 && isRealWord(w) && !FACILITY_GENERIC_WORDS.has(w))));
}

/**
 * The pieces of a title that name a facility: "Theater program, Example State
 * Prison" gives "Example State Prison"; "Shakespeare at San Quentin State
 * Prison" gives "San Quentin State Prison". The rest of the title is the
 * work, not the place, so its single words stay free to use.
 */
function facilityParts(title: string): string[] {
  return title
    .split(/[,;:()[\]|/\u2013\u2014]+|\s-\s|\s(?:at|in|inside)\s/i)
    .filter((p) => wordsOf(p).trim().split(" ").some((w) => FACILITY_KIND_WORDS.has(w)));
}

/**
 * The text of a row to check against hidden names: everything that comes
 * from the record. A venue-only row's leading kind word ("Arts program",
 * "Teaching") is the page's own label, never the person's text.
 */
export function rowCheckText(r: { parts: Part[]; mode: "true_title" | "venue_only" }): string {
  return rowText(r.mode === "venue_only" ? r.parts.slice(1) : r.parts);
}

/** The ids of the entries a built page prints (its rows), for hiddenFacilityTerms. */
export function shownEntryIds(model: { sections: { rows?: { entryId: string }[] }[] }): string[] {
  return model.sections.flatMap((s) => (s.rows ?? []).map((r) => r.entryId));
}

/**
 * The facility text a sentence may not carry on this lane: the title of each
 * facility-named entry not shown with its true title, and the venue of each
 * one left off (or not yet chosen). Lowercased. Each also counts in part
 * (review s2r2 N-H1): any run of two or more of its real words, and any single
 * distinctive word of a venue (or of a title or earlier name that itself
 * names a kind of facility). A part does not count when it is already on the
 * page through an entry this page prints with its true title.
 *
 * `shownIds` are the entries THIS page prints (review s2r2 N-M1): an entry
 * that is not on the page (a reference without an OK, an exhibition on a CV,
 * a row held for a status) never makes a hidden name public. Without it, the
 * lane's shown entries are used (picked, confirmed, true title).
 */
export function hiddenFacilityTerms(
  entries: PracticeEntry[],
  s: CreativeKindSettings | null | undefined,
  shownIds?: Iterable<string> | null
): string[] {
  const out: string[] = [];
  const picked = Array.isArray(s?.selection) ? new Set(s!.selection!.map((x) => x.toLowerCase())) : null;
  const onPage = shownIds ? new Set(Array.from(shownIds, (x) => x.toLowerCase())) : null;
  // On this page: only an entry the page prints (or, without shownIds, the
  // lane's picked and confirmed entries).
  const printed = (e: PracticeEntry) =>
    onPage ? onPage.has(e.id.toLowerCase()) : (!picked || picked.has(e.id.toLowerCase())) && (e.names_facility || e.proof !== "need_to_find");
  // A hidden VENUE is public only through an entry on this page shown with its
  // TRUE title (review s2r2 N-M1); a venue-only line or a held entry never
  // makes it public.
  const shown = entries.filter((e) => titleModeFor(e, s) === "true_title" && printed(e));
  const shownVenues = new Set(shown.filter((e) => e.venue).map((e) => wordsOf(e.venue as string)));
  // Words already on this page (so a PART of a hidden name found here is no
  // secret): true titles and venues of shown entries, and the venue a
  // venue-only line prints (its own hidden title never holds it).
  const venueOnly = entries.filter((e) => titleModeFor(e, s) === "venue_only" && printed(e));
  const publicText = [...shown.map((e) => `${wordsOf(e.title)}|${wordsOf(e.venue ?? "")}`), ...venueOnly.map((e) => wordsOf(e.venue ?? ""))].join("|");
  const full: string[] = [];
  /** Names whose single distinctive words count too. */
  const placeNames: string[] = [];
  for (const e of entries) {
    if (!e.names_facility) continue;
    const mode = titleModeFor(e, s);
    if (mode !== "true_title" && e.title.trim().length >= 4) {
      full.push(e.title.toLowerCase());
      placeNames.push(...facilityParts(e.title));
    }
    const venue = e.venue?.toLowerCase();
    if ((mode === "leave_out" || mode === "unset") && venue && venue.trim().length >= 4 && !shownVenues.has(wordsOf(venue))) {
      full.push(venue);
      placeNames.push(venue);
    }
    // Earlier names of the entry are never shown on a lane that keeps it off.
    if (mode !== "true_title") {
      for (const f of e.details.formerNames ?? []) {
        if (f.trim().length >= 4) {
          full.push(f.toLowerCase());
          // An earlier venue ("San Quentin") counts whole; an earlier title only where it names the facility.
          const parts = facilityParts(f);
          placeNames.push(...(parts.length ? parts : [f]));
        }
      }
    }
  }
  for (const t of full) if (!out.includes(t)) out.push(t);
  const add = (part: string) => {
    if (!publicText.includes(` ${part} `) && !out.includes(part)) out.push(part);
  };
  for (const t of full) for (const r of wordRuns(t)) add(r);
  for (const t of placeNames) for (const w of distinctiveWords(t)) add(w);
  return out;
}

/**
 * The hidden term a text names (whole words; case, punctuation and
 * apostrophes ignored), or null. A possessive reads both ways: "Riker's"
 * matches "Rikers", and "Stateville's" matches "Stateville".
 */
export function namesHiddenFacility(text: string, terms: string[]): string | null {
  const t = wordsOf(text);
  const bare = wordsOf(text.replace(/['\u2019\u02bc]s\b/gi, ""));
  return terms.find((x) => {
    const w = wordsOf(x);
    return w.trim() !== "" && (t.includes(w) || bare.includes(w));
  }) ?? null;
}


/**
 * How an education entry's title prints (review s2r2 N-M3). Study the person
 * marked as classes without a degree reads "Coursework toward <degree>" or
 * "Coursework in <field>", never as the degree itself. A title that already
 * says so ("Coursework toward an Associate of Arts") prints as typed.
 */
export function studyTitle(e: Pick<PracticeEntry, "section" | "title" | "details">): string {
  const kind = e.section === "education" ? e.details.study : undefined;
  if (!kind || /^\s*(?:course ?work|classes|credits?|non-?degree)\b/i.test(e.title)) return e.title;
  return kind === "toward_degree" ? `Coursework toward ${e.title}` : `Coursework in ${e.title}`;
}

/** The credential kind and status words (D4), shared by every page that prints a credential. */
export const CREDENTIAL_KIND_WORD: Record<string, string> = {
  license: "License", certification: "Certification", certificate: "Certificate", card: "Card", training: "Training",
};
export const CREDENTIAL_STATUS_WORD: Record<string, string> = {
  active: "Active", inactive: "Inactive", expired: "Expired", in_progress: "In progress", eligible: "Eligible to test",
};

/**
 * The status words an entry carries on EVERY rendering, title shown or not:
 * a publication's graded status, study in progress, a credential's status.
 * A venue-only line must never read as more than the true one.
 */
export function statusPart(e: PracticeEntry): Part | null {
  const d = e.details;
  if (e.section === "publication") {
    const w = publicationStatusWords(e);
    return w ? { text: `(${w})` } : null;
  }
  if (e.section === "education" && d.status === "in_progress") return { text: `(${d.expected ? `in progress, expected ${d.expected}` : "in progress"})` };
  if (e.section === "arts_program" && d.status === "in_progress") return { text: "(in progress)" };
  if (e.section === "license" && d.credentialStatus) return { text: `(${CREDENTIAL_STATUS_WORD[d.credentialStatus] ?? d.credentialStatus})` };
  return null;
}

// ------------------------------------------------------ artist resume model --

/** A run of text on a row. Italic for titles of works and shows (CAA). */
export interface Part {
  text: string;
  italic?: boolean;
  /** Punctuation drawn right after the text, never italic (the comma after a title). */
  after?: string;
}

export interface ArtistRow {
  entryId: string;
  /** "2019" or "2019-2021", printed at the left. */
  years: string;
  parts: Part[];
  /** "true_title" or "venue_only": how the row was built (for the checks). */
  mode: "true_title" | "venue_only";
}

export interface ArtistSection {
  key: string;
  heading: string;
  rows: ArtistRow[];
}

export interface ArtistResumeModel {
  header: { name: string; discipline: string; contact: string[] };
  sections: ArtistSection[];
  /** Entries a lane setting asks about before they can show (R03). */
  needsChoice: string[];
  /** Entries left off on purpose (not selected, "leave out", or naming something this lane hides). */
  omitted: { entryId: string; reason: "not_selected" | "leave_out" | "needs_choice" | "private_holder" | "names_hidden" }[];
  /** Typed top-of-page fields kept off because they name something this lane hides. */
  heldFields: string[];
  /** True when the person trimmed with a selection ("Selected" headings). */
  trimmed: boolean;
}

/** The CAA order of sections, and which record entries feed each. */
export const ARTIST_SECTIONS: { key: string; heading: string; take: (e: PracticeEntry) => boolean }[] = [
  { key: "education", heading: "Education and Training", take: (e) => e.section === "education" || e.section === "arts_program" },
  { key: "solo", heading: "Solo Exhibitions", take: (e) => e.section === "exhibition" && e.details.kind === "solo" },
  { key: "two_person", heading: "Two-Person Exhibitions", take: (e) => e.section === "exhibition" && e.details.kind === "two_person" },
  { key: "group", heading: "Group Exhibitions", take: (e) => e.section === "exhibition" && e.details.kind === "group" },
  { key: "performance", heading: "Performances, Screenings and Readings", take: (e) => e.section === "performance" },
  { key: "commission", heading: "Commissions", take: (e) => e.section === "commission" },
  { key: "award", heading: "Awards, Grants and Fellowships", take: (e) => e.section === "award" },
  { key: "residency", heading: "Residencies", take: (e) => e.section === "residency" },
  { key: "publication", heading: "Publications", take: (e) => e.section === "publication" },
  { key: "press", heading: "Bibliography", take: (e) => e.section === "press" },
  { key: "teaching", heading: "Teaching", take: (e) => e.section === "teaching" },
  { key: "collection", heading: "Collections", take: (e) => e.section === "collection" },
];

/** The plain kind word a venue-only line leads with. Never names the show. */
export function venueOnlyLabel(e: PracticeEntry): string {
  switch (e.section) {
    case "exhibition":
      return e.details.kind === "solo" ? "Solo exhibition" : e.details.kind === "two_person" ? "Two-person exhibition" : "Group exhibition";
    case "performance":
      return e.details.kind === "screening" ? "Screening" : e.details.kind === "reading" ? "Reading" : "Performance";
    case "residency":
      return "Residency";
    case "commission":
      return "Commission";
    case "publication":
      return "Publication";
    case "press":
      return "Press";
    case "collection":
      return "Work in a collection";
    case "teaching":
      return "Teaching";
    case "arts_program":
      return "Arts program";
    case "award":
      return e.details.kind === "grant" ? "Grant" : e.details.kind === "fellowship" ? "Fellowship" : "Award";
    case "education":
      return "Study";
    case "work":
      return "Work";
    case "appointment":
      return "Position";
    case "research":
      return "Research";
    case "presentation":
      return "Presentation";
    case "clinical":
      return "Clinical placement";
    case "license":
      return CREDENTIAL_KIND_WORD[e.details.credentialKind ?? ""] ?? "Credential";
    case "service":
      return "Service";
    case "membership":
      return "Membership";
    case "reference":
      return "Reference";
  }
}

/** The status words a publication shows. Graded, never upgraded (CR-05). */
export function publicationStatusWords(e: PracticeEntry): string {
  switch (e.details.status) {
    case "in_press":
      return "in press";
    case "accepted":
      return "accepted";
    case "submitted":
      return e.details.submittedWhen ? `submitted ${e.details.submittedWhen}` : "submitted";
    default:
      return "";
  }
}

function commaJoin(parts: Part[]): Part[] {
  const out: Part[] = [];
  parts
    .filter((p) => p.text && p.text.trim())
    .forEach((p, i, arr) => {
      if (i === arr.length - 1) out.push({ ...p });
      // A quoted title takes its comma inside the quotes ("Two Poems," Review).
      else if (/^".*"$/.test(p.text)) out.push({ ...p, text: `${p.text.slice(0, -1)},"` });
      else out.push({ ...p, after: "," });
    });
  return out;
}

/** One entry as a row of the artist resume, exactly from the record. */
export function artistRowParts(e: PracticeEntry, mode: "true_title" | "venue_only"): Part[] {
  const place = placeOf(e);
  if (mode === "venue_only") {
    // The kind and the venue, never the title; the status words stay (H1).
    const row = commaJoin([{ text: venueOnlyLabel(e) }, { text: e.venue ?? "" }, { text: place }]);
    const st = statusPart(e);
    if (st) row.push(st);
    return row;
  }
  const d = e.details;
  switch (e.section) {
    case "exhibition": {
      const flags = [d.juried ? "juried" : "", d.invitational ? "invitational" : "", d.curator ? `curated by ${d.curator}` : ""].filter(Boolean).join(", ");
      const row = commaJoin([{ text: e.title, italic: true }, { text: e.venue ?? "" }, { text: place }]);
      if (flags) row.push({ text: `(${flags})` });
      return row;
    }
    case "performance": {
      const row = commaJoin([{ text: e.title, italic: true }, { text: d.role ?? "" }, { text: e.venue ?? "" }, { text: place }]);
      if (d.touring) row.push({ text: "(touring)" });
      return row;
    }
    case "commission":
      return commaJoin([
        { text: e.title, italic: true },
        { text: d.consent && e.venue ? `commissioned by ${e.venue}` : "private commission" },
        { text: place },
      ]);
    case "publication": {
      const status = publicationStatusWords(e);
      const row = commaJoin([{ text: `"${e.title}"` }, { text: e.venue ?? "", italic: true }]);
      if (status) row.push({ text: `(${status})` });
      return row;
    }
    case "press":
      return commaJoin([{ text: d.author ?? "" }, { text: `"${e.title}"` }, { text: e.venue ?? "", italic: true }, { text: d.date ?? "" }]);
    case "collection":
      return commaJoin([
        { text: d.holder === "private" && !d.consent ? "Private collection" : e.venue ?? "" },
        { text: d.holder === "private" && !d.consent ? "" : place },
      ]);
    case "teaching":
      return commaJoin([{ text: e.title }, { text: e.venue ?? "" }, { text: place }, { text: d.level ?? "" }]);
    case "education": {
      const status = d.status === "in_progress" ? (d.expected ? `in progress, expected ${d.expected}` : "in progress") : "";
      const row = commaJoin([{ text: studyTitle(e) }, { text: e.venue ?? "" }, { text: place }]);
      if (status) row.push({ text: `(${status})` });
      return row;
    }
    case "arts_program": {
      const status = d.status === "in_progress" ? "in progress" : "";
      const row = commaJoin([{ text: e.title }, { text: e.venue ?? "" }, { text: place }, { text: d.role ?? "" }]);
      if (status) row.push({ text: `(${status})` });
      return row;
    }
    case "work":
      return commaJoin([{ text: e.title, italic: true }, { text: d.medium ?? "" }]);
    default:
      return commaJoin([{ text: e.title }, { text: e.venue ?? "" }, { text: place }]);
  }
}

export function rowText(parts: Part[]): string {
  return parts.map((p) => p.text + (p.after ?? "")).join(" ");
}

function sortNewestFirst(a: PracticeEntry, b: PracticeEntry): number {
  const ea = a.end_year ?? a.year;
  const eb = b.end_year ?? b.year;
  return eb - ea || b.year - a.year || a.title.localeCompare(b.title);
}

/**
 * The artist resume, assembled from the record. Reverse chronological inside
 * every section, years at the left, empty sections never shown, public
 * collections before private ones (and a private holder named only with
 * their OK).
 */
export function buildArtistResumeModel(entries: PracticeEntry[], s: CreativeKindSettings | null | undefined): ArtistResumeModel {
  const settings = s ?? {};
  const selection = Array.isArray(settings.selection) ? new Set(settings.selection.map((x) => x.toLowerCase())) : null;
  const omitted: ArtistResumeModel["omitted"] = [];
  const needsChoice: string[] = [];
  const sections: ArtistSection[] = [];
  let trimmedAny = false;
  // First pass: the rows this page would print. Only those can make a hidden
  // name public (review s2r2 N-M1); then every row and typed field is checked.
  const pending: { sec: (typeof ARTIST_SECTIONS)[number]; rows: ArtistRow[]; trimmedHere: boolean }[] = [];

  for (const sec of ARTIST_SECTIONS) {
    const all = entries.filter(sec.take).sort(sortNewestFirst);
    if (sec.key === "collection") all.sort((a, b) => (a.details.holder === "private" ? 1 : 0) - (b.details.holder === "private" ? 1 : 0));
    const rows: ArtistRow[] = [];
    let trimmedHere = false;
    for (const e of all) {
      if (selection && !selection.has(e.id.toLowerCase())) {
        omitted.push({ entryId: e.id, reason: "not_selected" });
        trimmedHere = true;
        continue;
      }
      const mode = titleModeFor(e, settings);
      if (mode === "unset") {
        needsChoice.push(e.id);
        omitted.push({ entryId: e.id, reason: "needs_choice" });
        continue;
      }
      if (mode === "leave_out") {
        omitted.push({ entryId: e.id, reason: "leave_out" });
        continue;
      }
      rows.push({ entryId: e.id, years: yearsOf(e), parts: artistRowParts(e, mode), mode });
    }
    pending.push({ sec, rows, trimmedHere });
  }

  const hidden = hiddenFacilityTerms(entries, settings, pending.flatMap((p) => p.rows.map((r) => r.entryId)));
  const heldFields: string[] = [];
  const keep = (field: keyof CreativeKindSettings): string | undefined => {
    const t = settings[field] as string | undefined;
    if (t && namesHiddenFacility(t, hidden)) return void heldFields.push(field);
    return t;
  };
  for (const { sec, rows: all, trimmedHere } of pending) {
    const rows = all.filter((r) => {
      if (!namesHiddenFacility(rowCheckText(r), hidden)) return true;
      omitted.push({ entryId: r.entryId, reason: "names_hidden" });
      return false;
    });
    if (trimmedHere) trimmedAny = true;
    if (rows.length) {
      sections.push({ key: sec.key, heading: trimmedHere ? `Selected ${sec.heading}` : sec.heading, rows });
    }
  }

  const contact = (["basedIn", "email", "phone", "website"] as const).map(keep).filter((x): x is string => !!x);
  return {
    header: { name: keep("displayName") ?? "", discipline: keep("discipline") ?? "", contact },
    sections,
    needsChoice,
    omitted,
    heldFields,
    trimmed: trimmedAny,
  };
}

/** The artist resume as plain text, for portal fields (years, a tab-free space, the row). */
export function artistResumePlainText(m: ArtistResumeModel): string {
  const lines: string[] = [];
  if (m.header.name) lines.push(m.header.name);
  if (m.header.discipline) lines.push(m.header.discipline);
  if (m.header.contact.length) lines.push(m.header.contact.join(" | "));
  for (const s of m.sections) {
    lines.push("", s.heading.toUpperCase());
    for (const r of s.rows) lines.push(`${r.years}  ${rowText(r.parts)}`);
  }
  return lines.join("\n").trim();
}

// ------------------------------------------------------------ work samples --

export interface WorkSampleRow {
  entryId: string;
  number: number;
  title: string;
  year: string;
  medium: string;
  /** Dimensions or duration, as the person gave it. */
  size: string;
  /** One line in the person's own words. Never generated. */
  description: string;
  fileName: string;
}

/**
 * The work-sample list: the person's works in the order they set (strongest
 * first). Works not in the order follow, newest first. Every field is copied
 * from the record as typed.
 */
export function buildWorkSampleList(
  entries: PracticeEntry[],
  order: string[] | null | undefined,
  s?: CreativeKindSettings | null
): WorkSampleRow[] {
  // The lane's choice decides, as for every document. A work has no venue, so
  // "venue only" keeps it off this list just like "leave it off"; a work with
  // no choice yet stays off and is asked about.
  const hidden = hiddenFacilityTerms(entries, s);
  const works = entries.filter(
    (e) =>
      e.section === "work" &&
      titleModeFor(e, s) === "true_title" &&
      !namesHiddenFacility([e.title, e.details.medium, e.details.description, e.details.fileName].filter(Boolean).join(" "), hidden)
  );
  const byId = new Map(works.map((w) => [w.id.toLowerCase(), w]));
  const ordered: PracticeEntry[] = [];
  for (const id of order ?? []) {
    const w = byId.get(id.toLowerCase());
    if (w && !ordered.includes(w)) ordered.push(w);
  }
  for (const w of [...works].sort(sortNewestFirst)) if (!ordered.includes(w)) ordered.push(w);
  return ordered.map((w, i) => ({
    entryId: w.id,
    number: i + 1,
    title: w.title,
    year: yearsOf(w),
    medium: w.details.medium ?? "",
    size: w.details.dimensions ?? w.details.duration ?? "",
    description: w.details.description ?? "",
    fileName: w.details.fileName ?? "",
  }));
}

export function workSampleListPlainText(rows: WorkSampleRow[]): string {
  return rows
    .map((r) => [`${r.number}. ${r.title}, ${r.year}`, [r.medium, r.size].filter(Boolean).join(", "), r.description, r.fileName ? `File: ${r.fileName}` : ""].filter(Boolean).join("\n"))
    .join("\n\n");
}

function csvCell(s: string): string {
  // Keep spreadsheet formulas inert: a leading = + - @ is quoted with a '.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function workSampleListCsv(rows: WorkSampleRow[]): string {
  const head = ["Number", "Title", "Year", "Medium", "Size or length", "Description", "File name"];
  return [head, ...rows.map((r) => [String(r.number), r.title, r.year, r.medium, r.size, r.description, r.fileName])]
    .map((r) => r.map(csvCell).join(","))
    .join("\r\n");
}

// ---------------------------------------------------------- counts, export --

/** Characters as portals count them: every character, spaces and line breaks included. */
export function countChars(text: string): number {
  return Array.from(text ?? "").length;
}

export function countWords(text: string): number {
  return (text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

export interface PlainTextDoc {
  key: "artist_resume" | "bio_short" | "bio_medium" | "bio_long" | "statement" | "work_samples";
  label: string;
  text: string;
  chars: number;
  words: number;
}

export function plainTextDoc(key: PlainTextDoc["key"], label: string, text: string): PlainTextDoc {
  return { key, label, text, chars: countChars(text), words: countWords(text) };
}

/** How many entries shown on a page are still marked "need to find" proof (a note by the downloads; never a BLOCK). */
export function stillNeedsProof(entries: PracticeEntry[], shownIds: string[]): number {
  const shown = new Set(shownIds.map((x) => x.toLowerCase()));
  return entries.filter((e) => e.proof === "need_to_find" && shown.has(e.id.toLowerCase())).length;
}

export const NEEDS_PROOF_NOTE = "Some entries still need proof. You can download now; keep the proof handy.";
