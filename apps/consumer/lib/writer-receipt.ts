/**
 * The writer's receipt (Phase 5 R1, review M1). Server only.
 *
 * Two inputs to the finish gate are not the person's words but SERVER
 * outputs: the documents exactly as the writer delivered them (`written`) and
 * the second check's grounding (`grounding`, from /api/forge/generate-docs).
 * A page could drop or edit them to look finished. So generate-docs signs
 * them: an HMAC over exactly those values, keyed with the server secret. The
 * page keeps the receipt with its documents (signed out too: before the wall,
 * a signed-out run has nothing on the server to store them against) and sends it back. The
 * server trusts written and grounding ONLY when the receipt matches them;
 * otherwise they count for nothing and the version cannot be finished.
 *
 * A receipt proves "this server wrote these documents and this check", not
 * who holds it; the person's own words, answers and confirmations are theirs
 * by definition, and the gate re-runs on them every time.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { stableJson } from "@crucible/core/src/artifactRevision";
import { serverHashSecret } from "@crucible/core/src/serverHashSecret";

const PREFIX = "wr1.";

function key(): Buffer {
  return createHash("sha256").update(`smr-writer-receipt:${serverHashSecret("sign writer receipts")}`).digest();
}

function body(written: { resume: string; letter: string }, grounding: unknown): string {
  return stableJson({ r: written.resume, l: written.letter, g: grounding ?? null });
}

/** The receipt for the writer's documents and their check, exactly as delivered. */
export function writerReceipt(written: { resume: string; letter: string }, grounding: unknown): string {
  return PREFIX + createHmac("sha256", key()).update(body(written, grounding)).digest("hex");
}

/** True only when the receipt was made by this server for exactly these values. */
export function verifyWriterReceipt(receipt: unknown, written: { resume: string; letter: string } | null | undefined, grounding: unknown): boolean {
  if (typeof receipt !== "string" || !receipt.startsWith(PREFIX) || !written) return false;
  if (typeof written.resume !== "string" || typeof written.letter !== "string") return false;
  const want = Buffer.from(writerReceipt(written, grounding));
  const got = Buffer.from(receipt);
  return want.length === got.length && timingSafeEqual(want, got);
}
