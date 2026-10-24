/**
 * Server half of the career planner: the person's facts and saved notes,
 * read through row-level security (consumer_profile is protected; owner
 * reads only). Nothing here trusts the browser for a fact.
 */

import { getOneAsUser } from "@crucible/core";
import { buildSavedFacts, type CareerFact } from "./facts";
import { readPlanNotes, type CareerPlanNote } from "./plan";

export interface CareerContext {
  facts: CareerFact[];
  location: string;
  notes: CareerPlanNote[];
}

export async function loadCareerContext(userId: string): Promise<CareerContext> {
  const row = await getOneAsUser<{ master: unknown; notes: unknown; skills: unknown; forge_output: unknown; location: unknown }>(
    userId,
    `SELECT profile_data->'masterDraft' AS master, profile_data->'careerPlanNotes' AS notes, skills, forge_output,
            preferences->>'location' AS location
       FROM consumer_profile WHERE user_id = $1`,
    [userId],
  );
  const location = typeof row?.location === "string" ? row.location.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  return {
    facts: buildSavedFacts({ master: row?.master, skills: row?.skills, forgeOutput: row?.forge_output }),
    location,
    notes: readPlanNotes(row?.notes),
  };
}
