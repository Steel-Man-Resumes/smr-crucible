/**
 * "Check it again" (Phase 5 R1, review r3 M-1). Server only.
 *
 * A finished page whose writer's receipt is missing or no longer accepted
 * (a finish from before receipts, a rotated key past its grace period, a run
 * cookie that is gone) can only be a draft on the server, and has no card the
 * person could answer. This re-runs the second check on the CURRENT documents
 * against the person's own words (their source, plus the answers they gave on
 * the finish page), and signs a fresh receipt over the writer's documents as
 * delivered and the new check, bound like any receipt (account or run cookie,
 * run, server-worked source, nonce, time). It rewrites nothing and keeps every
 * answer. Anything the check now flags comes back as a card, as on a new run.
 *
 * The verifier is passed in, so tests never reach a model.
 */

import { buildTrustedSource } from "./grounding-verify";
import type { verifyGrounding as VerifyFn } from "./grounding-verify";
import { accountFlags } from "./grounding-accounting";
import { credentialStatuses, findOverstatedCredentialLines, findOverstatedCredentials } from "./credential-truth";
import { plainPunctuationText } from "./legal-sanitize";
import { MAX_RENDER_CHARS } from "./resume-render";
import { writerReceipt, writerSourceFrom } from "./writer-receipt";

export interface RecheckDeps {
  verify: typeof VerifyFn;
  /** Signed in: keep the newest nonce for the run (packages/core recordWriterReceipt). */
  record?: (userId: string, runId: string, nonce: string, issuedAtMs: number) => Promise<void>;
  /** A fresh random nonce and run-cookie value (tests pass fixed ones). */
  random: () => string;
  now?: () => number;
}

export type RecheckResult =
  | { ok: true; grounding: Record<string, unknown>; receipt: string; runCookie: string | null }
  | { ok: false; status: number; error: string };

const isDoc = (v: unknown): v is { resume: string; letter: string } =>
  !!v && typeof v === "object" && typeof (v as { resume?: unknown }).resume === "string" && typeof (v as { letter?: unknown }).letter === "string";

export async function recheckDocs(body: unknown, userId: string | null, deps: RecheckDeps): Promise<RecheckResult> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 400, error: "Invalid request" };
  const b = body as Record<string, unknown>;
  const docs = b.documents;
  const written = b.written;
  const source = (b.source && typeof b.source === "object" ? b.source : {}) as Record<string, unknown>;
  const runId = typeof b.runId === "string" ? b.runId.slice(0, 100) : "";
  if (!isDoc(docs) || !isDoc(written)) return { ok: false, status: 400, error: "Nothing to check yet." };
  if (!runId) return { ok: false, status: 400, error: "Nothing to check yet." };
  for (const t of [docs.resume, docs.letter, written.resume, written.letter]) {
    if (t.length > MAX_RENDER_CHARS) return { ok: false, status: 413, error: "That is longer than a resume or letter can be." };
  }
  if (!docs.resume.trim()) return { ok: false, status: 400, error: "Nothing to check yet." };

  // The person's own words: their source, and what they answered on the page
  // (their own words too), so a line they confirmed is not flagged again.
  const answers = Array.isArray(b.answers) ? b.answers.filter((a): a is string => typeof a === "string").slice(0, 400).map((a) => a.slice(0, 2000)) : [];
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const groundingSource = buildTrustedSource({
    resumeText: str(source.resumeText),
    userText: [
      str(source.goalNarrative),
      Array.isArray(source.goals) ? source.goals.filter((g): g is string => typeof g === "string").join(", ") : undefined,
      str(source.credentialsNote)?.slice(0, 1000),
      ...answers,
    ],
  });

  const [rc, cc] = await Promise.all([
    deps.verify({ sourceText: groundingSource, output: docs.resume, kind: "resume" }),
    deps.verify({ sourceText: groundingSource, output: docs.letter, kind: "cover_letter" }),
  ]);
  // Nothing is rewritten: every flag is measured against the documents as they are.
  const accounting = accountFlags([
    { doc: "resume", flags: rc.flags, original: docs.resume, final: docs.resume },
    { doc: "cover_letter", flags: cc.flags, original: docs.letter, final: docs.letter },
  ]);
  const statuses = credentialStatuses(groundingSource);
  const clean = (claim: string) => plainPunctuationText(claim).text.slice(0, 200);
  const known = new Set(accounting.outcomes.map((o) => `${o.doc}|${o.claim.toLowerCase()}`));
  const credentialChecks = [
    ...findOverstatedCredentialLines(docs.resume, statuses).map((claim) => ({ claim, doc: "resume" as const })),
    ...findOverstatedCredentials(docs.letter, statuses, { firstPerson: true }).map((claim) => ({ claim, doc: "cover_letter" as const })),
  ];
  const outcomes = [
    ...accounting.outcomes,
    ...credentialChecks
      .filter((c) => !known.has(`${c.doc}|${clean(c.claim).toLowerCase()}`))
      .map((c) => ({ claim: clean(c.claim), doc: c.doc, status: "credential" as const })),
  ];
  const grounding = {
    hasFabrication: rc.hasFabrication || cc.hasFabrication,
    applied: false,
    removed: 0,
    residual: outcomes.filter((o) => o.status === "still_there" || o.status === "changed" || o.status === "also_in").length,
    flags: [...rc.flags, ...cc.flags],
    outcomes,
    verifierRan: rc.verifierRan && cc.verifierRan,
    verifierRanByDoc: { resume: rc.verifierRan, cover_letter: cc.verifierRan },
    hasFabricationByDoc: { resume: rc.hasFabrication, cover_letter: cc.hasFabrication },
    unnamedByDoc: {
      resume: rc.hasFabrication && !rc.flags.some((f) => f.claim.trim()),
      cover_letter: cc.hasFabrication && !cc.flags.some((f) => f.claim.trim()),
    },
    changed: accounting.changed,
    unmatched: accounting.unmatched,
    rechecked: true,
  };

  const nonce = deps.random();
  const now = (deps.now ?? Date.now)();
  const runCookie = userId ? null : deps.random();
  const receipt = writerReceipt(written, grounding, {
    userId,
    runId,
    source: writerSourceFrom(source),
    nonce,
    now,
    ...(runCookie ? { cookie: runCookie } : {}),
  });
  if (userId && deps.record) await deps.record(userId, runId, nonce, now);
  return { ok: true, grounding, receipt, runCookie };
}
