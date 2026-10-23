import type { WorkSelection } from "./assistant-work-context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** URL/page selections outrank browser convenience state. The server still validates ownership. */
export function assistantClientSelection(
  context: WorkSelection | undefined,
  search: Pick<URLSearchParams, "get">,
  rememberedLane?: string,
  pathname?: string,
): WorkSelection {
  const selected: WorkSelection = { ...context };
  if (pathname && ["/dashboard/creative", "/dashboard/cv", "/dashboard/performer"].includes(pathname) && search.get("lane")) selected.laneId = search.get("lane")!;
  const job = search.get("job");
  // Older disclosure links use ?job for a title, not an application selector.
  if (job && UUID.test(job)) selected.applicationId = job;
  if (pathname === "/dashboard/application-tailor" && search.get("id")) selected.artifactId = search.get("id")!;
  for (const key of ["laneId", "applicationId", "artifactId", "revisionId"] as const) {
    const value = search.get(key);
    if (value) selected[key] = value;
  }
  const explicitDocument = selected.applicationId !== undefined || selected.artifactId !== undefined || selected.revisionId !== undefined;
  // With an explicit job/document, let its authoritative row determine the lane.
  // Explicit URL/page lane choices remain intact so mismatches still fail closed.
  if (!(pathname === "/dashboard" || pathname?.startsWith("/dashboard/")) && selected.laneId === undefined && !explicitDocument && rememberedLane && (rememberedLane === "main" || UUID.test(rememberedLane))) {
    selected.laneId = rememberedLane;
  }
  return selected;
}
