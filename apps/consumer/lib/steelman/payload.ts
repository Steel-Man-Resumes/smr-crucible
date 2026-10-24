/** Steel Man meter: turns a read into the GET /api/steelman payload. Pure. */
import { BANDS, MARKS, MAX_SCORE, bandFor, bandWhy, componentViews, dailyUnits, gainOptions, isSteelMan, nextGain, nextMark, scoreOf, steelManRequirements, weekStreak } from "./score";
import type { ComponentCounts, DatedUnit, MeterMoment, SteelManPayload } from "./types";

export interface PayloadInput {
  counts: ComponentCounts;
  dated: DatedUnit[];
  grantKeys: Set<string>;
  recent: Array<{ grant_key: string; kind: string; label: string; created_at: string }>;
}

/** Steel Man is permanent once recorded (memo 5); the bar itself never resets at a mark. */
export function buildPayload(input: PayloadInput, now: Date, awarded: string[] = []): SteelManPayload {
  const score = scoreOf(input.counts);
  const steelMan = isSteelMan(input.counts) || input.grantKeys.has("moment:steel-man");
  const band = bandFor(score, steelMan);
  const moments: MeterMoment[] = input.recent
    // meter:* rows are internal markers (the Steel Man allowance), not moments.
    .filter((g) => g.kind === "milestone" && g.created_at && !g.grant_key.startsWith("meter:"))
    .slice(0, 12)
    .map((g) => ({ key: g.grant_key, label: g.label, at: g.created_at, kind: "milestone" as const }));
  return {
    asOf: now.toISOString(),
    score,
    maxScore: MAX_SCORE,
    band: { id: band.id, label: band.label, why: bandWhy(band, input.counts) },
    components: componentViews(input.counts).map(({ id, label, value, max, weight, why, href, count, cap }) => ({ id, label, value, max, weight, why, href, count, cap })),
    steelMan,
    nextGain: nextGain(input.counts),
    moments,
    marks: [
      { score: MARKS.firstLoop, bandId: BANDS[1].id, label: BANDS[1].label },
      { score: MARKS.everyPart, bandId: BANDS[2].id, label: BANDS[2].label },
      { score: MARKS.breadth, bandId: BANDS[3].id, label: BANDS[3].label },
      { score: MARKS.depth, bandId: BANDS[4].id, label: BANDS[4].label },
    ],
    nextMark: nextMark(score, steelMan),
    gains: gainOptions(input.counts).slice(0, 5),
    requirements: steelManRequirements(input.counts),
    days: dailyUnits(input.dated, now),
    streak: weekStreak(input.dated.map((d) => d.at), now),
    reviewOffered: input.grantKeys.has("moment:review-offered"),
    awarded,
  };
}
