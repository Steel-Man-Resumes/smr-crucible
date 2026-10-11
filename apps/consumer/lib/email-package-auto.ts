/**
 * The finished package, emailed by itself (lane 3a Part 2, item 2; reworked
 * for saved revisions in Phase 5 lane R1, review A5).
 *
 * When someone signed in finishes in the Forge, the finish page saves the
 * version (a revision, migration 081) and asks this to send THAT revision to
 * their own account address. The request carries a revision id and nothing
 * that can decide anything. The rules, all checked here on the server:
 *  - the revision is the person's own (read AS them, owner only);
 *  - finished: its stored status, which the server computed when it was
 *    saved, AND a fresh run of the same gate and page rule on the stored
 *    evidence (lib/revision-status.ts), letter included (D5). Either one
 *    says draft: nothing is sent, and the page says why;
 *  - only to the account's own address, and only once a REAL proof of it is
 *    on record (079 email_proof_source; 068's backfill does not count). No
 *    address in the request is read;
 *  - the person can turn it off (users.forge_package_email, 079);
 *  - the NEWEST version only, once it has settled (review L4): the request
 *    names a revision, but what goes out is that resume's newest revision,
 *    and only when it is finished and nothing newer was saved for about five
 *    minutes (quick edits settle first). "Email me the latest" (now: true)
 *    sends at once;
 *  - at most one automatic email per resume per day (UTC), and never the
 *    same revision twice: both are claims in forge_package_email_sent (079),
 *    taken before anything is sent and given back if it does not go out;
 *    before 079 is applied, a daily count;
 *  - the same per-address daily cap as the package box;
 *  - it delivers the actual files: the resume PDF and Word file and the
 *    letter in Word, from the same renderer as the downloads, as attachments
 *    (lib/email-package-files.ts);
 *  - the transport and the file renderer are passed in, so tests never reach
 *    a real provider.
 */

import { createHash } from "crypto";
import { computeRevision, inputFromRevision } from "./revision-status";
import { EMAIL_PACKAGE_PER_RECIPIENT_PER_DAY, RECIPIENT_ENDPOINT, recipientKey } from "./email-package-guard";
import { buildPackageEmail, type MailAttachment, type MailTransport } from "./email-package-send";
import type { AutoResult } from "./email-package-auto-line";
import type { ArtifactRevision } from "@crucible/core/src/artifactRevision";
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
  /** The person's own revision (packages/core getRevision). */
  getRevision: (userId: string, revisionId: string) => Promise<ArtifactRevision | null>;
  /** The newest revision of one of the person's resumes (packages/core getLatestRevision). */
  getLatestRevision: (userId: string, artifactId: string) => Promise<ArtifactRevision | null>;
  /** The clock (tests pass their own). */
  now?: () => number;
  /** The files to attach (lib/email-package-files.ts). */
  files: (resumeText: string, letterText: string) => Promise<MailAttachment[]>;
  /** null when email is not configured here. */
  transport: MailTransport | null;
  from: string;
}

/** The version of one revision: SHA-256 hex of the person, the revision id and its content hash. */
export function revisionVersion(userId: string, rev: Pick<ArtifactRevision, "id" | "content_hash">): string {
  return createHash("sha256").update(`${userId}\n${rev.id}\n${rev.content_hash}`).digest("hex");
}

/** How long a finished version must stand before it is emailed by itself. */
export const AUTO_SETTLE_MS = 5 * 60 * 1000;

/** The UTC day, for the once-a-day claim. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The claim for "this resume was emailed today": SHA-256 hex of the person, the resume and the UTC day. */
export function artifactDayVersion(userId: string, artifactId: string, day: string): string {
  return createHash("sha256").update(`${userId}\nartifact-day\n${artifactId}\n${day}`).digest("hex");
}

/** The daily fallback key (079 not applied yet): the same resume once a day. */
export function autoRunKey(userId: string, artifactId: string, day: string): string {
  return "auto:" + artifactDayVersion(userId, artifactId, day).slice(0, 32);
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

export async function sendFinishedPackage(
  userId: string,
  body: Record<string, unknown>,
  deps: AutoDeps
): Promise<AutoResult> {
  const revisionId = typeof body.revisionId === "string" ? body.revisionId : "";
  if (!revisionId) return { sent: false, reason: "no_resume" };
  const named = await deps.getRevision(userId, revisionId);
  if (!named) return { sent: false, reason: "not_found" };
  // The newest version of that resume is what goes out (review L4).
  const rev = (await deps.getLatestRevision(userId, named.artifact_id)) ?? named;
  const nowMs = (deps.now ?? Date.now)();
  const now = body.now === true;

  // Finished by the stored status AND by the gate run again on what is
  // stored, letter included. A draft sends nothing and claims nothing.
  if (rev.status !== "finished") return { sent: false, reason: "draft" };
  const input = inputFromRevision(rev);
  if (!input || computeRevision(input).status !== "finished") return { sent: false, reason: "draft" };
  // Quick edits settle first, unless the person asked for it now.
  const age = nowMs - Date.parse(rev.created_at);
  if (!now && Number.isFinite(age) && age < AUTO_SETTLE_MS) {
    return { sent: false, reason: "settling", retryInMs: Math.max(1000, AUTO_SETTLE_MS - age) };
  }

  // The recipient comes from the account, never from the request.
  const t = await deps.target(userId);
  if (!t || !t.email) return { sent: false, reason: "no_address" };
  if (!t.on) return { sent: false, reason: "off" };
  if (!t.proven) return { sent: false, reason: "unproven" };
  const to = t.email;
  if (!deps.transport) return { sent: false, reason: "not_configured", to };

  // Never the same revision twice; at most one per resume per day.
  const version = revisionVersion(userId, rev);
  const day = utcDay(nowMs);
  const dayVersion = artifactDayVersion(userId, rev.artifact_id, day);
  const claimedRev = await deps.claim(userId, version);
  if (claimedRev === false) return { sent: false, reason: "already", to };
  let claimedDay: boolean | null = null;
  if (claimedRev === true) {
    claimedDay = await deps.claim(userId, dayVersion);
    if (claimedDay === false) {
      await deps.release(userId, version).catch(() => {});
      return { sent: false, reason: "already_today", to };
    }
  } else if ((await deps.count(autoRunKey(userId, rev.artifact_id, day), AUTO_ENDPOINT)) > 1) {
    // 079 not applied: a daily count per resume.
    return { sent: false, reason: "already_today", to };
  }
  const claimed = claimedRev === true;
  // From here the claims are given back unless the email went out (the cap,
  // a provider refusal, or an error), so a later visit can send it.
  let result: AutoResult = { sent: false, reason: "failed", to };
  try {
    if ((await deps.count(recipientKey(to), RECIPIENT_ENDPOINT)) > EMAIL_PACKAGE_PER_RECIPIENT_PER_DAY) {
      result = { sent: false, reason: "limit", to };
      return result;
    }
    let attachments: MailAttachment[];
    try {
      attachments = await deps.files(rev.resume_text, rev.letter_text);
    } catch {
      return result; // the files did not build: not sent, given back, retry later
    }
    const mail = buildPackageEmail(
      {
        resumeText: rev.resume_text,
        coverLetterText: rev.letter_text,
        // Display only (the person's story heading); never decides anything.
        headline: clip(body.narrativeHeadline, 500),
        summary: clip(body.narrativeSummary, 5000),
      },
      { why: "finished", attached: attachments.length > 0 }
    );
    try {
      const res = await deps.transport({ from: deps.from, to, ...mail, attachments });
      if (res.ok) result = { sent: true, to, revision: rev.revision_number };
    } catch {
      // not sent
    }
    return result;
  } finally {
    if (!result.sent && claimed) {
      await deps.release(userId, version).catch(() => {});
      if (claimedDay) await deps.release(userId, dayVersion).catch(() => {});
    }
  }
}
