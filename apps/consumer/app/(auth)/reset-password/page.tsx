"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { TBtn } from "@crucible/consumer-ui";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState("");

  const invalidLink = !email || !token;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (invalidLink || !password || !confirmPassword) return;
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
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

  if (invalidLink) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4 font-term bg-t-bg">
        <div className="w-full max-w-sm text-center">
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
      <main className="min-h-screen flex flex-col items-center justify-center px-4 font-term bg-t-bg">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold text-t-white mb-2">
            Password reset
          </h1>
          <p className="text-base text-t-phos-dim mb-6">
            Your password has been updated. You can sign in now.
          </p>
          <TBtn onClick={signInNow} className="w-full">
            sign in
          </TBtn>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 font-term bg-t-bg">
      <div className="w-full max-w-sm">
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
              placeholder="New password (8+ characters)"
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
            {status === "saving" ? "saving..." : "reset password"}
          </TBtn>
        </form>
      </div>
    </main>
  );
}
