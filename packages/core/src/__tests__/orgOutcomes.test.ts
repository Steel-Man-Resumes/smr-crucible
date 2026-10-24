/**
 * Retention truth (R3 review S7), with dated fixtures. A placement that ended
 * before a check-in date was "not asked yet" at that mark forever, in Insights
 * and in the funder CSV. It now counts as "no longer there".
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeOutcomes, type Outcome } from "../orgOutcomes";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const day = (iso: string) => iso;
function placement(p: Partial<Outcome> & { start_date: string }): Outcome {
  return {
    id: Math.random().toString(36).slice(2), client_user_id: "c", client_name: null, employer: "Employer", job_title: null,
    hourly_wage: null, hours_per_week: null, source: "staff_reported", verification_method: null, verified_by_name: null,
    verified_at: null, ended_on: null, end_reason: null, created_by_name: null, checks: [], due_marks: [], ...p,
  };
}
const mark = (s: ReturnType<typeof summarizeOutcomes>, m: number) => s.retention.find((r) => r.dayMark === m)!;

describe("retention with end dates", () => {
  // Started 2026-03-01 (236 days before NOW): old enough for every mark.
  it("a placement that ended on day 20 is no longer there at 30, 60, 90 and 180, not 'not asked yet'", () => {
    const s = summarizeOutcomes([placement({ start_date: day("2026-03-01"), ended_on: day("2026-03-21"), end_reason: "left_other" })], NOW);
    for (const m of [30, 60, 90, 180]) {
      const r = mark(s, m);
      assert.equal(r.eligible, 1, `eligible at ${m}`);
      assert.equal(r.notEmployed, 1, `no longer there at ${m}`);
      assert.equal(r.endedBeforeMark, 1);
      assert.equal(r.notAskedYet, 0, `not asked yet at ${m}`);
    }
  });

  it("a placement that ended on day 45 still needs asking at 30, and is no longer there from 60", () => {
    const s = summarizeOutcomes([placement({ start_date: day("2026-03-01"), ended_on: day("2026-04-15"), end_reason: "laid_off" })], NOW);
    assert.equal(mark(s, 30).notAskedYet, 1);
    assert.equal(mark(s, 30).notEmployed, 0);
    assert.equal(mark(s, 60).notEmployed, 1);
    assert.equal(mark(s, 60).notAskedYet, 0);
  });

  it("ending exactly on the check-in date is not 'before' it (matches when the check-in is still due)", () => {
    const s = summarizeOutcomes([placement({ start_date: day("2026-03-01"), ended_on: day("2026-03-31") })], NOW);
    assert.equal(mark(s, 30).endedBeforeMark, 0);
    assert.equal(mark(s, 30).notAskedYet, 1);
  });

  it("an answer someone recorded wins over the end date and is never counted twice", () => {
    const s = summarizeOutcomes([placement({
      start_date: day("2026-03-01"), ended_on: day("2026-03-21"),
      checks: [{ day_mark: 30, status: "unknown", method: "could_not_reach", checked_at: "2026-04-01" }],
    })], NOW);
    const r = mark(s, 30);
    assert.equal(r.unknown, 1);
    assert.equal(r.notEmployed, 0);
    assert.equal(r.employed + r.notEmployed + r.unknown + r.notAskedYet, r.eligible);
  });

  it("a placement with no end and no answer is still 'not asked yet'; one too new is not counted at all", () => {
    const s = summarizeOutcomes([
      placement({ start_date: day("2026-03-01") }),
      placement({ start_date: day("2026-10-13") }),
    ], NOW);
    assert.equal(mark(s, 30).eligible, 1);
    assert.equal(mark(s, 30).notAskedYet, 1);
  });

  it("entries made by mistake stay out of every number", () => {
    const s = summarizeOutcomes([placement({ start_date: day("2026-03-01"), ended_on: day("2026-03-02"), end_reason: "entered_in_error" })], NOW);
    assert.equal(s.placements, 0);
    assert.equal(mark(s, 30).eligible, 0);
  });
});
