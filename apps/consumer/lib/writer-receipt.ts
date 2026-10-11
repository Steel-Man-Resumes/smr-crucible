/**
 * The writer's receipt (Phase 5 R1, reviews M1, M-B, L-A, I-1, H2). Server only.
 *
 * Some inputs to the finish gate are not the person's own claims but SERVER
 * outputs, or must be attested by the server:
 *   - the documents exactly as the writer delivered them (`written`);
 *   - the second check's grounding (`grounding`);
 *   - the person's own words the writer worked from (the "source": their
 *     own words, their own resume lines, their licenses answer and rows).
 * A page could drop, edit or swap any of them to look finished: send the
 * whole page as "own words", or replay an older run's clean check onto newer
 * flagged text. So /api/forge/generate-docs signs them: an HMAC over the
 * written documents and the grounding, bound to
 *   sub  the account it was made for ("u:<user id>"), or, signed out, the run
 *        ("r:<run id>");
 *   run  the run (the Forge session's startedAt);
 *   src  a SHA-256 of the source block the SERVER worked out from the writer's
 *        own inputs (writerSourceFrom below);
 *   n    a random nonce: one generation;
 *   t    the time it was made.
 * Signed in, generate-docs also keeps the newest nonce per run on the server
 * (forge_writer_receipt, 081), so an older clean receipt cannot be replayed
 * onto a newer generation. On a sign-in import, a run receipt ("r:") counts
 * only when that run is the account's (its saved Forge run).
 *
 * KEYS. Derived from IP_HASH_SECRET or AUTH_SECRET with the deploy environment
 * in the label (VERCEL_ENV: preview receipts never verify in production; I-1).
 * Rotation: set WRITER_RECEIPT_PREVIOUS_SECRET to the old secret, and receipts
 * signed with it keep verifying for 14 days after they were made (L-A). A
 * signed-in person's own verified revision is also trusted as a match, so a
 * rotation never forces a regeneration.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { stableJson } from "@crucible/core/src/artifactRevision";
import { serverHashSecret } from "@crucible/core/src/serverHashSecret";
import { CREDENTIALS_KEY } from "./forge-path";
import { ownWordsFor } from "./finish-gate";
import { withholdRecordLines } from "./record-lines";
import { completeCredentialRows, readCredentialRows } from "./credential-rows";

const PREFIX = "wr2.";
/** How long a receipt signed with the previous secret keeps verifying after it was made. */
export const RECEIPT_PREVIOUS_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

/** The person's own words the writer worked from, as the server works them out. */
export interface WriterSource {
  ownWords: string;
  ownResumeText: string;
  credentialsAnswer: string;
  credentialRows: unknown[];
}

/**
 * The source block from the writer's own inputs, with the same functions the
 * finish page uses (ownWordsFor, withholdRecordLines), so an honest page
 * produces exactly this.
 */
export function writerSourceFrom(input: {
  resumeText?: unknown;
  originalResumeText?: unknown;
  goalNarrative?: unknown;
  hookNarrative?: unknown;
  credentialsNote?: unknown;
  credentialRows?: unknown;
  keepInsideLines?: unknown;
}): WriterSource {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const keep = input.keepInsideLines === true;
  const credentials = str(input.credentialsNote);
  return {
    ownWords: ownWordsFor(
      {
        resumeText: str(input.resumeText),
        goalNarrative: str(input.goalNarrative),
        hookNarrative: str(input.hookNarrative),
        challengeNarratives: credentials !== undefined ? { [CREDENTIALS_KEY]: credentials } : undefined,
      },
      keep
    ),
    ownResumeText: withholdRecordLines(str(input.originalResumeText) ?? str(input.resumeText), keep).kept,
    credentialsAnswer: credentials ?? "",
    credentialRows: completeCredentialRows(readCredentialRows(input.credentialRows)) as unknown[],
  };
}

/** SHA-256 hex of a source block (stable JSON). */
export function sourceHash(src: WriterSource): string {
  return createHash("sha256")
    .update(stableJson({ o: src.ownWords ?? "", r: src.ownResumeText ?? "", c: src.credentialsAnswer ?? "", w: src.credentialRows ?? [] }))
    .digest("hex");
}

export interface ReceiptMeta {
  v: 2;
  sub: string;
  run: string;
  src: string;
  n: string;
  t: number;
}

/** The deploy environment the key is bound to (I-1). */
export function receiptEnvironment(): string {
  return process.env.VERCEL_ENV || (process.env.NODE_ENV === "production" ? "production" : "development");
}

function keyFrom(secret: string): Buffer {
  return createHash("sha256").update(`smr-writer-receipt:${receiptEnvironment()}:${secret}`).digest();
}

function currentKey(): Buffer {
  return keyFrom(serverHashSecret("sign writer receipts"));
}

function previousKey(): Buffer | null {
  const s = process.env.WRITER_RECEIPT_PREVIOUS_SECRET;
  return s ? keyFrom(s) : null;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function mac(key: Buffer, token: string, written: { resume: string; letter: string }, grounding: unknown): string {
  return createHmac("sha256", key)
    .update(`wr2\n${token}\n${stableJson({ r: written.resume, l: written.letter, g: grounding ?? null })}`)
    .digest("hex");
}

/**
 * The receipt for one generation. Without `bind` (an old caller), the receipt
 * carries no run and is never accepted.
 */
export function writerReceipt(
  written: { resume: string; letter: string },
  grounding: unknown,
  bind?: { userId: string | null; runId: string; source: WriterSource; now?: number; nonce?: string }
): string {
  const meta: ReceiptMeta = {
    v: 2,
    sub: bind ? (bind.userId ? `u:${bind.userId}` : `r:${bind.runId}`) : "r:",
    run: bind?.runId ?? "",
    src: bind ? sourceHash(bind.source) : "",
    n: bind?.nonce ?? randomBytes(16).toString("hex"),
    t: bind?.now ?? Date.now(),
  };
  const token = b64(JSON.stringify(meta));
  return `${PREFIX}${token}.${mac(currentKey(), token, written, grounding)}`;
}

/** The receipt's fields, read WITHOUT checking its signature (for lookups; never trusted alone). */
export function readReceipt(receipt: unknown): ReceiptMeta | null {
  if (typeof receipt !== "string" || !receipt.startsWith(PREFIX) || receipt.length > 2000) return null;
  const [token] = receipt.slice(PREFIX.length).split(".");
  try {
    const m = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Partial<ReceiptMeta>;
    if (m.v !== 2 || typeof m.sub !== "string" || typeof m.run !== "string" || typeof m.src !== "string" || typeof m.n !== "string" || typeof m.t !== "number") return null;
    return m as ReceiptMeta;
  } catch {
    return null;
  }
}

/**
 * The receipt's fields when this server signed it over exactly these written
 * documents and grounding (current key; or the previous key for 14 days after
 * the receipt was made). Null otherwise.
 */
export function verifyWriterReceipt(
  receipt: unknown,
  written: { resume: string; letter: string } | null | undefined,
  grounding: unknown,
  now: number = Date.now()
): ReceiptMeta | null {
  const meta = readReceipt(receipt);
  if (!meta || !written || typeof written.resume !== "string" || typeof written.letter !== "string") return null;
  const [token, got] = (receipt as string).slice(PREFIX.length).split(".");
  if (!got) return null;
  const same = (key: Buffer) => {
    const want = Buffer.from(mac(key, token, written, grounding));
    const have = Buffer.from(got);
    return want.length === have.length && timingSafeEqual(want, have);
  };
  if (same(currentKey())) return meta;
  const prev = previousKey();
  if (prev && now - meta.t <= RECEIPT_PREVIOUS_GRACE_MS && meta.t <= now + 60_000 && same(prev)) return meta;
  return null;
}

/** Who is asking, and what the server knows about the receipt's run. */
export interface ReceiptContext {
  /** The signed-in account, or null signed out. */
  userId: string | null;
  /** Signed out: the run the page says it is. */
  runId?: string;
  /** Signed in: the newest nonce generate-docs recorded for the receipt's run (null: none recorded). */
  newestNonce?: string | null;
  /** Signed in: the receipt's run is this account's (its saved Forge run). */
  runLinked?: boolean;
}

/** Whether a verified receipt may be used here (account, run, newest generation). */
export function receiptAccepted(meta: ReceiptMeta, ctx: ReceiptContext): boolean {
  if (!meta.run) return false;
  // An older generation of the same run never stands in for the newest one.
  if (ctx.newestNonce && ctx.newestNonce !== meta.n) return false;
  if (ctx.userId) {
    if (meta.sub === `u:${ctx.userId}`) return true;
    // Made signed out, then imported: only for this account's own run.
    return meta.sub === `r:${meta.run}` && ctx.runLinked === true;
  }
  return meta.sub === `r:${meta.run}` && !!ctx.runId && ctx.runId === meta.run;
}
