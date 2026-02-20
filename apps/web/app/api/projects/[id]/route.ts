import { NextResponse } from "next/server";
import { getOne, query } from "@crucible/core";
import { getAuthContext, requireOrg } from "../../../../lib/api-auth";

interface ProjectDetail {
  id: string;
  title: string;
  status: string;
  display_label: string;
  created_at: string;
  updated_at: string;
}

interface DocumentRow {
  id: string;
  kind: string;
  source: string;
  object_key: string;
  mime_type: string;
  byte_size: number;
  created_at: string;
}

interface EventRow {
  id: string;
  event_type: string;
  severity: string;
  actor_label: string;
  ts: string;
  payload: Record<string, unknown>;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const { ctx, error } = await getAuthContext();
  if (error) return error;
  const orgError = requireOrg(ctx);
  if (orgError) return orgError;

  const project = await getOne<ProjectDetail>(
    `SELECT p.id, p.title, p.status, s.display_label, p.created_at, p.updated_at
     FROM project p
     JOIN subject s ON s.id = p.subject_id
     WHERE p.id = $1 AND p.org_id = $2`,
    [params.id, ctx.orgId]
  );

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const documents = await query<DocumentRow>(
    `SELECT d.id, d.kind, d.source, f.object_key, f.mime_type, f.byte_size, d.created_at
     FROM document d
     JOIN file_object f ON f.id = d.file_object_id
     WHERE d.project_id = $1 AND d.org_id = $2
     ORDER BY d.created_at DESC`,
    [params.id, ctx.orgId]
  );

  const events = await query<EventRow>(
    `SELECT id, event_type, severity, actor_label, ts, payload
     FROM event
     WHERE project_id = $1 AND org_id = $2
     ORDER BY ts DESC
     LIMIT 20`,
    [params.id, ctx.orgId]
  );

  return NextResponse.json({ project, documents, events });
}
