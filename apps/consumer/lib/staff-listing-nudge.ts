/**
 * The listing nudge, server side (lane S6, migration 112): after a staff
 * member used a directory listing for someone, the one line "Did this place
 * still check out? Called them lately?" At most once per listing per week per
 * person (staff_listing_nudge), and only while their t.ROY suggestions are on.
 *
 * Used by /api/org/listing-nudge and by the t.ROY tool module
 * (lib/tools/staff/contribute-tools.ts). Takes a core loader so tests and the
 * tool context pass their own.
 */
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";
import { LISTING_NUDGE_LINE } from "@crucible/core/src/staffRewardsShared";
import { FLOW_LABELS, type ContributionFlow, type ContributionKind } from "@crucible/core/src/directoryContributionShared";

type Core = typeof import("@crucible/core");
type CoreLoader = () => Promise<Core>;

/**
 * The Suggestions switch, read from staff prefs with a default of ON. The
 * field belongs to lanes S1/S3 (staff prefs, key `troySuggestions`); until it
 * exists the normalizer drops the key and this stays on, the spec's default.
 */
export async function suggestionsOn(actor: OrgActor, loadCore: CoreLoader): Promise<boolean> {
  try {
    const prefs = await (await loadCore()).getStaffPrefs(actor);
    const e = prefs.effective as unknown as Record<string, unknown>;
    // S3 names the switch troySuggestions; an earlier name was suggestions. Either one off means off.
    return e.troySuggestions !== false && e.suggestions !== false;
  } catch {
    // A read that fails never nags: no line.
    return false;
  }
}

export interface ListingNudge { line: string; flows: { flow: ContributionFlow; label: string }[] }

/** The line and its two buttons, or null when t.ROY should stay quiet. */
export async function listingNudgeFor(
  actor: OrgActor,
  listing: { kind: ContributionKind; id: string },
  opts: { loadCore: CoreLoader; suggestionsOn?: boolean },
): Promise<ListingNudge | null> {
  if (actor.viaPlatformAdmin) return null;
  const on = opts.suggestionsOn ?? (await suggestionsOn(actor, opts.loadCore));
  if (!on) return null;
  const claimed = await (await opts.loadCore()).claimListingNudge(actor, listing.kind, listing.id).catch(() => false);
  if (!claimed) return null;
  return {
    line: LISTING_NUDGE_LINE,
    flows: (["called_today", "correction"] as const).map((flow) => ({ flow, label: FLOW_LABELS[flow].button })),
  };
}
