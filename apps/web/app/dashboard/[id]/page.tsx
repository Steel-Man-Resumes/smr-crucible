"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useParams } from "next/navigation";

// --- Types ---

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

interface RunData {
  id: string;
  pipeline_key: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

interface StepData {
  id: string;
  step_key: string;
  status: string;
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

interface ArtifactData {
  id: string;
  artifact_type: string;
  version: number;
  review_status: string;
  reviewed_at: string | null;
  created_at: string;
  object_key: string;
  byte_size: number;
  mime_type: string;
  download_url: string;
}

// --- Constants ---

const STEP_LABELS: Record<string, string> = {
  extract: "Text Extraction",
  parse: "AI Parsing",
  analyze: "Career Analysis",
  generate: "Resume Generation",
};

const STEP_DESCRIPTIONS: Record<string, string> = {
  extract: "Extracting text from uploaded documents",
  parse: "AI parsing resume into structured data",
  analyze: "Running multi-model career analysis",
  generate: "Generating professional resume DOCX",
};

const EVENT_LABELS: Record<string, string> = {
  PROJECT_CREATED: "Project created",
  PROJECT_UPDATED: "Project updated",
  PROJECT_ARCHIVED: "Project archived",
  DOC_UPLOAD_COMPLETED: "Document uploaded",
  DOC_TEXT_EXTRACTED: "Text extracted",
  DOC_PARSE_COMPLETED: "Parsing completed",
  DOC_PARSE_FAILED: "Parsing failed",
  RUN_QUEUED: "Pipeline queued",
  RUN_STARTED: "Pipeline started",
  RUN_COMPLETED: "Pipeline completed",
  RUN_FAILED: "Pipeline failed",
  STEP_STARTED: "Step started",
  STEP_COMPLETED: "Step completed",
  STEP_FAILED: "Step failed",
  STEP_SKIPPED: "Step skipped",
  AI_CALL_STARTED: "AI call started",
  AI_CALL_COMPLETED: "AI call completed",
  AI_CALL_FAILED: "AI call failed",
  ARTIFACT_GENERATED: "Artifact generated — awaiting review",
  ARTIFACT_DOWNLOADED: "Artifact downloaded",
  HUMAN_REVIEW_APPROVED: "Approved",
  HUMAN_REVIEW_REJECTED: "Rejected",
};

// --- Helpers ---

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

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt) return "";
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const secs = Math.round((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function eventDisplayText(event: EventItem): string {
  const base = EVENT_LABELS[event.event_type] || event.event_type;
  const p = event.payload;

  if (event.event_type === "DOC_UPLOAD_COMPLETED" && p.file_name) {
    return `Document uploaded — ${p.file_name}`;
  }
  if (event.event_type === "DOC_TEXT_EXTRACTED" && p.char_count) {
    return `Text extracted (${Number(p.char_count).toLocaleString()} chars)`;
  }
  if (event.event_type === "DOC_PARSE_COMPLETED" && p.confidence) {
    const conf = p.confidence as Record<string, number>;
    const pct = Math.round((conf.overall || 0) * 100);
    return `AI parsing completed (confidence: ${pct}%)`;
  }
  if (event.event_type === "STEP_STARTED" && p.step_key) {
    return `${STEP_LABELS[p.step_key as string] || p.step_key} started`;
  }
  if (event.event_type === "STEP_COMPLETED" && p.step_key) {
    return `${STEP_LABELS[p.step_key as string] || p.step_key} completed`;
  }
  if (event.event_type === "STEP_FAILED" && p.step_key) {
    return `${STEP_LABELS[p.step_key as string] || p.step_key} failed`;
  }
  if (event.event_type === "AI_CALL_COMPLETED" && p.provider) {
    return `AI call completed (${p.provider}/${p.model}, ${p.latency_ms}ms)`;
  }
  if (event.event_type === "ARTIFACT_GENERATED" && p.artifact_type) {
    return `Resume generated — awaiting review`;
  }
  if (event.event_type === "HUMAN_REVIEW_APPROVED") {
    return `Resume approved by ${event.actor_label}`;
  }
  if (event.event_type === "HUMAN_REVIEW_REJECTED") {
    return `Resume rejected by ${event.actor_label}`;
  }
  if (event.event_type === "RUN_COMPLETED") {
    return "Pipeline completed successfully";
  }
  if (event.event_type === "RUN_FAILED" && p.error) {
    return `Pipeline failed: ${String(p.error).substring(0, 100)}`;
  }
  return base;
}

// --- Status Icons ---

function StepStatusIcon({ status }: { status: string }) {
  if (status === "succeeded") {
    return (
      <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
        <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  if (status === "running") {
    return (
      <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
        <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center">
        <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    );
  }
  if (status === "skipped") {
    return (
      <div className="w-6 h-6 rounded-full bg-zinc-500/20 flex items-center justify-center">
        <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
        </svg>
      </div>
    );
  }
  // pending
  return <div className="w-6 h-6 rounded-full bg-zinc-700/50 border border-zinc-600" />;
}

// --- Main Component ---

export default function ProjectPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Pipeline state
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunData | null>(null);
  const [steps, setSteps] = useState<StepData[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactData[]>([]);
  const [runEvents, setRunEvents] = useState<EventItem[]>([]);
  const [starting, setStarting] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // --- Data Fetching ---

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

  const fetchRun = useCallback(async (runId: string) => {
    const [runRes, artRes] = await Promise.all([
      fetch(`/api/runs/${runId}`),
      fetch(`/api/runs/${runId}/artifacts`),
    ]);

    if (runRes.ok) {
      const data = await runRes.json();
      setRun(data.run);
      setSteps(data.steps || []);
      setRunEvents(data.events || []);
    }

    if (artRes.ok) {
      const data = await artRes.json();
      setArtifacts(data.artifacts || []);
    }
  }, []);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  // Poll run status when active
  useEffect(() => {
    if (!activeRunId) return;

    fetchRun(activeRunId);

    pollRef.current = setInterval(() => {
      fetchRun(activeRunId);
    }, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeRunId, fetchRun]);

  // Stop polling when run is done
  useEffect(() => {
    if (run && !["queued", "running"].includes(run.status)) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      // Refresh project events
      fetchProject();
    }
  }, [run, fetchProject]);

  // --- Actions ---

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

  async function handleStartRun() {
    setStarting(true);
    const res = await fetch(`/api/projects/${projectId}/run`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setActiveRunId(data.runId);
    }
    setStarting(false);
  }

  async function handleReview(artifactId: string, action: "approved" | "rejected") {
    setReviewing(artifactId);
    const res = await fetch(`/api/artifacts/${artifactId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      // Refresh artifacts
      if (activeRunId) await fetchRun(activeRunId);
      await fetchProject();
    }
    setReviewing(null);
  }

  // --- Render ---

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
        <Link href="/dashboard" className="text-[var(--accent)] text-sm mt-2 inline-block">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  const uploadedDocs = documents.filter((d) => d.source === "user_upload");
  const hasUploads = uploadedDocs.length > 0;
  const isRunning = run && ["queued", "running"].includes(run.status);
  const isComplete = run && run.status === "succeeded";
  const isFailed = run && run.status === "failed";

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
          <p className="text-sm text-[var(--muted)] mt-1">{project.display_label}</p>
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
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            dragOver ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-[var(--border)]"
          }`}
        >
          {uploading ? (
            <div className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-[var(--muted)]">Uploading...</span>
            </div>
          ) : (
            <div>
              <p className="text-[var(--muted)] mb-2">Drag and drop files here</p>
              <label className="inline-block px-4 py-2 bg-[var(--card)] border border-[var(--border)] rounded-lg text-sm cursor-pointer hover:border-[var(--accent)]/50 transition-colors">
                Or browse files
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                  onChange={(e) => e.target.files && handleUpload(e.target.files)}
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
                      {doc.kind.replace("upload_", "").toUpperCase().slice(0, 4)}
                    </div>
                    <div>
                      <p className="text-sm">{doc.object_key.split("/").pop()}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {formatBytes(doc.byte_size)} &middot; {formatTime(doc.created_at)}
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

      {/* Run Analysis Button */}
      {!activeRunId && (
        <section className="mb-8">
          <button
            onClick={handleStartRun}
            disabled={!hasUploads || starting}
            className={`w-full py-3 rounded-xl font-medium text-sm transition-all ${
              hasUploads && !starting
                ? "bg-[var(--accent)] text-black hover:brightness-110"
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
            }`}
          >
            {starting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                Starting...
              </span>
            ) : hasUploads ? (
              "Run Analysis"
            ) : (
              "Upload a document first"
            )}
          </button>
        </section>
      )}

      {/* Pipeline Progress */}
      {activeRunId && run && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium">Pipeline Progress</h2>
            <span
              className={`px-2 py-0.5 text-xs rounded-full ${
                run.status === "succeeded"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : run.status === "failed"
                  ? "bg-red-500/10 text-red-400"
                  : run.status === "running"
                  ? "bg-blue-500/10 text-blue-400"
                  : "bg-zinc-500/10 text-zinc-400"
              }`}
            >
              {run.status}
            </span>
          </div>

          <div className="space-y-3">
            {["extract", "parse", "analyze", "generate"].map((key) => {
              const step = steps.find((s) => s.step_key === key);
              const status = step?.status || "pending";

              return (
                <motion.div
                  key={key}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
                    status === "running"
                      ? "bg-blue-500/5 border-blue-500/30"
                      : status === "succeeded"
                      ? "bg-emerald-500/5 border-emerald-500/20"
                      : status === "failed"
                      ? "bg-red-500/5 border-red-500/20"
                      : "bg-[var(--card)] border-[var(--border)]"
                  }`}
                >
                  <StepStatusIcon status={status} />
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {STEP_LABELS[key] || key}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {status === "running"
                        ? STEP_DESCRIPTIONS[key]
                        : status === "failed" && step?.error_message
                        ? step.error_message.substring(0, 100)
                        : status === "succeeded"
                        ? `Completed in ${formatDuration(step?.started_at || null, step?.finished_at || null)}`
                        : "Waiting..."}
                    </p>
                  </div>
                  {step?.started_at && (
                    <span className="text-xs text-[var(--muted)]">
                      {formatDuration(step.started_at, step.finished_at)}
                    </span>
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Error message */}
          {isFailed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl"
            >
              <p className="text-sm text-red-400">
                Pipeline failed. Check the activity timeline for details.
              </p>
              <button
                onClick={() => {
                  setActiveRunId(null);
                  setRun(null);
                  setSteps([]);
                  setArtifacts([]);
                }}
                className="mt-2 text-sm text-[var(--accent)] hover:underline"
              >
                Try again
              </button>
            </motion.div>
          )}
        </section>
      )}

      {/* Artifacts */}
      {artifacts.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">Generated Artifacts</h2>
          <div className="space-y-3">
            {artifacts.map((artifact) => (
              <motion.div
                key={artifact.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-[var(--card)] border border-[var(--border)] rounded-xl"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[var(--accent)]/10 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {artifact.artifact_type === "resume_docx" ? "Professional Resume" : artifact.artifact_type}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        DOCX &middot; {formatBytes(artifact.byte_size)} &middot; v{artifact.version}
                      </p>
                    </div>
                  </div>

                  {/* Review Status Badge */}
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      artifact.review_status === "approved"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : artifact.review_status === "rejected"
                        ? "bg-red-500/10 text-red-400"
                        : "bg-amber-500/10 text-amber-400"
                    }`}
                  >
                    {artifact.review_status === "approved"
                      ? "Approved"
                      : artifact.review_status === "rejected"
                      ? "Rejected"
                      : "Pending Review"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={artifact.download_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center py-2 bg-[var(--accent)]/10 text-[var(--accent)] rounded-lg text-sm font-medium hover:bg-[var(--accent)]/20 transition-colors"
                  >
                    Download
                  </a>

                  {artifact.review_status === "pending" && (
                    <>
                      <button
                        onClick={() => handleReview(artifact.id, "approved")}
                        disabled={reviewing === artifact.id}
                        className="flex-1 py-2 bg-emerald-500/10 text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReview(artifact.id, "rejected")}
                        disabled={reviewing === artifact.id}
                        className="flex-1 py-2 bg-red-500/10 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </>
                  )}

                  {artifact.review_status === "rejected" && (
                    <button
                      onClick={() => {
                        setActiveRunId(null);
                        setRun(null);
                        setSteps([]);
                        setArtifacts([]);
                      }}
                      className="flex-1 py-2 bg-zinc-500/10 text-zinc-400 rounded-lg text-sm font-medium hover:bg-zinc-500/20 transition-colors"
                    >
                      Re-run
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

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
                <div
                  className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${
                    event.severity === "error"
                      ? "bg-red-400"
                      : event.event_type.includes("COMPLETED") || event.event_type.includes("APPROVED")
                      ? "bg-emerald-400"
                      : event.event_type.includes("STARTED") || event.event_type.includes("QUEUED")
                      ? "bg-blue-400"
                      : "bg-[var(--accent)]"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{eventDisplayText(event)}</p>
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
