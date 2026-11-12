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

import { Suspense, useState, useEffect, useRef } from "react";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useTranslations } from "next-intl";
import { signIn, signOut, useSession } from "next-auth/react";
import { confirmedSignOut } from "@/lib/confirmed-sign-out";
import { clearAccountBrowserState } from "@/lib/account-browser-state";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { TBtn } from "@crucible/consumer-ui";
import { trackGA } from "@/lib/ga";
import { passwordProblem, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { isSafeRelativePath } from "@/lib/safe-path";
import { safeLoginReturn } from "@/lib/session-policy";
import { isForgeSignInPage } from "@/lib/forge-access";
import { useForgeWall } from "@/components/forge/useForgeWall";
import { TERMS_TICKED_KEY, tickedMark } from "@/lib/terms-ticked";
import { TERMS_VERSION } from "@/lib/terms";
import {
  FORGE_RUN_CHOICE_DEFAULT,
  FORGE_SESSION_KEY,
  type ForgeRunChoice,
  readLocalForgeRunRaw,
  readStoredForgeRun,
  forgeRunToEraseAtSignup,
  eraseLocalForgeRun,
  forgeChoiceComplete,
  forgeRegisterFields,
  forgeAfterSignup,
  markForgeRunOwned,
} from "@/lib/forge-carry";
import {
  AccountTypeChooser,
  AccountRouteNote,
  ACCOUNT_ROUTES,
  type AccountRoute,
} from "@/components/auth/AccountTypeChooser";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

type Mode = "sign-in" | "create" | "magic-link";

// passwordProblem() (lib/password-policy.ts) words its answer in English. The
// four answers it can give are shown in the page's language (auth.password
// in the catalog); any other text shows as it came.
const PASSWORD_PROBLEM_KEYS: ReadonlyMap<string, string> = new Map([
  [`Use at least ${PASSWORD_MIN_LENGTH} characters.`, "tooShort"],
  ["That password is too long. Use fewer characters; some letters and symbols take more space.", "tooLong"],
  ["Include at least one letter and one number.", "needsLetterAndNumber"],
  ["That password is too common. Pick something only you would know.", "tooCommon"],
]);

// Same-origin relative path only (lib/safe-path.ts). Keeps an honored
// callbackUrl from ever becoming an open redirect. Auth.js also rejects
// cross-origin callback URLs on its side; this is the client half.

function LoginForm() {
  const t = useTranslations("auth.login");
  const tRoutes = useTranslations("auth.routes");
  const tPassword = useTranslations("auth.password");
  const tc = useTranslations("common.actions");
  const searchParams = useSearchParams();
  const { data: currentSession } = useSession();
  const isDev = process.env.NODE_ENV === "development";
  const fromForge = searchParams.get("from") === "forge";
  const forPartner = (searchParams.get("callbackUrl") || "").includes(
    "/dashboard/partner"
  );
  // Sent here from a Forge screen (the sign-in wall): this page brings them
  // straight back there, and says so.
  const forgeReturn = (() => {
    const back = safeLoginReturn(searchParams.get("callbackUrl"));
    return isForgeSignInPage(back.split(/[?#]/)[0]) ? back : null;
  })();
  const wall = useForgeWall();

  const [mode, setMode] = useState<Mode>(fromForge ? "create" : "sign-in");
  // Seeded from ?as= so an invitation email or a partner page can send someone
  // straight to their own door instead of making them find it.
  const [accountRoute, setAccountRoute] = useState<AccountRoute>(() => {
    const asked = searchParams.get("as");
    return ACCOUNT_ROUTES.some((r) => r.id === asked)
      ? (asked as AccountRoute)
      : forPartner
        ? "org"
        : "seeker";
  });
  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [password, setPassword] = useState("");
  // Create-account only: explicit Terms/Privacy/AI-processing acceptance,
  // required before any account or Forge data is persisted server-side.
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  // Shared-computer rule: a Forge run in this browser may be someone else's.
  // When one is here, creating an account needs an explicit yes or no, with
  // nothing preselected (lib/forge-carry.ts). The run asked about is kept
  // from page load, so the one sent is the one the person answered about.
  const [forgeChoice, setForgeChoice] = useState<ForgeRunChoice>(FORGE_RUN_CHOICE_DEFAULT);
  const [forgeRunOffered, setForgeRunOffered] = useState(false);
  const offeredRunRef = useRef<Record<string, any> | null>(null);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  // Two-step sign-in: after password, show a 2FA code field when required.
  const [twoFactorStep, setTwoFactorStep] = useState(false);
  const [totp, setTotp] = useState("");

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setError("");
    setPassword("");
    setConfirmPassword("");
    setTwoFactorStep(false);
    setTotp("");
  }

  function resetSecondStep() {
    setTwoFactorStep(false);
    setTotp("");
    setError("");
  }

  // Pre-fill partner code from URL
  useEffect(() => {
    const urlCode = searchParams.get("code");
    if (urlCode) { setCode(urlCode); setShowCode(true); }
  }, [searchParams]);

  // Ask about a run only when an unowned one with work in it is in this
  // browser. An unowned run past the Forge's 24-hour idle limit is erased,
  // never offered. A run already marked with an owner is never offered either
  // (it is saved in that account); it is erased once a new account is created.
  useEffect(() => {
    const raw = readLocalForgeRunRaw();
    const run = readStoredForgeRun(raw);
    if (!run && raw) {
      try {
        if (!JSON.parse(raw)?._ownerUserId && forgeRunToEraseAtSignup(raw)) eraseLocalForgeRun();
      } catch {}
    }
    offeredRunRef.current = run;
    setForgeRunOffered(!!run);
  }, []);

  // NextAuth error from URL
  useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError) {
      const msgs: Record<string, string> = {
        Configuration: t("urlErrors.Configuration"),
        AccessDenied: t("urlErrors.AccessDenied"),
        Verification: t("urlErrors.Verification"),
        CredentialsSignin: t("urlErrors.CredentialsSignin"),
        OAuthAccountNotLinked: t("urlErrors.OAuthAccountNotLinked"),
        GoogleEmailUnverified: t("urlErrors.GoogleEmailUnverified"),
        GoogleEmailMismatch: t("urlErrors.GoogleEmailMismatch"),
        SessionNotUsable: t("urlErrors.SessionNotUsable"),
      };
      setError(msgs[urlError] || t("errors.signInIncomplete"));
    }
  }, [searchParams]);

  function storeCode() {
    try {
      if (code.trim()) localStorage.setItem("pending_access_code", code.trim());
    } catch {
      // A blocked browser store must not prevent sign-in. Codes can be added
      // from Settings after signing in.
    }
  }

  // Checked here as well as by Auth.js: a same-site path only, never another
  // site, never the login pages or an API route (lib/session-policy.ts).
  const callbackUrl = safeLoginReturn(searchParams.get("callbackUrl"));

  async function switchAccount() {
    setSending(true);
    setError("");
    try {
      // Confirmed server-side first; then nothing of the previous person
      // (Forge run, queues, staff note drafts, codes) stays in this browser.
      await confirmedSignOut();
      clearAccountBrowserState();
      window.location.assign(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    } catch {
      setError(t("errors.signOutFailed"));
      setSending(false);
    }
  }

  async function signInWithGoogle() {
    setSending(true);
    setError("");
    storeCode();
    try {
      await signIn("google", { callbackUrl }, { prompt: "select_account" });
    } catch {
      setError(t("errors.googleNotOpened"));
      setSending(false);
    }
  }
  // Mini Forge sends people here with callbackUrl=/mini-forge/import-complete,
  // the step that loads their tablet plan into the new account. Account
  // creation must honor it (see createCallback below) or the import never runs.
  const fromMiniForge = searchParams.get("from") === "mini-forge";

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
      // Were missing, so they survived every reset: the last job search with
      // its full result list, and the approved-resume pointer that seeds the
      // generator's tailoring base.
      "refinery_last_job_search",
      "active_baseline_id",
      "view_as",
    ];
    for (const key of keys) localStorage.removeItem(key);
  }

  /**
   * Clear the PREVIOUS account's derived state when creating a new account in
   * a browser that already has one, WITHOUT touching `forge_session` -- that
   * blob is carried onto the new account below only if the person answers
   * "Yes", and erased if they answer "No".
   *
   * This is the path used to give each demo persona its own clean account.
   */
  function clearPriorAccountState() {
    const keys = [
      "forge_preload",
      "consumer_progress",
      "hidden_jobs",
      "saved_jobs",
      "refinery_last_job_search",
      "active_baseline_id",
      "view_as",
    ];
    for (const key of keys) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
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

  function passwordProblemText(problem: string): string {
    const key = PASSWORD_PROBLEM_KEYS.get(problem);
    return key ? tPassword(`problems.${key}`, { min: PASSWORD_MIN_LENGTH }) : problem;
  }

  // ─── Sign In ──────────────────────────────────────────────────────────
  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setError(""); setSending(true); storeCode();

    try {
      // Step 1 (password only): verify creds + learn if a 2FA code is needed.
      // Fail-open: if precheck is unavailable, fall through to sign-in (which
      // still enforces 2FA on its own) rather than blocking a valid login.
      if (!twoFactorStep) {
        const preRes = await fetch("/api/auth/password-precheck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
        }).catch(() => null);
        // A rate-limited precheck is not a wrong password. Say what happened.
        if (preRes && preRes.status === 429) {
          setError(t("errors.tooManyAttempts"));
          setSending(false);
          return;
        }
        const pre = preRes ? await preRes.json().catch(() => null) : null;
        if (pre && pre.ok === false) {
          setError(t("errors.invalidCredentials"));
          setSending(false);
          return;
        }
        if (pre && pre.twoFactorRequired) {
          setTwoFactorStep(true);
          setSending(false);
          return;
        }
      }

      const result = await signIn("password-login", {
        email: email.trim(),
        password,
        totp: twoFactorStep ? totp.trim() : undefined,
        callbackUrl,
        redirect: false,
      });
      if (result?.error) {
        setError(
          twoFactorStep
            ? t("errors.codeMismatch")
            : t("errors.invalidCredentials")
        );
        setSending(false);
      } else if (result?.url) {
        window.location.href = result.url;
      } else {
        setError(t("errors.signInIncomplete"));
        setSending(false);
      }
    } catch {
      setError(t("errors.generic"));
      setSending(false);
    }
  }

  // ─── Create Account ───────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password || !confirmPassword) return;
    if (password !== confirmPassword) { setError(tPassword("mismatch")); return; }
    { const problem = passwordProblem(password); if (problem) { setError(passwordProblemText(problem)); return; } }
    if (!name.trim() || !phone.trim()) { setError(t("errors.nameAndPhone")); return; }
    if (!acceptedTerms) { setError(t("errors.agreeCreate")); return; }
    if (!forgeChoiceComplete(forgeRunOffered, forgeChoice)) { setError(t("forgeRun.hint")); return; }
    setError(""); setSending(true); storeCode();

    // Carry the Forge work onto the new account server-side, ONLY when the
    // person answered "Yes". The forge_session lives in forge.* localStorage
    // and is lost crossing to the authed origin, so we hand it to the register
    // call. On a shared computer it may be someone else's run, so "No" (or no
    // run offered) sends nothing.
    const offeredRun = forgeRunOffered ? offeredRunRef.current : null;
    const forgeFields = forgeRegisterFields(offeredRun, forgeRunOffered ? forgeChoice : null);

    // The Forge work above carries forward only by choice. Everything else in this
    // browser belongs to whoever was signed in before and must not follow a
    // brand-new account -- otherwise the previous person's saved jobs, progress
    // counters and approved-resume pointer become this account's opening state.
    clearPriorAccountState();

    try {
      // Turnstile token (present only when the env-gated widget is rendered)
      let turnstileToken: string | undefined;
      try {
        const el = document.querySelector<HTMLInputElement>(
          'input[name="cf-turnstile-response"]'
        );
        turnstileToken = el?.value || undefined;
      } catch {}

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, name: name.trim(), phone: phone.trim(), ...forgeFields, turnstileToken, acceptedTerms: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t("errors.createFailed"));
        setSending(false);
        return;
      }
      // The account exists. "No": erase the run from this computer now, before
      // any redirect, so no later screen can pick it up. "Yes": mark it as this
      // new account's run so the Refinery does not ask again. A run another
      // account owns was never offered; erase it too.
      const created = await res.json().catch(() => ({}));
      const after = forgeAfterSignup(forgeRunOffered, forgeChoice);
      if (after === "erase" || (!forgeRunOffered && forgeRunToEraseAtSignup(readLocalForgeRunRaw()))) {
        eraseLocalForgeRun();
      } else if (after === "mark-owned" && offeredRun && typeof created?.userId === "string") {
        try {
          localStorage.setItem(FORGE_SESSION_KEY, JSON.stringify(markForgeRunOwned(offeredRun, created.userId)));
        } catch {}
      }
      // Acquisition attribution only -- no PII, no product detail (GA doctrine).
      trackGA("refinery_signup", { from_forge: !!forgeFields.forge });
      // New accounts with no Forge data go to /intro, not /dashboard. A run
      // answered "No" is not this account's data.
      const createCallback = (() => {
        const explicit = searchParams.get("callbackUrl");
        if (explicit && isSafeRelativePath(explicit)) return safeLoginReturn(explicit);
        // Came from a Forge screen (the sign-in wall): back to it. A run
        // answered "Yes" is marked as this account's below, so the Forge
        // shows it; "No" erased it.
        if (forgeReturn) return forgeReturn;
        return callbackUrl;
      })();
      const result = await signIn("password-login", {
        email: email.trim(), password, callbackUrl: createCallback, redirect: false,
      });
      if (result?.error) {
        changeMode("sign-in");
        setError(t("errors.createdTrySignIn"));
        setSending(false);
      } else if (result?.url) {
        window.location.href = result.url;
      } else {
        changeMode("sign-in");
        setError(t("errors.createdSignIn"));
        setSending(false);
      }
    } catch {
      setError(t("errors.generic"));
      setSending(false);
    }
  }

  // ─── Magic Link ───────────────────────────────────────────────────────
  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    if (!acceptedTerms) { setError(t("errors.agreeContinue")); return; }
    setError(""); setSending(true); storeCode();
    // The box checked here is recorded once the link signs them in, on this
    // browser only (app/(auth)/login/terms).
    try {
      localStorage.setItem(TERMS_TICKED_KEY, JSON.stringify(tickedMark(email, TERMS_VERSION)));
    } catch {
      // storage blocked: the terms page asks with one tap instead
    }

    try {
      const result = await signIn("resend", {
        email: email.trim(), callbackUrl, redirect: false,
      });
      if (result?.error) {
        setError(t("errors.magicLinkFailed"));
        setSending(false);
      } else if (result?.url) {
        setMagicLinkSent(true);
        setSending(false);
      } else {
        setError(t("errors.requestNotConfirmed"));
        setSending(false);
      }
    } catch {
      setError(t("errors.generic"));
      setSending(false);
    }
  }

  // ─── Magic link sent confirmation ─────────────────────────────────────
  if (magicLinkSent) {
    return (
      <main className="forge-workshop flex min-h-[calc(100vh-72px)] flex-col items-center justify-center bg-t-bg px-4 py-10 font-body">
        <div className="w-full max-w-md border border-t-line bg-t-panel p-6 text-center sm:p-8">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center border border-t-amber bg-t-panel-2">
            <svg width="28" height="28" viewBox="0 0 18 18" fill="none" className="text-t-amber">
              <rect x="2" y="4" width="14" height="10" rx="0" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2 6l7 4 7-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-t-white mb-2">{t("checkEmail.title")}</h1>
          <p className="text-base text-t-phos-dim mb-6">
            {t.rich("checkEmail.body", {
              address: email,
              email: (chunks) => <span className="font-medium text-t-white">{chunks}</span>,
            })}
          </p>
          <button
            onClick={() => { setMagicLinkSent(false); changeMode("sign-in"); }}
            className="text-sm text-t-amber-bright hover:text-t-amber"
          >
            {t("checkEmail.back")}
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
    || (mode === "sign-in" && twoFactorStep && !totp.trim())
    || (mode === "create" && (!confirmPassword || !name.trim() || !phone.trim() || !acceptedTerms))
    || (mode === "magic-link" && !acceptedTerms)
    || (mode === "create" && !forgeChoiceComplete(forgeRunOffered, forgeChoice));

  return (
    <main className="forge-workshop flex min-h-[calc(100vh-72px)] flex-col items-center justify-start bg-t-bg px-4 py-10 font-body sm:justify-center sm:py-14">
      <div className="w-full max-w-md border border-t-line bg-t-panel p-6 shadow-[4px_4px_0_#000] sm:p-8">
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="font-term text-[11px] font-bold uppercase text-t-amber-bright">
              {forgeReturn ? "/forge" : "/refinery"}
            </p>
            {/* Site language, one tap (i18n/locale.ts). */}
            <LanguageSwitch variant="compact" tone="dark" />
          </div>
          <h1 className="font-display text-2xl font-bold uppercase text-t-white" data-testid="login-heading">
            {forgeReturn
              ? mode === "create"
                ? t("heading.forgeCreate")
                : t("heading.forgeSignIn")
              : mode === "create"
                ? t("heading.create")
                : (ACCOUNT_ROUTES.some((r) => r.id === accountRoute)
                    ? tRoutes(`${accountRoute}.heading`)
                    : t("heading.signInRefinery"))}
          </h1>
          <p className="mt-2 text-sm text-t-bone-dim">
            {forgeReturn
              ? t("subheading.forge")
              : mode === "create"
                ? t("subheading.create")
                : mode === "magic-link"
                  ? t("subheading.magicLink")
                  : t("subheading.default")}
          </p>
        </div>

        {currentSession?.user?.email && (
          <div className="mb-4 border border-t-line p-3 text-sm text-t-white">
            <p className="break-words">{t("signedInAs", { email: currentSession.user.email })}</p>
            <Link href={callbackUrl} className="t-focus mr-4 inline-block py-2 text-t-amber-bright underline">{tc("continue")}</Link>
            <button type="button" onClick={() => void switchAccount()} disabled={sending} className="t-focus py-2 text-t-amber-bright underline disabled:opacity-50">
              {t("switchAccount")}
            </button>
          </div>
        )}

        {/* Someone coming from a Forge screen is here to build their own
            resume: the "who are you here as" choice would only slow them down. */}
        {!forgeReturn && <AccountTypeChooser value={accountRoute} onChange={setAccountRoute} />}

        <AccountRouteNote route={accountRoute}>
          {accountRoute === "agency" && (
            <p className="mt-2 text-xs leading-relaxed text-t-bone-dim">
              {t.rich("agencyNote", {
                forge: (chunks) => (
                  <a
                    href="https://forge.steelmanresumes.com"
                    className="font-medium text-t-amber-bright underline underline-offset-2"
                  >
                    {chunks}
                  </a>
                ),
                mail: (chunks) => (
                  <a
                    href="mailto:hmu@themidnightgarden.club?subject=Agency%20evaluation"
                    className="font-medium text-t-amber-bright underline underline-offset-2"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </p>
          )}
          {accountRoute === "org" && (
            <p className="mt-2 text-xs leading-relaxed text-t-bone-dim">
              {t.rich("orgNote", {
                mail: (chunks) => (
                  <a
                    href="mailto:hmu@themidnightgarden.club?subject=Organization%20access"
                    className="font-medium text-t-amber-bright underline underline-offset-2"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </p>
          )}
        </AccountRouteNote>

        {/* Google sign-in -- env-gated dark build; shows once
            NEXT_PUBLIC_GOOGLE_AUTH=1 (and AUTH_GOOGLE_ID/SECRET server-side) */}
        {process.env.NEXT_PUBLIC_GOOGLE_AUTH === "1" && (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              disabled={sending}
              className="t-focus w-full flex items-center justify-center gap-2 px-4 py-3 border border-t-line bg-t-panel text-sm font-medium text-t-white hover:border-t-phos-dim transition-colors min-h-touch"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0012 23z" />
                <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 010-4.2V7.06H2.18a11 11 0 000 9.88l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 002.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              {t("google")}
            </button>
            <div className="flex items-center gap-3 mt-4">
              <div className="flex-1 h-px bg-t-line" />
              <span className="text-[11px] text-t-phos-dim">{t("or")}</span>
              <div className="flex-1 h-px bg-t-line" />
            </div>
          </div>
        )}

        <form onSubmit={submitHandler} className="space-y-4">
          {/* Email — always visible, autoComplete for saved credentials */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-t-white mb-1">
              {t("fields.email")}
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); resetSecondStep(); }}
              placeholder={t("fields.emailPlaceholder")}
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
                {t("fields.password")}
              </label>
              <PasswordInput
                key={mode}
                id="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); resetSecondStep(); }}
                placeholder={mode === "create" ? t("fields.createPasswordPlaceholder", { hint: tPassword("hint", { min: PASSWORD_MIN_LENGTH }) }) : t("fields.passwordPlaceholder")}
                required
                autoComplete={mode === "create" ? "new-password" : "current-password"}
                className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
                disabled={sending}
              />
            </div>
          )}

          {/* Two-factor code — sign-in, second step */}
          {mode === "sign-in" && twoFactorStep && (
            <div>
              <label htmlFor="totp" className="block text-sm font-medium text-t-white mb-1">
                {t("fields.authCode")}
              </label>
              <input
                id="totp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/[^0-9a-zA-Z-]/g, ""))}
                placeholder={t("fields.authCodePlaceholder")}
                autoFocus
                className="w-full px-4 py-3 border border-t-amber text-sm bg-t-panel text-t-white tracking-widest focus:border-t-amber-bright focus:outline-none transition-colors min-h-touch"
                disabled={sending}
              />
              <p className="text-[11px] text-t-phos-dim mt-1">
                {t("fields.authCodeHelp")}
              </p>
            </div>
          )}

          {/* Confirm password — create mode only */}
          {mode === "create" && (
            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-t-white mb-1">
                {t("fields.confirmPassword")}
              </label>
              <PasswordInput
                id="confirm"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t("fields.confirmPasswordPlaceholder")}
                required
                autoComplete="new-password"
                className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
                disabled={sending}
              />
            </div>
          )}

          {/* Turnstile bot check -- env-gated; renders once
              NEXT_PUBLIC_TURNSTILE_SITE_KEY is set (server enforces when
              TURNSTILE_SECRET_KEY is set) */}
          {mode === "create" && <TurnstileWidget />}

          {/* Name + phone — create mode (these go on the resume + unlock the tools) */}
          {mode === "create" && (
            <>
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-t-white mb-1">
                  {t("fields.name")}
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("fields.namePlaceholder")}
                  autoComplete="name"
                  className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
                  disabled={sending}
                />
              </div>
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-t-white mb-1">
                  {t("fields.phone")}
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
                <p className="text-[11px] text-t-phos-dim mt-1">{t("fields.phoneHelp")}</p>
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
              {showCode ? t("partnerCode.hide") : t("partnerCode.show")}
            </button>
            {showCode && (
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder={t("partnerCode.placeholder")}
                className="mt-2 w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch uppercase"
                disabled={sending}
              />
            )}
          </div>

          {/* Shared-computer rule: a run on this computer needs a yes or a no,
              nothing preselected. Create account stays disabled until then. */}
          {mode === "create" && forgeRunOffered && (
            <fieldset className="border border-t-line px-4 py-3">
              <legend className="px-1 text-sm font-semibold text-t-white">
                {t("forgeRun.legend")}
              </legend>
              <label className="mt-1 flex items-start gap-2 text-sm text-t-white">
                <input
                  type="radio"
                  name="forge-run-choice"
                  value="yes"
                  checked={forgeChoice === "yes"}
                  onChange={() => setForgeChoice("yes")}
                  disabled={sending}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 accent-t-amber"
                />
                <span>{t("forgeRun.yes")}</span>
              </label>
              <label className="mt-2 flex items-start gap-2 text-sm text-t-white">
                <input
                  type="radio"
                  name="forge-run-choice"
                  value="no"
                  checked={forgeChoice === "no"}
                  onChange={() => setForgeChoice("no")}
                  disabled={sending}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 accent-t-amber"
                />
                <span>{t("forgeRun.no")}</span>
              </label>
              {forgeChoice === null && (
                <p className="mt-2 text-sm text-t-bone-dim">{t("forgeRun.hint")}</p>
              )}
            </fieldset>
          )}

          {/* Terms / Privacy / AI-processing consent -- create and email-link
              modes. Required before any account or Forge data persists:
              recorded at registration, or on the terms page once an email link
              signs the person in (app/(auth)/login/terms). */}
          {(mode === "create" || mode === "magic-link") && (
            <label className="flex items-start gap-2 text-[12px] text-t-phos-dim">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                disabled={sending}
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-t-amber"
              />
              <span>
                {t.rich("terms", {
                  terms: (chunks) => (
                    <a href="https://steelmanresumes.com/terms" target="_blank" rel="noopener noreferrer" className="text-t-amber-bright hover:text-t-amber underline">{chunks}</a>
                  ),
                  privacy: (chunks) => (
                    <a href="https://steelmanresumes.com/privacy" target="_blank" rel="noopener noreferrer" className="text-t-amber-bright hover:text-t-amber underline">{chunks}</a>
                  ),
                })}
              </span>
            </label>
          )}

          {error && (
            <p role="alert" className="text-sm text-t-red">
              {error}
              {["OAuthAccountNotLinked", "SessionNotUsable"].includes(searchParams.get("error") || "") && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => void switchAccount()}
                    disabled={sending}
                    className="underline hover:no-underline"
                  >
                    {t("signOut")}
                  </button>
                </>
              )}
            </p>
          )}

          {/* Submit */}
          <TBtn type="submit" disabled={submitDisabled} className="w-full !text-[#14100a]">
            {sending
              ? t("submit.working")
              : mode === "create"
                ? t("submit.create")
                : mode === "magic-link"
                  ? t("submit.magicLink")
                  : twoFactorStep
                    ? t("submit.verify")
                    : t("submit.signIn")}
          </TBtn>
        </form>

        {/* Mode switchers — one clear secondary action per mode */}
        <div className="mt-6 text-center space-y-2">
          {mode === "sign-in" && (
            <>
              <button
                type="button"
                onClick={() => changeMode("create")}
                disabled={sending}
                className="text-sm text-t-amber-bright hover:text-t-amber transition-colors block mx-auto"
              >
                {t("switchers.newHere")}
              </button>
              <div className="flex items-center justify-center gap-3 text-xs text-t-phos-dim">
                <button
                  type="button"
                  onClick={() => { window.location.href = `/forgot-password${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ""}`; }}
                  disabled={sending}
                  className="hover:text-t-amber-bright transition-colors"
                >
                  {t("switchers.forgot")}
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => changeMode("magic-link")}
                  disabled={sending}
                  className="hover:text-t-amber-bright transition-colors"
                >
                  {t("switchers.emailLink")}
                </button>
              </div>
            </>
          )}

          {mode === "create" && (
            <button
              type="button"
              onClick={() => changeMode("sign-in")}
              disabled={sending}
              className="text-sm text-t-amber-bright hover:text-t-amber transition-colors"
            >
              {t("switchers.haveAccount")}
            </button>
          )}

          {mode === "magic-link" && (
            <>
              <p className="text-xs text-t-phos-dim">
                {t("switchers.linkNote")}
              </p>
              <button
                type="button"
                onClick={() => changeMode("sign-in")}
                disabled={sending}
                className="text-sm text-t-amber-bright hover:text-t-amber transition-colors"
              >
                {t("switchers.backToPassword")}
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
                className="t-focus min-h-touch w-full border border-t-line-strong bg-t-panel-2 px-4 py-3 text-sm font-medium text-t-white transition-colors hover:bg-t-panel-3 disabled:opacity-40"
              >
                Fresh Client Run
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleDevLogin("client")}
                  disabled={sending}
                  className="t-focus min-h-touch border border-t-line bg-t-panel px-4 py-3 text-sm font-medium text-t-white transition-colors hover:border-t-line-strong disabled:opacity-40"
                >
                  Client Login
                </button>
                <button
                  type="button"
                  onClick={() => handleDevLogin("admin")}
                  disabled={sending}
                  className="t-focus min-h-touch border border-t-line bg-t-panel px-4 py-3 text-sm font-medium text-t-white transition-colors hover:border-t-line-strong disabled:opacity-40"
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
                className="t-focus min-h-touch w-full border border-t-line bg-transparent px-4 py-3 text-sm font-medium text-t-bone-dim transition-colors hover:border-t-line-strong hover:text-t-white disabled:opacity-40"
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
            {t("footer.free")}
          </p>
          <p className="text-xs text-t-phos-dim mt-2">
            {t.rich(
              wall === null ? "footer.notStartedPlain" : wall === "up" ? "footer.notStartedUp" : "footer.notStartedOpen",
              {
                link: (chunks) => (
                  <a href="/intro" className="text-t-amber-bright hover:text-t-amber font-medium">
                    {chunks}
                  </a>
                ),
              },
            )}
          </p>
        </div>
      </div>
    </main>
  );
}
