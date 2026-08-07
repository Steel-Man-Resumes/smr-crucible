import { NextResponse } from "next/server";
import { insert, emitEvent, uploadFile, getSignedUrl, getOne } from "@crucible/core";
import { getAuthContext, requireOrg } from "../../../../../lib/api-auth";
import crypto from "crypto";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function isAllowedMime(mimeType: string): boolean {
  return (
    mimeType === "application/pdf" ||
    mimeType === "application/msword" ||
    mimeType.includes("wordprocessingml") ||
    mimeType.startsWith("text/") ||
    mimeType.startsWith("image/")
  );
}

interface DocumentRow {
  id: string;
  kind: string;
  source: string;
  file_object_id: string;
  created_at: string;
}

function getDocumentKind(mimeType: string): string {
  if (mimeType === "application/pdf") return "upload_pdf";
  if (mimeType.includes("wordprocessingml") || mimeType.includes("msword"))
    return "upload_docx";
  if (mimeType.startsWith("text/")) return "upload_txt";
  if (mimeType.startsWith("image/")) return "upload_image";
  return "upload_pdf"; // fallback
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { ctx, error } = await getAuthContext();
  if (error) return error;
  const orgError = requireOrg(ctx);
  if (orgError) return orgError;

  // Object-level authorization: the project must belong to the caller's org
  // (same check as run/route.ts -- a bare project id is never trusted).
  const project = await getOne<{ id: string }>(
    `SELECT id FROM project WHERE id = $1 AND org_id = $2`,
    [params.id, ctx.orgId]
  );
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!isAllowedMime(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type. Upload PDF, Word, text, or image files." },
      { status: 415 }
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "File too large (15MB max)." },
      { status: 413 }
    );
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const ext = file.name.split(".").pop() || "bin";
  const objectKey = `${ctx.orgId}/${params.id}/${crypto.randomUUID()}.${ext}`;

  // Upload to R2 and create file_object record
  const fileObject = await uploadFile(
    ctx.orgId,
    objectKey,
    buffer,
    file.type || "application/octet-stream",
    sha256
  );

  // Create document record
  const kind = getDocumentKind(file.type);
  const doc = await insert<DocumentRow>("document", {
    org_id: ctx.orgId,
    project_id: params.id,
    kind,
    file_object_id: fileObject.id,
    source: "user_upload",
    created_by_user_id: ctx.userId,
  });

  // Emit event
  await emitEvent({
    org_id: ctx.orgId,
    project_id: params.id,
    run_id: null,
    step_id: null,
    event_type: "DOC_UPLOAD_COMPLETED",
    severity: "info",
    actor_type: "user",
    actor_user_id: ctx.userId,
    actor_label: ctx.email,
    data_classification: "pii",
    retention_class: "standard",
    correlation_id: null,
    parent_event_id: null,
    payload: {
      document_id: doc.id,
      file_name: file.name,
      mime_type: file.type,
      byte_size: buffer.length,
      kind,
    },
    sensitive_ref: null,
  });

  // Get signed download URL
  const downloadUrl = await getSignedUrl(objectKey);

  return NextResponse.json(
    {
      document: doc,
      file_object: fileObject,
      download_url: downloadUrl,
      file_name: file.name,
    },
    { status: 201 }
  );
}
