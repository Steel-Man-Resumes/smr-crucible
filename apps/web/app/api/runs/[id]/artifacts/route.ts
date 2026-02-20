import { NextResponse } from "next/server";
import { query, getSignedUrl } from "@crucible/core";
import { getAuthContext, requireOrg } from "../../../../../lib/api-auth";

interface ArtifactRow {
  id: string;
  artifact_type: string;
  version: number;
  review_status: string;
  reviewed_at: string | null;
  created_at: string;
  object_key: string;
  byte_size: number;
  mime_type: string;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const { ctx, error } = await getAuthContext();
  if (error) return error;
  const orgError = requireOrg(ctx);
  if (orgError) return orgError;

  const artifacts = await query<ArtifactRow>(
    `SELECT a.id, a.artifact_type, a.version, a.review_status, a.reviewed_at, a.created_at,
            f.object_key, f.byte_size, f.mime_type
     FROM artifact a
     JOIN file_object f ON f.id = a.file_object_id
     WHERE a.run_id = $1 AND a.org_id = $2
     ORDER BY a.created_at DESC`,
    [params.id, ctx.orgId]
  );

  // Add signed download URLs
  const withUrls = await Promise.all(
    artifacts.map(async (a) => ({
      ...a,
      download_url: await getSignedUrl(a.object_key),
    }))
  );

  return NextResponse.json({ artifacts: withUrls });
}
