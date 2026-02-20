import { NextResponse } from "next/server";
import { insert, getOne, emitEvent } from "@crucible/core";
import { getAuthContext } from "../../../lib/api-auth";

interface OrgRow {
  id: string;
  name: string;
  created_at: string;
}

interface UserRow {
  id: string;
  email: string;
}

export async function POST(request: Request) {
  const { ctx, error } = await getAuthContext();
  if (error) return error;

  const body = await request.json();
  const name: string = body.name;
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Create org
  const org = await insert<OrgRow>("org", { name });

  // Ensure user record exists
  let user = await getOne<UserRow>(
    `SELECT id, email FROM "user" WHERE email = $1`,
    [ctx.email]
  );
  if (!user) {
    user = await insert<UserRow>("user", { email: ctx.email, name: ctx.email });
  }

  // Create admin membership
  await insert("membership", {
    org_id: org.id,
    user_id: user.id,
    role: "admin",
  });

  // Emit event
  await emitEvent({
    org_id: org.id,
    project_id: null,
    run_id: null,
    step_id: null,
    event_type: "PROJECT_CREATED",
    severity: "info",
    actor_type: "user",
    actor_user_id: user.id,
    actor_label: ctx.email,
    data_classification: "internal",
    retention_class: "standard",
    correlation_id: null,
    parent_event_id: null,
    payload: { action: "org_created", org_name: name },
    sensitive_ref: null,
  });

  return NextResponse.json(org, { status: 201 });
}
