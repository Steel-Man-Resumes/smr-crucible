import { NextResponse } from "next/server";
import { getOne, putRunData } from "@crucible/core";
import { DATA_PRODUCT_SCHEMAS } from "@crucible/core";
import { getAuthContext, requireOrg } from "../../../../../lib/api-auth";

interface RunRow {
  id: string;
  org_id: string;
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { ctx, error } = await getAuthContext();
  if (error) return error;
  const orgError = requireOrg(ctx);
  if (orgError) return orgError;

  // Verify run exists and belongs to this org
  const run = await getOne<RunRow>(
    `SELECT id, org_id FROM workflow_run WHERE id = $1 AND org_id = $2`,
    [params.id, ctx.orgId]
  );

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const body = await request.json();
  const { key, data } = body;

  if (!key || !data) {
    return NextResponse.json(
      { error: "Missing required fields: key, data" },
      { status: 400 }
    );
  }

  // Only allow portfolio_prefs writes from the web app
  if (key !== "portfolio_prefs.v1") {
    return NextResponse.json(
      { error: `This endpoint only accepts portfolio_prefs.v1, got: ${key}` },
      { status: 400 }
    );
  }

  // Validate against Zod schema
  const schema = DATA_PRODUCT_SCHEMAS[key];
  if (schema) {
    const result = schema.safeParse(data);
    if (!result.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          issues: result.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 422 }
      );
    }
  }

  try {
    await putRunData(params.id, key, data, {
      classification: "internal",
      producerStepKey: "user_prefs",
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    // Write-once violation — prefs already saved for this run
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "Preferences already saved for this run" },
        { status: 409 }
      );
    }
    throw err;
  }
}
