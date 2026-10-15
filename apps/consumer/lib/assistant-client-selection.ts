import type { WorkSelection } from "./assistant-work-context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** URL/page selections outrank browser convenience state. The server still validates ownership. */
export function assistantClientSelection(
  context: WorkSelection | undefined,
  search: Pick<URLSearchParams, "get">,
  rememberedLane?: string,
): WorkSelection {
  const selected: WorkSelection = { ...context };
  const job = search.get("job");
  // Older disclosure links use ?job for a title, not an application selector.
  if (job && UUID.test(job)) selected.applicationId = job;
  for (const key of ["laneId", "artifactId", "revisionId"] as const) {
    const value = search.get(key);
    if (value) selected[key] = value;
  }
  const explicitDocument = selected.applicationId !== undefined || selected.artifactId !== undefined || selected.revisionId !== undefined;
  // With an explicit job/document, let its authoritative row determine the lane.
  // Explicit URL/page lane choices remain intact so mismatches still fail closed.
  if (selected.laneId === undefined && !explicitDocument && rememberedLane && (rememberedLane === "main" || UUID.test(rememberedLane))) {
    selected.laneId = rememberedLane;
  }
  return selected;
}
