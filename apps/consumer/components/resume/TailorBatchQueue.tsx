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
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { CheckAndFinish } from "@/components/lanes/CheckAndFinish";
import {
  BATCH_HANDOFF_KEY, BATCH_STORAGE_PREFIX, MAX_BATCH_JOBS, admitBatch, clearTailorBatchStorage, confirmedSignedOut, batchSummary, createBatch, readBatch, runBatch, runnableIndexes,
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
  const t = useTranslations("refineryResume.resume.batch");
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
  const sessionStatus = useSession().status;

  // Another person signed in on this tab: only their own queues stay. A session
  // read that merely failed is not a sign-out: the batch is cleared only when a
  // fresh read confirms nobody is signed in (confirmedSignOut also clears it).
  useEffect(() => {
    let live = true;
    if (sessionStatus === "unauthenticated") {
      void confirmedSignedOut().then(out => {
        if (!live || !out) return;
        clearTailorBatchStorage(); runToken.current++; setBatch(null);
      });
    } else if (ownerUid) clearTailorBatchStorage(typeof sessionStorage === "undefined" ? null : sessionStorage, ownerUid);
    return () => { live = false; };
  }, [sessionStatus, ownerUid]);

  // Restore or create the batch for this person only.
  useEffect(() => {
    if (!ownerUid) return;
    const from = searchParams.get("from");
    const id = searchParams.get("batch");
    if (from === "batch") {
      let raw: string | null = null;
      try { raw = sessionStorage.getItem(BATCH_HANDOFF_KEY); sessionStorage.removeItem(BATCH_HANDOFF_KEY); } catch {}
      if (!raw) { if (!id) setLoadError(t("notFound")); return; }
      try {
        const handoff = JSON.parse(raw) as { ownerUid?: string; laneId?: string | null; jobs?: BatchJob[] };
        if (handoff.ownerUid !== ownerUid) throw new Error("owner");
        const state = createBatch(handoff.jobs || [], { batchId: newBatchId(), ownerUid, laneId: handoff.laneId ?? null });
        storeBatch(state);
        setBatch(state);
        router.replace(`/dashboard/application-tailor?batch=${state.batchId}`, { scroll: false });
      } catch {
        setLoadError(t("unreadable"));
      }
      return;
    }
    if (id) {
      let state: BatchState | null = null;
      try { state = readBatch(JSON.parse(sessionStorage.getItem(BATCH_STORAGE_PREFIX + id) || "null"), ownerUid); } catch {}
      if (state) setBatch(prev => (prev?.batchId === state!.batchId ? prev : state));
      else setLoadError(t("gone"));
    }
  }, [ownerUid, searchParams, router, t]);

  useEffect(() => () => { runToken.current++; }, []);

  const laneParam = batch?.laneId ?? "main";
  const loadAllowance = useCallback(async () => {
    setAllowanceError("");
    try {
      const response = await fetch(`/api/tailor-batch?laneId=${encodeURIComponent(laneParam)}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || !("remaining" in body)) throw new Error();
      setAllowance({ remaining: typeof body.remaining === "number" ? body.remaining : null, blockedReason: body.blockedReason || null });
    } catch {
      setAllowance(null);
      setAllowanceError(t("allowanceError"));
    }
  }, [laneParam, t]);
  useEffect(() => { if (batch && ownerUid) void loadAllowance(); }, [batch?.batchId, ownerUid, loadAllowance]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = batch ? runnableIndexes(batch) : [];
  const admission = batch && allowance ? admitBatch(pending.length, allowance.remaining, allowance.blockedReason) : null;
  // The same cost words admitBatch builds, in the person's language. A reason the server gave stays as it is.
  const costLine = (): string | null => {
    if (!admission || !allowance) return null;
    if (admission.kind === "none" && (pending.length === 0 || allowance.blockedReason)) return admission.line;
    const n = Math.max(0, Math.min(MAX_BATCH_JOBS, Math.floor(pending.length)));
    if (allowance.remaining === null) return t("costUnlimited", { count: n });
    const left = Math.max(0, Math.floor(allowance.remaining));
    const cost = t("cost", { count: n });
    if (left === 0) return `${cost} ${t("costNone")}`;
    if (left < n) return `${cost} ${t("costSome", { left })}`;
    return `${cost} ${t("costAll", { left })}`;
  };
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
        async tailor({ key, index, size, job, postingText, applicationId }) {
          const response = await fetch("/api/tailor-batch", {
            // The account that started the batch; the server refuses any other.
            method: "POST", headers: { "Content-Type": "application/json", "X-Expected-Account-Id": batch.ownerUid },
            body: JSON.stringify({
              batchId: batch.batchId, index, size, laneId: batch.laneId,
              job: { ...job, description: postingText, jdSourceProvider: job.source, jdSourceUrl: job.apply_url ?? null },
              context: context.generator, parentArtifactId: context.parentArtifactId,
              applicationId: applicationId || job.existingApplicationId || null,
            }),
          });
          const body = (await response.json().catch(() => null)) as (TailorResult & { key?: string }) | null;
          if (!body || (body.key && body.key !== key)) return { ok: false, code: "unreadable", error: t("answerUnreadable") };
          // A changed lane or base resume: read the person context again on the next try.
          if (!body.ok) contextRef.current = null;
          return body;
        },
        async confirm(artifactId) {
          const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, { cache: "no-store" });
          const body = await response.json().catch(() => null);
          return response.ok && body?.data?.id === artifactId;
        },
      });
    } catch {
      if (isCurrent()) setAllowanceError(t("stopped"));
    } finally {
      if (runToken.current === token) { setRunning(false); void loadAllowance(); }
    }
  }

  if (!ownerUid) return null;
  if (loadError && !batch) {
    return <section aria-label={t("ariaJobs")} className="mb-4 border border-t-line bg-t-panel p-4 text-sm text-t-phos" role="status">{loadError}</section>;
  }
  if (!batch) return null;

  const summary = batchSummary(batch);
  const currentIndex = batch.jobs.findIndex(j => j.artifactId && j.artifactId === currentArtifactId);
  const nextSaved = batch.jobs.find(j => j.phase === "saved" && j.index > currentIndex && j.artifactId !== currentArtifactId);
  const open = (artifactId: string) => router.push(`/dashboard/application-tailor?id=${encodeURIComponent(artifactId)}&batch=${batch.batchId}`);

  return (
    <section aria-label={t("ariaJobs")} data-testid="tailor-batch-queue" className="mb-6 border border-t-steel bg-t-panel p-4">
      <h2 className="font-bold text-t-white">{t("title", { count: batch.jobs.length })}</h2>
      <p className="mt-1 text-sm text-t-phos">
        {t("intro")}
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
                      {t("jobAt", { title: j.job.title, company: j.job.company })}
                    </label>
                  ) : (
                    <p className="text-sm font-semibold text-t-white">{j.index + 1}. {t("jobAt", { title: j.job.title, company: j.job.company })}</p>
                  )}
                  <p className={`text-xs ${j.phase === "failed" ? "text-t-red" : j.phase === "saved" ? "text-t-amber-bright" : "text-t-phos-dim"}`}>
                    {busy ? `${t(`phase.${j.phase}`)}...` : t(`phase.${j.phase}`)}{isCurrent ? t("openNow") : ""}
                  </p>
                  {j.error && j.phase !== "saved" && <p className="mt-1 text-xs text-t-phos" role={j.phase === "failed" ? "alert" : undefined}>{j.error}</p>}
                  {j.phase === "saved" && j.truth && (j.truth.blocked || j.truth.flags.length > 0) && (
                    <div className="mt-1 text-xs text-t-amber-bright" data-testid="batch-flags">
                      {j.truth.notice && <p>{j.truth.notice}</p>}
                      {j.truth.flags.length > 0 ? (
                        <>
                          <p>{j.truth.flags.length === 1 ? t("truthOne") : t("truthMany")}</p>
                          <ul className="ml-4 list-disc">{j.truth.flags.map((claim, i) => <li key={i}>{claim}</li>)}</ul>
                        </>
                      ) : !j.truth.notice ? <p>{t("needsCheck")}</p> : null}
                    </div>
                  )}
                  {j.phase === "saved" && j.linked === false && (
                    <p className="mt-1 text-xs text-t-phos">{t("notLinked", { status: j.applicationStatus === "heard_back" ? t("statusHeardBack") : j.applicationStatus || t("statusPast") })}</p>
                  )}
                  {j.phase === "saved" && j.letterSaved === false && (
                    <p className="mt-1 text-xs text-t-phos">{t("letterNotSaved")}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {j.phase === "saved" && j.artifactId && !isCurrent && (
                    <button type="button" onClick={() => open(j.artifactId!)} className="t-focus min-h-touch border border-t-steel px-3 text-sm font-bold text-t-steel">{t("reviewThis")}</button>
                  )}
                  {j.phase === "failed" && (
                    <button type="button" disabled={running} onClick={() => void run([j.index])} className="t-focus min-h-touch border border-t-amber px-3 text-sm font-bold text-t-amber-bright disabled:opacity-50">
                      {j.code === "save_failed" || j.code === "not_confirmed" ? t("retrySave") : t("retryJob")}
                    </button>
                  )}
                </div>
              </div>
              {j.phase === "saved" && j.artifactId && <CheckAndFinish artifactId={j.artifactId} className="mt-2" />}
            </li>
          );
        })}
      </ol>

      {summary.used > 0 && <p className="mt-3 text-xs text-t-phos-dim">{t("used", { count: summary.used })}</p>}

      {pending.length > 0 && !running && (
        <div className="mt-3 space-y-2">
          {allowanceError && <p role="alert" className="text-sm text-t-red">{allowanceError} <button type="button" onClick={() => void loadAllowance()} className="t-focus min-h-touch underline">{t("checkAgain")}</button></p>}
          {!allowance && !allowanceError && <p role="status" className="text-sm text-t-phos-dim">{t("checkingAllowance")}</p>}
          {admission && <p className="text-sm text-t-phos" data-testid="batch-cost-line">{costLine()}</p>}
          {admission?.kind === "all" && (
            <button type="button" data-testid="batch-run" onClick={() => void run(pending)} className="t-focus w-full min-h-touch bg-t-amber px-5 font-bold text-white hover:bg-t-amber-bright sm:w-auto">
              {summary.saved || summary.failed ? t("runLeft", { count: pending.length }) : t("tailorFor", { count: pending.length })}
            </button>
          )}
          {admission?.kind === "some" && (
            <button type="button" data-testid="batch-run" disabled={!chosen.length} onClick={() => void run(chosen)} className="t-focus w-full min-h-touch bg-t-amber px-5 font-bold text-white hover:bg-t-amber-bright disabled:opacity-50 sm:w-auto">
              {chosen.length === 1 ? t("runOne") : t("runMany", { count: chosen.length })}
            </button>
          )}
        </div>
      )}
      {running && <p role="status" className="mt-3 text-sm text-t-phos-dim">{t("working")}</p>}
      <p className="mt-3 text-xs text-t-phos-dim">{t("encrypted")}</p>

      {summary.saved > 0 && (
        <div className="mt-3 space-y-2 text-xs text-t-phos-dim">
          <p>{t("linked")}</p>
          <p>{t("draftNote")}</p>
          {nextSaved?.artifactId && currentIndex >= 0 && (
            <button type="button" onClick={() => open(nextSaved.artifactId!)} className="t-focus min-h-touch border border-t-steel px-3 text-sm font-bold text-t-steel">{t("nextJob", { title: nextSaved.job.title })}</button>
          )}
        </div>
      )}
    </section>
  );
}
