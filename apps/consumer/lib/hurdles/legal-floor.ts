/**
 * The record plan's legal floor: dated sources from the curated public list
 * the record check also uses (record-check/sources.ts). Only entries marked
 * "verify before relying" with a link and a date are ever shown. This module
 * reads the static list only. It never reads a person's record check, and it
 * never goes into a model prompt.
 */

import { showableSourcesFor, SOURCE_LIST_AS_OF, type ShownSource } from "@/lib/record-check/sources";

const FLOOR_TOPICS = new Set(["hiring_law", "record_relief", "background_checks", "bonding"]);

export interface LegalFloor {
  state: string | null;
  asOf: string;
  sources: ShownSource[];
  note: string;
  /** Sources last checked more than 180 days ago (shown with a warning, never as current). */
  staleIds: string[];
  staleNote: string | null;
}

export const STALE_DAYS = 180;

export function legalFloorFor(state: string | null | undefined, now: Date = new Date()): LegalFloor {
  const st = typeof state === "string" && /^[A-Z]{2}$/.test(state) ? state : null;
  const all = st ? showableSourcesFor(st) : showableSourcesFor("US");
  const sources = all.filter((s) => FLOOR_TOPICS.has(s.topic)).slice(0, 8);
  const own = st ? sources.some((s) => s.id.toLowerCase().startsWith(`${st.toLowerCase()}-`)) : false;
  const note = !st
    ? "Add the job's state to see dated sources for that state. The national sources below apply everywhere."
    : own
      ? `Dated sources for ${st} and national ones. Each says what it covers. Check current law before you rely on any of it.`
      : `We don't have checked sources for ${st} yet. The national ones below still apply. A legal aid office near you can tell you what applies there.`;
  const cutoff = now.getTime() - STALE_DAYS * 86_400_000;
  const staleIds = sources.filter((x) => !(Date.parse(x.asOf) >= cutoff)).map((x) => x.id);
  const staleNote = staleIds.length
    ? `${staleIds.length === sources.length ? "These sources were" : "Some of these sources were"} last checked more than ${STALE_DAYS} days ago. Laws change. Check the current law, or ask a legal aid office, before you rely on them.`
    : null;
  return { state: st, asOf: SOURCE_LIST_AS_OF, sources, note, staleIds, staleNote };
}
