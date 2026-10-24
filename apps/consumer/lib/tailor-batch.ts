/**
 * Multi-job tailoring: the batch coordinator (pure sequencing and policy).
 *
 * A person picks up to three jobs and runs "Tailor for these jobs". What is
 * shared and what is not, stated plainly so the screen can never overstate it:
 *  - Shared once per batch: the person's base resume, Forge facts, contact and
 *    lane context are loaded once on the client and reused for every job.
 *  - Once per job: the posting is read once (board text, or one fetch of the
 *    posting page) and cached in the batch state, so a retry never re-reads it.
 *  - Once per job, never shared: the generator. Each job is its own tailored
 *    resume and its own AI action, admitted on the server per job.
 *
 * Idempotency: every job carries the key `${batchId}:${index}`. The server
 * returns the saved resume for a key it has already finished instead of running
 * the generator again, and this coordinator never re-runs a job it holds as
 * saved. The server claims each key before the generator runs (migration
 * 093), so a second tab is refused instead of charged. A failed generation is
 * not counted (failed operations are excluded from the allowance and the
 * per-tool count is refunded), so retrying it is not a second charge. A
 * generation that succeeded but did not save is held by the server (encrypted
 * with the claim), never in the browser, and the retry saves it only.
 *
 * Stale guard: results are written only while `isCurrent()` holds for this
 * run, and a batch never writes into an open document. Each job lands as its
 * own new artifact; the server's idempotent path returns an existing artifact
 * untouched, so a late or repeated batch cannot overwrite a newer edit.
 */

export const MAX_BATCH_JOBS = 3;

export const SELECTION_FULL_LINE =
  "You can pick up to 3 jobs at a time. Tailor these first, or uncheck one to swap it.";

export type BatchPhase = "queued" | "reading" | "tailoring" | "checking" | "saved" | "failed" | "skipped";

/** The job as the batch needs it. `existingApplicationId` = a saved job the person picked. */
export interface BatchJob {
  selectKey: string;
  title: string;
  company: string;
  location?: string;
  salary?: string | null;
  employment_type?: string;
  description?: string;
  requirements?: string[] | string;
  id?: string;
  apply_url?: string | null;
  employer_website?: string | null;
  source?: string;
  existingApplicationId?: string;
}

export interface BatchTruth { blocked: boolean; notice: string; flags: string[] }

export interface BatchJobState {
  index: number;
  key: string;
  job: BatchJob;
  phase: BatchPhase;
  attempts: number;
  postingText?: string;
  postingSource?: "board" | "fetched" | "saved";
  applicationId?: string;
  artifactId?: string;
  /** True once the server reports the generator ran and was admitted for this job. */
  actionUsed: boolean;
  truth?: BatchTruth | null;
  /** False when the job's application was already past "saved" and kept its own resume. */
  linked?: boolean;
  applicationStatus?: string | null;
  /** False when the cover letter did not save (the resume did). */
  letterSaved?: boolean | null;
  code?: string;
  error?: string;
}

export interface BatchState {
  version: 1;
  batchId: string;
  ownerUid: string;
  laneId: string | null;
  createdAt: string;
  jobs: BatchJobState[];
}

export function batchJobKey(batchId: string, index: number) {
  return `${batchId}:${index}`;
}

/** Toggle one job in the selection. The fourth is refused, never silently dropped. */
export function toggleSelection(selected: readonly string[], key: string, max = MAX_BATCH_JOBS): { selected: string[]; refused: boolean } {
  if (selected.includes(key)) return { selected: selected.filter(k => k !== key), refused: false };
  if (selected.length >= max) return { selected: [...selected], refused: true };
  return { selected: [...selected, key], refused: false };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createBatch(jobs: BatchJob[], opts: { batchId: string; ownerUid: string; laneId: string | null; now?: Date }): BatchState {
  if (!UUID.test(opts.batchId)) throw new Error("invalid_batch_id");
  if (!opts.ownerUid) throw new Error("owner_required");
  if (jobs.length < 1) throw new Error("batch_empty");
  if (jobs.length > MAX_BATCH_JOBS) throw new Error("batch_too_large");
  const seen = new Set<string>();
  for (const job of jobs) {
    if (!job.title?.trim() || !job.company?.trim()) throw new Error("job_incomplete");
    if (seen.has(job.selectKey)) throw new Error("batch_duplicate");
    seen.add(job.selectKey);
  }
  return {
    version: 1,
    batchId: opts.batchId,
    ownerUid: opts.ownerUid,
    laneId: opts.laneId,
    createdAt: (opts.now ?? new Date()).toISOString(),
    jobs: jobs.map((job, index) => ({ index, key: batchJobKey(opts.batchId, index), job, phase: "queued", attempts: 0, actionUsed: false })),
  };
}

/** Restore only a well-formed batch that belongs to this person. */
export function readBatch(raw: unknown, ownerUid: string | null | undefined): BatchState | null {
  if (!raw || typeof raw !== "object" || !ownerUid) return null;
  const b = raw as BatchState;
  if (b.version !== 1 || b.ownerUid !== ownerUid || !UUID.test(String(b.batchId)) || !Array.isArray(b.jobs)) return null;
  if (b.jobs.length < 1 || b.jobs.length > MAX_BATCH_JOBS) return null;
  if (!b.jobs.every((j, i) => j && j.index === i && j.key === batchJobKey(b.batchId, i) && typeof j.job?.title === "string")) return null;
  // A tab closed mid-run leaves jobs "in flight". They did not finish here; the
  // next run asks the server, which returns any saved result for the key.
  return { ...b, jobs: b.jobs.map(j => (["reading", "tailoring", "checking"].includes(j.phase) ? { ...j, phase: "queued" as const } : j)) };
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export type Admission =
  | { kind: "all"; runnable: number; line: string }
  | { kind: "some"; runnable: number; line: string }
  | { kind: "none"; runnable: 0; line: string };

/**
 * The up-front allowance check for the whole batch. `remaining` null means no
 * count limit applies to this account (other daily and spending limits still
 * can stop a job; a job that does not run uses no action).
 */
export function admitBatch(jobsToRun: number, remaining: number | null, blockedReason?: string | null): Admission {
  const n = Math.max(0, Math.min(MAX_BATCH_JOBS, Math.floor(jobsToRun)));
  if (n === 0) return { kind: "none", runnable: 0, line: "Every job here is already tailored." };
  if (blockedReason) return { kind: "none", runnable: 0, line: blockedReason };
  const cost = `${plural(n, "job")} = ${plural(n, "AI action")} from your allowance.`;
  if (remaining === null) {
    return { kind: "all", runnable: n, line: `${plural(n, "job")} = ${plural(n, "AI action")}. Each job gets its own resume. If a daily limit stops one, that job uses nothing and the rest stay saved.` };
  }
  const left = Math.max(0, Math.floor(remaining));
  if (left === 0) return { kind: "none", runnable: 0, line: `${cost} You have no AI actions left today. Ask t.ROY through the progress bar for more, or come back after midnight UTC. Your picks stay here.` };
  if (left < n) return { kind: "some", runnable: left, line: `${cost} You have ${left} left today, so ${left === 1 ? "one job" : `${left} jobs`} can run now. Pick ${left === 1 ? "the one" : "which ones"} to run first. The rest stay here for later.` };
  return { kind: "all", runnable: n, line: `${cost} You have ${left} left today.` };
}

/** Jobs a run should touch: everything not already saved. */
export function runnableIndexes(state: BatchState): number[] {
  return state.jobs.filter(j => j.phase !== "saved").map(j => j.index);
}

/** Refusals that would repeat for every later job: the run stops and the rest are not tried. */
export const ALLOWANCE_CODES = new Set(["tool_allowance_used", "allowance_used", "progression_locked", "tool_paused", "tier_required", "account_changed", "signed_out", "invalid_lane", "not_ready", "impersonation"]);

export interface TailorResult {
  ok: boolean;
  code?: string;
  error?: string;
  applicationId?: string | null;
  artifactId?: string;
  /** True when the generator ran and was admitted for this call. */
  actionUsed?: boolean;
  reused?: boolean;
  truth?: BatchTruth | null;
  linked?: boolean;
  applicationStatus?: string | null;
  letterSaved?: boolean | null;
}

export interface BatchDeps {
  /** Read the posting once. Returns null to use the text the job already carries. */
  readPosting(job: BatchJob): Promise<{ text: string; source: "fetched" } | null>;
  tailor(input: { key: string; index: number; size: number; job: BatchJob; postingText: string; applicationId?: string }): Promise<TailorResult>;
  /** Read the saved resume back from the server. */
  confirm(artifactId: string): Promise<boolean>;
  /** False once a newer run, another account or a closed screen owns the batch. */
  isCurrent(): boolean;
  onUpdate(state: BatchState): void;
}

const MIN_POSTING = 600;

function postingFromJob(job: BatchJob) {
  return (job.description || "").trim();
}

/**
 * Run the given jobs one at a time. A failure on one job is recorded on that
 * job only; earlier saved jobs are never touched. An allowance refusal stops
 * the jobs after it (they are marked "skipped", no action used) because the
 * next call would be refused the same way.
 */
export async function runBatch(initial: BatchState, indexes: number[], deps: BatchDeps): Promise<BatchState> {
  let state: BatchState = { ...initial, jobs: initial.jobs.map(j => ({ ...j })) };
  const order = [...new Set(indexes)].filter(i => state.jobs[i] && state.jobs[i].phase !== "saved").sort((a, b) => a - b);
  const set = (index: number, patch: Partial<BatchJobState>): boolean => {
    if (!deps.isCurrent()) return false;
    state = { ...state, jobs: state.jobs.map(j => (j.index === index ? { ...j, ...patch } : j)) };
    deps.onUpdate(state);
    return true;
  };
  for (let n = 0; n < order.length; n++) {
    const index = order[n];
    if (!deps.isCurrent()) return state;
    const current = state.jobs[index];
    if (current.phase === "saved") continue;
    if (!set(index, { phase: "reading", attempts: current.attempts + 1, code: undefined, error: undefined })) return state;

    let postingText = current.postingText;
    if (postingText === undefined) {
      const fromJob = postingFromJob(current.job);
      let read: { text: string; source: "fetched" } | null = null;
      if (fromJob.length < MIN_POSTING && current.job.apply_url) {
        try { read = await deps.readPosting(current.job); } catch { read = null; }
      }
      postingText = read && read.text.length > fromJob.length ? read.text : fromJob;
      if (!set(index, { postingText, postingSource: read && read.text.length > fromJob.length ? "fetched" : current.job.existingApplicationId ? "saved" : "board" })) return state;
    }

    if (!set(index, { phase: "tailoring" })) return state;
    let result: TailorResult;
    try {
      result = await deps.tailor({ key: current.key, index, size: state.jobs.length, job: current.job, postingText, applicationId: state.jobs[index].applicationId });
    } catch {
      result = { ok: false, code: "network", error: "We lost the connection on this job. Nothing else changed. Retry when you are back online." };
    }
    if (!deps.isCurrent()) return state;
    const used = state.jobs[index].actionUsed || !!result.actionUsed;
    if (!result.ok || !result.artifactId) {
      set(index, {
        phase: "failed", actionUsed: used, code: result.code || "tailor_failed",
        error: result.error || "This job did not finish. Your other jobs are safe. Retry this one.",
        applicationId: result.applicationId ?? state.jobs[index].applicationId ?? undefined,
      });
      if (result.code && ALLOWANCE_CODES.has(result.code)) {
        for (const later of order.slice(n + 1)) {
          set(later, { phase: "skipped", code: result.code, error: "Not run. No AI action used. It stays here for later." });
        }
        return state;
      }
      continue;
    }
    if (!set(index, { phase: "checking", actionUsed: used, applicationId: result.applicationId ?? undefined, artifactId: result.artifactId, truth: result.truth ?? null, linked: result.linked ?? true, applicationStatus: result.applicationStatus ?? null, letterSaved: result.letterSaved ?? null })) return state;
    let confirmed = false;
    try { confirmed = await deps.confirm(result.artifactId); } catch { confirmed = false; }
    if (!deps.isCurrent()) return state;
    if (confirmed) set(index, { phase: "saved" });
    else set(index, { phase: "failed", code: "not_confirmed", error: "The resume did not read back from your account yet. Retry checks again and uses no new AI action." });
  }
  return state;
}

export function batchSummary(state: BatchState) {
  const saved = state.jobs.filter(j => j.phase === "saved").length;
  const failed = state.jobs.filter(j => j.phase === "failed").length;
  const used = state.jobs.filter(j => j.actionUsed).length;
  return { saved, failed, used, total: state.jobs.length };
}

export const PHASE_LABEL: Record<BatchPhase, string> = {
  queued: "Waiting",
  reading: "Reading the posting",
  tailoring: "Tailoring and checking each line against your facts",
  checking: "Making sure it saved",
  saved: "Saved",
  failed: "Did not finish",
  skipped: "Not run",
};

export const BATCH_STORAGE_PREFIX = "tailor_batch:v1:";
export const BATCH_HANDOFF_KEY = "resume_target_batch";

/** Everything this feature keeps in the browser tab. Cleared on sign-out (lib/confirmed-sign-out.ts). */
export function clearTailorBatchStorage(storage: Pick<Storage, "length" | "key" | "removeItem" | "getItem"> | null = typeof sessionStorage === "undefined" ? null : sessionStorage, keepOwner?: string | null) {
  if (!storage) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) continue;
      if (key === BATCH_HANDOFF_KEY || key === "resume_target_job") { if (!keepOwner) doomed.push(key); continue; }
      if (!key.startsWith(BATCH_STORAGE_PREFIX)) continue;
      if (!keepOwner) { doomed.push(key); continue; }
      try {
        const raw = storage.getItem(key);
        const owner = raw ? (JSON.parse(raw) as { ownerUid?: unknown }).ownerUid : null;
        if (owner !== keepOwner) doomed.push(key);
      } catch { doomed.push(key); }
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {}
}
