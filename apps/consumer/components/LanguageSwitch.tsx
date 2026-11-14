"use client";

/**
 * The site-language switch (i18n/locale.ts). One tap sets the cookie (and the
 * account when signed in) through /api/lang, then the page re-renders in that
 * language. Each language is named in itself, so the switch reads the same
 * whichever one is on.
 *
 * "pills": both languages side by side (Settings). "compact": one button that
 * names the other language (the Forge header).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { LOCALES, LOCALE_NAMES, isLocale, type Locale } from "@/i18n/locale";

/** The compact button's colors: "bone" on the Forge's light header, "dark" on the dark panels. */
const COMPACT_TONE = {
  bone: "border-ws-bg/25 text-t-bone-dim hover:border-ws-bg/60 hover:text-ws-bg",
  dark: "border-t-line text-t-phos-dim hover:border-t-phos-dim hover:text-t-white",
} as const;

export function LanguageSwitch({
  variant = "pills",
  tone = "bone",
  className = "",
}: {
  variant?: "pills" | "compact";
  tone?: keyof typeof COMPACT_TONE;
  className?: string;
}) {
  const router = useRouter();
  const current = useLocale();
  const locale: Locale = isLocale(current) ? current : "en";
  const t = useTranslations("common.lang");
  const tErr = useTranslations("common.errors");
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function choose(next: Locale) {
    if (next === locale || busy) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/lang", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      startTransition(() => router.refresh());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (variant === "compact") {
    const other: Locale = locale === "es" ? "en" : "es";
    return (
      <button
        type="button"
        lang={other}
        aria-label={`${LOCALE_NAMES[other]}`}
        aria-busy={busy || pending}
        disabled={busy || pending}
        onClick={() => choose(other)}
        data-testid="language-switch"
        className={`t-focus inline-flex min-h-touch items-center rounded-[5px] border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${COMPACT_TONE[tone]} ${className}`}
      >
        {LOCALE_NAMES[other]}
      </button>
    );
  }

  return (
    <div className={className}>
      <div role="group" aria-label={t("chooseAria")} className="flex flex-wrap gap-2" data-testid="language-switch">
        {LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            lang={l}
            aria-pressed={locale === l}
            aria-busy={busy || pending}
            disabled={busy || pending}
            onClick={() => choose(l)}
            className={`t-focus border px-4 py-2.5 text-sm font-medium transition-colors min-h-touch disabled:opacity-60 ${
              locale === l
                ? "border-t-amber bg-t-panel-2 text-t-amber-bright"
                : "border-t-line bg-t-panel text-t-phos-dim hover:border-t-phos-dim"
            }`}
          >
            {LOCALE_NAMES[l]}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-t-red" role="alert">{tErr("couldNotSave")}</p>}
    </div>
  );
}
