"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useParams } from "next/navigation";

interface ProjectDetail {
  id: string;
  title: string;
  status: string;
  display_label: string;
  created_at: string;
  updated_at: string;
}

interface Document {
  id: string;
  kind: string;
  source: string;
  object_key: string;
  mime_type: string;
  byte_size: number;
  created_at: string;
  download_url?: string;
}

interface EventItem {
  id: string;
  event_type: string;
  severity: string;
  actor_label: string;
  ts: string;
  payload: Record<string, unknown>;
}

const EVENT_LABELS: Record<string, string> = {
  PROJECT_CREATED: "Project created",
  PROJECT_UPDATED: "Project updated",
  PROJECT_ARCHIVED: "Project archived",
  DOC_UPLOAD_COMPLETED: "Document uploaded",
  DOC_TEXT_EXTRACTED: "Text extracted",
  DOC_PARSE_COMPLETED: "Document parsed",
  DOC_PARSE_FAILED: "Document parse failed",
  RUN_QUEUED: "Run queued",
  RUN_STARTED: "Run started",
  RUN_COMPLETED: "Run completed",
  RUN_FAILED: "Run failed",
  AI_CALL_STARTED: "AI call started",
  AI_CALL_COMPLETED: "AI call completed",
  HUMAN_REVIEW_STARTED: "Review started",
  HUMAN_REVIEW_COMPLETED: "Review completed",
  ARTIFACT_GENERATED: "Artifact generated",
  ARTIFACT_DOWNLOADED: "Artifact downloaded",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ProjectPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fetchProject = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`);
    if (res.ok) {
      const data = await res.json();
      setProject(data.project);
      setDocuments(data.documents);
      setEvents(data.events);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  async function handleUpload(files: FileList | File[]) {
    setUploading(true);
    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append("file", file);
      await fetch(`/api/projects/${projectId}/upload`, {
        method: "POST",
        body: formData,
      });
    }
    await fetchProject();
    setUploading(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-20">
        <p className="text-[var(--muted)]">Project not found</p>
        <Link
          href="/dashboard"
          className="text-[var(--accent)] text-sm mt-2 inline-block"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/dashboard"
        className="text-sm text-[var(--muted)] hover:text-white transition-colors mb-6 inline-block"
      >
        &larr; Back to Dashboard
      </Link>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold">{project.title}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            {project.display_label}
          </p>
        </div>
        <span
          className={`px-2 py-0.5 text-xs rounded-full ${
            project.status === "active"
              ? "bg-emerald-500/10 text-emerald-400"
              : "bg-zinc-500/10 text-zinc-400"
          }`}
        >
          {project.status}
        </span>
      </div>

      {/* Upload Dropzone */}
      <section className="mb-8">
        <h2 className="text-lg font-medium mb-3">Documents</h2>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            dragOver
              ? "border-[var(--accent)] bg-[var(--accent)]/5"
              : "border-[var(--border)]"
          }`}
        >
          {uploading ? (
            <div className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-[var(--muted)]">Uploading...</span>
            </div>
          ) : (
            <div>
              <p className="text-[var(--muted)] mb-2">
                Drag and drop files here
              </p>
              <label className="inline-block px-4 py-2 bg-[var(--card)] border border-[var(--border)] rounded-lg text-sm cursor-pointer hover:border-[var(--accent)]/50 transition-colors">
                Or browse files
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                  onChange={(e) =>
                    e.target.files && handleUpload(e.target.files)
                  }
                />
              </label>
            </div>
          )}
        </div>

        {/* Document List */}
        {documents.length > 0 && (
          <div className="mt-4 space-y-2">
            <AnimatePresence>
              {documents.map((doc, i) => (
                <motion.div
                  key={doc.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-center justify-between p-3 bg-[var(--card)] border border-[var(--border)] rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-[var(--accent)]/10 rounded flex items-center justify-center text-xs text-[var(--accent)] font-medium">
                      {doc.kind.replace("upload_", "").toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm">
                        {doc.object_key.split("/").pop()}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {formatBytes(doc.byte_size)} &middot;{" "}
                        {formatTime(doc.created_at)}
                      </p>
                    </div>
                  </div>
                  {doc.download_url && (
                    <a
                      href={doc.download_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-[var(--accent)] hover:underline"
                    >
                      Download
                    </a>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      {/* Activity Timeline */}
      <section>
        <h2 className="text-lg font-medium mb-3">Activity</h2>
        {events.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No activity yet.</p>
        ) : (
          <div className="space-y-1">
            {events.map((event, i) => (
              <motion.div
                key={event.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.02 }}
                className="flex items-start gap-3 py-2"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] mt-2 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    {EVENT_LABELS[event.event_type] || event.event_type}
                    {event.payload?.file_name ? (
                      <span className="text-[var(--muted)]">
                        {" "}
                        &mdash; {String(event.payload.file_name)}
                      </span>
                    ) : null}
                    {event.payload?.title ? (
                      <span className="text-[var(--muted)]">
                        {" "}
                        &mdash; {String(event.payload.title)}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {event.actor_label} &middot; {formatTime(event.ts)}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
