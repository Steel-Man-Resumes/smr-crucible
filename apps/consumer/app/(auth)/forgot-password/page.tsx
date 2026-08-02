"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TBtn } from "@crucible/consumer-ui";

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}

function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;

    setStatus("sending");
    setError("");

    try {
      const res = await fetch("/api/auth/reset-password/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not send reset email.");
        setStatus("idle");
        return;
      }
      setStatus("sent");
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("idle");
    }
  }

  if (status === "sent") {
    return (
      <main className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-center bg-t-bg px-4 py-10 font-body">
        <div className="app-panel w-full max-w-md p-6 text-center sm:p-8">
          <h1 className="text-2xl font-bold text-t-white mb-2">
            Check your email
          </h1>
          <p className="text-base text-t-phos-dim mb-6">
            If an account exists for <span className="font-medium text-t-white">{email}</span>,
            we sent a password reset link. It expires in 60 minutes.
          </p>
          <Link href="/login" className="text-sm text-t-amber-bright hover:text-t-amber">
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-center bg-t-bg px-4 py-10 font-body">
      <div className="app-panel w-full max-w-md p-6 sm:p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-t-white">
            Reset your password
          </h1>
          <p className="text-sm text-t-phos-dim mt-1">
            We&apos;ll email you a link to set a new password.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-t-white mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
              disabled={status === "sending"}
            />
          </div>

          {error && <p className="text-sm text-t-red">{error}</p>}

          <TBtn type="submit" disabled={status === "sending" || !email.trim()} className="w-full">
            {status === "sending" ? "Sending..." : "Send reset email"}
          </TBtn>
        </form>

        <p className="text-center mt-6">
          <Link href="/login" className="text-sm text-t-amber-bright hover:text-t-amber">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
