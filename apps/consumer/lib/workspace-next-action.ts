/** One next action for the selected work, shared by shell and Overview. */
import { isLaneTask, CHECK_AND_FINISH_LABEL, CARDS_PARAM, BUILD_WITH_TROY_LABEL, rebuildHref, type LaneTask } from "./lane-task";
import { isLaneKind } from "@crucible/core/src/careerLaneShared";
import { laneToolHref } from "./lane-goals";
import type { RefineryWorkspaceContext } from "./refinery-workspace";

export interface WorkspaceNextAction { label: string; href: string }
type Revision = NonNullable<RefineryWorkspaceContext["revision"]>;

export function resumeWorkspaceAction(revision: Revision): WorkspaceNextAction {
  if (revision.fromWriter === undefined) return { label: "Review this resume", href: `/dashboard/application-tailor?id=${encodeURIComponent(revision.artifactId)}` };
  if (revision.fromWriter && revision.status === "finished") return { label: "Find a job to go after", href: "/dashboard/jobs" };
  return revision.fromWriter
    ? { label: CHECK_AND_FINISH_LABEL, href: `/output?check=${encodeURIComponent(revision.artifactId)}&${CARDS_PARAM}=1` }
    : { label: BUILD_WITH_TROY_LABEL, href: rebuildHref(revision.artifactId) };
}

/** Null leaves room for the global journey engine when no task is chosen. */
export function workspaceNextAction({ work, task, profileFirst = false }: {
  work: RefineryWorkspaceContext | null;
  /** A saved lane task already loaded by the caller; server context wins. */
  task?: LaneTask | null;
  profileFirst?: boolean;
}): WorkspaceNextAction | null {
  const savedTask = work?.task;
  const chosen = isLaneTask(savedTask) ? savedTask : task;
  const application = work?.application;
  const priority = work?.priorityApplication;
  const urgent = priority ? true : application ? application.status === "interviewing" : chosen === "interview" || chosen === "support";
  if (profileFirst && !urgent) return { label: "Save your profile", href: "/dashboard#profile-setup" };
  if (application) return application.status === "interviewing"
    ? { label: "Practice for this interview", href: `/dashboard/interview?applicationId=${encodeURIComponent(application.id)}` }
    : { label: "Open this application", href: `/dashboard/application-tailor?job=${encodeURIComponent(application.id)}` };

  if (priority && chosen !== "support") return { label: priority.company ? `Prepare for your interview at ${priority.company}` : "Prepare for your interview", href: `/dashboard/interview?applicationId=${encodeURIComponent(priority.id)}` };

  const lane = work?.lane;
  const documentHref = lane && isLaneKind(lane.kind) ? laneToolHref(lane.kind, lane.id) : null;
  switch (chosen) {
    case "interview": return { label: "Practice for your interview", href: "/dashboard/interview" };
    case "support": return { label: "Find help near you", href: "/dashboard/resources#support" };
    case "explore": return { label: "See job paths", href: "/dashboard/resources#paths" };
    case "job": return { label: "Pick a job to go after", href: "/dashboard/jobs" };
    case "documents": return documentHref ? { label: "Open this lane’s documents", href: documentHref } : { label: "Choose documents in My resumes", href: "/dashboard/vault" };
    case "resume":
      if (documentHref) return { label: "Open this lane’s documents", href: documentHref };
      if (!work) return null; // Unavailable work is different from a known empty lane.
      return work.revision ? resumeWorkspaceAction(work.revision) : { label: "Start your resume", href: "/resume" };
    default: return null;
  }
}
