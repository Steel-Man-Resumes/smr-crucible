/**
 * Staff t.ROY reads the employer directory (lane S1, staff pass 2026-10-27).
 *
 *   find_employers   public employer listings with the hiring mark and the
 *                    date of the evidence, checked (band A, the mark) before
 *                    reported (band B). Same reader and bands as the
 *                    participant's search_verified_employers
 *                    (assistant-data-tools.ts); public directory data only.
 *
 * It reads nothing about any participant: not their place, their lane, their
 * saved jobs or their applications. The staff member names the place and
 * the kind of work. Listing text is written by others, so the result is
 * labelled data and the read counts as a list read (after it, a person tool
 * opens only someone the staff member named). Local help is find_local_help
 * in assistant-staff-tools.ts.
 */
import { tool, jsonSchema } from "ai";
import type { StaffToolModule } from "./types";

/** The mark in the directory's own words (lib/directory-labels.ts employerEvidenceLabel). */
export function employerMarkWords(band: unknown): string {
  return band === "A" ? "Hires people with records (our mark: dated evidence that meets our rule, where it was found)" : "Reported hiring evidence, below our mark";
}

const US_STATE = /^[A-Za-z]{2}$/;

export const directoryTools: StaffToolModule = {
  id: "directory",
  activity: { find_employers: "Searching employers that hire people with records" },
  build(ctx) {
    return {
      find_employers: tool({
        description: "Search Steel Man's public employer directory for employers that hire people with records, in a state the STAFF MEMBER named (two letters), optionally by kind of work or employer name (q) and industry. Public listings only; reads nothing about any participant. Returns up to six, the mark first, each with the date its evidence was checked and when it needs a recheck. If no state was given, ask for one.",
        parameters: jsonSchema<{ state: string; q?: string; industry?: string }>({
          type: "object",
          properties: { state: { type: "string", minLength: 2, maxLength: 2 }, q: { type: "string", maxLength: 80 }, industry: { type: "string", maxLength: 80 } },
          required: ["state"], additionalProperties: false,
        }),
        execute: ctx.safe(async ({ state, q, industry }: { state: string; q?: string; industry?: string }) => {
          // Listing text is written by others and can carry an id (same rule as find_local_help).
          ctx.markCaseloadRead();
          if (!US_STATE.test(String(state ?? ""))) return { status: "needs_place", error: "Ask the staff member which state, as two letters." };
          await ctx.actor();
          const core = await ctx.loadCore();
          const st = state.toUpperCase();
          const result = await core.searchVerifiedEmployers({ state: st, q: q?.trim() || undefined, industry: industry?.trim() || undefined, bands: ["A", "B"], limit: 25 });
          if (result.status !== "ok") return { status: "unavailable", error: "The employer directory could not be read just now. Do not say there are no employers there." };
          const rank = (b: string) => (b === "A" ? 0 : 1);
          const rows = result.data.map((r, i) => ({ r, i })).sort((x, y) => rank(x.r.band) - rank(y.r.band) || x.i - y.i).map((x) => x.r);
          return {
            status: "ok", readAt: new Date().toISOString(), asOf: result.asOf, state: st, q: q ?? null, dataNote: ctx.dataNote, markFirst: true,
            employers: rows.slice(0, 6).map((e) => ({
              id: e.id, employer: e.name, industry: e.industry, city: e.city, location: e.location, band: e.band,
              howSure: employerMarkWords(e.band), lastChecked: e.checkedAt ? String(e.checkedAt).slice(0, 10) : null,
              recheckBy: e.expiresAt ? String(e.expiresAt).slice(0, 10) : null,
              roles: e.roleTypes, evidence: e.evidence ? String(e.evidence).slice(0, 300) : null,
              caveats: e.caveats ? String(e.caveats).slice(0, 200) : null, apply: e.applyUrl, source: e.sourceUrl,
            })),
            more: rows.length > 6,
            mustSay: "A mark is about how this employer has hired where the evidence was found. It never promises a job or that a person's record will be accepted. Check the listing before you send someone.",
            empty: rows.length === 0 ? "No listing for this search. That is a gap in our directory, not proof nobody there hires people with records." : null,
          };
        }),
      }),
    };
  },
};
