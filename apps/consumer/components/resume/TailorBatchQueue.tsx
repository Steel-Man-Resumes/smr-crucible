"use client";

/**
 * The multi-job queue on the Tailor page. Arrives with ?from=batch (the job
 * board's hand-off) or ?batch=<id> (reviewing results). Shows the honest cost
 * before anything runs, runs the jobs one at a time through
 * /api/tailor-batch, and lets the person review each saved resume in turn.
 * It never writes into the open document: each job is its own saved resume.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckAndFinish } from "@/components/lanes/CheckAndFinish";
import {
  BATCH_HANDOFF_KEY, BATCH_STORAGE_PREFIX, PHASE_LABEL, admitBatch, batchSummary, createBatch, plural, readBatch, runBatch, runnableIndexes,
  type BatchJob, type BatchState, type TailorResult,
} from "@/lib/tailor-batch";
import { loadTailorContext, type TailorContext } from "@/lib/tailor-context";

interface Allowance { remaining: number | null; blockedReason: string | null }

function storeBatch(state: BatchState) {
  try { sessionStorage.setItem(BATCH_STORAGE_PREFIX + state.batchId, JSON.stringify(state)); } catch {}
}

function newBatchId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "";
}

export function TailorBatchQueue({ ownerUid, currentArtifactId }: { ownerUid: string | null | undefined; currentArtifactId: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [allowanceError, setAllowanceError] = useState("");
  const [running, setRunning] = useState(false);
  const [chosen, setChosen] = useState<number[]>([]);
  const runToken = useRef(0);
  const ownerRef = useRef(ownerUid); ownerRef.current = ownerUid;
  const contextRef = useRef<{ owner: string; lane: string | null; value: TailorContext } | null>(null);

  // Restore or create the batch for this person only.
  useEffect(() => {
    if (!ownerUid) return;
    const from = searchParams.get("from");
    const id = searchParams.get("batch");
    if (from === "batch") {
      let raw: string | null = null;
      try { raw = sessionStorage.getItem(BATCH_HANDOFF_KEY); sessionStorage.removeItem(BATCH_HANDOFF_KEY); } catch {}
      if (!raw) { if (!id) setLoadError("The jobs you picked were not found. Pick them again on the job board."); return; }
      try {
        const handoff = JSON.parse(raw) as { ownerUid?: string; laneId?: string | null; jobs?: BatchJob[] };
        if (handoff.ownerUid !== ownerUid) throw new Error("owner");
        const state = createBatch(handoff.jobs || [], { batchId: newBatchId(), ownerUid, laneId: handoff.laneId ?? null });
        storeBatch(state);
        setBatch(state);
        router.replace(`/dashboard/application-tailor?batch=${state.batchId}`, { scroll: false });
      } catch {
        setLoadError("The jobs you picked could not be read. Pick them again on the job board.");
      }
      return;
    }
    if (id) {
      let state: BatchState | null = null;
      try { state = readBatch(JSON.parse(sessionStorage.getItem(BATCH_STORAGE_PREFIX + id) || "null"), ownerUid); } catch {}
      if (state) setBatch(prev => (prev?.batchId === state!.batchId ? prev : state));
      else setLoadError("This batch is no longer on this device. Your saved resumes are in your Library and under Applications.");
    }
  }, [ownerUid, searchParams, router]);

  useEffect(() => () => { runToken.current++; }, []);

  const loadAllowance = useCallback(async () => {
    setAllowanceError("");
    try {
      const response = await fetch("/api/tailor-batch", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || !("remaining" in body)) throw new Error();
      setAllowance({ remaining: typeof body.remaining === "number" ? body.remaining : null, blockedReason: body.blockedReason || null });
    } catch {
      setAllowance(null);
      setAllowanceError("Your allowance could not be checked. Try again before running.");
    }
  }, []);
  useEffect(() => { if (batch && ownerUid) void loadAllowance(); }, [batch?.batchId, ownerUid, loadAllowance]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = batch ? runnableIndexes(batch) : [];
  const admission = batch && allowance ? admitBatch(pending.length, allowance.remaining, allowance.blockedReason) : null;
  // When only some can run, the person picks which; default to the first ones.
  useEffect(() => {
    if (!admission || admission.kind !== "some") { setChosen([]); return; }
    setChosen(prev => (prev.length && prev.every(i => pending.includes(i)) ? prev.slice(0, admission.runnable) : pending.slice(0, admission.runnable)));
  }, [admission?.kind, admission?.runnable, pending.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(indexes: number[]) {
    if (!batch || !ownerUid || running || !indexes.length) return;
    const token = ++runToken.current;
    const owner = ownerUid;
    const isCurrent = () => runToken.current === token && ownerRef.current === owner;
    setRunning(true);
    try {
      if (!contextRef.current || contextRef.current.owner !== owner || contextRef.current.lane !== batch.laneId) {
        contextRef.current = { owner, lane: batch.laneId, value: await loadTailorContext(owner, batch.laneId) };
      }
      const context = contextRef.current.value;
      await runBatch(batch, indexes, {
        isCurrent,
        onUpdate: (state) => { storeBatch(state); setBatch(state); },
        async readPosting(job) {
          if (!job.apply_url) return null;
          const response = await fetch("/api/fetch-job-posting", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: job.apply_url }) });
          const body = await response.json().catch(() => null);
          return response.ok && body?.ok && typeof body.text === "string" ? { text: body.text, source: "fetched" } : null;
        },
        async tailor({ key, index, size, job, postingText, pendingSave, applicationId }) {
          const response = await fetch("/api/tailor-batch", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              batchId: batch.batchId, index, size, laneId: batch.laneId,
              job: { ...job, description: postingText, jdSourceProvider: job.source, jdSourceUrl: job.apply_url ?? null },
              context: context.generator, parentArtifactId: context.parentArtifactId,
              applicationId: applicationId || job.existingApplicationId || null,
              ...(pendingSave ? { pendingSave } : {}),
            }),
          });
          const body = (await response.json().catch(() => null)) as (TailorResult & { key?: string }) | null;
          if (!body || (body.key && body.key !== key)) return { ok: false, code: "unreadable", error: "The answer for this job could not be read. Retry this one." };
          return body;
        },
        async confirm(artifactId) {
          const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, { cache: "no-store" });
          const body = await response.json().catch(() => null);
          return response.ok && body?.data?.id === artifactId;
        },
      });
    } catch {
      if (isCurrent()) setAllowanceError("The batch stopped before it finished. Saved jobs stay saved. Retry the rest.");
    } finally {
      if (runToken.current === token) { setRunning(false); void loadAllowance(); }
    }
  }

  if (!ownerUid) return null;
  if (loadError && !batch) {
    return <section aria-label="Jobs to tailor" className="mb-4 border border-t-line bg-t-panel p-4 text-sm text-t-phos" role="status">{loadError}</section>;
  }
  if (!batch) return null;

  const summary = batchSummary(batch);
  const currentIndex = batch.jobs.findIndex(j => j.artifactId && j.artifactId === currentArtifactId);
  const nextSaved = batch.jobs.find(j => j.phase === "saved" && j.index > currentIndex && j.artifactId !== currentArtifactId);
  const open = (artifactId: string) => router.push(`/dashboard/application-tailor?id=${encodeURIComponent(artifactId)}&batch=${batch.batchId}`);

  return (
    <section aria-label="Jobs to tailor" data-testid="tailor-batch-queue" className="mb-6 border border-t-steel bg-t-panel p-4">
      <h2 className="font-bold text-t-white">Tailor for {plural(batch.jobs.length, "job")}</h2>
      <p className="mt-1 text-sm text-t-phos">
        Your base resume and facts are read once for all of them. Each job gets its own posting read and its own tailored resume, so each one is its own AI action.
      </p>

      <ol className="mt-3 space-y-2" aria-live="polite">
        {batch.jobs.map(j => {
          const isCurrent = j.artifactId && j.artifactId === currentArtifactId;
          const busy = ["reading", "tailoring", "checking"].includes(j.phase);
          const pickable = admission?.kind === "some" && !running && j.phase !== "saved";
          return (
            <li key={j.key} data-testid="batch-job" data-phase={j.phase} aria-current={isCurrent ? "step" : undefined}
              className={`border p-3 ${isCurrent ? "border-t-amber bg-t-panel-2" : "border-t-line"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  {pickable ? (
                    <label className="flex min-h-touch items-center gap-2 text-sm font-semibold text-t-white">
                      <input type="checkbox" className="h-5 w-5" checked={chosen.includes(j.index)}
                        onChange={() => setChosen(prev => prev.includes(j.index) ? prev.filter(i => i !== j.index) : prev.length < (admission?.runnable ?? 0) ? [...prev, j.index] : prev)} />
                      {j.job.title} at {j.job.company}
                    </label>
                  ) : (
                    <p className="text-sm font-semibold text-t-white">{j.index + 1}. {j.job.title} at {j.job.company}</p>
                  )}
                  <p className={`text-xs ${j.phase === "failed" ? "text-t-red" : j.phase === "saved" ? "text-t-amber-bright" : "text-t-phos-dim"}`}>
                    {busy ? `${PHASE_LABEL[j.phase]}...` : PHASE_LABEL[j.phase]}{isCurrent ? ". Open now" : ""}
                  </p>
                  {j.error && j.phase !== "saved" && <p className="mt-1 text-xs text-t-phos" role={j.phase === "failed" ? "alert" : undefined}>{j.error}</p>}
                  {j.phase === "saved" && j.truth && (j.truth.blocked || j.truth.flags.length > 0) && (
                    <p className="mt-1 text-xs text-t-amber-bright">{j.truth.notice || "Some lines need your check before this is finished."}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {j.phase === "saved" && j.artifactId && !isCurrent && (
                    <button type="button" onClick={() => open(j.artifactId!)} className="t-focus min-h-touch border border-t-steel px-3 text-sm font-bold text-t-steel">Review this one</button>
                  )}
                  {j.phase === "failed" && (
                    <button type="button" disabled={running} onClick={() => void run([j.index])} className="t-focus min-h-touch border border-t-amber px-3 text-sm font-bold text-t-amber-bright disabled:opacity-50">
                      {j.pendingSave || j.code === "not_confirmed" ? "Retry the save" : "Retry this job"}
                    </button>
                  )}
                </div>
              </div>
              {j.phase === "saved" && j.artifactId && <CheckAndFinish artifactId={j.artifactId} className="mt-2" />}
            </li>
          );
        })}
      </ol>

      {summary.used > 0 && <p className="mt-3 text-xs text-t-phos-dim">{plural(summary.used, "AI action")} used by this batch so far.</p>}

      {pending.length > 0 && !running && (
        <div className="mt-3 space-y-2">
          {allowanceError && <p role="alert" className="text-sm text-t-red">{allowanceError} <button type="button" onClick={() => void loadAllowance()} className="t-focus min-h-touch underline">Check again</button></p>}
          {!allowance && !allowanceError && <p role="status" className="text-sm text-t-phos-dim">Checking your allowance...</p>}
          {admission && <p className="text-sm text-t-phos" data-testid="batch-cost-line">{admission.line}</p>}
          {admission?.kind === "all" && (
            <button type="button" data-testid="batch-run" onClick={() => void run(pending)} className="t-focus w-full min-h-touch bg-t-amber px-5 font-bold text-white hover:bg-t-amber-bright sm:w-auto">
              {summary.saved || summary.failed ? `Run the ${plural(pending.length, "job")} left` : `Tailor for ${pending.length === 1 ? "this job" : `these ${pending.length} jobs`}`}
            </button>
          )}
          {admission?.kind === "some" && (
            <button type="button" data-testid="batch-run" disabled={!chosen.length} onClick={() => void run(chosen)} className="t-focus w-full min-h-touch bg-t-amber px-5 font-bold text-white hover:bg-t-amber-bright disabled:opacity-50 sm:w-auto">
              {chosen.length === 1 ? "Run one now" : `Run ${chosen.length} now`}
            </button>
          )}
        </div>
      )}
      {running && <p role="status" className="mt-3 text-sm text-t-phos-dim">Working one job at a time. You can stay on this page.</p>}

      {summary.saved > 0 && (
        <div className="mt-3 space-y-2 text-xs text-t-phos-dim">
          <p>Each saved resume is added to that job in Applications as prepared, not applied. Mark it applied after you send it.</p>
          <p>A tailored resume starts as a draft. Use Check and finish on each one. Finishing is what queues its package to your email, once your email is confirmed. Nothing is emailed before you finish it.</p>
          {nextSaved?.artifactId && currentIndex >= 0 && (
            <button type="button" onClick={() => open(nextSaved.artifactId!)} className="t-focus min-h-touch border border-t-steel px-3 text-sm font-bold text-t-steel">Next job: {nextSaved.job.title}</button>
          )}
        </div>
      )}
    </section>
  );
}
