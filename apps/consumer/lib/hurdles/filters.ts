/**
 * Consented functional constraints into job search filters (PURE).
 * Only what the person picked (shifts they can reach, distance, remote, hours)
 * and only after they press the button that says so. Never a diagnosis, a
 * record detail or a family detail: those are not constraints, so they never
 * reach here.
 */

import { readJobSearchFilters, type JobSearchFilters, type JobShift } from "@crucible/core/src/jobSearchFilters";
import type { Constraint } from "./graph";

export function mergeConstraints(list: Constraint[]): Constraint {
  const out: Constraint = {};
  const shifts = new Set<JobShift>();
  for (const c of list) {
    for (const s of c.shifts ?? []) shifts.add(s);
    if (typeof c.radiusMiles === "number") out.radiusMiles = Math.min(out.radiusMiles ?? Infinity, c.radiusMiles);
    if (c.remote) out.remote = true;
    if (c.partTime) out.partTime = true;
    if (c.fullTime) out.fullTime = true;
  }
  if (shifts.size) out.shifts = [...shifts];
  return out;
}

export function hasConstraints(c: Constraint): boolean {
  return !!(c.shifts?.length || typeof c.radiusMiles === "number" || c.remote || c.partTime || c.fullTime);
}

const SHIFT_WORDS: Record<JobShift, string> = { day: "days", evening: "evenings", night: "nights", weekend: "weekends", rotating: "a rotating schedule" };

export function describeConstraints(c: Constraint): string[] {
  const lines: string[] = [];
  if (c.shifts?.length) lines.push(`Shifts: ${c.shifts.map((s) => SHIFT_WORDS[s]).join(", ")}`);
  if (c.remote) lines.push("Work from home only");
  else if (typeof c.radiusMiles === "number") lines.push(`Within ${c.radiusMiles} miles`);
  if (c.partTime && !c.fullTime) lines.push("Part time");
  if (c.fullTime && !c.partTime) lines.push("Full time");
  return lines;
}

/** Saved filters with the constraints laid over them. Everything else is kept. */
export function applyConstraints(saved: unknown, c: Constraint): JobSearchFilters {
  const base = readJobSearchFilters(saved);
  const patch: Record<string, unknown> = {};
  if (c.shifts?.length) patch.shifts = { value: c.shifts, mode: "must" };
  if (c.remote) patch.arrangements = { value: ["remote"], mode: "must" };
  else if (typeof c.radiusMiles === "number") patch.radiusMiles = { value: c.radiusMiles, mode: "must" };
  const types: string[] = [];
  if (c.partTime) types.push("part_time");
  if (c.fullTime) types.push("full_time");
  if (types.length) patch.employmentTypes = { value: types, mode: "must" };
  return readJobSearchFilters(patch, base);
}
