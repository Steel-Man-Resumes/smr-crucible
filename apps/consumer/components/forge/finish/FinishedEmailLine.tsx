"use client";

/**
 * Signed in and FINISHED: the package goes to the account's own proven
 * address by itself (lib/email-package-auto.ts), once per saved revision,
 * unless the person turned it off. The finish page shows one line:
 * "We sent it to you@example.com."
 *
 * It sends ONE thing: the id of the revision the page just saved (Phase 5
 * R1). The server re-checks that resume's NEWEST revision, letter included,
 * and decides everything: the address (the account's, never typed here),
 * whether this version was already sent, and the caps (one automatic email
 * per resume per day). Quick edits settle first (review L4): the page asks
 * about five minutes after the last finished save, and "Email me the latest"
 * asks at once. A server draft or a failure is said on the page, with Try
 * again where a retry can help. Nothing is kept in this browser.
 */

import { useEffect, useRef, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { autoResultLine, autoResultRetryable, type AutoResult } from "@/lib/email-package-auto-line";

/** How long after the last finished save the page asks for the email (the server holds the same wait). */
export const AUTO_EMAIL_DELAY_MS = 5 * 60 * 1000;

export function FinishedEmailLine(props: {
  /** The saved revision the server called finished; null until it is saved. */
  revisionId: string | null;
  narrativeHeadline: string;
  narrativeSummary: string;
  /** Checked by the page right before sending: the run is this account's. */
  mayUse: () => boolean;
}) {
  const { data: authData } = useSession();
  const accountEmail = typeof authData?.user?.email === "string" ? authData.user.email : "";
  const [proofLink, setProofLink] = useState<"" | "sending" | "sent" | "failed">("");
  const [result, setResult] = useState<AutoResult | null>(null);
  const [sending, setSending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestId = useRef<string | null>(null);
  latestId.current = props.revisionId;

  const send = (revisionId: string, now = false) => {
    if (timer.current) clearTimeout(timer.current);
    setSending(true);
    fetch("/api/forge/email-package/auto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revisionId,
        ...(now ? { now: true } : {}),
        narrativeHeadline: props.narrativeHeadline,
        narrativeSummary: props.narrativeSummary,
      }),
    })
      .then((r) => r.json().catch(() => null))
      .then((r: AutoResult | null) => {
        const got: AutoResult = r && typeof r === "object" && "sent" in r ? r : { sent: false, reason: "failed" };
        setResult(got);
        // Still settling (a newer save landed): ask again when it has.
        if (!got.sent && got.reason === "settling") {
          timer.current = setTimeout(() => latestId.current && send(latestId.current), Math.min(got.retryInMs ?? AUTO_EMAIL_DELAY_MS, AUTO_EMAIL_DELAY_MS) + 1000);
        }
      })
      .catch(() => setResult({ sent: false, reason: "failed" }))
      .finally(() => setSending(false));
  };

  // Each finished save restarts the wait; about five minutes after the last
  // one, the newest finished version is emailed (the server re-checks it).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!props.revisionId || !props.mayUse()) return;
    setResult({ sent: false, reason: "settling" });
    timer.current = setTimeout(() => latestId.current && send(latestId.current), AUTO_EMAIL_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [props.revisionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const line = sending
    ? "Sending your finished resume to your email..."
    : !props.revisionId
      ? "Saving this version to your account first..."
      : autoResultLine(result);
  const retry = !sending && autoResultRetryable(result) && !!props.revisionId;
  // "Email me the latest": at once, under the same caps (offered until it went out).
  const offerNow = !sending && !!props.revisionId && !(result && (result.sent || result.reason === "already" || result.reason === "already_today" || result.reason === "off" || result.reason === "unproven" || result.reason === "draft"));
  const off = result && !result.sent && result.reason === "off";
  const unproven = result && !result.sent && result.reason === "unproven";

  // The existing proof flow (Settings uses the same): a sign-in link to the
  // account's own address. Opening it proves the inbox and comes back here,
  // and the next finish sends.
  async function sendProofLink() {
    if (!accountEmail) return;
    setProofLink("sending");
    try {
      const res = await signIn("resend", { email: accountEmail, redirect: false, callbackUrl: "/output" });
      setProofLink(res?.error ? "failed" : "sent");
    } catch {
      setProofLink("failed");
    }
  }
  // Nothing to say (a draft by the server's count, or no address): no box.
  if (!sending && !line && !off) return null;
  return (
    <div className="border border-t-line bg-t-panel p-4" data-testid="finished-email">
      <p className="mb-1 text-sm font-semibold text-t-white">Your package by email</p>
      {line && (
        <p role="status" className="text-sm text-t-phos" data-testid="finished-email-line">
          {line}
        </p>
      )}
      {offerNow && !retry && (
        <button
          type="button"
          onClick={() => props.revisionId && send(props.revisionId, true)}
          className="t-focus mt-2 min-h-touch border border-t-line bg-t-panel-2 px-3 py-2 text-sm text-t-white hover:border-t-phos-dim"
          data-testid="finished-email-now"
        >
          Email me the latest
        </button>
      )}
      {retry && (
        <button
          type="button"
          onClick={() => props.revisionId && send(props.revisionId, true)}
          className="t-focus mt-2 min-h-touch border border-t-line bg-t-panel-2 px-3 py-2 text-sm text-t-white hover:border-t-phos-dim"
          data-testid="finished-email-retry"
        >
          Try again
        </button>
      )}
      {off && <p className="text-sm text-t-phos-dim">You turned off emailing your finished resume.</p>}
      {unproven && accountEmail && (
        <div className="mt-2" data-testid="finished-email-confirm">
          {proofLink === "sent" ? (
            <p className="text-sm text-t-phos">Check {accountEmail} for the link. Open it, and your resume comes next.</p>
          ) : (
            <button
              type="button"
              onClick={() => void sendProofLink()}
              disabled={proofLink === "sending"}
              className="t-focus min-h-touch border border-t-line bg-t-panel-2 px-3 py-2 text-sm text-t-white hover:border-t-phos-dim disabled:opacity-50"
            >
              {proofLink === "sending" ? "Sending..." : `Email a confirm link to ${accountEmail}`}
            </button>
          )}
          {proofLink === "failed" && <p className="mt-1 text-sm text-t-red">We couldn&apos;t send the link. Try again in a few minutes.</p>}
        </div>
      )}
      <p className="mt-2 text-xs text-t-phos-dim">
        <a href="/dashboard/settings#package-email" className="underline underline-offset-2 hover:text-t-white">
          Change this in Settings
        </a>
      </p>
    </div>
  );
}
