"use client";

/**
 * Email-me-my-package, moved from the output page unchanged in behaviour:
 * same /api/forge/email-package call, same address check, same Turnstile
 * widget (remounted after every attempt), same server limits. The newsletter
 * box starts unchecked; a yes is the person's own click.
 */

import { useRef, useState } from "react";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { NEWSLETTER_DEFAULT_CHECKED, NEWSLETTER_LINE } from "@/lib/finish-gate";

export function EmailPackageBox({
  resumeText,
  coverLetterText,
  narrativeHeadline,
  narrativeSummary,
}: {
  resumeText: string;
  coverLetterText: string;
  narrativeHeadline: string;
  narrativeSummary: string;
}) {
  const [email, setEmail] = useState("");
  const [letter, setLetter] = useState(NEWSLETTER_DEFAULT_CHECKED);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  // A Turnstile token is single-use: remount the widget after every attempt.
  const [attempt, setAttempt] = useState(0);

  async function send() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setState("error");
      setMessage("That email doesn't look right. Check it and try again.");
      return;
    }
    setState("sending");
    setMessage("");
    // Turnstile token, present only when the env-gated widget rendered.
    const turnstileToken =
      boxRef.current?.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')?.value ||
      undefined;
    try {
      const res = await fetch("/api/forge/email-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          resumeText,
          coverLetterText,
          narrativeHeadline,
          narrativeSummary,
          turnstileToken,
          letter,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setAttempt((n) => n + 1);
      if (res.ok && data.ok) {
        setState("sent");
        setMessage("Sent. Check your inbox (and spam folder, just in case).");
      } else {
        setState("error");
        setMessage(data.error || "We couldn't send that. Your download still works.");
      }
    } catch {
      setState("error");
      setMessage("We couldn't reach the server. Your download still works.");
    }
  }

  return (
    <div ref={boxRef} className="border border-t-line bg-t-panel p-4">
      <p className="mb-1 text-sm font-semibold text-t-white">Email me my package</p>
      <p className="mb-3 text-xs text-t-phos-dim">
        We&apos;ll send your story, resume and cover letter to your inbox so you have them anywhere, even without an account.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="finish-email" className="sr-only">
          Your email
        </label>
        <input
          id="finish-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          disabled={state === "sending" || state === "sent"}
          className="min-h-touch flex-1 border border-t-line bg-t-panel px-4 py-2.5 text-sm text-t-white transition-colors focus:border-t-amber focus:outline-none"
        />
        <button
          onClick={send}
          disabled={state === "sending" || state === "sent" || !email.trim()}
          className="t-focus min-h-touch bg-t-amber px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-t-amber-bright disabled:bg-t-line disabled:text-t-phos-dim"
        >
          {state === "sending" ? "Sending..." : state === "sent" ? "Sent" : "Send it"}
        </button>
      </div>
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-t-phos-dim">
        <input
          type="checkbox"
          checked={letter}
          onChange={(e) => setLetter(e.target.checked)}
          disabled={state === "sending" || state === "sent"}
          className="mt-0.5 accent-t-amber"
          data-testid="newsletter-optin"
        />
        <span>{NEWSLETTER_LINE}</span>
      </label>
      {/* Bot check: renders only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set;
          the server checks it when TURNSTILE_SECRET_KEY is set. */}
      {state !== "sent" && (
        <div className="mt-3">
          <TurnstileWidget key={attempt} />
        </div>
      )}
      {message && (
        <p className={state === "sent" ? "mt-2 text-xs text-t-phos" : "mt-2 text-xs text-t-amber-bright"}>{message}</p>
      )}
    </div>
  );
}
