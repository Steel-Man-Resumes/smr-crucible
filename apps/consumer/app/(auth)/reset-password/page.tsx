"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { TBtn } from "@crucible/consumer-ui";
import { passwordProblem, PASSWORD_HINT } from "@/lib/password-policy";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

/** This tab's copy of the reset link's email and token, after the URL is cleaned. */
const LINK_KEY = "smr_reset_link";

type ResetLink = { email: string; token: string };

function validLink(email: unknown, token: unknown): ResetLink | null {
  if (typeof email !== "string" || typeof token !== "string") return null;
  if (!email.includes("@") || email.length > 254 || /[\u0000-\u001f\u007f\s]/.test(email)) return null;
  if (!/^[0-9a-f]{32,256}$/i.test(token)) return null;
  return { email, token };
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  // undefined while reading (first render), null when the link is not valid.
  const [link, setLink] = useState<ResetLink | null | undefined>(undefined);
  // Next updates useSearchParams after replaceState, so the effect runs again
  // with no parameters; this keeps what was read the first time.
  const readOnce = useRef<ResetLink | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState("");

  // The reset link carries a live token and the email address. Take them out
  // of the address bar and history as soon as they are read (this page also
  // sends no referrer, see next.config.mjs). They are kept in memory and in
  // this tab's sessionStorage, so a refresh still works, and cleared once the
  // password is changed.
  useEffect(() => {
    const fromUrl = validLink(searchParams.get("email"), searchParams.get("token"));
    if (fromUrl) {
      readOnce.current = fromUrl;
      try {
        sessionStorage.setItem(LINK_KEY, JSON.stringify(fromUrl));
      } catch {
        // storage blocked: memory is enough for this visit
      }
      window.history.replaceState(null, "", "/reset-password");
      setLink(fromUrl);
      return;
    }
    if (readOnce.current) {
      setLink(readOnce.current);
      return;
    }
    let saved: ResetLink | null = null;
    try {
      const raw = sessionStorage.getItem(LINK_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      saved = parsed ? validLink(parsed.email, parsed.token) : null;
    } catch {
      saved = null;
    }
    setLink(saved);
  }, [searchParams]);

  const email = link?.email ?? "";
  const token = link?.token ?? "";
  const invalidLink = link === null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (invalidLink || !password || !confirmPassword) return;
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }

    setStatus("saving");
    setError("");

    try {
      const res = await fetch("/api/auth/reset-password/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not reset password.");
        setStatus("idle");
        return;
      }
      try {
        sessionStorage.removeItem(LINK_KEY);
      } catch {
        // ignore
      }
      setStatus("done");
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("idle");
    }
  }

  async function signInNow() {
    await signIn("password-login", {
      email,
      password,
      callbackUrl: "/dashboard",
    });
  }

  if (link === undefined) {
    // Reading the link (one render); nothing to show yet.
    return (
      <main className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-center bg-t-bg px-4 py-10 font-body" />
    );
  }

  if (invalidLink) {
    return (
      <main className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-center bg-t-bg px-4 py-10 font-body">
        <div className="app-panel w-full max-w-md p-6 text-center sm:p-8">
          <h1 className="text-2xl font-bold text-t-white mb-2">
            Invalid reset link
          </h1>
          <p className="text-base text-t-phos-dim mb-6">
            This link is missing required information. Request a new password
            reset email.
          </p>
          <Link href="/forgot-password" className="text-sm text-t-amber-bright hover:text-t-amber">
            Request a new link
          </Link>
        </div>
      </main>
    );
  }

  if (status === "done") {
    return (
      <main className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-center bg-t-bg px-4 py-10 font-body">
        <div className="app-panel w-full max-w-md p-6 text-center sm:p-8">
          <h1 className="text-2xl font-bold text-t-white mb-2">
            Password reset
          </h1>
          <p className="text-base text-t-phos-dim mb-6">
            Your password has been updated. You can sign in now.
          </p>
          <TBtn onClick={signInNow} className="w-full">
            Sign in
          </TBtn>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-center bg-t-bg px-4 py-10 font-body">
      <div className="app-panel w-full max-w-md p-6 sm:p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-t-white">
            Choose a new password
          </h1>
          <p className="text-sm text-t-phos-dim mt-1">
            This will update the password for {email}.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-t-white mb-1">
              New password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={`New password (${PASSWORD_HINT})`}
              required
              autoComplete="new-password"
              className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
              disabled={status === "saving"}
            />
          </div>

          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-t-white mb-1">
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm password"
              required
              autoComplete="new-password"
              className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
              disabled={status === "saving"}
            />
          </div>

          {error && <p className="text-sm text-t-red">{error}</p>}

          <TBtn
            type="submit"
            disabled={status === "saving" || !password || !confirmPassword}
            className="w-full"
          >
            {status === "saving" ? "Saving..." : "Reset password"}
          </TBtn>
        </form>
      </div>
    </main>
  );
}
