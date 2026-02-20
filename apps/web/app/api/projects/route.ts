import { NextResponse } from "next/server";
import { query, insert, emitEvent } from "@crucible/core";
import { getAuthContext, requireOrg } from "../../../lib/api-auth";

interface ProjectRow {
  id: string;
  title: string;
  status: string;
  display_label: string;
  created_at: string;
  updated_at: string;
  doc_count: string;
}

interface SubjectRow {
  id: string;
}

export async function GET() {
  const { ctx, error } = await getAuthContext();
  if (error) return error;
  const orgError = requireOrg(ctx);
  if (orgError) return orgError;

  const projects = await query<ProjectRow>(
    `SELECT p.id, p.title, p.status, s.display_label,
            p.created_at, p.updated_at,
            (SELECT COUNT(*) FROM document d WHERE d.project_id = p.id) as doc_count
     FROM project p
     JOIN subject s ON s.id = p.subject_id
     WHERE p.org_id = $1
     ORDER BY p.updated_at DESC`,
    [ctx.orgId]
  );

  return NextResponse.json(projects);
}

export async function POST(request: Request) {
  const { ctx, error } = await getAuthContext();
  if (error) return error;
  const orgError = requireOrg(ctx);
  if (orgError) return orgError;

  const body = await request.json();
  const title: string = body.title;
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  // Auto-create subject for MVP (subject = the authenticated user)
  const subject = await insert<SubjectRow>("subject", {
    org_id: ctx.orgId,
    display_label: ctx.email,
  });

  // Create project
  const project = await insert<ProjectRow>("project", {
    org_id: ctx.orgId,
    subject_id: subject.id,
    created_by_user_id: ctx.userId,
    title,
  });

  // Emit event
  await emitEvent({
    org_id: ctx.orgId,
    project_id: project.id,
    run_id: null,
    step_id: null,
    event_type: "PROJECT_CREATED",
    severity: "info",
    actor_type: "user",
    actor_user_id: ctx.userId,
    actor_label: ctx.email,
    data_classification: "internal",
    retention_class: "standard",
    correlation_id: null,
    parent_event_id: null,
    payload: { title },
    sensitive_ref: null,
  });

  return NextResponse.json(project, { status: 201 });
}
