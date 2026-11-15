"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TBtn } from "@crucible/consumer-ui";
import { useTranslations } from "next-intl";

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}

function ForgotPasswordForm() {
  const t = useTranslations("refineryShell.forgot");
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
        setError(data.error || t("couldNotSend"));
        setStatus("idle");
        return;
      }
      setStatus("sent");
    } catch {
      setError(t("wentWrong"));
      setStatus("idle");
    }
  }

  if (status === "sent") {
    return (
      <main className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-center bg-t-bg px-4 py-10 font-body">
        <div className="app-panel w-full max-w-md p-6 text-center sm:p-8">
          <h1 className="text-2xl font-bold text-t-white mb-2">
            {t("sentTitle")}
          </h1>
          <p className="text-base text-t-phos-dim mb-6">
            {t.rich("sentBody", { email, strong: (chunks) => <span className="font-medium text-t-white">{chunks}</span> })}
          </p>
          <Link href="/login" className="text-sm text-t-amber-bright hover:text-t-amber">
            {t("backToSignIn")}
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
            {t("lead")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-t-white mb-1">
              {t("emailLabel")}
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t("emailPlaceholder")}
              required
              autoComplete="email"
              className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
              disabled={status === "sending"}
            />
          </div>

          {error && <p className="text-sm text-t-red">{error}</p>}

          <TBtn type="submit" disabled={status === "sending" || !email.trim()} className="w-full">
            {status === "sending" ? t("sending") : t("send")}
          </TBtn>
        </form>

        <p className="text-center mt-6">
          <Link href="/login" className="text-sm text-t-amber-bright hover:text-t-amber">
            {t("backToSignIn")}
          </Link>
        </p>
      </div>
    </main>
  );
}
