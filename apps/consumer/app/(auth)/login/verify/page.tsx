"use client";

/**
 * Second step after an email-link or Google sign-in (F1).
 *
 * An account with two-step verification that signs in without a password
 * lands here: the middleware holds the session at this page until a code from
 * the authenticator app (or a backup code) is entered. The code is checked by
 * /api/auth/mfa-verify; update() then refreshes the session, and the server
 * marks it verified only from its own record.
 */

import { Suspense, useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { TBtn } from "@crucible/consumer-ui";
import { safeCallbackPath } from "@/lib/session-policy";

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyForm />
    </Suspense>
  );
}

function VerifyForm() {
  const searchParams = useSearchParams();
  const { data: session, status, update } = useSession();
  const callbackUrl = safeCallbackPath(searchParams.get("callbackUrl"));
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Not signed in: back to the sign-in page. Already verified (or no second
  // step owed): straight on to where they were going.
  useEffect(() => {
    if (status === "unauthenticated") {
      window.location.href = "/login";
    } else if (status === "authenticated" && (session?.user as any)?.mfa !== false) {
      window.location.href = callbackUrl;
    }
  }, [status, session, callbackUrl]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/auth/mfa-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "That code didn't match. Try again, or use a backup code.");
        setSending(false);
        return;
      }
      const next = await update();
      if ((next?.user as any)?.mfa === false) {
        setError("Your code was accepted, but the sign-in did not finish. Try once more.");
        setSending(false);
        return;
      }
      window.location.href = callbackUrl;
    } catch {
      setError("Something went wrong. Please try again.");
      setSending(false);
    }
  }

  return (
    <main className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-start bg-t-bg px-4 py-10 font-body sm:justify-center sm:py-14">
      <div className="app-panel w-full max-w-md p-6 sm:p-8">
        <div className="mb-6">
          <p className="app-eyebrow mb-2 text-[#4f6b57]">Private career workspace</p>
          <h1 className="text-2xl font-semibold text-t-white">Enter your two-step code</h1>
          <p className="mt-2 text-sm text-t-bone-dim">
            Your account has two-step verification. Enter the 6-digit code from
            your authenticator app, or one of your backup codes.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-t-white mb-1">
              Authentication code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9a-zA-Z-]/g, ""))}
              placeholder="6-digit code (or a backup code)"
              autoFocus
              className="w-full px-4 py-3 border border-t-amber text-sm bg-t-panel text-t-white tracking-widest focus:border-t-amber-bright focus:outline-none transition-colors min-h-touch"
              disabled={sending || status !== "authenticated"}
            />
          </div>

          {error && <p className="text-sm text-t-red">{error}</p>}

          <TBtn
            type="submit"
            disabled={sending || !code.trim() || status !== "authenticated"}
            className="w-full !border-[#4f6b57] !bg-[#4f6b57] hover:!bg-[#3d5745]"
          >
            {sending ? "Checking..." : "Verify code"}
          </TBtn>
        </form>

        <p className="mt-6 text-sm text-t-bone-dim">
          Lost your phone and your backup codes? Ask for help at{" "}
          <a
            href="mailto:hmu@themidnightgarden.club?subject=Two-step%20help"
            className="font-medium text-t-amber-bright underline underline-offset-2"
          >
            hmu@themidnightgarden.club
          </a>
          .
        </p>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="mt-4 text-sm text-t-amber-bright underline underline-offset-2 hover:text-t-amber"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
