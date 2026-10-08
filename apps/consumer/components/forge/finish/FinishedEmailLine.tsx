"use client";

/**
 * Signed in and FINISHED: the package goes to the account's own proven
 * address by itself (lib/email-package-auto.ts), once per finished version,
 * unless the person turned it off. The finish page shows one line:
 * "We sent it to you@example.com."
 *
 * The server decides everything: the address (the account's, never typed
 * here), whether this version was already sent, and the daily cap. Nothing is
 * kept in this browser, so a shared computer holds no trace of the address.
 */

import { useEffect, useRef, useState } from "react";
import { autoResultLine, type AutoResult } from "@/lib/email-package-auto-line";

export function FinishedEmailLine(props: {
  resumeText: string;
  coverLetterText: string;
  narrativeHeadline: string;
  narrativeSummary: string;
  ownWords: string;
  defendAnswers: unknown[];
  /** Checked by the page right before sending: the run is this account's. */
  mayUse: () => boolean;
}) {
  const [result, setResult] = useState<AutoResult | null>(null);
  const [sending, setSending] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !props.resumeText.trim() || !props.mayUse()) return;
    started.current = true;
    setSending(true);
    fetch("/api/forge/email-package/auto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resumeText: props.resumeText,
        coverLetterText: props.coverLetterText,
        narrativeHeadline: props.narrativeHeadline,
        narrativeSummary: props.narrativeSummary,
        ownWords: props.ownWords,
        defendAnswers: props.defendAnswers,
      }),
    })
      .then((r) => r.json().catch(() => null))
      .then((r: AutoResult | null) => setResult(r && typeof r === "object" && "sent" in r ? r : { sent: false, reason: "failed" }))
      .catch(() => setResult({ sent: false, reason: "failed" }))
      .finally(() => setSending(false));
  }, [props.resumeText]); // eslint-disable-line react-hooks/exhaustive-deps

  const line = sending ? "Sending your finished resume to your email..." : autoResultLine(result);
  const off = result && !result.sent && result.reason === "off";
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
      {off && <p className="text-sm text-t-phos-dim">You turned off emailing your finished resume.</p>}
      <p className="mt-2 text-xs text-t-phos-dim">
        <a href="/dashboard/settings#package-email" className="underline underline-offset-2 hover:text-t-white">
          Change this in Settings
        </a>
      </p>
    </div>
  );
}
