/**
 * Performer lanes (078): the pure half shared by the routes, the screens and
 * the renderer. No db import.
 *
 * One page, always (decision C1), on 8x10 (for the back of a headshot) and US
 * Letter. In industry order: name and discipline line, union status exactly
 * as held, the description the person gives (height, hair, eyes, voice, an age
 * RANGE, never an age), contact or agent; then credits by medium in three
 * columns (production | role or billing as credited | company, place,
 * director), training (always dated), awards, and special skills the person
 * says they can do on request today.
 *
 * Years (decision C2): every credit has a year in the record and every check
 * reads it; the page hides credit years unless the person turns them on.
 *
 * Every line is ASSEMBLED from the practice record and the lane's typed
 * top-of-page lines. Nothing is written by a model. A headshot is never made,
 * picked or changed here, and stays off the page.
 */

import {
  type PracticeEntry,
  type PracticeSection,
  CREDIT_MEDIA,
  placeOf,
  yearsOf,
} from "./practiceRecordShared";
import {
  type ArtistRow,
  type CreativeKindSettings,
  type FacilityAsk,
  type FacilityFieldKind,
  type FacilityHit,
  type HiddenTerms,
  type Part,
  CREDIT_MEDIUM_WORD,
  artistRowParts,
  facilityCheck,
  hiddenFacilityTerms,
  rowFacilityHit,
  rowText,
  settleShown,
  titleModeFor,
} from "./creativeLaneShared";
import { isPersonalDetail, rowHasPersonalDetail } from "./cvShared";

export type CreditMedium = (typeof CREDIT_MEDIA)[number];

export const MEDIUM_HEADING: Record<CreditMedium, string> = {
  theater: "Theater", film: "Film", tv: "Television", voice: "Voice", music: "Music", other: "Other",
};
export const BILLING_WORD: Record<string, string> = {
  lead: "Lead", supporting: "Supporting", series_regular: "Series Regular", recurring: "Recurring", guest_star: "Guest Star",
  co_star: "Co-Star", featured: "Featured", ensemble: "Ensemble", understudy: "Understudy", swing: "Swing", background: "Background",
};
export const UNION_STATUS_WORD: Record<string, string> = { member: "Member", eligible: "Eligible", candidate: "Membership Candidate" };

/** The record kinds a performer page reads. */
export const PERFORMER_SECTIONS: readonly PracticeSection[] = ["credit", "training", "union", "award"];

/** "25-35" or "25 to 35": a range the person plays. A single age is never a range. */
export function ageRangeOf(text: string | null | undefined): { lo: number; hi: number } | null {
  const m = typeof text === "string" ? /^\s*(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*$/i.exec(text) : null;
  if (!m) return null;
  const lo = parseInt(m[1], 10);
  const hi = parseInt(m[2], 10);
  return lo >= 1 && hi <= 99 && lo < hi ? { lo, hi } : null;
}

export type PerformerField =
  | "displayName" | "discipline" | "agent" | "basedIn" | "email" | "phone" | "website"
  | "height" | "hair" | "eyes" | "voice" | "ageRange" | "skills";

/**
 * How each typed field is read for facility words (review s2r3 N3-H1): the
 * person's own name, email, website and home place are never held, only
 * asked about (a whole hidden name is held in any field). Everything else is
 * free text, the agent line included: it is a line the person writes, not
 * their own name, so part of a hidden name in it is held.
 */
export const PERFORMER_FIELD_KIND: Record<PerformerField, FacilityFieldKind> = {
  displayName: "name", email: "name", website: "name", basedIn: "place",
  agent: "text", discipline: "text", phone: "text", height: "text", hair: "text", eyes: "text", voice: "text", ageRange: "text", skills: "text",
};

export interface CreditRow {
  entryId: string;
  /** Always computed from the record (C2); printed only when the lane turns years on. */
  years: string;
  /** Production | role or billing | company, place, director. */
  cols: [Part[], Part[], Part[]];
  mode: "true_title" | "venue_only";
}

export interface PerformerSection {
  key: "training" | "award" | "skills";
  heading: string;
  rows?: ArtistRow[];
  text?: string;
}

export interface PerformerModel {
  header: { name: string; discipline: string; unions: string[]; stats: string[]; contact: string[] };
  /** The union entries the header prints, in the order of header.unions. */
  unionIds: string[];
  credits: { key: CreditMedium; heading: string; rows: CreditRow[] }[];
  sections: PerformerSection[];
  /** C2: credit years on the page (off by default). Training and awards are always dated. */
  showYears: boolean;
  needsChoice: string[];
  omitted: { entryId: string; reason: "not_selected" | "leave_out" | "needs_choice" | "needs_status" | "personal" | "names_hidden" }[];
  heldFields: { field: PerformerField; reason: "personal" | "names_hidden" | "not_a_range" }[];
  /** Lines that print but share a word with a place this lane keeps off: one tap to answer (review s2r3 N3-H1). */
  asks: FacilityAsk[];
  /** Skills the person has not yet confirmed they can do on request today (never on the page). */
  unconfirmedSkills: number;
  trimmed: boolean;
}

function commaJoin(parts: Part[]): Part[] {
  const kept = parts.filter((p) => p.text && p.text.trim());
  return kept.map((p, i) => (i < kept.length - 1 ? { ...p, after: "," } : { ...p }));
}

/** One credit's three columns, exactly from the record. A venue-only line never shows the production, role or director; the billing stays. */
export function creditCols(e: PracticeEntry, mode: "true_title" | "venue_only"): [Part[], Part[], Part[]] {
  const d = e.details;
  const billing = d.billing ? BILLING_WORD[d.billing] ?? "" : "";
  if (mode === "venue_only") {
    return [[{ text: CREDIT_MEDIUM_WORD[d.medium ?? ""] ?? "Production" }], billing ? [{ text: billing }] : [], commaJoin([{ text: e.venue ?? "" }, { text: placeOf(e) }])];
  }
  const role: Part[] = d.role ? [{ text: d.role }] : [];
  if (billing) role.push({ text: d.role ? `(${billing})` : billing });
  return [
    [{ text: e.title, italic: true }],
    role,
    commaJoin([{ text: e.venue ?? "" }, { text: placeOf(e) }, { text: d.director ? `Dir. ${d.director}` : "" }]),
  ];
}

/** A training row (always dated): what, where, with whom, how long. A venue-only line keeps only the kind word, the place and how long. */
export function trainingParts(e: PracticeEntry, mode: "true_title" | "venue_only"): Part[] {
  if (mode === "venue_only") return commaJoin([{ text: "Training" }, { text: e.venue ?? "" }, { text: placeOf(e) }, { text: e.details.duration ?? "" }]);
  return commaJoin([
    { text: e.title },
    { text: e.venue ?? "" },
    { text: placeOf(e) },
    { text: e.details.teacher ? `with ${e.details.teacher}` : "" },
    { text: e.details.duration ?? "" },
  ]);
}

/** The text of a credit row's three columns (what the checks compare). */
export function creditText(cols: [Part[], Part[], Part[]]): string {
  return cols.map((c) => rowText(c)).join(" | ");
}

/**
 * A performer row's facility hit (review s2r3 N3-H1), from the parts the row
 * prints minus the page's own label: its own words as free text, its city and
 * state as a place, and a director or teacher as a name (a person's name is
 * asked about, never held). Tier 1 wins over tier 2.
 */
export function performerPartsHit(parts: Part[], e: PracticeEntry | undefined, terms: HiddenTerms): FacilityHit | null {
  const place = e ? placeOf(e) : "";
  const d = e?.details;
  const isPlace = (p: Part) => !!e && !!p.text && (p.text === place || p.text === e.city || p.text === e.state);
  const nameOf = (p: Part): string | null =>
    !d || !p.text ? null : d.director && p.text === `Dir. ${d.director}` ? d.director : d.teacher && p.text === `with ${d.teacher}` ? d.teacher : null;
  const hits = [
    facilityCheck(rowText(parts.filter((p) => !isPlace(p) && nameOf(p) === null)), terms, "text"),
    ...parts.filter(isPlace).map((p) => facilityCheck(p.text, terms, "place")),
    ...parts.map(nameOf).filter((n): n is string => !!n).map((n) => facilityCheck(n, terms, "name")),
  ].filter((h): h is FacilityHit => !!h);
  return hits.find((h) => h.tier === 1) ?? hits[0] ?? null;
}

/** A credit row's facility hit: all three columns, minus a venue-only row's label column. */
export function creditFacilityHit(r: { cols: [Part[], Part[], Part[]]; mode: "true_title" | "venue_only" }, e: PracticeEntry | undefined, terms: HiddenTerms): FacilityHit | null {
  return performerPartsHit((r.mode === "venue_only" ? r.cols.slice(1) : r.cols).flat(), e, terms);
}

/** A training row's facility hit, minus a venue-only row's "Training" label. */
export function trainingFacilityHit(r: { parts: Part[]; mode: "true_title" | "venue_only" }, e: PracticeEntry | undefined, terms: HiddenTerms): FacilityHit | null {
  return performerPartsHit(r.mode === "venue_only" ? r.parts.slice(1) : r.parts, e, terms);
}

/** "SAG-AFTRA Member": the union as named, and the status exactly as held. */
export function unionLine(e: PracticeEntry): string | null {
  const w = UNION_STATUS_WORD[e.details.status ?? ""];
  return w ? `${e.title} ${w}` : null;
}

/**
 * Personal details (CR-08) in the fields a person writes about themselves.
 * A credit's production and role are a work and a character, never the
 * person (review s2r2 N-M4), so a credit is never scanned; an award's name is
 * scanned as on a CV.
 */
export function performerRowHasPersonalDetail(e: PracticeEntry): boolean {
  return e.section !== "credit" && rowHasPersonalDetail(e);
}

function newestFirst(a: PracticeEntry, b: PracticeEntry): number {
  return (b.end_year ?? b.year) - (a.end_year ?? a.year) || b.year - a.year || a.title.localeCompare(b.title);
}

/** The ids of the entries a built performer page prints (credits, training, awards, unions), for hiddenFacilityTerms. */
export function performerShownIds(m: Pick<PerformerModel, "credits" | "sections" | "unionIds">): string[] {
  return [...m.unionIds, ...m.credits.flatMap((c) => c.rows.map((r) => r.entryId)), ...m.sections.flatMap((s) => (s.rows ?? []).map((r) => r.entryId))];
}

/**
 * The performer page, assembled from the record with this lane's current
 * choices. The lane's choices are the single source: which entries are
 * picked, and for an entry that names a facility, the true title, a
 * venue-only line, or leave it out. Never a softened title.
 */
export function buildPerformerModel(entries: PracticeEntry[], s: CreativeKindSettings | null | undefined): PerformerModel {
  const settings = s ?? {};
  const picked = Array.isArray(settings.selection) ? new Set(settings.selection.map((x) => x.toLowerCase())) : null;
  const omitted: PerformerModel["omitted"] = [];
  const needsChoice: string[] = [];
  const trimmedKeys = new Set<string>();

  /** The entries that may show, newest first, with how each shows. */
  const shown = (list: PracticeEntry[], key: string | null): { e: PracticeEntry; mode: "true_title" | "venue_only" }[] => {
    const out: { e: PracticeEntry; mode: "true_title" | "venue_only" }[] = [];
    for (const e of [...list].sort(newestFirst)) {
      if (key && picked && !picked.has(e.id.toLowerCase())) {
        omitted.push({ entryId: e.id, reason: "not_selected" });
        trimmedKeys.add(key);
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
      if (performerRowHasPersonalDetail(e)) {
        omitted.push({ entryId: e.id, reason: "personal" });
        continue;
      }
      out.push({ e, mode });
    }
    return out;
  };

  // First pass: the lines this page would print. Only these can make a hidden
  // facility name public (review s2r2 N-M1).
  const pendingUnions: { entryId: string; line: string }[] = [];
  for (const { e, mode } of shown(entries.filter((x) => x.section === "union"), null)) {
    // A union line is its name. A lane that keeps the name off has nothing left to show.
    if (mode === "venue_only") {
      omitted.push({ entryId: e.id, reason: "leave_out" });
      continue;
    }
    const line = unionLine(e);
    if (!line) {
      omitted.push({ entryId: e.id, reason: "needs_status" });
      continue;
    }
    pendingUnions.push({ entryId: e.id, line });
  }
  const pendingCredits: { key: CreditMedium; rows: CreditRow[] }[] = CREDIT_MEDIA.map((medium) => ({
    key: medium,
    rows: shown(entries.filter((x) => x.section === "credit" && x.details.medium === medium), medium).map(({ e, mode }) => ({ entryId: e.id, years: yearsOf(e), cols: creditCols(e, mode), mode })),
  }));
  const pendingTraining: ArtistRow[] = shown(entries.filter((x) => x.section === "training"), "training").map(({ e, mode }) => ({ entryId: e.id, years: yearsOf(e), parts: trainingParts(e, mode), mode }));
  const pendingAwards: ArtistRow[] = shown(entries.filter((x) => x.section === "award"), "award").map(({ e, mode }) => ({ entryId: e.id, years: yearsOf(e), parts: artistRowParts(e, mode), mode }));

  // The lines this page prints, settled (review s2r3 N3-L1): only lines that
  // print can make a hidden name public, and a line the check drops never
  // does. Tier 1 stays off the page (and blocks); tier 2 prints and is asked
  // about with one tap.
  const byId = new Map(entries.map((e) => [e.id.toLowerCase(), e]));
  const entryOf = (id: string) => byId.get(id.toLowerCase());
  type Line = { entryId: string; check: (t: HiddenTerms) => FacilityHit | null };
  const unionLines = new Map(pendingUnions.map((u) => [u, { entryId: u.entryId, check: (t: HiddenTerms) => facilityCheck(u.line, t, "text") } as Line]));
  const creditLines = new Map(pendingCredits.flatMap((c) => c.rows).map((r) => [r, { entryId: r.entryId, check: (t: HiddenTerms) => creditFacilityHit(r, entryOf(r.entryId), t) } as Line]));
  const trainingLines = new Map(pendingTraining.map((r) => [r, { entryId: r.entryId, check: (t: HiddenTerms) => trainingFacilityHit(r, entryOf(r.entryId), t) } as Line]));
  const awardLines = new Map(pendingAwards.map((r) => [r, { entryId: r.entryId, check: (t: HiddenTerms) => rowFacilityHit(r, entryOf(r.entryId), t) } as Line]));
  const settled = settleShown(
    [...unionLines.values(), ...creditLines.values(), ...trainingLines.values(), ...awardLines.values()],
    (x) => x.entryId,
    (x, t) => x.check(t),
    (ids) => hiddenFacilityTerms(entries, settings, ids)
  );
  const hidden = settled.terms;
  const asks: FacilityAsk[] = [];
  const keep = (line: Line | undefined): boolean => {
    const h = line ? settled.hits.get(line) : undefined;
    if (!line || !h) return true;
    if (h.tier === 1) {
      omitted.push({ entryId: line.entryId, reason: "names_hidden" });
      return false;
    }
    asks.push({ entryId: line.entryId, phrase: h.phrase });
    return true;
  };
  const heldFields: PerformerModel["heldFields"] = [];
  // Every typed field: a personal detail or a name this lane keeps off stays
  // off the page; a line that only shares a word with it prints and is asked about.
  const safe = (field: Exclude<PerformerField, "skills">): string | undefined => {
    const t = settings[field];
    if (!t) return undefined;
    if (isPersonalDetail(t)) return void heldFields.push({ field, reason: "personal" });
    const h = facilityCheck(t, hidden, PERFORMER_FIELD_KIND[field]);
    if (h?.tier === 1) return void heldFields.push({ field, reason: "names_hidden" });
    if (h) asks.push({ field, phrase: h.phrase });
    return t;
  };

  const unionsKept = pendingUnions.filter((u) => keep(unionLines.get(u)));
  const credits: PerformerModel["credits"] = [];
  for (const c of pendingCredits) {
    const rows = c.rows.filter((r) => keep(creditLines.get(r)));
    // Trimmed for one page: the heading says "Selected", as the person chose.
    if (rows.length) credits.push({ key: c.key, heading: `${trimmedKeys.has(c.key) ? "Selected " : ""}${MEDIUM_HEADING[c.key]}`, rows });
  }
  const sections: PerformerSection[] = [];
  // Training stays dated (C2).
  const training = pendingTraining.filter((r) => keep(trainingLines.get(r)));
  if (training.length) sections.push({ key: "training", heading: trimmedKeys.has("training") ? "Selected Training" : "Training", rows: training });
  const awards = pendingAwards.filter((r) => keep(awardLines.get(r)));
  if (awards.length) sections.push({ key: "award", heading: trimmedKeys.has("award") ? "Selected Awards" : "Awards", rows: awards });

  // Special skills: only the ones the person says they can do on request today (CR-08).
  let unconfirmedSkills = 0;
  const skills: string[] = [];
  let skillHeld: "personal" | "names_hidden" | null = null;
  for (const sk of settings.skills ?? []) {
    if (!sk.confirmed) {
      unconfirmedSkills++;
      continue;
    }
    if (isPersonalDetail(sk.text)) {
      skillHeld = skillHeld ?? "personal";
      continue;
    }
    const h = facilityCheck(sk.text, hidden, "text");
    if (h?.tier === 1) {
      skillHeld = skillHeld ?? "names_hidden";
      continue;
    }
    if (h) asks.push({ field: "skills", phrase: h.phrase });
    skills.push(sk.text);
  }
  if (skillHeld) heldFields.push({ field: "skills", reason: skillHeld });
  if (skills.length) sections.push({ key: "skills", heading: "Special Skills", text: skills.join(", ") });

  // The description the person gives. An age is never printed: only a range (CR-08).
  const stats: string[] = [];
  const h = safe("height");
  if (h) stats.push(`Height ${h}`);
  const hair = safe("hair");
  if (hair) stats.push(`Hair ${hair}`);
  const eyes = safe("eyes");
  if (eyes) stats.push(`Eyes ${eyes}`);
  const voice = safe("voice");
  if (voice) stats.push(`Voice ${voice}`);
  const ar = safe("ageRange");
  if (ar) {
    const r = ageRangeOf(ar);
    if (r) stats.push(`Age range ${r.lo}-${r.hi}`);
    else heldFields.push({ field: "ageRange", reason: "not_a_range" });
  }

  const contact = (["agent", "basedIn", "email", "phone", "website"] as const).map(safe).filter((x): x is string => !!x);
  return {
    header: { name: safe("displayName") ?? "", discipline: safe("discipline") ?? "", unions: unionsKept.map((u) => u.line), stats, contact },
    unionIds: unionsKept.map((u) => u.entryId),
    credits,
    sections,
    showYears: settings.showYears === true,
    needsChoice,
    omitted,
    heldFields,
    asks,
    unconfirmedSkills,
    trimmed: trimmedKeys.size > 0,
  };
}

/** The performer page as plain text (F03: shipped beside the three-column page). */
export function performerPlainText(m: PerformerModel): string {
  const lines: string[] = [];
  if (m.header.name) lines.push(m.header.name);
  if (m.header.discipline) lines.push(m.header.discipline);
  if (m.header.unions.length) lines.push(m.header.unions.join(" | "));
  if (m.header.stats.length) lines.push(m.header.stats.join(" | "));
  if (m.header.contact.length) lines.push(m.header.contact.join(" | "));
  for (const c of m.credits) {
    lines.push("", c.heading.toUpperCase());
    for (const r of c.rows) lines.push(`${m.showYears ? `${r.years}  ` : ""}${creditText(r.cols)}`);
  }
  for (const s of m.sections) {
    lines.push("", s.heading.toUpperCase());
    if (s.text) lines.push(s.text);
    for (const r of s.rows ?? []) lines.push(`${r.years}  ${rowText(r.parts)}`);
  }
  return lines.join("\n");
}
