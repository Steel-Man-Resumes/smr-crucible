/**
 * The record check route handlers (D11), with their dependencies passed in so
 * the tests can run them with no network, no database and no real AI.
 *
 * Data flow, in one place:
 *   - The person's offense, state and job arrive in ONE request to
 *     /api/record-check, only after a ticked, versioned, revocable yes.
 *   - They go into this route's own prompt and to Anthropic only. The model
 *     returns PICKS ONLY: source ids from the dated list and question ids from
 *     the bank. Every word the person sees is ours (question-bank.ts,
 *     sources.json) or theirs; the model's own text is never shown or stored
 *     (security r1 F1, F8). Unknown ids are dropped. No valid picks: the
 *     fixed plain checklist.
 *   - Nothing typed is stored, logged, or put in decision_log or usage rows.
 *   - Saving is a separate request and stores the state, the picked ids and
 *     the date. The job and the record are stored (sealed) only when the
 *     person ticked "Keep what I typed" (security r1 F2).
 *   - Taking back the yes runs as one transaction that marks it revoked and
 *     deletes every saved check; a build in flight on this server is
 *     cancelled, and any build or save re-checks the yes before it sends or
 *     writes (security r1 F5).
 *   - Staff acting as the person can do none of this. Every route needs the
 *     person's tier, and every write must be same-origin JSON (F6, F11).
 */

import { RECORD_CHECK_CONSENT_VERSION, RECORD_CHECK_COPY } from "./copy";
import { buildRecordCheckPrompt, JOB_MAX, OFFENSE_MAX, type RecordCheckInput } from "./prompt";
import { safeErrorLabel, safeJobSlot, typedUrlFrom } from "./guard";
import { showableSourceById, showableSourcesFor, SOURCE_LIST_AS_OF, type ShownSource } from "./sources";
import { isStateCode, STATE_NAMES } from "./states";
import { bankQuestion, DEFAULT_QUESTION_IDS, STEP_BANK, type BankStep } from "./question-bank";
import { isSameOriginJsonPost } from "@/lib/same-origin";

// ---------------------------------------------------------------- types --

/** Ids only. Lines are rebuilt from the bank and the list on every render. */
export interface Picks {
  v: 2;
  sourceIds: string[];
  questionIds: string[];
  generatedBy: "ai" | "plain";
}

export interface ChecklistView {
  state: string;
  stateName: string;
  /** The job as shown in the lines: what they typed, or "this work". */
  jobShown: string;
  steps: Array<{ id: string; text: string; sourceIds: string[] }>;
  questions: Array<{ id: string; text: string }>;
  sources: ShownSource[];
  picks: Picks;
  generatedBy: "ai" | "plain";
  sourceListAsOf: string;
  notAVerdict: string;
}

export interface SavedSummary {
  id: string;
  state: string;
  keptTyped: boolean;
  createdAt: string;
}

export interface SavedFull extends SavedSummary {
  picks: Picks;
  typed: { job: string; offense: string } | null;
}

export interface ConsentState {
  granted: boolean;
  version: string | null;
  grantedAt: string | null;
}

export interface RecordCheckDeps {
  userId: () => Promise<string | null>;
  /** True when the session is staff acting as someone (impersonation). */
  actingForSomeoneElse: () => Promise<boolean>;
  /** The person's tier allows the Refinery tools (client or better). */
  tierAllowed: (userId: string) => Promise<boolean>;
  consentStatus: (userId: string) => Promise<ConsentState>;
  grantConsent: (userId: string, version: string) => Promise<{ grantedAt: string }>;
  /** One transaction: mark the yes revoked (with its time) and delete every saved check. */
  revokeAndDeleteAll: (userId: string) => Promise<{ deleted: number }>;
  store: {
    save: (p: {
      userId: string;
      state: string;
      picks: Picks;
      typed: { job: string; offense: string } | null;
      consentVersion: string;
    }) => Promise<{ ok: true; id: string; createdAt: string } | { ok: false; reason: "no_consent" | "cap" }>;
    list: (userId: string) => Promise<SavedSummary[]>;
    get: (userId: string, id: string) => Promise<SavedFull | null | "unreadable">;
    deleteOne: (userId: string, id: string) => Promise<boolean>;
  };
  /** One model call. Implemented with callAI(..., { anthropicOnly: true }, signal). */
  callModel: (system: string, user: string, userId: string, signal: AbortSignal) => Promise<string>;
  mock: boolean;
  mockReply: string;
  /** Milliseconds before the build gives up and shows the plain checklist. */
  timeoutMs?: number;
  /** Counts only. Never anything the person typed, and no state. */
  logDecision: (entry: { userId: string; summary: Record<string, string | number | boolean> }) => Promise<void>;
  /** A fixed label only (safeErrorLabel). */
  logError: (where: string, label: string) => void;
}

export const BUILD_TIMEOUT_MS = 20_000;

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...NO_STORE } });
}

// ------------------------------------------------- builds in flight (F5) --

const INFLIGHT = new Map<string, Set<AbortController>>();
function track(userId: string, c: AbortController) {
  const set = INFLIGHT.get(userId) ?? new Set<AbortController>();
  set.add(c);
  INFLIGHT.set(userId, set);
}
function untrack(userId: string, c: AbortController) {
  const set = INFLIGHT.get(userId);
  if (!set) return;
  set.delete(c);
  if (!set.size) INFLIGHT.delete(userId);
}
/** Cancel this person's builds running on this server instance. */
export function cancelInflightBuilds(userId: string): number {
  const set = INFLIGHT.get(userId);
  if (!set) return 0;
  for (const c of set) c.abort("revoked");
  INFLIGHT.delete(userId);
  return set.size;
}

// -------------------------------------------------------------- picking --

export interface PickCounts {
  sources: number;
  questions: number;
  unknown_ids: number;
  model_reply_used: boolean;
}

/** The plain checklist's picks: every showable source for the state plus the
 *  national table, and the default questions. No model involved. */
export function plainPicks(state: string): Picks {
  const ids = showableSourcesFor(state)
    .filter((s) => !s.id.startsWith("us-"))
    .map((s) => s.id);
  return { v: 2, sourceIds: [...ids, "us-ccrc-licensing-comparison"], questionIds: [...DEFAULT_QUESTION_IDS], generatedBy: "plain" };
}

/**
 * Read ONLY ids from a model reply. Anything else in it is ignored and never
 * kept. Unknown ids, and ids not showable for this state, are dropped.
 */
export function picksFromReply(state: string, reply: string | null): { picks: Picks; counts: PickCounts } {
  const allowed = new Set(showableSourcesFor(state).map((s) => s.id));
  const counts: PickCounts = { sources: 0, questions: 0, unknown_ids: 0, model_reply_used: false };
  let sourceIds: string[] = [];
  let questionIds: string[] = [];
  if (reply) {
    try {
      const m = reply.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : null;
      const src = parsed && Array.isArray(parsed.source_ids) ? parsed.source_ids.slice(0, 20) : [];
      const qs = parsed && Array.isArray(parsed.question_ids) ? parsed.question_ids.slice(0, 20) : [];
      for (const id of src) {
        if (typeof id === "string" && allowed.has(id)) sourceIds.push(id);
        else counts.unknown_ids++;
      }
      for (const id of qs) {
        if (bankQuestion(id)) questionIds.push(id as string);
        else counts.unknown_ids++;
      }
    } catch {
      sourceIds = [];
      questionIds = [];
    }
  }
  sourceIds = Array.from(new Set(sourceIds)).slice(0, 12);
  questionIds = Array.from(new Set(questionIds)).slice(0, 10);
  if (!sourceIds.length && !questionIds.length) {
    const picks = plainPicks(state);
    return { picks, counts: { ...counts, sources: picks.sourceIds.length, questions: picks.questionIds.length } };
  }
  // Partial picks: fill from the defaults so the checklist is never thin.
  if (questionIds.length < 4) {
    for (const id of DEFAULT_QUESTION_IDS) if (questionIds.length < 4 && !questionIds.includes(id)) questionIds.push(id);
  }
  if (!sourceIds.includes("us-ccrc-licensing-comparison")) sourceIds.push("us-ccrc-licensing-comparison");
  counts.sources = sourceIds.length;
  counts.questions = questionIds.length;
  counts.model_reply_used = true;
  return { picks: { v: 2, sourceIds, questionIds, generatedBy: "ai" }, counts };
}

// ------------------------------------------------------------ rendering --

/**
 * Fill a bank line's slots. Function replacers, so "$&", "$`" or "$'" in a
 * value is taken literally; {job} last, so a typed job containing "{source}"
 * or "{state}" is never expanded (security r2 N3).
 */
export function fill(text: string, slots: { state: string; job: string; source?: string }): string {
  return text
    .replace(/\{state\}/g, () => slots.state)
    .replace(/\{source\}/g, () => slots.source ?? "")
    .replace(/\{job\}/g, () => slots.job);
}

/** Build every line from the banks and the list. Ids no longer showable
 *  (marked UNVERIFIED or removed since) simply drop out. */
export function renderChecklist(
  state: string,
  picks: Picks,
  typed: { job?: string | null } = {}
): ChecklistView {
  const stateName = STATE_NAMES[state] ?? state;
  const jobShown = safeJobSlot(typed.job ?? null);
  const slots = { state: stateName, job: jobShown };
  const sources: ShownSource[] = [];
  for (const id of picks.sourceIds) {
    const s = showableSourceById(id);
    if (s && (s.id.startsWith(state.toLowerCase() + "-") || s.id.startsWith("us-"))) sources.push(s);
  }
  const typedUrl = typedUrlFrom(typed.job ?? null);
  if (typedUrl) {
    sources.push({
      id: "you-typed",
      title: "The link you gave",
      whatItIs: "You typed this link. We did not check it.",
      url: typedUrl,
      kind: "reference",
      topic: "reference",
      asOf: "",
      label: "Verify before relying",
      from: "you",
    });
  }
  const ofTopic = (...topics: string[]) => sources.filter((s) => s.from === "list" && topics.includes(s.topic)).map((s) => s.id);
  const steps: Array<{ id: string; text: string; sourceIds: string[] }> = [];
  const add = (step: BankStep, ids: string[]) => steps.push({ id: step.id, text: fill(step.text, slots), sourceIds: ids });
  add(STEP_BANK.findBoard, ofTopic("licensing_board"));
  const pre = ofTopic("predetermination");
  add(pre.length ? STEP_BANK.predetermination : STEP_BANK.askReview, pre);
  if (ofTopic("licensing_law").length) add(STEP_BANK.licensingLaw, ofTopic("licensing_law"));
  if (ofTopic("hiring_law").length) add(STEP_BANK.hiringLaw, ofTopic("hiring_law"));
  if (ofTopic("record_relief").length) add(STEP_BANK.recordRelief, ofTopic("record_relief"));
  if (ofTopic("federal_license").length) add(STEP_BANK.federal, ofTopic("federal_license"));
  if (ofTopic("background_checks").length) add(STEP_BANK.backgroundChecks, ofTopic("background_checks"));
  if (ofTopic("bonding").length) add(STEP_BANK.bonding, ofTopic("bonding"));
  if (ofTopic("reference").length) add(STEP_BANK.reference, ofTopic("reference"));
  add(STEP_BANK.notes, []);

  // {source} questions take the first picked state law source, else drop out.
  const lawSource = sources.find((s) => s.from === "list" && !s.id.startsWith("us-") && ["licensing_law", "predetermination", "hiring_law"].includes(s.topic));
  const questions: Array<{ id: string; text: string }> = [];
  for (const id of picks.questionIds) {
    const q = bankQuestion(id);
    if (!q) continue;
    if (q.text.includes("{source}") && !lawSource) continue;
    questions.push({ id: q.id, text: fill(q.text, { ...slots, source: lawSource?.title }) });
  }
  return {
    state,
    stateName,
    jobShown,
    steps,
    questions,
    sources,
    picks,
    generatedBy: picks.generatedBy,
    sourceListAsOf: SOURCE_LIST_AS_OF,
    notAVerdict: RECORD_CHECK_COPY.notAVerdict,
  };
}

// ---------------------------------------------------------- body readers --

const BUILD_KEYS = new Set(["offense", "state", "job"]);

/** Exactly three fields. Anything else is refused, so a client cannot send
 *  more than the check needs (a name, a resume, other record answers). */
export function readBuildBody(body: unknown): { input: RecordCheckInput } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Invalid body" };
  const extra = Object.keys(body as object).filter((k) => !BUILD_KEYS.has(k));
  if (extra.length) return { error: "Only offense, state and job are accepted." };
  const b = body as Record<string, unknown>;
  const offense = typeof b.offense === "string" ? b.offense.trim() : "";
  const job = typeof b.job === "string" ? b.job.trim() : "";
  if (!offense) return { error: "Tell us your record in your own words." };
  if (offense.length > OFFENSE_MAX) return { error: `Keep it under ${OFFENSE_MAX} characters.` };
  if (!job) return { error: "Tell us the job or license you want." };
  if (job.length > JOB_MAX) return { error: `Keep the job under ${JOB_MAX} characters.` };
  if (!isStateCode(b.state)) return { error: "Pick a state." };
  return { input: { offense, state: b.state, job } };
}

const SAVE_KEYS = new Set(["state", "sourceIds", "questionIds", "generatedBy", "keepTyped", "job", "offense"]);

/** Ids only, re-checked against the list and the bank. The job and the record
 *  come along only with keepTyped, and are refused otherwise. */
export function readSaveBody(
  body: unknown
): { state: string; picks: Picks; typed: { job: string; offense: string } | null } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Invalid body" };
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => !SAVE_KEYS.has(k))) return { error: "Unexpected field." };
  if (!isStateCode(b.state)) return { error: "Pick a state." };
  const state = b.state;
  const keep = b.keepTyped === true;
  if (!keep && (b.job !== undefined || b.offense !== undefined)) {
    return { error: "What you typed is only sent when you tick the box to keep it." };
  }
  let typed: { job: string; offense: string } | null = null;
  if (keep) {
    const job = typeof b.job === "string" ? b.job.trim() : "";
    const offense = typeof b.offense === "string" ? b.offense.trim() : "";
    if (!job || !offense || job.length > JOB_MAX || offense.length > OFFENSE_MAX) return { error: "Nothing typed to keep." };
    typed = { job, offense };
  }
  const allowed = new Set(showableSourcesFor(state).map((s) => s.id));
  const sourceIds = Array.from(
    new Set((Array.isArray(b.sourceIds) ? b.sourceIds : []).filter((id): id is string => typeof id === "string" && allowed.has(id)))
  ).slice(0, 12);
  const questionIds = Array.from(
    new Set((Array.isArray(b.questionIds) ? b.questionIds : []).filter((id): id is string => !!bankQuestion(id)))
  ).slice(0, 10);
  if (!sourceIds.length && !questionIds.length) return { error: "Nothing to save." };
  return { state, typed, picks: { v: 2, sourceIds, questionIds, generatedBy: b.generatedBy === "ai" ? "ai" : "plain" } };
}

// --------------------------------------------------------------- guards --

/** A read from another origin (any steelmanresumes.com page is same-site). */
function isSameOriginRead(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}

async function gate(
  req: Request,
  deps: RecordCheckDeps,
  { needConsent, write, tier = true }: { needConsent: boolean; write: boolean; tier?: boolean }
): Promise<{ userId: string } | { res: Response }> {
  if (write ? !isSameOriginJsonPost(req.headers) : !isSameOriginRead(req.headers)) {
    return { res: json({ error: "Forbidden", code: "not_same_origin" }, 403) };
  }
  const userId = await deps.userId();
  if (!userId) return { res: json({ error: "Please sign in to use this feature." }, 401) };
  if (await deps.actingForSomeoneElse()) {
    return { res: json({ error: RECORD_CHECK_COPY.staffBlocked, code: "staff_cannot_consent" }, 403) };
  }
  // Withdrawing (revoke, delete, reading what is saved in order to delete it)
  // never depends on a tier (security r2 N2). Only using the step does.
  if (tier && !(await deps.tierAllowed(userId))) {
    return { res: json({ error: "This tool requires a higher access tier." }, 403) };
  }
  if (needConsent && !(await hasCurrentConsent(deps, userId))) return { res: consentNeeded() };
  return { userId };
}

async function hasCurrentConsent(deps: RecordCheckDeps, userId: string): Promise<boolean> {
  const c = await deps.consentStatus(userId);
  return c.granted && c.version === RECORD_CHECK_CONSENT_VERSION;
}
function consentNeeded() {
  return json({ error: "Your yes is needed first.", code: "consent_required" }, 409);
}

async function readJson(req: Request, max: number): Promise<{ body: unknown } | { res: Response }> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > max) return { res: json({ error: "Request too large" }, 413) };
  try {
    const text = await req.text();
    if (text.length > max) return { res: json({ error: "Request too large" }, 413) };
    return { body: JSON.parse(text || "{}") };
  } catch {
    // Never log the parse error: it can quote the body.
    return { res: json({ error: "Invalid body" }, 400) };
  }
}

// --------------------------------------------------------------- routes --

/** POST /api/record-check: build one checklist. */
export async function handleBuild(req: Request, deps: RecordCheckDeps): Promise<Response> {
  const g = await gate(req, deps, { needConsent: true, write: true });
  if ("res" in g) return g.res;
  const r = await readJson(req, 8_000);
  if ("res" in r) return r.res;
  const parsed = readBuildBody(r.body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  const input = parsed.input;

  let reply: string | null = null;
  if (deps.mock) {
    reply = deps.mockReply;
  } else {
    // Re-check the yes right before anything is sent (a revoke may have landed
    // while the body was read).
    if (!(await hasCurrentConsent(deps, g.userId))) return consentNeeded();
    const prompt = buildRecordCheckPrompt(input);
    const controller = new AbortController();
    track(g.userId, controller);
    const timer = setTimeout(() => controller.abort("timeout"), deps.timeoutMs ?? BUILD_TIMEOUT_MS);
    try {
      reply = await deps.callModel(prompt.system, prompt.user, g.userId, controller.signal);
    } catch (err) {
      deps.logError("build", controller.signal.aborted ? `aborted_${String(controller.signal.reason)}` : safeErrorLabel(err));
      reply = null;
    } finally {
      clearTimeout(timer);
      untrack(g.userId, controller);
    }
    if (controller.signal.aborted && controller.signal.reason === "revoked") return consentNeeded();
  }
  // And again before anything is sent back: a revoke on another server
  // instance discards this result.
  if (!(await hasCurrentConsent(deps, g.userId))) return consentNeeded();

  const { picks, counts } = picksFromReply(input.state, reply);
  const checklist = renderChecklist(input.state, picks, { job: input.job });
  try {
    await deps.logDecision({ userId: g.userId, summary: { ...counts, generated_by: picks.generatedBy, consent_version: RECORD_CHECK_CONSENT_VERSION } });
  } catch (err) {
    deps.logError("decision_log", safeErrorLabel(err));
  }
  return json({ checklist });
}

/** GET /api/record-check/consent */
export async function handleConsentGet(req: Request, deps: RecordCheckDeps): Promise<Response> {
  if (!isSameOriginRead(req.headers)) return json({ error: "Forbidden", code: "not_same_origin" }, 403);
  const userId = await deps.userId();
  if (!userId) return json({ error: "Please sign in to use this feature." }, 401);
  const staff = await deps.actingForSomeoneElse();
  // No tier check: a person must always be able to see their yes to take it back.
  const c = await deps.consentStatus(userId);
  return json({
    granted: c.granted && c.version === RECORD_CHECK_CONSENT_VERSION,
    grantedAt: c.granted ? c.grantedAt : null,
    currentVersion: RECORD_CHECK_CONSENT_VERSION,
    staffBlocked: staff,
  });
}

/** POST /api/record-check/consent: the person ticked the box. */
export async function handleConsentPost(req: Request, deps: RecordCheckDeps): Promise<Response> {
  const g = await gate(req, deps, { needConsent: false, write: true });
  if ("res" in g) return g.res;
  const r = await readJson(req, 2_000);
  if ("res" in r) return r.res;
  const b = r.body as Record<string, unknown>;
  if (!b || b.ticked !== true) return json({ error: "Tick the box to say yes." }, 400);
  if (b.textVersion !== RECORD_CHECK_CONSENT_VERSION) {
    return json({ error: "The words changed. Read them again.", code: "version_mismatch" }, 409);
  }
  const { grantedAt } = await deps.grantConsent(g.userId, RECORD_CHECK_CONSENT_VERSION);
  return json({ granted: true, grantedAt, version: RECORD_CHECK_CONSENT_VERSION });
}

/** DELETE /api/record-check/consent: take back the yes, delete saved checks. */
export async function handleConsentDelete(req: Request, deps: RecordCheckDeps): Promise<Response> {
  const g = await gate(req, deps, { needConsent: false, write: true, tier: false });
  if ("res" in g) return g.res;
  const cancelled = cancelInflightBuilds(g.userId);
  try {
    const { deleted } = await deps.revokeAndDeleteAll(g.userId);
    return json({ revoked: true, deleted, cancelled });
  } catch (err) {
    deps.logError("revoke", safeErrorLabel(err));
    return json({ error: "That did not go through. Nothing changed. Try again." }, 500);
  }
}

/** GET /api/record-check/saved (list, no typed text) or ?id= (one, opened). */
export async function handleSavedGet(req: Request, deps: RecordCheckDeps): Promise<Response> {
  const g = await gate(req, deps, { needConsent: false, write: false, tier: false });
  if ("res" in g) return g.res;
  const id = new URL(req.url).searchParams.get("id");
  try {
    if (id === null) {
      const rows = await deps.store.list(g.userId);
      return json({ saved: rows.map((r) => ({ ...r, stateName: STATE_NAMES[r.state] ?? r.state })) });
    }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Invalid id" }, 400);
    const one = await deps.store.get(g.userId, id);
    if (one === null) return json({ error: "Not found" }, 404);
    if (one === "unreadable") return json({ error: RECORD_CHECK_COPY.unreadable, code: "unreadable" }, 422);
    return json({
      saved: {
        id: one.id,
        createdAt: one.createdAt,
        keptTyped: one.keptTyped,
        typed: one.typed,
        checklist: renderChecklist(one.state, one.picks, { job: one.typed?.job ?? null }),
      },
    });
  } catch (err) {
    deps.logError("saved_get", safeErrorLabel(err));
    return json({ error: "Could not load saved checklists." }, 500);
  }
}

/** POST /api/record-check/saved: "Save this checklist". */
export async function handleSavedPost(req: Request, deps: RecordCheckDeps): Promise<Response> {
  const g = await gate(req, deps, { needConsent: true, write: true });
  if ("res" in g) return g.res;
  const r = await readJson(req, 8_000);
  if ("res" in r) return r.res;
  const parsed = readSaveBody(r.body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  try {
    // The store writes only while the current yes stands (one statement).
    const saved = await deps.store.save({ userId: g.userId, ...parsed, consentVersion: RECORD_CHECK_CONSENT_VERSION });
    if (!saved.ok) {
      return saved.reason === "cap"
        ? json({ error: RECORD_CHECK_COPY.capReached, code: "cap" }, 409)
        : consentNeeded();
    }
    return json({ saved: { id: saved.id, createdAt: saved.createdAt, keptTyped: parsed.typed !== null } });
  } catch (err) {
    deps.logError("save", safeErrorLabel(err));
    return json({ error: "Could not save. Try again." }, 500);
  }
}

/** DELETE /api/record-check/saved?id= */
export async function handleSavedDelete(req: Request, deps: RecordCheckDeps): Promise<Response> {
  const g = await gate(req, deps, { needConsent: false, write: true, tier: false });
  if ("res" in g) return g.res;
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Invalid id" }, 400);
  const ok = await deps.store.deleteOne(g.userId, id);
  return json({ deleted: ok }, ok ? 200 : 404);
}
