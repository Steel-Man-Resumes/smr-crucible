/**
 * The record planner consent (migration 094), server side.
 * A yes counts only when it is granted AND at the current text version. Bump
 * the version whenever the consent card's words change materially; older yeses
 * then stop counting and the card asks again.
 */
import { cookies } from "next/headers";
import { getOne, grantConsent, revokeConsent } from "@crucible/core";
import { IMPERSONATE_COOKIE } from "@/lib/impersonation";

export const RECORD_PLANNER_LAYER = "record_planner" as const;
export const RECORD_PLANNER_CONSENT_VERSION = "2026-10-23-v1";

export async function recordPlannerConsent(userId: string): Promise<{ granted: boolean; version: string | null }> {
  const row = await getOne<{ status: string; consent_text_version: string }>(
    "SELECT status, consent_text_version FROM consumer_consent WHERE user_id = $1 AND consent_layer = $2",
    [userId, RECORD_PLANNER_LAYER]
  );
  return { granted: row?.status === "granted" && row.consent_text_version === RECORD_PLANNER_CONSENT_VERSION, version: row?.consent_text_version ?? null };
}

export async function actingForSomeoneElse(): Promise<boolean> {
  const store = await cookies();
  return !!store.get(IMPERSONATE_COOKIE)?.value;
}

export async function grantRecordPlanner(userId: string) {
  return grantConsent(userId, RECORD_PLANNER_LAYER, RECORD_PLANNER_CONSENT_VERSION, { screen: "plan_what_to_say" }, { collectionMethod: "hurdle_planner" });
}

export async function revokeRecordPlanner(userId: string) {
  return revokeConsent(userId, RECORD_PLANNER_LAYER);
}
