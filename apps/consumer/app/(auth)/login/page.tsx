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
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const searchParams = useSearchParams();
  const isDev = process.env.NODE_ENV === "development";

  // "Create Account" mode when arriving from Forge
  const fromForge = searchParams.get("from") === "forge";
  const [isRegister, setIsRegister] = useState(fromForge);

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
        CredentialsSignin: "Invalid email or password.",
      };
      setError(messages[urlError] || `Login error: ${urlError}`);
    }
  }, [searchParams]);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setError("");
    setSending(true);

    if (code.trim()) {
      localStorage.setItem("pending_access_code", code.trim());
    }

    try {
      const result = await signIn("resend", {
        email: email.trim(),
        callbackUrl: searchParams.get("callbackUrl") || "/dashboard",
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

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password || !confirmPassword) return;

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setError("");
    setSending(true);

    if (code.trim()) {
      localStorage.setItem("pending_access_code", code.trim());
    }

    try {
      const regRes = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (!regRes.ok) {
        const data = await regRes.json().catch(() => ({}));
        setError(data.error || "Could not create account.");
        setSending(false);
        return;
      }

      // Auto-sign in after registration
      const result = await signIn("password-login", {
        email: email.trim(),
        password,
        callbackUrl: searchParams.get("callbackUrl") || "/dashboard",
        redirect: false,
      });

      if (result?.error) {
        setError("Account created but sign-in failed. Try signing in manually.");
        setSending(false);
      } else if (result?.url) {
        window.location.href = result.url;
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setSending(false);
    }
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setError("");
    setSending(true);

    if (code.trim()) {
      localStorage.setItem("pending_access_code", code.trim());
    }

    try {
      const result = await signIn("password-login", {
        email: email.trim(),
        password,
        callbackUrl: searchParams.get("callbackUrl") || "/dashboard",
        redirect: false,
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

  async function handleDevLogin() {
    setSending(true);
    if (code.trim()) {
      localStorage.setItem("pending_access_code", code.trim());
    }
    try {
      await signIn("dev-login", {
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
          {isRegister ? "Create Your Account" : "Sign In"}
        </h1>
        <p className="text-body text-muted mb-6 text-center">
          {isRegister
            ? "Create a free account to save your Forge results and start building in The Refinery."
            : usePassword
              ? "Sign in with your email and password."
              : "Enter your email and we\u2019ll send you a magic link \u2014 no password needed."}
        </p>

        <form
          onSubmit={isRegister ? handleRegister : usePassword ? handlePasswordLogin : handleMagicLink}
          className="space-y-4"
        >
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
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 transition-colors min-h-touch"
              disabled={sending}
            />
          </div>

          {(usePassword || isRegister) && (
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isRegister ? "Create a password (8+ characters)" : "Your password"}
                required
                autoComplete={isRegister ? "new-password" : "current-password"}
                className="w-full px-4 py-3 rounded-xl border-2 border-border text-sm bg-white focus:border-sage-600 transition-colors min-h-touch"
                disabled={sending}
              />
            </div>
          )}

          {isRegister && (
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
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
            disabled={sending || !email.trim() || ((usePassword || isRegister) && !password) || (isRegister && !confirmPassword)}
            className="w-full px-6 py-4 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-touch"
          >
            {sending
              ? (isRegister ? "Creating account..." : "Signing in...")
              : isRegister
              ? "Create Account"
              : usePassword
              ? "Sign In"
              : "Send Magic Link"}
          </button>
        </form>

        {/* Toggle between modes */}
        <div className="mt-4 text-center">
          {isRegister ? (
            <button
              type="button"
              onClick={() => {
                setIsRegister(false);
                setUsePassword(true);
                setError("");
                setPassword("");
                setConfirmPassword("");
              }}
              className="text-sm text-sage-600 hover:text-sage-700 transition-colors"
            >
              Already have an account? Sign in
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setUsePassword(!usePassword);
                  setError("");
                  setPassword("");
                }}
                className="text-sm text-sage-600 hover:text-sage-700 transition-colors"
              >
                {usePassword
                  ? "Don\u2019t have a password? Use a magic link instead"
                  : "Already have a password? Sign in with password"}
              </button>
              {usePassword && (
                <p className="text-xs text-muted mt-2">
                  Forgot your password? Use a magic link to sign in and set a new one.
                </p>
              )}
              {!usePassword && (
                <button
                  type="button"
                  onClick={() => {
                    setIsRegister(true);
                    setError("");
                    setPassword("");
                  }}
                  className="text-xs text-muted mt-2 block mx-auto hover:text-sage-600 transition-colors"
                >
                  New here? Create an account
                </button>
              )}
            </>
          )}
        </div>

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
