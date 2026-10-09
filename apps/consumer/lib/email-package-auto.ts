/**
 * The finished package, emailed by itself (lane 3a Part 2, item 2).
 *
 * When someone signed in finishes in the Forge (FINISHED, not a draft), the
 * finish page asks this to send their package to their own account address.
 * The rules, all checked here on the server:
 *  - finished: the finish gate (lib/finish-gate.ts) is run again on what was
 *    sent, and a draft sends nothing;
 *  - only to the account's own address, and only once a REAL proof of it is
 *    on record (079 email_proof_source: an email link, a verified Google
 *    sign-in, or a reset by email; 068's backfill does not count). The
 *    request carries no address at all; nothing in it can choose a recipient;
 *  - the person can turn it off (users.forge_package_email, 079);
 *  - once per finished version: the version is claimed in the database
 *    (forge_package_email_sent, 079) before anything is sent and given back
 *    if the email does not go out; before 079 is applied, once a day;
 *  - the same per-address daily cap as the package box
 *    (lib/email-package-guard.ts);
 *  - the transport is passed in, so tests never reach a real provider.
 */

import { createHash } from "crypto";
import { buildFinishView, type DefendAnswer } from "./finish-gate";
import { EMAIL_PACKAGE_PER_RECIPIENT_PER_DAY, RECIPIENT_ENDPOINT, recipientKey } from "./email-package-guard";
import { buildPackageEmail, clipDocs, MAX_FIELD, type MailTransport } from "./email-package-send";
import type { AutoResult } from "./email-package-auto-line";
export { autoResultLine, type AutoResult } from "./email-package-auto-line";

export const AUTO_ENDPOINT = "email-package-auto";

export interface AutoDeps {
  /** The account's address, proven flag and switch (packages/core packageEmail). */
  target: (userId: string) => Promise<{ email: string | null; proven: boolean; on: boolean } | null>;
  /** Durable daily counter (packages/core incrementIpUsage). Returns the new count. */
  count: (key: string, endpoint: string) => Promise<number>;
  /** Claim a finished version (packages/core claimPackageEmailVersion): true claimed, false already sent, null not ready. */
  claim: (userId: string, version: string) => Promise<boolean | null>;
  /** Give a claim back (packages/core releasePackageEmailVersion). */
  release: (userId: string, version: string) => Promise<void>;
  /** null when email is not configured here. */
  transport: MailTransport | null;
  from: string;
}

/** Defend answers as the finish gate reads them; anything else is dropped. */
export function cleanDefendAnswers(raw: unknown): DefendAnswer[] {
  if (!Array.isArray(raw)) return [];
  const out: DefendAnswer[] = [];
  for (const a of raw.slice(0, 300)) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    if (typeof r.line !== "string" || typeof r.answer !== "string") continue;
    const verdict = r.verdict === "stands" || r.verdict === "cut" || r.verdict === "unsure" ? r.verdict : undefined;
    out.push({
      line: r.line.slice(0, 2000),
      answer: r.answer.slice(0, 4000),
      ...(verdict ? { verdict } : {}),
      ...(r.kind === "rewrite" ? { kind: "rewrite" as const } : {}),
    });
  }
  return out;
}

/** The finished version: SHA-256 hex of the person's id and the finished resume text. */
export function finishedVersion(userId: string, resumeText: string): string {
  return createHash("sha256").update(`${userId}\n${resumeText}`).digest("hex");
}

/** The daily fallback key (079 not applied yet): the same resume once a day. */
export function autoRunKey(userId: string, resumeText: string): string {
  return "auto:" + finishedVersion(userId, resumeText).slice(0, 32);
}

export async function sendFinishedPackage(
  userId: string,
  body: Record<string, unknown>,
  deps: AutoDeps
): Promise<AutoResult> {
  const docs = clipDocs(body);
  if (!docs.resumeText.trim()) return { sent: false, reason: "no_resume" };

  // Finished, not a draft: the same gate the page uses, run on what was sent.
  const ownWords = String(body.ownWords || "").slice(0, MAX_FIELD * 2);
  const view = buildFinishView({ resumeText: docs.resumeText, ownWords, defendAnswers: cleanDefendAnswers(body.defendAnswers) });
  if (view.state !== "finished") return { sent: false, reason: "draft" };

  // The recipient comes from the account, never from the request.
  const t = await deps.target(userId);
  if (!t || !t.email) return { sent: false, reason: "no_address" };
  if (!t.on) return { sent: false, reason: "off" };
  if (!t.proven) return { sent: false, reason: "unproven" };
  const to = t.email;
  if (!deps.transport) return { sent: false, reason: "not_configured", to };

  // Once per finished version.
  const version = finishedVersion(userId, docs.resumeText);
  const claimed = await deps.claim(userId, version);
  if (claimed === false) return { sent: false, reason: "already", to };
  if (claimed === null && (await deps.count(autoRunKey(userId, docs.resumeText), AUTO_ENDPOINT)) > 1) {
    return { sent: false, reason: "already", to };
  }
  // From here a claimed version is given back unless the email went out
  // (the cap, a provider refusal, or an error), so a later visit can send it.
  let result: AutoResult = { sent: false, reason: "failed", to };
  try {
    if ((await deps.count(recipientKey(to), RECIPIENT_ENDPOINT)) > EMAIL_PACKAGE_PER_RECIPIENT_PER_DAY) {
      result = { sent: false, reason: "limit", to };
      return result;
    }
    const mail = buildPackageEmail(docs, { why: "finished" });
    try {
      const res = await deps.transport({ from: deps.from, to, ...mail });
      if (res.ok) result = { sent: true, to };
    } catch {
      // not sent
    }
    return result;
  } finally {
    if (!result.sent && claimed) await deps.release(userId, version).catch(() => {});
  }
}
