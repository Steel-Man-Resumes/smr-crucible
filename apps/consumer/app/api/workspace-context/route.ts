import { NextResponse } from "next/server";
import { effectiveAuth } from "@/lib/effective-auth";
import { loadSelectedWork } from "@/lib/assistant-work-context";

/** The shell and coach use the same ownership-checked selection. No document body is needed by the shell. */
export async function GET(request: Request) {
  const session = await effectiveAuth();
  const userId = session?.user?.id;
  const headers = { "Cache-Control": "private, no-store" };
  if (!userId) return NextResponse.json({ error: "Sign in to see your workspace." }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const selection: Record<string, string> = {};
  for (const key of ["laneId", "applicationId", "artifactId", "revisionId"]) {
    const value = params.get(key);
    if (value !== null) selection[key] = value;
  }
  try {
    const work = await loadSelectedWork(userId, selection, false);
    return NextResponse.json({ data: {
      lane: work.lane,
      task: work.task,
      priorityApplication: work.priorityApplication,
      selection: work.selection,
      application: work.application ? { id: work.application.id, job_title: work.application.job_title, company: work.application.company, status: work.application.status } : null,
      revision: work.revision ? { id: work.revision.id, artifactId: work.revision.artifactId, number: work.revision.number, status: work.revision.status, fromWriter: work.revision.fromWriter } : null,
    } }, { headers });
  } catch {
    return NextResponse.json({ error: "That workspace could not be loaded. Reopen your lane or document." }, { status: 409, headers });
  }
}
