/** Browser values select work; /api/workspace-context validates ownership. */
export interface RefineryWorkspaceContext {
  priorityApplication?: { id: string; job_title: string; company: string } | null;
  lane: { id: string; name: string; target: string | null; kind?: string } | null;
  application: { id: string; job_title: string; company: string; status: string } | null;
  revision: { id: string; artifactId: string; number: number; status: "draft" | "finished"; fromWriter?: boolean } | null;
  selection: { laneId: string | null; applicationId?: string; artifactId?: string; revisionId?: string };
  task: string | null;
}

export function workspaceContextUrl(pathname: string, params: URLSearchParams, focusLaneId: string | null): string {
  const selected = new URLSearchParams();
  const applicationId = params.get("applicationId") || (pathname === "/dashboard/application-tailor" ? params.get("job") : null);
  const artifactId = params.get("artifactId") || (pathname === "/dashboard/application-tailor" ? params.get("id") : null);
  const revisionId = params.get("revisionId");
  const laneId = params.get("laneId") || (["/dashboard/creative", "/dashboard/cv", "/dashboard/performer"].includes(pathname) ? params.get("lane") : null);
  if (laneId) selected.set("laneId", laneId);
  // A specific document or application owns its lane. The previous page's
  // focus must not turn a valid saved link into a cross-lane mismatch.
  else if (!applicationId && !artifactId && !revisionId) selected.set("laneId", focusLaneId || "main");
  if (applicationId) selected.set("applicationId", applicationId);
  if (artifactId) selected.set("artifactId", artifactId);
  if (revisionId) selected.set("revisionId", revisionId);
  return `/api/workspace-context?${selected.toString()}`;
}
