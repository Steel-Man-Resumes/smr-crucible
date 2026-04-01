"use client";

/**
 * Login / Create Account — Unified auth page
 *
 * Standard app sign-in pattern:
 * 1. Email field first (always visible, auto-fills from browser)
 * 2. Password field (for sign-in or account creation)
 * 3. Magic link as backup ("Can't remember your password?")
 * 4. From Forge: defaults to "Create Account" mode
 */

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

type Mode = "sign-in" | "create" | "magic-link";

function LoginForm() {
  const searchParams = useSearchParams();
  const isDev = process.env.NODE_ENV === "development";
  const fromForge = searchParams.get("from") === "forge";

  const [mode, setMode] = useState<Mode>(fromForge ? "create" : "sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  // Pre-fill partner code from URL
  useEffect(() => {
    const urlCode = searchParams.get("code");
    if (urlCode) { setCode(urlCode); setShowCode(true); }
  }, [searchParams]);

  // NextAuth error from URL
  useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError) {
      const msgs: Record<string, string> = {
        Configuration: "Login is temporarily unavailable. Please contact Troy.",
        AccessDenied: "Access denied. Check your email and try again.",
        Verification: "That link has expired. Request a new one below.",
        CredentialsSignin: "Invalid email or password.",
      };
      setError(msgs[urlError] || `Login error: ${urlError}`);
    }
  }, [searchParams]);

  function storeCode() {
    if (code.trim()) localStorage.setItem("pending_access_code", code.trim());
  }

  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  // ─── Sign In ──────────────────────────────────────────────────────────
  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setError(""); setSending(true); storeCode();

    try {
      const result = await signIn("password-login", {
        email: email.trim(), password, callbackUrl, redirect: false,
      });
      if (result?.error) {
        setError("Invalid email or password.");
        setSending(false);
      } else if (result?.url) {
        window.location.href = result.url;
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setSending(false);
    }
  }

  // ─── Create Account ───────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password || !confirmPassword) return;
    if (password !== confirmPassword) { setError("Passwords don't match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setError(""); setSending(true); storeCode();

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not create account.");
        setSending(false);
        return;
      }
      const result = await signIn("password-login", {
        email: email.trim(), password, callbackUrl, redirect: false,
      });
      if (result?.error) {
        setError("Account created. Try signing in.");
        setMode("sign-in");
        setSending(false);
      } else if (result?.url) {
        window.location.href = result.url;
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setSending(false);
    }
  }

  // ─── Magic Link ───────────────────────────────────────────────────────
  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setError(""); setSending(true); storeCode();

    try {
      const result = await signIn("resend", {
        email: email.trim(), callbackUrl, redirect: false,
      });
      if (result?.error) {
        setError("Could not send magic link. Try again or use a password.");
        setSending(false);
      } else if (result?.url) {
        setMagicLinkSent(true);
        setSending(false);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setSending(false);
    }
  }

  // ─── Magic link sent confirmation ─────────────────────────────────────
  if (magicLinkSent) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-sage-100 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 18 18" fill="none" className="text-sage-600">
              <rect x="2" y="4" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2 6l7 4 7-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Check your email</h1>
          <p className="text-body text-muted mb-6">
            We sent a sign-in link to <span className="font-medium text-foreground">{email}</span>.
            Click the link in the email to sign in. It expires in 24 hours.
          </p>
          <button
            onClick={() => { setMagicLinkSent(false); setMode("sign-in"); }}
            className="text-sm text-sage-600 hover:text-sage-700"
          >
            Back to sign in
          </button>
        </div>
      </main>
    );
  }

  // ─── Main form ────────────────────────────────────────────────────────
  const submitHandler = mode === "create" ? handleCreate
    : mode === "magic-link" ? handleMagicLink
    : handleSignIn;

  const submitDisabled = sending || !email.trim()
    || (mode !== "magic-link" && !password)
    || (mode === "create" && !confirmPassword);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 pb-16">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">Steel Man Resumes</h1>
          <p className="text-sm text-muted mt-1">
            {mode === "create"
              ? "Create your free account"
              : mode === "magic-link"
                ? "Sign in with a magic link"
                : "Sign in to your account"}
          </p>
        </div>

        <form onSubmit={submitHandler} className="space-y-4">
          {/* Email — always visible, autoComplete for saved credentials */}
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
              autoComplete="email"
              autoFocus
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 transition-colors min-h-touch"
              disabled={sending}
            />
          </div>

          {/* Password — visible for sign-in and create modes */}
          {mode !== "magic-link" && (
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "create" ? "Create a password (8+ characters)" : "Your password"}
                required
                autoComplete={mode === "create" ? "new-password" : "current-password"}
                className="w-full px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 transition-colors min-h-touch"
                disabled={sending}
              />
            </div>
          )}

          {/* Confirm password — create mode only */}
          {mode === "create" && (
            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-foreground mb-1">
                Confirm Password
              </label>
              <input
                id="confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
                autoComplete="new-password"
                className="w-full px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 transition-colors min-h-touch"
                disabled={sending}
              />
            </div>
          )}

          {/* Partner code — collapsible */}
          <div>
            <button
              type="button"
              onClick={() => setShowCode(!showCode)}
              className="text-xs text-sage-600 hover:text-sage-700 transition-colors"
            >
              {showCode ? "Hide partner code" : "Have a partner code?"}
            </button>
            {showCode && (
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g., PARTNER123"
                className="mt-2 w-full px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 transition-colors min-h-touch uppercase"
                disabled={sending}
              />
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitDisabled}
            className="w-full px-6 py-4 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-touch"
          >
            {sending
              ? "Working..."
              : mode === "create"
                ? "Create Account"
                : mode === "magic-link"
                  ? "Send Magic Link"
                  : "Sign In"}
          </button>
        </form>

        {/* Mode switchers */}
        <div className="mt-6 space-y-3 text-center">
          {mode === "sign-in" && (
            <>
              <button
                type="button"
                onClick={() => { setMode("magic-link"); setError(""); setPassword(""); }}
                className="text-xs text-muted hover:text-sage-600 transition-colors block mx-auto"
              >
                Forgot password? Sign in with a magic link
              </button>
              <button
                type="button"
                onClick={() => { setMode("create"); setError(""); setPassword(""); setConfirmPassword(""); }}
                className="text-sm text-sage-600 hover:text-sage-700 transition-colors block mx-auto"
              >
                New here? Create an account
              </button>
            </>
          )}

          {mode === "create" && (
            <button
              type="button"
              onClick={() => { setMode("sign-in"); setError(""); setPassword(""); setConfirmPassword(""); }}
              className="text-sm text-sage-600 hover:text-sage-700 transition-colors"
            >
              Already have an account? Sign in
            </button>
          )}

          {mode === "magic-link" && (
            <>
              <p className="text-xs text-muted">
                We&apos;ll email you a one-time sign-in link. No password needed.
                Use this if you lost your device or forgot your password.
              </p>
              <button
                type="button"
                onClick={() => { setMode("sign-in"); setError(""); }}
                className="text-sm text-sage-600 hover:text-sage-700 transition-colors"
              >
                Back to password sign-in
              </button>
            </>
          )}
        </div>

        {/* Ways to sign in — always visible */}
        <div className="mt-8 pt-6 border-t border-border">
          <p className="text-xs text-muted text-center mb-3 font-medium">Ways to sign in</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <button
              type="button"
              onClick={() => { setMode("sign-in"); setError(""); }}
              className={`text-xs py-2 px-2 rounded-lg transition-colors ${
                mode === "sign-in" ? "bg-sage-100 text-sage-700 font-medium" : "text-muted hover:bg-gray-50"
              }`}
            >
              Password
            </button>
            <button
              type="button"
              onClick={() => { setMode("magic-link"); setError(""); setPassword(""); }}
              className={`text-xs py-2 px-2 rounded-lg transition-colors ${
                mode === "magic-link" ? "bg-sage-100 text-sage-700 font-medium" : "text-muted hover:bg-gray-50"
              }`}
            >
              Magic Link
            </button>
            <button
              type="button"
              onClick={() => { setMode("create"); setError(""); setPassword(""); setConfirmPassword(""); }}
              className={`text-xs py-2 px-2 rounded-lg transition-colors ${
                mode === "create" ? "bg-sage-100 text-sage-700 font-medium" : "text-muted hover:bg-gray-50"
              }`}
            >
              New Account
            </button>
          </div>
        </div>

        {isDev && (
          <div className="mt-4 pt-4 border-t border-border">
            <button
              onClick={async () => {
                setSending(true); storeCode();
                try { await signIn("dev-login", { email: email.trim() || "dev@test.com", callbackUrl: "/dashboard" }); }
                catch { setError("Dev login failed."); setSending(false); }
              }}
              disabled={sending}
              className="w-full px-6 py-3 bg-amber-100 text-amber-800 rounded-xl text-sm font-medium hover:bg-amber-200 transition-colors min-h-touch"
            >
              Dev Login (skip email)
            </button>
          </div>
        )}

        <div className="mt-6 text-center">
          <p className="text-xs text-muted">
            No credit card. No spam. Your data stays yours.
          </p>
          <p className="text-xs text-muted mt-2">
            Haven&apos;t started yet?{" "}
            <a href="/intro" className="text-sage-600 hover:text-sage-700 font-medium">
              Try The Forge
            </a>{" "}
            — free, no account needed.
          </p>
        </div>
      </div>
    </main>
  );
}
