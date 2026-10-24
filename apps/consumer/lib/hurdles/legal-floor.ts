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
}

export function legalFloorFor(state: string | null | undefined): LegalFloor {
  const st = typeof state === "string" && /^[A-Z]{2}$/.test(state) ? state : null;
  const all = st ? showableSourcesFor(st) : showableSourcesFor("US");
  const sources = all.filter((s) => FLOOR_TOPICS.has(s.topic)).slice(0, 8);
  const own = st ? sources.some((s) => s.id.toLowerCase().startsWith(`${st.toLowerCase()}-`)) : false;
  const note = !st
    ? "Add the job's state to see dated sources for that state. The national sources below apply everywhere."
    : own
      ? `Dated sources for ${st} and national ones. Each says what it covers. Check current law before you rely on any of it.`
      : `We don't have checked sources for ${st} yet. The national ones below still apply. A legal aid office near you can tell you what applies there.`;
  return { state: st, asOf: SOURCE_LIST_AS_OF, sources, note };
}
