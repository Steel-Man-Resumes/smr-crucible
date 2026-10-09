/**
 * The record check route handlers (D11), with their dependencies passed in so
 * the tests can run them with no network, no database and no real AI.
 *
 * Data flow, in one place:
 *   - The person's offense, state and job arrive in ONE request to
 *     /api/record-check, only after a ticked, versioned, revocable yes.
 *   - The offense goes into this route's own prompt and to Anthropic only.
 *     It is not stored, not logged, not put in decision_log or ai usage
 *     rows, and not returned (the reply carries the checklist).
 *   - Saving is a separate request. The offense is stored (sealed) only when
 *     the person ticked "keep what I typed"; the default is not to.
 *   - Taking back the yes deletes every saved checklist.
 *   - Staff acting as the person (assist or view mode) can do none of this.
 */

import { RECORD_CHECK_CONSENT_VERSION, RECORD_CHECK_COPY } from "./copy";
import { buildRecordCheckPrompt, JOB_MAX, OFFENSE_MAX, type RecordCheckInput } from "./prompt";
import { cleanLine, safeErrorLabel, typedUrlFrom, type LineDrop } from "./guard";
import {
  showableSourceById,
  showableSourcesFor,
  SOURCE_LIST_AS_OF,
  missingTopicsFor,
  type ShownSource,
  type SourceTopic,
} from "./sources";
import { isStateCode, STATE_NAMES } from "./states";
import { plainPunctuation } from "@/lib/legal-sanitize";

// ---------------------------------------------------------------- types --

export interface ChecklistStep {
  text: string;
  sourceIds: string[];
}

/** What is saved (sealed) for a checklist. Source ids, never URLs. */
export interface StoredChecklist {
  v: 1;
  state: string;
  steps: ChecklistStep[];
  questions: string[];
  sourceIds: string[];
  typedUrl: string | null;
  generatedBy: "ai" | "plain";
  sourceListAsOf: string;
}

/** What the page shows. Sources rendered from the list at read time. */
export interface ChecklistView extends StoredChecklist {
  stateName: string;
  job: string;
  sources: ShownSource[];
  notAVerdict: string;
}

export interface SavedRow {
  id: string;
  state: string;
  job: string;
  checklist: unknown;
  offense: string | null;
  createdAt: string;
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
  consentStatus: (userId: string) => Promise<ConsentState>;
  grantConsent: (userId: string, version: string) => Promise<{ grantedAt: string }>;
  revokeConsent: (userId: string) => Promise<void>;
  store: {
    save: (p: { userId: string; state: string; job: string; checklist: StoredChecklist; offense: string | null }) => Promise<{ id: string; createdAt: string }>;
    list: (userId: string) => Promise<SavedRow[]>;
    deleteOne: (userId: string, id: string) => Promise<boolean>;
    deleteAll: (userId: string) => Promise<number>;
  };
  /** One model call. Implemented with callAI(..., { anthropicOnly: true }). */
  callModel: (system: string, user: string, userId: string) => Promise<string>;
  mock: boolean;
  mockReply: string;
  /** Counts and fixed labels only. Never anything the person typed. */
  logDecision: (entry: { userId: string; state: string; summary: Record<string, string | number | boolean> }) => Promise<void>;
  /** A fixed label only (safeErrorLabel). */
  logError: (where: string, label: string) => void;
}

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...NO_STORE },
  });
}

// --------------------------------------------------------- plain checklist --

const PLAIN_QUESTIONS = [
  "Do you review a record before someone applies or trains? How do I ask, and what does it cost?",
  "Which parts of a record does the board look at for this license, and for how long?",
  "What papers should I bring about my record and what I have done since?",
  "If the board has concerns, how do I respond, and how long do I have?",
  "Does a sealed or cleared record still count for this license?",
];

function idsForTopic(state: string, topic: SourceTopic): string[] {
  return showableSourcesFor(state)
    .filter((s) => s.id.startsWith(state.toLowerCase() + "-") && s.topic === topic)
    .map((s) => s.id);
}

/** The checklist with no model at all: fixed steps, list sources only. */
export function plainSteps(state: string): ChecklistStep[] {
  const missing = new Set(missingTopicsFor(state));
  const steps: ChecklistStep[] = [
    { text: "Find the licensing board for this work in your state. Look for its page about records.", sourceIds: idsForTopic(state, "licensing_board") },
  ];
  steps.push(
    missing.has("predetermination")
      ? { text: "Ask the board if it will look at your record before you apply or pay for training.", sourceIds: [] }
      : { text: "Ask the board for a review of your record before you pay for training.", sourceIds: idsForTopic(state, "predetermination") }
  );
  if (!missing.has("licensing_law")) {
    steps.push({ text: "Read your state's law on how licensing boards may use a record.", sourceIds: idsForTopic(state, "licensing_law") });
  }
  steps.push({ text: "Ask about sealing or clearing options for your record.", sourceIds: idsForTopic(state, "record_relief") });
  steps.push({ text: "Check whether a federal rule covers this kind of work.", sourceIds: [] });
  steps.push({ text: "Write down what the board tells you, with the date and the name of who you talked to.", sourceIds: [] });
  return steps;
}

// ------------------------------------------------------------ build logic --

export interface BuildCounts {
  steps: number;
  questions: number;
  dropped_verdict: number;
  dropped_link_or_citation: number;
  dropped_other: number;
  unknown_source_ids: number;
}

/**
 * Turn a model reply (or null, when there was no usable reply) into a
 * checklist. Every model line is cleaned: verdicts, links and citations are
 * dropped, the person's own offense words are replaced with "your record".
 * Source ids not on the list for this state are dropped.
 */
export function buildChecklist(
  input: RecordCheckInput,
  reply: string | null
): { checklist: ChecklistView; counts: BuildCounts } {
  const { state, offense } = input;
  const job = input.job.trim().slice(0, JOB_MAX);
  const allowed = new Set(showableSourcesFor(state).map((s) => s.id));
  const counts: BuildCounts = { steps: 0, questions: 0, dropped_verdict: 0, dropped_link_or_citation: 0, dropped_other: 0, unknown_source_ids: 0 };
  const noteDrop = (d: LineDrop) => {
    if (d === "verdict") counts.dropped_verdict++;
    else if (d === "link_or_citation") counts.dropped_link_or_citation++;
    else counts.dropped_other++;
  };

  let steps: ChecklistStep[] = [];
  let questions: string[] = [];
  let parsedOk = false;
  if (reply) {
    try {
      const m = reply.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : null;
      if (parsed && typeof parsed === "object") {
        parsedOk = true;
        for (const s of Array.isArray(parsed.steps) ? parsed.steps.slice(0, 10) : []) {
          const c = cleanLine(s?.text, offense);
          if ("drop" in c) { noteDrop(c.drop); continue; }
          const ids: string[] = [];
          for (const id of Array.isArray(s?.source_ids) ? s.source_ids : []) {
            if (typeof id === "string" && allowed.has(id)) ids.push(id);
            else counts.unknown_source_ids++;
          }
          steps.push({ text: c.text, sourceIds: Array.from(new Set(ids)) });
        }
        for (const q of Array.isArray(parsed.questions) ? parsed.questions.slice(0, 10) : []) {
          const c = cleanLine(q, offense);
          if ("drop" in c) { noteDrop(c.drop); continue; }
          questions.push(c.text);
        }
      }
    } catch {
      parsedOk = false;
    }
  }
  const generatedBy: "ai" | "plain" = parsedOk && (steps.length >= 2 || questions.length >= 2) ? "ai" : "plain";
  if (steps.length < 2) steps = plainSteps(state);
  if (questions.length < 2) questions = [...PLAIN_QUESTIONS];
  steps = dedupe(steps, (s) => s.text.toLowerCase()).slice(0, 8);
  questions = dedupe(questions, (q) => q.toLowerCase()).slice(0, 8);
  // Model text only: plain lines are already written without dashes.
  ({ steps, questions } = plainPunctuation({ steps, questions }));

  const sourceIds = chooseSourceIds(state, steps);
  const typedUrl = typedUrlFrom(job);
  counts.steps = steps.length;
  counts.questions = questions.length;
  const stored: StoredChecklist = {
    v: 1,
    state,
    steps,
    questions,
    sourceIds,
    typedUrl,
    generatedBy,
    sourceListAsOf: SOURCE_LIST_AS_OF,
  };
  return { checklist: renderChecklist(stored, job), counts };
}

function dedupe<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Every showable source for the state, plus federal ones a step points at,
 *  plus the national licensing table. Ids only. */
function chooseSourceIds(state: string, steps: ChecklistStep[]): string[] {
  const stateIds = showableSourcesFor(state).filter((s) => !s.id.startsWith("us-")).map((s) => s.id);
  const stepFederal = steps.flatMap((s) => s.sourceIds).filter((id) => id.startsWith("us-"));
  return Array.from(new Set([...stateIds, ...stepFederal, "us-ccrc-licensing-comparison"])).filter(
    (id) => showableSourceById(id) !== null
  );
}

/** Render a stored checklist for the page. Ids that are no longer showable
 *  (marked UNVERIFIED or removed since) simply drop out. */
export function renderChecklist(stored: StoredChecklist, job: string): ChecklistView {
  const sources: ShownSource[] = [];
  for (const id of stored.sourceIds) {
    const s = showableSourceById(id);
    if (s) sources.push(s);
  }
  if (stored.typedUrl) {
    sources.push({
      id: "you-typed",
      title: "The link you gave",
      whatItIs: "You typed this link. We did not check it.",
      url: stored.typedUrl,
      kind: "reference",
      topic: "reference",
      asOf: "",
      label: "Verify before relying",
      from: "you",
    });
  }
  const steps = stored.steps.map((s) => ({ text: s.text, sourceIds: s.sourceIds.filter((id) => showableSourceById(id) !== null) }));
  return {
    ...stored,
    steps,
    stateName: STATE_NAMES[stored.state] ?? stored.state,
    job,
    sources,
    notAVerdict: RECORD_CHECK_COPY.notAVerdict,
  };
}

// ---------------------------------------------------------- body readers --

const BUILD_KEYS = new Set(["offense", "state", "job"]);

/** Exactly three fields. Anything else is refused, so a client cannot send
 *  more than the check needs (a name, a resume, other record answers). */
export function readBuildBody(body: unknown): { input: RecordCheckInput } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Invalid body" };
  const keys = Object.keys(body as object);
  const extra = keys.filter((k) => !BUILD_KEYS.has(k));
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

const SAVE_KEYS = new Set(["state", "job", "checklist", "keepOffense", "offense"]);

/** Re-check a checklist the client sends back to save. Lines are cleaned
 *  again; ids must be showable; the typed link is recomputed from the job. */
export function readSaveBody(
  body: unknown
): { state: string; job: string; checklist: StoredChecklist; offense: string | null } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Invalid body" };
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => !SAVE_KEYS.has(k))) return { error: "Unexpected field." };
  if (!isStateCode(b.state)) return { error: "Pick a state." };
  const state = b.state;
  const job = typeof b.job === "string" ? b.job.trim().slice(0, JOB_MAX) : "";
  const c = b.checklist as Record<string, unknown> | undefined;
  if (!c || typeof c !== "object") return { error: "Nothing to save." };
  const keep = b.keepOffense === true;
  const offenseRaw = typeof b.offense === "string" ? b.offense.trim() : "";
  if (keep && (!offenseRaw || offenseRaw.length > OFFENSE_MAX)) return { error: "Nothing typed to keep." };
  const offense = keep ? offenseRaw : null;

  const allowed = new Set(showableSourcesFor(state).map((s) => s.id));
  const steps: ChecklistStep[] = [];
  for (const s of Array.isArray(c.steps) ? (c.steps as unknown[]).slice(0, 10) : []) {
    const r = cleanLine((s as Record<string, unknown>)?.text, null);
    if ("drop" in r) continue;
    const idsRaw = (s as Record<string, unknown>)?.sourceIds;
    const ids = (Array.isArray(idsRaw) ? idsRaw : []).filter((id): id is string => typeof id === "string" && allowed.has(id));
    steps.push({ text: r.text, sourceIds: Array.from(new Set(ids)) });
  }
  const questions: string[] = [];
  for (const q of Array.isArray(c.questions) ? (c.questions as unknown[]).slice(0, 10) : []) {
    const r = cleanLine(q, null);
    if (!("drop" in r)) questions.push(r.text);
  }
  if (!steps.length && !questions.length) return { error: "Nothing to save." };
  const sourceIdsRaw = Array.isArray(c.sourceIds) ? (c.sourceIds as unknown[]) : [];
  const sourceIds = Array.from(
    new Set(sourceIdsRaw.filter((id): id is string => typeof id === "string" && allowed.has(id)))
  );
  return {
    state,
    job,
    offense,
    checklist: {
      v: 1,
      state,
      steps,
      questions,
      sourceIds,
      typedUrl: typedUrlFrom(job),
      generatedBy: c.generatedBy === "ai" ? "ai" : "plain",
      sourceListAsOf: SOURCE_LIST_AS_OF,
    },
  };
}

// --------------------------------------------------------------- guards --

async function gate(
  deps: RecordCheckDeps,
  { needConsent }: { needConsent: boolean }
): Promise<{ userId: string } | { res: Response }> {
  const userId = await deps.userId();
  if (!userId) return { res: json({ error: "Please sign in to use this feature." }, 401) };
  if (await deps.actingForSomeoneElse()) {
    return { res: json({ error: RECORD_CHECK_COPY.staffBlocked, code: "staff_cannot_consent" }, 403) };
  }
  if (needConsent) {
    const c = await deps.consentStatus(userId);
    if (!c.granted || c.version !== RECORD_CHECK_CONSENT_VERSION) {
      return { res: json({ error: "Your yes is needed first.", code: "consent_required" }, 409) };
    }
  }
  return { userId };
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
  const g = await gate(deps, { needConsent: true });
  if ("res" in g) return g.res;
  const r = await readJson(req, 8_000);
  if ("res" in r) return r.res;
  const parsed = readBuildBody(r.body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  const input = parsed.input;

  const prompt = buildRecordCheckPrompt(input);
  let reply: string | null = null;
  if (deps.mock) {
    reply = deps.mockReply;
  } else {
    try {
      reply = await deps.callModel(prompt.system, prompt.user, g.userId);
    } catch (err) {
      deps.logError("build", safeErrorLabel(err));
      reply = null;
    }
  }
  const { checklist, counts } = buildChecklist(input, reply);
  try {
    await deps.logDecision({
      userId: g.userId,
      state: input.state,
      summary: { ...counts, generated_by: checklist.generatedBy, sources: checklist.sources.length, consent_version: RECORD_CHECK_CONSENT_VERSION },
    });
  } catch (err) {
    deps.logError("decision_log", safeErrorLabel(err));
  }
  return json({ checklist });
}

/** GET /api/record-check/consent */
export async function handleConsentGet(deps: RecordCheckDeps): Promise<Response> {
  const userId = await deps.userId();
  if (!userId) return json({ error: "Please sign in to use this feature." }, 401);
  const staff = await deps.actingForSomeoneElse();
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
  const g = await gate(deps, { needConsent: false });
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
export async function handleConsentDelete(deps: RecordCheckDeps): Promise<Response> {
  const g = await gate(deps, { needConsent: false });
  if ("res" in g) return g.res;
  await deps.revokeConsent(g.userId);
  let deleted = 0;
  try {
    deleted = await deps.store.deleteAll(g.userId);
  } catch (err) {
    deps.logError("revoke_delete", safeErrorLabel(err));
    return json({ error: "Your yes is taken back, but deleting saved checklists failed. Try again.", revoked: true }, 500);
  }
  return json({ revoked: true, deleted });
}

/** GET /api/record-check/saved */
export async function handleSavedGet(deps: RecordCheckDeps): Promise<Response> {
  const g = await gate(deps, { needConsent: false });
  if ("res" in g) return g.res;
  try {
    const rows = await deps.store.list(g.userId);
    const saved = rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      offense: row.offense,
      keptOffense: row.offense !== null,
      checklist: isStored(row.checklist) ? renderChecklist(row.checklist, row.job) : null,
    }));
    return json({ saved });
  } catch (err) {
    deps.logError("list", safeErrorLabel(err));
    return json({ error: "Could not load saved checklists." }, 500);
  }
}

function isStored(x: unknown): x is StoredChecklist {
  const c = x as StoredChecklist;
  return !!c && c.v === 1 && Array.isArray(c.steps) && Array.isArray(c.questions) && Array.isArray(c.sourceIds);
}

/** POST /api/record-check/saved: "Save this checklist". */
export async function handleSavedPost(req: Request, deps: RecordCheckDeps): Promise<Response> {
  const g = await gate(deps, { needConsent: true });
  if ("res" in g) return g.res;
  const r = await readJson(req, 30_000);
  if ("res" in r) return r.res;
  const parsed = readSaveBody(r.body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  try {
    const saved = await deps.store.save({ userId: g.userId, ...parsed });
    return json({ saved: { id: saved.id, createdAt: saved.createdAt, keptOffense: parsed.offense !== null } });
  } catch (err) {
    deps.logError("save", safeErrorLabel(err));
    return json({ error: "Could not save. Try again." }, 500);
  }
}

/** DELETE /api/record-check/saved?id= */
export async function handleSavedDelete(req: Request, deps: RecordCheckDeps): Promise<Response> {
  const g = await gate(deps, { needConsent: false });
  if ("res" in g) return g.res;
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Invalid id" }, 400);
  const ok = await deps.store.deleteOne(g.userId, id);
  return json({ deleted: ok }, ok ? 200 : 404);
}
