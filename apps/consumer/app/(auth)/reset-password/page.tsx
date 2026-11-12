"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { TBtn } from "@crucible/consumer-ui";
import { passwordProblem, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

// passwordProblem() (lib/password-policy.ts) words its answer in English. The
// four answers it can give are shown in the page's language (auth.password
// in the catalog); any other text shows as it came.
const PASSWORD_PROBLEM_KEYS: ReadonlyMap<string, string> = new Map([
  [`Use at least ${PASSWORD_MIN_LENGTH} characters.`, "tooShort"],
  ["That password is too long. Use fewer characters; some letters and symbols take more space.", "tooLong"],
  ["Include at least one letter and one number.", "needsLetterAndNumber"],
  ["That password is too common. Pick something only you would know.", "tooCommon"],
]);

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
  const t = useTranslations("auth.reset");
  const tPassword = useTranslations("auth.password");
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
      setError(tPassword("mismatch"));
      return;
    }
    const problem = passwordProblem(password);
    if (problem) {
      const key = PASSWORD_PROBLEM_KEYS.get(problem);
      setError(key ? tPassword(`problems.${key}`, { min: PASSWORD_MIN_LENGTH }) : problem);
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
        setError(data.error || t("errors.resetFailed"));
        setStatus("idle");
        return;
      }
      try {
        sessionStorage.removeItem(LINK_KEY);
      } catch {
        // ignore
      }
      setPassword("");
      setConfirmPassword("");
      setStatus("done");
    } catch {
      setError(t("errors.generic"));
      setStatus("idle");
    }
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
            {t("invalidTitle")}
          </h1>
          <p className="text-base text-t-phos-dim mb-6">
            {t("invalidBody")}
          </p>
          <Link href="/forgot-password" className="text-sm text-t-amber-bright hover:text-t-amber">
            {t("requestNew")}
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
            {t("doneTitle")}
          </h1>
          <p className="text-base text-t-phos-dim mb-6">
            {t("doneBody")}
          </p>
          <Link href={`/login?email=${encodeURIComponent(email)}`} className="t-focus inline-block px-4 py-3 text-t-amber-bright underline">
            {t("goToSignIn")}
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
            {t("title")}
          </h1>
          <p className="text-sm text-t-phos-dim mt-1">
            {t("forEmail", { email })}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-t-white mb-1">
              {t("newPassword")}
            </label>
            <PasswordInput
              id="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t("newPasswordPlaceholder", { hint: tPassword("hint", { min: PASSWORD_MIN_LENGTH }) })}
              required
              autoComplete="new-password"
              className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
              disabled={status === "saving"}
            />
          </div>

          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-t-white mb-1">
              {t("confirmPassword")}
            </label>
            <PasswordInput
              id="confirm"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder={t("confirmPasswordPlaceholder")}
              required
              autoComplete="new-password"
              className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
              disabled={status === "saving"}
            />
          </div>

          {error && <p role="alert" className="text-sm text-t-red">{error}</p>}

          <TBtn
            type="submit"
            disabled={status === "saving" || !password || !confirmPassword}
            className="w-full"
          >
            {status === "saving" ? t("saving") : t("submit")}
          </TBtn>
        </form>
      </div>
    </main>
  );
}
