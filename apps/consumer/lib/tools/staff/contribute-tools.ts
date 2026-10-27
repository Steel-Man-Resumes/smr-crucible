/**
 * Staff t.ROY tools for the directory (staff side lane S6, migration 112).
 * Same shape as lib/tools/assistant-staff-tools.ts: tool definitions plus
 * their handlers; lane S1's registry (lib/tools/staff/index.ts) composes them.
 *
 *   listing_check_nudge          after the staff member used a listing for
 *                                someone, the one line "Did this place still
 *                                check out? Called them lately?" At most once
 *                                per listing per week per person, and only
 *                                while their t.ROY suggestions are on.
 *   draft_directory_contribution t.ROY drafts an update to the directory from
 *                                the staff member's words, as a card. The
 *                                staff member presses Send on the card; this
 *                                tool sends nothing (SPEC rule 4). Opens with
 *                                the "directory_scout" unlock (one approved
 *                                contribution); before that it points to the form.
 *
 * NEVER: a participant's name or anything about their record goes into a
 * draft (the record-word gate and the reach-scoped name check refuse it);
 * t.ROY never handles a personal contact (the "who you know" part of
 * knows_someone is typed by the staff member into the private field).
 */
import { tool, jsonSchema, type ToolSet } from "ai";
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";
import { oncePerInput } from "../assistant-data-tools";
import { hasStaffRecordWords } from "../../staff-ai-safety";
import { LISTING_NUDGE_LINE } from "@crucible/core/src/staffRewardsShared";
import { FLOW_LABELS, normalizeContribution, type ContributionFlow, type ContributionKind } from "@crucible/core/src/directoryContributionShared";

type Core = typeof import("@crucible/core");

export const CONTRIBUTE_TOOL_NAMES = ["listing_check_nudge", "draft_directory_contribution"] as const;

export interface ContributeToolOptions {
  /** Tests inject a stand-in; production imports @crucible/core. */
  core?: () => Promise<Core>;
  /**
   * The staff member's "Suggestions" switch (lane S1 reads it from staff prefs
   * with a default of on). When not given, read here with the same default.
   */
  suggestionsOn?: boolean;
  /** Today's date as YYYY-MM-DD (tests pass it). */
  today?: string;
}

/**
 * The Suggestions switch, read from staff prefs with a default of ON. The
 * field belongs to lanes S1/S3 (staff prefs); until it exists the normalizer
 * drops the key and this stays on, which is the spec's default.
 */
export async function suggestionsOn(actor: OrgActor, loadCore: () => Promise<Core> = () => import("@crucible/core")): Promise<boolean> {
  try {
    const prefs = await (await loadCore()).getStaffPrefs(actor);
    return (prefs.effective as unknown as Record<string, unknown>).suggestions !== false;
  } catch {
    // A read that fails never nags: no line.
    return false;
  }
}

export interface ListingNudge { line: string; flows: { flow: ContributionFlow; label: string }[] }

/**
 * The quiet helper behind the nudge, for any screen or route that knows a
 * listing was just used (a referral to a directory resource, a handoff item).
 * Returns the line, or null when it should stay quiet.
 */
export async function listingNudgeFor(
  actor: OrgActor,
  listing: { kind: ContributionKind; id: string },
  opts: ContributeToolOptions = {},
): Promise<ListingNudge | null> {
  if (actor.viaPlatformAdmin) return null;
  const loadCore = opts.core ?? (() => import("@crucible/core"));
  const on = opts.suggestionsOn ?? (await suggestionsOn(actor, loadCore));
  if (!on) return null;
  const claimed = await (await loadCore()).claimListingNudge(actor, listing.kind, listing.id).catch(() => false);
  if (!claimed) return null;
  return {
    line: LISTING_NUDGE_LINE,
    flows: (["called_today", "correction"] as const).map((flow) => ({ flow, label: FLOW_LABELS[flow].button })),
  };
}

const ID = { type: "string", pattern: "^[0-9a-fA-F-]{36}$" };
const SHORT = { type: "string", maxLength: 200 };
const LONG = { type: "string", maxLength: 600 };

function safe<A>(run: (a: A) => Promise<unknown>) {
  return oncePerInput(async (a: A) => {
    try { return await run(a); }
    catch { return { status: "unavailable", error: "That could not be checked. Do not say anything was sent or saved." }; }
  });
}

export function buildContributeTools(actor: OrgActor, opts: ContributeToolOptions = {}): ToolSet {
  const loadCore = opts.core ?? (() => import("@crucible/core"));
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  return {
    listing_check_nudge: tool({
      description: "Call ONCE after the staff member used a directory listing for someone (sent a referral to it, handed it to a participant, or chose it as a suggestion). It tells you whether you may ask them one short question about the listing. If it returns a line, end your answer with that line, word for word, and nothing more about it. If it returns quiet, do not mention it. Never call it twice for the same listing in one answer.",
      parameters: jsonSchema<{ kind: ContributionKind; listingId: string }>({
        type: "object",
        properties: { kind: { type: "string", enum: ["employer", "resource"] }, listingId: ID },
        required: ["kind", "listingId"], additionalProperties: false,
      }),
      execute: safe(async ({ kind, listingId }: { kind: ContributionKind; listingId: string }) => {
        const nudge = await listingNudgeFor(actor, { kind, id: listingId }, { ...opts, core: loadCore });
        return nudge ? { status: "ok", line: nudge.line, buttons: nudge.flows } : { status: "quiet" };
      }),
    }),

    draft_directory_contribution: tool({
      description: "Draft an update to the shared employer and resource directory from the staff member's own words: a place we are missing (new_place), something wrong on a listing (correction), what a place told them on a call, a visit or an email back (called_today), or that they know someone who hires at an employer (knows_someone). Returns a CARD for the staff member to check and press Send. This tool sends nothing; never say it was sent. Never put a participant's name, or anything about anyone's record, court case or supervision, in a draft. For knows_someone, never write who they know: the card asks them to type that privately.",
      parameters: jsonSchema<{
        flow: ContributionFlow; targetKind: ContributionKind; listingId?: string; name?: string; city?: string; state?: string;
        website?: string; phone?: string; change?: string; said?: string; interactionOn?: string; interactionMethod?: string;
      }>({
        type: "object",
        properties: {
          flow: { type: "string", enum: ["new_place", "correction", "called_today", "knows_someone"] },
          targetKind: { type: "string", enum: ["employer", "resource"] },
          listingId: ID, name: SHORT, city: SHORT, state: { type: "string", pattern: "^[A-Za-z]{2}$" }, website: SHORT, phone: { type: "string", maxLength: 30 },
          change: LONG, said: LONG,
          interactionOn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          interactionMethod: { type: "string", enum: ["phone_call", "in_person", "email_reply", "site_visit", "website", "heard_from_someone"] },
        },
        required: ["flow", "targetKind"], additionalProperties: false,
      }),
      execute: safe(async (a: {
        flow: ContributionFlow; targetKind: ContributionKind; listingId?: string; name?: string; city?: string; state?: string;
        website?: string; phone?: string; change?: string; said?: string; interactionOn?: string; interactionMethod?: string;
      }) => {
        if (actor.viaPlatformAdmin) return { status: "refused", error: "Nothing is drafted while viewing as someone else." };
        const core = await loadCore();
        const unlocks = await core.staffUnlocks(actor);
        if (!unlocks.includes("directory_scout")) {
          return { status: "locked", error: "Point the staff member to Help the directory (/dashboard/contribute) to send this themselves. t.ROY drafting these opens after one of their updates is approved." };
        }
        const words = [a.name, a.city, a.change, a.said].filter((s): s is string => !!s);
        if (words.some((w) => hasStaffRecordWords(w))) {
          return { status: "refused", error: "The words mention a record, a court matter or supervision. Ask the staff member to say it without those details; it is about the place." };
        }
        const people = await core.reachableParticipantNames(actor).catch(() => []);
        if (words.some((w) => core.namesMentioned(w, people).length > 0)) {
          return { status: "refused", error: "The words name a person on their caseload. The directory is about the place, never a participant. Ask them to leave the name out." };
        }
        const draft = {
          flow: a.flow, targetKind: a.targetKind, targetId: a.listingId ?? null,
          details: { name: a.name, city: a.city, state: a.state?.toUpperCase(), website: a.website, phone: a.phone, change: a.change, said: a.said },
          interactionOn: a.interactionOn ?? null, interactionMethod: a.interactionMethod ?? null,
          // knows_someone: the staff member types who, privately, on the card. A placeholder passes the check only for the preview.
          privateNote: a.flow === "knows_someone" ? "(typed by the staff member on the card)" : null,
        };
        const checked = normalizeContribution(draft, today);
        if (!checked.ok) return { status: "needs_more", missing: checked.error, card: { ...draft, privateNote: null } };
        return {
          status: "draft",
          card: { ...checked.value, privateNote: null },
          title: FLOW_LABELS[a.flow].title,
          note: a.flow === "knows_someone"
            ? "The staff member types who they know in the private box on the card, then presses Send. Nothing was sent."
            : "The staff member checks the card and presses Send. Nothing was sent.",
        };
      }),
    }),
  };
}
