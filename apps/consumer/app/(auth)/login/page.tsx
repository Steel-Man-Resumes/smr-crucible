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
import Link from "next/link";
import { TBtn } from "@crucible/consumer-ui";

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
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
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

  function resetLocalFlowState() {
    const keys = [
      "forge_session",
      "forge_preload",
      "consumer_progress",
      "consent_record",
      "hidden_jobs",
      "saved_jobs",
      "admin_test_mode",
      "forge_audience",
      "pending_access_code",
    ];
    for (const key of keys) localStorage.removeItem(key);
  }

  async function handleDevLogin(tier: "client" | "partner" | "admin", fresh = false) {
    setSending(true);
    setError("");
    if (fresh) resetLocalFlowState();
    storeCode();
    const devEmail = fresh
      ? `client-${Date.now()}@steelman.dev`
      : email.trim() || `${tier}@steelman.dev`;
    try {
      await signIn("dev-login", {
        email: devEmail,
        tier,
        callbackUrl: fresh ? "/dashboard" : callbackUrl,
      });
    } catch {
      setError("Dev login failed.");
      setSending(false);
    }
  }

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
    if (!name.trim() || !phone.trim()) { setError("Please add your name and phone -- they go on the resumes you build."); return; }
    setError(""); setSending(true); storeCode();

    // Carry the Forge work onto the new account server-side. The forge_session
    // lives in forge.* localStorage and is lost crossing to the authed origin,
    // so we hand it to the register call to persist against the new user.
    let forge: unknown = null;
    try {
      const s = localStorage.getItem("forge_session");
      forge = s ? JSON.parse(s) : null;
    } catch { forge = null; }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, name: name.trim(), phone: phone.trim(), forge }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not create account.");
        setSending(false);
        return;
      }
      // New accounts with no Forge data go to /intro, not /dashboard
      const createCallback = (() => {
        try {
          const s = localStorage.getItem("forge_session");
          const session = s ? JSON.parse(s) : null;
          return session?.forgeOutput ? callbackUrl : "/intro";
        } catch { return "/intro"; }
      })();
      const result = await signIn("password-login", {
        email: email.trim(), password, callbackUrl: createCallback, redirect: false,
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
      <main className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-center bg-t-bg px-4 py-10 font-body">
        <div className="app-panel w-full max-w-md p-6 text-center sm:p-8">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[6px] border border-[#b9cdbd] bg-[#e3ede5]">
            <svg width="28" height="28" viewBox="0 0 18 18" fill="none" className="text-t-amber">
              <rect x="2" y="4" width="14" height="10" rx="0" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2 6l7 4 7-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-t-white mb-2">Check your email</h1>
          <p className="text-base text-t-phos-dim mb-6">
            We sent a sign-in link to <span className="font-medium text-t-white">{email}</span>.
            Click the link in the email to sign in. It expires in 24 hours.
          </p>
          <button
            onClick={() => { setMagicLinkSent(false); setMode("sign-in"); }}
            className="text-sm text-t-amber-bright hover:text-t-amber"
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
    || (mode === "create" && (!confirmPassword || !name.trim() || !phone.trim()));

  return (
    <main className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-start bg-t-bg px-4 py-10 font-body sm:justify-center sm:py-14">
      <div className="app-panel w-full max-w-md p-6 sm:p-8">
        <div className="mb-6">
          <p className="app-eyebrow mb-2 text-[#4f6b57]">Private career workspace</p>
          <h1 className="text-2xl font-semibold text-t-white">
            {mode === "create" ? "Create your Refinery account" : "Sign in to The Refinery"}
          </h1>
          <p className="mt-2 text-sm text-t-bone-dim">
            {mode === "create"
              ? "Save your Forge work and continue with the full toolset."
              : mode === "magic-link"
                ? "Sign in with a magic link"
                : "Continue your career work where you left off."}
          </p>
        </div>

        <section
          aria-labelledby="signin-help-title"
          className="mb-6 border-l-[3px] border-[#4f6b57] bg-[#f5f6f4] py-3 pl-4 pr-3"
        >
          <h2 id="signin-help-title" className="text-sm font-semibold text-t-white">
            Who signs in here?
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-t-bone-dim">
            The Forge works without an account. Sign in when you want to save
            your work and use The Refinery.
          </p>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-t-bone-dim">
            <li>
              <strong className="text-t-white">New job seeker:</strong> try The
              Forge first, or create a free account below.
            </li>
            <li>
              <strong className="text-t-white">Returning user:</strong> sign in
              to continue where you stopped.
            </li>
            <li>
              <strong className="text-t-white">Partner participant:</strong> use
              the invitation or partner code your organization gave you. Each
              participant creates their own account.
            </li>
          </ul>
        </section>

        <form onSubmit={submitHandler} className="space-y-4">
          {/* Email — always visible, autoComplete for saved credentials */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-t-white mb-1">
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
              className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
              disabled={sending}
            />
          </div>

          {/* Password — visible for sign-in and create modes */}
          {mode !== "magic-link" && (
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-t-white mb-1">
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
                className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
                disabled={sending}
              />
            </div>
          )}

          {/* Confirm password — create mode only */}
          {mode === "create" && (
            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-t-white mb-1">
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
                className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
                disabled={sending}
              />
            </div>
          )}

          {/* Name + phone — create mode (these go on the resume + unlock the tools) */}
          {mode === "create" && (
            <>
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-t-white mb-1">
                  Your name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="First and last name"
                  autoComplete="name"
                  className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
                  disabled={sending}
                />
              </div>
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-t-white mb-1">
                  Phone
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 555-5555"
                  autoComplete="tel"
                  className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
                  disabled={sending}
                />
                <p className="text-[11px] text-t-phos-dim mt-1">These go on the resumes you build. You can change them anytime.</p>
              </div>
            </>
          )}

          {/* Partner code — collapsible */}
          <div>
            <button
              type="button"
              onClick={() => setShowCode(!showCode)}
              className="text-xs text-t-amber-bright hover:text-t-amber transition-colors"
            >
              {showCode ? "Hide partner code" : "Have a partner code?"}
            </button>
            {showCode && (
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g., PARTNER123"
                className="mt-2 w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch uppercase"
                disabled={sending}
              />
            )}
          </div>

          {error && <p className="text-sm text-t-red">{error}</p>}

          {/* Submit */}
          <TBtn type="submit" disabled={submitDisabled} className="w-full !border-[#4f6b57] !bg-[#4f6b57] hover:!bg-[#3d5745]">
            {sending
              ? "Working..."
              : mode === "create"
                ? "Create account"
                : mode === "magic-link"
                  ? "Send magic link"
                  : "Sign in"}
          </TBtn>
        </form>

        {/* Mode switchers — one clear secondary action per mode */}
        <div className="mt-6 text-center space-y-2">
          {mode === "sign-in" && (
            <>
              <button
                type="button"
                onClick={() => { setMode("create"); setError(""); setPassword(""); setConfirmPassword(""); }}
                className="text-sm text-t-amber-bright hover:text-t-amber transition-colors block mx-auto"
              >
                New here? Create a free account
              </button>
              <div className="flex items-center justify-center gap-3 text-xs text-t-phos-dim">
                <button
                  type="button"
                  onClick={() => { window.location.href = `/forgot-password${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""}`; }}
                  className="hover:text-t-amber-bright transition-colors"
                >
                  Forgot password?
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => { setMode("magic-link"); setError(""); setPassword(""); }}
                  className="hover:text-t-amber-bright transition-colors"
                >
                  Email me a sign-in link
                </button>
              </div>
            </>
          )}

          {mode === "create" && (
            <button
              type="button"
              onClick={() => { setMode("sign-in"); setError(""); setPassword(""); setConfirmPassword(""); }}
              className="text-sm text-t-amber-bright hover:text-t-amber transition-colors"
            >
              Already have an account? Sign in
            </button>
          )}

          {mode === "magic-link" && (
            <>
              <p className="text-xs text-t-phos-dim">
                We&apos;ll email a one-time link. It signs you in without changing your password.
              </p>
              <button
                type="button"
                onClick={() => { setMode("sign-in"); setError(""); }}
                className="text-sm text-t-amber-bright hover:text-t-amber transition-colors"
              >
                Back to password sign-in
              </button>
            </>
          )}
        </div>

        {isDev && (
          <div className="mt-4 pt-4 border-t border-t-line">
            <p className="text-xs font-semibold text-t-amber-bright mb-2">
              Development access
            </p>
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => handleDevLogin("client", true)}
                disabled={sending}
                className="t-focus min-h-touch w-full rounded-[5px] border border-t-line-strong bg-t-panel-2 px-4 py-3 text-sm font-medium text-t-white transition-colors hover:bg-t-panel-3 disabled:opacity-40"
              >
                Fresh Client Run
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleDevLogin("client")}
                  disabled={sending}
                  className="t-focus min-h-touch rounded-[5px] border border-t-line bg-t-panel px-4 py-3 text-sm font-medium text-t-white transition-colors hover:border-t-line-strong disabled:opacity-40"
                >
                  Client Login
                </button>
                <button
                  type="button"
                  onClick={() => handleDevLogin("admin")}
                  disabled={sending}
                  className="t-focus min-h-touch rounded-[5px] border border-t-line bg-t-panel px-4 py-3 text-sm font-medium text-t-white transition-colors hover:border-t-line-strong disabled:opacity-40"
                >
                  Admin Login
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  resetLocalFlowState();
                  window.location.href = "/intro";
                }}
                disabled={sending}
                className="t-focus min-h-touch w-full rounded-[5px] border border-t-line bg-transparent px-4 py-3 text-sm font-medium text-t-bone-dim transition-colors hover:border-t-line-strong hover:text-t-white disabled:opacity-40"
              >
                Reset Local Flow Only
              </button>
            </div>
            <p className="text-[11px] text-t-phos-dim mt-2">
              Local only. Skips email sends so you can run demos and debug passes quickly.
            </p>
          </div>
        )}

        <div className="mt-6 text-center">
          <p className="text-xs text-t-phos-dim">
            No credit card. No spam. Your data stays yours.
          </p>
          <p className="text-xs text-t-phos-dim mt-2">
            Haven&apos;t started yet?{" "}
            <a href="/intro" className="text-t-amber-bright hover:text-t-amber font-medium">
              Try The Forge
            </a>{" "}
            — free, no account needed.
          </p>
        </div>
      </div>
    </main>
  );
}
