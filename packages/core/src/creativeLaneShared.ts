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
  /** Entries left off on purpose (not selected, or "leave out"). */
  omitted: { entryId: string; reason: "not_selected" | "leave_out" | "needs_choice" | "private_holder" }[];
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
      return "Credential";
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
    return commaJoin([{ text: venueOnlyLabel(e) }, { text: e.venue ?? "" }, { text: place }]);
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
      const row = commaJoin([{ text: e.title }, { text: e.venue ?? "" }, { text: place }]);
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
    if (trimmedHere) trimmedAny = true;
    if (rows.length) {
      sections.push({ key: sec.key, heading: trimmedHere ? `Selected ${sec.heading}` : sec.heading, rows });
    }
  }

  const contact = [settings.basedIn, settings.email, settings.phone, settings.website].filter((x): x is string => !!x);
  return {
    header: { name: settings.displayName ?? "", discipline: settings.discipline ?? "", contact },
    sections,
    needsChoice,
    omitted,
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
  const works = entries.filter((e) => e.section === "work" && titleModeFor(e, s) === "true_title");
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
