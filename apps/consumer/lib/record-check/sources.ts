/**
 * The curated, dated source list for the record check (D11).
 *
 * The ONLY places a URL in a record check may come from: an entry in
 * sources.json whose status is "verify_before_relying", or a URL the person
 * typed themself. UNVERIFIED entries are research placeholders: they have no
 * url and showableSources() never returns them.
 */

import RAW from "./sources.json";

export type SourceStatus = "verify_before_relying" | "UNVERIFIED";
export type SourceTopic =
  | "licensing_law"
  | "predetermination"
  | "licensing_board"
  | "record_relief"
  | "hiring_law"
  | "bonding"
  | "federal_license"
  | "background_checks"
  | "reference";

export interface CuratedSource {
  id: string;
  /** Two-letter state, or "US" for federal and national entries. */
  state: string;
  topic: SourceTopic;
  title: string;
  what_it_is: string;
  url: string | null;
  kind: "official" | "legal_aid" | "reference" | "reference_copy";
  status: SourceStatus;
  as_of: string | null;
  checked_by: string;
}

/** What the page shows for one source. Never carries an UNVERIFIED entry. */
export interface ShownSource {
  id: string;
  title: string;
  whatItIs: string;
  url: string;
  kind: CuratedSource["kind"];
  topic: SourceTopic;
  asOf: string;
  label: "Verify before relying";
  /** "list" = from our dated list; "you" = a link the person typed. */
  from: "list" | "you";
}

export const SOURCE_LIST_AS_OF: string = (RAW as { as_of: string }).as_of;
export const TOPIC_LABELS: Record<SourceTopic, string> = (RAW as { topics: Record<SourceTopic, string> }).topics;

const ENTRIES: CuratedSource[] = (RAW as { entries: CuratedSource[] }).entries;

/** Every entry, both statuses. For tests and the reviewer only. */
export function allCuratedSources(): readonly CuratedSource[] {
  return ENTRIES;
}

/** States with at least one showable entry. */
export const STATES_WITH_SOURCES: readonly string[] = Array.from(
  new Set(ENTRIES.filter(isShowable).map((e) => e.state).filter((s) => s !== "US"))
).sort();

export function isShowable(e: CuratedSource): boolean {
  return e.status === "verify_before_relying" && typeof e.url === "string" && /^https:\/\//.test(e.url) && !!e.as_of;
}

function toShown(e: CuratedSource): ShownSource {
  return {
    id: e.id,
    title: e.title,
    whatItIs: e.what_it_is,
    url: e.url as string,
    kind: e.kind,
    topic: e.topic,
    asOf: e.as_of as string,
    label: "Verify before relying",
    from: "list",
  };
}

/** A showable entry by id, or null (unknown id, or an UNVERIFIED placeholder). */
export function showableSourceById(id: unknown): ShownSource | null {
  if (typeof id !== "string") return null;
  const e = ENTRIES.find((x) => x.id === id);
  return e && isShowable(e) ? toShown(e) : null;
}

/** Showable entries for a state plus the federal ones, in list order. */
export function showableSourcesFor(state: string): ShownSource[] {
  return ENTRIES.filter((e) => (e.state === state || e.state === "US") && isShowable(e)).map(toShown);
}

/** Ids the model may pick from for this state (showable only). */
export function sourceIdsFor(state: string): string[] {
  return showableSourcesFor(state).map((s) => s.id);
}

/** Every URL a person could ever be shown from the list. */
export function allShowableUrls(): Set<string> {
  return new Set(ENTRIES.filter(isShowable).map((e) => e.url as string));
}

/** Topics that have no showable entry for this state (for "look this up" steps). */
export function missingTopicsFor(state: string): SourceTopic[] {
  const have = new Set(ENTRIES.filter((e) => e.state === state && isShowable(e)).map((e) => e.topic));
  const want: SourceTopic[] = ["licensing_board", "licensing_law", "predetermination", "record_relief"];
  return want.filter((t) => !have.has(t));
}
