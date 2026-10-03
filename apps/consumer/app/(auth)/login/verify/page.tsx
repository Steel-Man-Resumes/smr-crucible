"use client";

/**
 * The one step a sign-in may still owe before the account opens.
 *
 *  - Two-step code (F1): an account with two-step verification signed in by
 *    email link or Google. The middleware holds the session here until a code
 *    from the authenticator app (or a backup code) is entered.
 *  - First proof of the email address (F3): the account's address was never
 *    proven (it was created with a password and no email check). Whoever set
 *    the password or two-step proves it by entering it. Someone who did not set
 *    it can say so, and it is removed (lib/email-proof.ts).
 *
 * Every check runs on the server; update() then refreshes the session, and
 * the server marks it done only from its own records.
 */

import { Suspense, useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { TBtn } from "@crucible/consumer-ui";
import { safeCallbackPath, sessionPending } from "@/lib/session-policy";

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyForm />
    </Suspense>
  );
}

const INPUT =
  "w-full px-4 py-3 border border-t-amber text-sm bg-t-panel text-t-white focus:border-t-amber-bright focus:outline-none transition-colors min-h-touch";

function VerifyForm() {
  const searchParams = useSearchParams();
  const { data: session, status, update } = useSession();
  const callbackUrl = safeCallbackPath(searchParams.get("callbackUrl"));
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const user = session?.user as any;
  const claim: "2fa" | "password" | null = user?.claim ?? null;
  const passwordMode = claim === "password" && user?.mfa !== false;

  // Not signed in: back to the sign-in page. Nothing owed: straight on.
  useEffect(() => {
    if (status === "unauthenticated") {
      window.location.href = "/login";
    } else if (status === "authenticated" && !sessionPending(session?.user as any)) {
      window.location.href = callbackUrl;
    }
  }, [status, session, callbackUrl]);

  /** Refresh the session from the server; go on if nothing is owed any more. */
  async function finish(failMessage: string) {
    const next = await update();
    if (sessionPending(next?.user as any)) {
      setError(failMessage);
      setSending(false);
      setConfirmRemove(false);
      return;
    }
    window.location.href = callbackUrl;
  }

  async function post(path: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, error: data.error };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setSending(true);
    setError("");
    try {
      const r = passwordMode
        ? await post("/api/auth/claim-password", { password: value })
        : await post("/api/auth/mfa-verify", { code: value.trim() });
      if (!r.ok) {
        setError(
          r.error ||
            (passwordMode
              ? "That password didn't match. Try again, or choose the other option below."
              : "That code didn't match. Try again, or use a backup code.")
        );
        setSending(false);
        return;
      }
      await finish(
        passwordMode
          ? "Your password was accepted, but the sign-in did not finish. Try once more."
          : "Your code was accepted, but the sign-in did not finish. Try once more."
      );
    } catch {
      setError("Something went wrong. Please try again.");
      setSending(false);
    }
  }

  async function removeAndContinue() {
    setSending(true);
    setError("");
    try {
      const r = await post("/api/auth/claim-reset", {});
      if (!r.ok) {
        setError(r.error || "Something went wrong. Please try again.");
        setSending(false);
        return;
      }
      await finish("That was done, but the sign-in did not finish. Try once more.");
    } catch {
      setError("Something went wrong. Please try again.");
      setSending(false);
    }
  }

  const ready = status === "authenticated";

  return (
    <main className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-start bg-t-bg px-4 py-10 font-body sm:justify-center sm:py-14">
      <div className="app-panel w-full max-w-md p-6 sm:p-8">
        <div className="mb-6">
          <p className="app-eyebrow mb-2 text-[#4f6b57]">Private career workspace</p>
          <h1 className="text-2xl font-semibold text-t-white">
            {passwordMode ? "Enter your password to keep it" : "Enter your two-step code"}
          </h1>
          <p className="mt-2 text-sm text-t-bone-dim">
            {passwordMode
              ? "This is the first time this email address has been confirmed, and the account already has a password. If you set it, enter it here and it stays."
              : "Your account has two-step verification. Enter the 6-digit code from your authenticator app, or one of your backup codes."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="secret" className="block text-sm font-medium text-t-white mb-1">
              {passwordMode ? "Password" : "Authentication code"}
            </label>
            {passwordMode ? (
              <input
                id="secret"
                type="password"
                autoComplete="current-password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
                className={INPUT}
                disabled={sending || !ready}
              />
            ) : (
              <input
                id="secret"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^0-9a-zA-Z-]/g, ""))}
                placeholder="6-digit code (or a backup code)"
                autoFocus
                className={`${INPUT} tracking-widest`}
                disabled={sending || !ready}
              />
            )}
          </div>

          {error && <p className="text-sm text-t-red">{error}</p>}

          <TBtn
            type="submit"
            disabled={sending || !value.trim() || !ready}
            className="w-full !border-[#4f6b57] !bg-[#4f6b57] hover:!bg-[#3d5745]"
          >
            {sending ? "Checking..." : passwordMode ? "Keep my password" : "Verify code"}
          </TBtn>
        </form>

        {claim && (
          <div className="mt-6 border-t border-t-line pt-5">
            {!confirmRemove ? (
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                disabled={sending || !ready}
                className="text-sm font-medium text-t-amber-bright underline underline-offset-2 hover:text-t-amber"
              >
                {passwordMode ? "I didn't set a password" : "I didn't set up two-step on this account"}
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-t-bone-dim">
                  {passwordMode
                    ? "We'll remove that password and sign out any other devices. Your work stays. You can set your own password in Settings."
                    : "We'll remove the two-step and any password on this account and sign out any other devices. Your work stays. You can set them up again in Settings."}
                </p>
                <div className="flex gap-3">
                  <TBtn type="button" onClick={removeAndContinue} disabled={sending}>
                    {sending ? "Working..." : "Yes, remove it"}
                  </TBtn>
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(false)}
                    disabled={sending}
                    className="text-sm text-t-bone-dim underline underline-offset-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {!passwordMode && (
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
        )}
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
