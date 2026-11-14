"use client";

/**
 * Source confidence (Troy 2026-10-15): the quick route is allowed, and this
 * line says what it cost and where. It never blocks; the hard stop stays only
 * for a denied fact or an unsourced one.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ConfidenceLevel, ConfidenceNote } from "@/lib/finish-gate";
import { useServerText } from "@/components/ServerTextProvider";

const TONE: Record<ConfidenceLevel, string> = { high: "text-t-phos", medium: "text-t-amber-bright", low: "text-t-red" };

export function ConfidenceMeter({ level, notes }: { level: ConfidenceLevel; notes: ConfidenceNote[] }) {
  const t = useTranslations("forgeFinish.confidence");
  const ts = useServerText();
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3 border border-t-line bg-t-panel px-4 py-2.5" data-testid="confidence-meter" data-level={level}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-t-phos">
          {t("label")} <span className={`font-bold ${TONE[level]}`}>{t(`levels.${level}`)}</span>
        </p>
        {notes.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="t-focus text-xs text-t-phos-dim underline underline-offset-2 hover:text-t-white"
          >
            {open ? t("hide") : t("why", { count: notes.length })}
          </button>
        ) : (
          <p className="text-[11px] text-t-phos-dim">{t("allGood")}</p>
        )}
      </div>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {notes.map((n, i) => (
            <li key={i} className="text-[11px] leading-relaxed text-t-phos" data-testid="confidence-note">
              &ldquo;{n.line}&rdquo; {ts(n.why)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
