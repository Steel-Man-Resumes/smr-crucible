"use client";

/**
 * "Leer en español" on a saved resume (lane D1): the gate and the panel.
 *
 * Shown only when the site language is Spanish AND the server switch
 * SPANISH_READING_ENABLED is on. In English, or with the switch off, this
 * renders nothing at all, so the English screen is exactly what it was.
 *
 * The panel says plainly that the reading is not the resume, that the resume
 * stays in English, that a computer wrote and checked the Spanish and no person
 * did, and where to tell us when something reads wrong. It never offers to
 * export, copy into a resume or replace anything.
 *
 * No timeout: a slow reading shows the working placeholder until it answers.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useServerSwitches } from "@/components/ServerSwitches";

interface Reading { reading: string; missing: string[] }
export type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; value: Reading }
  | { kind: "limit" }
  | { kind: "error"; reason: "failed" | "allowance" | "signedOut" };

/** Readings already made this session, by resume and version, so opening one again costs nothing. */
const seen = new Map<string, Reading>();

/** The list the "Revisa estos datos" line shows. */
export function joinItems(items: string[]): string {
  return items.join(", ");
}

/**
 * The gate: nothing renders unless the server switch is on AND the site is in
 * Spanish. `askMore` is the existing progress-bar request for more AI actions
 * (kind ai_bonus), handed in by SpanishReading.tsx; absent means the person
 * cannot ask from here and the limit line stands alone.
 */
export function SpanishReadingGate({ artifactId, version, askMore }: { artifactId: string; version: string; askMore?: () => void }) {
  const { spanishReading } = useServerSwitches();
  const locale = useLocale();
  if (!spanishReading || locale !== "es") return null;
  return <SpanishReadingPanel artifactId={artifactId} version={version} askMore={askMore} />;
}

export function SpanishReadingPanel({ artifactId, version, askMore }: { artifactId: string; version: string; askMore?: () => void }) {
  const t = useTranslations("spanishReading");
  const key = `${artifactId}:${version}`;
  const [phase, setPhase] = useState<Phase>(() => {
    const value = seen.get(key);
    return value ? { kind: "ready", value } : { kind: "idle" };
  });
  const [open, setOpen] = useState(() => seen.has(key));
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** Focus moves to the panel only after the person asked for it, never on first render. */
  const asked = useRef(false);
  const panelId = `spanish-reading-${artifactId}`;

  useEffect(() => {
    if (asked.current && (phase.kind === "ready" || phase.kind === "limit" || phase.kind === "error")) headingRef.current?.focus();
  }, [phase.kind]);

  async function run() {
    asked.current = true;
    setOpen(true);
    const cached = seen.get(key);
    if (cached) { setPhase({ kind: "ready", value: cached }); return; }
    setPhase({ kind: "loading" });
    try {
      const res = await fetch("/api/resume/spanish-reading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactId }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && typeof data.reading === "string") {
        const value: Reading = { reading: data.reading, missing: Array.isArray(data.missing) ? data.missing.filter((x: unknown) => typeof x === "string") : [] };
        seen.set(key, value);
        setPhase({ kind: "ready", value });
      } else if (res.status === 429 && data?.code === "reading_limit") setPhase({ kind: "limit" });
      else if (res.status === 429) setPhase({ kind: "error", reason: "allowance" });
      else if (res.status === 401) setPhase({ kind: "error", reason: "signedOut" });
      else setPhase({ kind: "error", reason: "failed" });
    } catch {
      setPhase({ kind: "error", reason: "failed" });
    }
  }

  return (
    <div className="mt-3 min-w-0" data-testid="spanish-reading">
      <button
        type="button"
        onClick={() => (open && phase.kind === "ready" ? setOpen(false) : void run())}
        aria-expanded={open}
        aria-controls={panelId}
        disabled={phase.kind === "loading"}
        className="t-focus inline-flex min-h-touch items-center text-xs font-medium text-t-phos-dim underline underline-offset-2 hover:text-t-white disabled:opacity-60"
        data-testid="spanish-reading-button"
      >
        {t("button")}
      </button>
      <div id={panelId} hidden={!open} aria-live="polite" className="mt-2 max-w-full border border-t-line bg-t-panel-2 p-4 text-sm text-t-phos">
        {open ? <PanelContent phase={phase} askMore={askMore} onClose={() => setOpen(false)} onRetry={() => void run()} headingRef={headingRef} /> : null}
      </div>
    </div>
  );
}


/** What the open panel shows for each phase. Pure: the tests render it directly. */
export function PanelContent({ phase, askMore, onClose, onRetry, headingRef }: { phase: Phase; askMore?: () => void; onClose: () => void; onRetry: () => void; headingRef?: React.Ref<HTMLHeadingElement> }) {
  const t = useTranslations("spanishReading");
  return (
          <>
            <h4 ref={headingRef} tabIndex={-1} className="t-focus font-semibold text-t-white">{t("title")}</h4>
            <p className="mt-1 text-xs text-t-phos-dim">{t("notResume")}</p>
            <p className="mt-1 text-xs text-t-phos-dim">{t("machine")}</p>
            <p className="mt-1 text-xs text-t-phos-dim">
              {t("feedbackLead")}{" "}
              <Link href="/dashboard/help" className="t-focus underline underline-offset-2">{t("feedbackLink")}</Link>
            </p>
            {phase.kind === "loading" ? (
              <div role="status" className="mt-3" data-testid="spanish-reading-loading">
                <span className="sr-only">{t("loading")}</span>
                <div aria-hidden className="space-y-2">
                  {[0, 1, 2, 3].map((n) => <span key={n} className="block h-3 w-full animate-pulse rounded-[4px] bg-t-panel-3 motion-reduce:animate-none" style={{ maxWidth: `${96 - n * 12}%` }} />)}
                </div>
                <p aria-hidden className="mt-2 text-xs text-t-phos-dim">{t("loading")}</p>
              </div>
            ) : null}
            {phase.kind === "ready" ? (
              <>
                {phase.value.missing.length > 0 ? (
                  <p role="status" className="mt-3 text-xs font-medium text-t-amber-bright" data-testid="spanish-reading-missing">
                    {t("missingLine", { items: joinItems(phase.value.missing) })}
                  </p>
                ) : null}
                <div lang="es" role="region" aria-label={t("readingLabel")} tabIndex={0} className="t-focus mt-3 max-w-full whitespace-pre-wrap break-words leading-relaxed text-t-white" data-testid="spanish-reading-text">
                  {phase.value.reading}
                </div>
              </>
            ) : null}
            {phase.kind === "limit" ? (
              <div className="mt-3" role="status" data-testid="spanish-reading-limit">
                <p className="text-t-white">{t("limitLine")}</p>
                {askMore ? (
                  <button type="button" aria-haspopup="dialog" onClick={askMore} className="t-focus mt-1 inline-flex min-h-touch items-center text-xs text-t-amber-bright underline underline-offset-2" data-testid="spanish-reading-ask">
                    {t("askMore")}
                  </button>
                ) : null}
              </div>
            ) : null}
            {phase.kind === "error" ? (
              <div className="mt-3" role="alert" data-testid="spanish-reading-error">
                <p className="text-t-white">{phase.reason === "allowance" ? t("allowanceUsed") : phase.reason === "signedOut" ? t("signedOut") : t("failed")}</p>
                {phase.reason === "failed" ? (
                  <button type="button" onClick={onRetry} className="t-focus mt-1 inline-flex min-h-touch items-center text-xs underline underline-offset-2">{t("tryAgain")}</button>
                ) : null}
              </div>
            ) : null}
            {phase.kind !== "loading" ? (
              <button type="button" onClick={onClose} className="t-focus mt-3 inline-flex min-h-touch items-center text-xs text-t-phos-dim underline underline-offset-2">{t("close")}</button>
            ) : null}
          </>
  );
}
