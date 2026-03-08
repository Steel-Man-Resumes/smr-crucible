"use client";

import { Suspense, useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const searchParams = useSearchParams();
  const isDev = process.env.NODE_ENV === "development";

  // Pre-fill partner code from URL param
  useEffect(() => {
    const urlCode = searchParams.get("code");
    if (urlCode) {
      setCode(urlCode);
      setShowCode(true);
    }
  }, [searchParams]);

  // Check for NextAuth error in URL params
  useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError) {
      const messages: Record<string, string> = {
        Configuration: "Login is temporarily unavailable. Please try again later or contact Troy.",
        AccessDenied: "Access denied. Check your email and try again.",
        Verification: "That link has expired. Please request a new one.",
      };
      setError(messages[urlError] || `Login error: ${urlError}`);
    }
  }, [searchParams]);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setError("");
    setSending(true);

    // Store pending access code for post-auth redemption
    if (code.trim()) {
      localStorage.setItem("pending_access_code", code.trim());
    }

    try {
      const result = await signIn("resend", {
        email: email.trim(),
        callbackUrl: "/dashboard",
        redirect: false,
      });

      if (result?.error) {
        setError(
          result.error === "Configuration"
            ? "Email delivery is temporarily unavailable. Please try again later or contact Troy."
            : `Login error: ${result.error}`
        );
        setSending(false);
      } else if (result?.url) {
        window.location.href = result.url;
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setSending(false);
    }
  }

  async function handleDevLogin() {
    setSending(true);
    if (code.trim()) {
      localStorage.setItem("pending_access_code", code.trim());
    }
    try {
      await signIn("credentials", {
        email: email.trim() || "dev@test.com",
        callbackUrl: "/dashboard",
      });
    } catch {
      setError("Dev login failed.");
      setSending(false);
    }
  }

  return (
    <main className="flow-center min-h-screen flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-4 text-center">
          Save Your Results
        </h1>
        <p className="text-body text-muted mb-6 text-center">
          Enter your email to create a free account. We&apos;ll send you a magic
          link — no password needed.
        </p>

        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 transition-colors min-h-touch"
              disabled={sending}
            />
          </div>

          {/* Collapsible partner code field */}
          <div>
            <button
              type="button"
              onClick={() => setShowCode(!showCode)}
              className="text-sm text-sage-600 hover:text-sage-700 transition-colors"
            >
              {showCode ? "Hide partner code" : "Have a partner code?"}
            </button>

            {showCode && (
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Enter code (e.g., PARTNER123)"
                className="mt-2 w-full px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 transition-colors min-h-touch uppercase"
                disabled={sending}
              />
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={sending || !email.trim()}
            className="w-full px-6 py-4 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-touch"
          >
            {sending ? "Sending..." : "Send Magic Link"}
          </button>
        </form>

        {isDev && (
          <div className="mt-6 pt-6 border-t border-border">
            <button
              onClick={handleDevLogin}
              disabled={sending}
              className="w-full px-6 py-3 bg-amber-100 text-amber-800 rounded-xl text-sm font-medium hover:bg-amber-200 transition-colors min-h-touch"
            >
              Dev Login (skip email)
            </button>
          </div>
        )}

        <p className="text-xs text-muted mt-6 text-center">
          No credit card. No spam. Just a way to save your work.
        </p>

        <div className="mt-8 pt-6 border-t border-border text-center text-sm text-muted space-y-2">
          <p>
            Haven&apos;t started yet?{" "}
            <a
              href="https://forge.steelmanresumes.com"
              className="text-sage-600 hover:text-sage-700 font-medium"
            >
              Try The Forge first
            </a>{" "}
            — it&apos;s free, no account needed.
          </p>
          <p>
            <a
              href="https://steelmanresumes.com"
              className="text-sage-600 hover:text-sage-700"
            >
              steelmanresumes.com
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
