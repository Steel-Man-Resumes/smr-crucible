/** Browser-confirmed correction, through the existing revision gate and optimistic artifact write. */
import { NextResponse } from "next/server";
import { revisionCaller } from "@/lib/revision-route";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { coreStore, saveEditRevision } from "@/lib/revision-save";
import { artifactText, revisionIsCurrent, withRevisionMarker } from "@/lib/revision-current";
import { resumeTextToDocument } from "@/lib/revision-to-doc";
import { applyExactCorrection } from "@/lib/assistant-correction";

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 12_000) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const caller = await revisionCaller();
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const b = await request.json().catch(() => null);
  if (b?.confirmed !== true || !/^[0-9a-f-]{36}$/i.test(b?.revisionId ?? "")) return NextResponse.json({ error: "Confirm the preview first." }, { status: 400 });
  const c = await import("@crucible/core");
  const base = await c.getRevision(caller.userId, b.revisionId);
  if (!base || base.doc_kind !== "resume") return NextResponse.json({ error: "Resume not found." }, { status: 404 });
  const next = applyExactCorrection(base.resume_text, b.before, b.after);
  if (!next) return NextResponse.json({ error: "Choose one exact passage to correct." }, { status: 400 });
  const store = await coreStore();
  const [artifact, latest] = await Promise.all([store.getArtifact(caller.userId, base.artifact_id), store.getLatestRevision(caller.userId, base.artifact_id)]);
  if (!artifact || artifact.is_locked) return NextResponse.json({ error: "Open an editable copy first." }, { status: 409 });
  // A completed response lost in transit can be retried without another edit.
  if (latest?.resume_text === next && revisionIsCurrent(artifact.content, latest)) return NextResponse.json({ saved: true, revisionId: latest.id, status: latest.status, reused: true });
  if (latest?.id !== base.id || !revisionIsCurrent(artifact.content, base)) return NextResponse.json({ error: "The resume changed after this preview. Reopen it and preview again." }, { status: 409 });
  const count = await c.incrementUserUsage(caller.userId, "revision-save");
  if (count > 200) return NextResponse.json({ error: "Too many edits today. Your existing work is saved." }, { status: 429 });
  const saved = await saveEditRevision(caller.userId, base.artifact_id, next, base.letter_text, store, { base });
  if (!saved.ok) return NextResponse.json({ error: saved.reason }, { status: saved.status });
  const doc = resumeTextToDocument(next);
  const content = withRevisionMarker({ ...doc }, saved.revision.id, { formatted: artifactText(doc), kind: "edit" });
  const written = await store.updateArtifactContent(caller.userId, base.artifact_id, content, artifact.content);
  if (written !== "updated") return NextResponse.json({ error: "Your document changed while saving. The proposed revision was kept, but your document was not overwritten. Reopen it." }, { status: 409 });
  return NextResponse.json({ saved: true, revisionId: saved.revision.id, status: saved.revision.status }, { headers: { "Cache-Control": "no-store" } });
}
