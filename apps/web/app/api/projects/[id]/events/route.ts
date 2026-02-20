import { NextResponse } from "next/server";
import { query } from "@crucible/core";
import { getAuthContext, requireOrg } from "../../../../../lib/api-auth";

interface EventRow {
  id: string;
  event_type: string;
  severity: string;
  actor_type: string;
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

  const events = await query<EventRow>(
    `SELECT id, event_type, severity, actor_type, actor_label, ts, payload
     FROM event
     WHERE project_id = $1 AND org_id = $2
     ORDER BY ts DESC
     LIMIT 50`,
    [params.id, ctx.orgId]
  );

  return NextResponse.json(events);
}
