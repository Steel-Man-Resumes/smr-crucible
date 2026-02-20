import { NextResponse } from "next/server";
import { query, getSignedUrl } from "@crucible/core";
import { getAuthContext, requireOrg } from "../../../../../lib/api-auth";

interface DocumentRow {
  id: string;
  kind: string;
  source: string;
  object_key: string;
  mime_type: string;
  byte_size: number;
  created_at: string;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const { ctx, error } = await getAuthContext();
  if (error) return error;
  const orgError = requireOrg(ctx);
  if (orgError) return orgError;

  const documents = await query<DocumentRow>(
    `SELECT d.id, d.kind, d.source, f.object_key, f.mime_type, f.byte_size, d.created_at
     FROM document d
     JOIN file_object f ON f.id = d.file_object_id
     WHERE d.project_id = $1 AND d.org_id = $2
     ORDER BY d.created_at DESC`,
    [params.id, ctx.orgId]
  );

  // Attach signed download URLs
  const withUrls = await Promise.all(
    documents.map(async (doc) => ({
      ...doc,
      download_url: await getSignedUrl(doc.object_key),
    }))
  );

  return NextResponse.json(withUrls);
}
