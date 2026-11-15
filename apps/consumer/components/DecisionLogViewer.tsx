"use client";

/**
 * DecisionLogViewer -- "Why t.ROY suggested things".
 *
 * A quiet, collapsible list of the assistant's RECORDED reasoning for its
 * suggestions: the plain explanation, when, and which model. It shows only what
 * is actually instrumented. It does NOT show private chain-of-thought (none is
 * stored) and it does NOT show the raw input (only a hash is kept). We do not
 * advertise more transparency than exists.
 *
 * Standalone: export for the Settings-IA pass to place. Reads GET
 * /api/user/decisions (ownership-scoped).
 */

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { labelForContextPage } from "@/lib/ai-usage-labels";
import { useServerText } from "@/components/ServerTextProvider";

interface DecisionRow {
  contextPage: string;
  explanation: string;
  modelProvider: string;
  modelId: string;
  outputSummary: Record<string, unknown>;
  createdAt: string;
}

function fmtWhen(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(locale === "es" ? "es" : undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DecisionLogViewer() {
  const t = useTranslations("refineryAccount.decisionLog");
  const ts = useServerText();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DecisionRow[] | null>(null);
  const [error, setError] = useState("");

  const contextLabel = (key: string) => (t.has(`pages.${key}`) ? t(`pages.${key}`) : ts(labelForContextPage(key)));

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/decisions?limit=25")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => !cancelled && setData(d.decisions || []))
      .catch(() => !cancelled && setError(t("loadError")));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="border border-t-line bg-t-panel mt-6">
      <button
        onClick={() => setOpen(!open)}
        className="t-focus w-full flex items-center justify-between px-4 py-3 text-left min-h-touch"
      >
        <span>
          <span className="text-sm font-semibold text-t-white block">
            {t("title")}
          </span>
          <span className="text-xs text-t-phos-dim">
            {t("subtitle")}
          </span>
        </span>
        <span className="text-xs text-t-phos-dim ml-3">{open ? t("hide") : t("show")}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-t-line pt-3 space-y-3">
          <p className="text-[11px] text-t-phos-dim leading-relaxed">
            {t("explainer")}
          </p>
          {error && <p className="text-xs text-t-red">{error}</p>}
          {!data && !error && (
            <p className="text-xs text-t-phos-dim">{t("loading")}</p>
          )}
          {data && data.length === 0 && (
            <p className="text-xs text-t-phos-dim">
              {t("empty")}
            </p>
          )}
          {data && data.length > 0 && (
            <ul className="space-y-3">
              {data.map((d, i) => (
                <li key={i} className="border-t border-t-line pt-3 first:border-t-0 first:pt-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs font-semibold text-t-white">
                      {contextLabel(d.contextPage)}
                    </span>
                    <span className="text-[10px] text-t-phos-dim flex-shrink-0">
                      {fmtWhen(d.createdAt, locale)}
                    </span>
                  </div>
                  <p className="text-xs text-t-phos leading-relaxed mt-1">
                    {ts(d.explanation)}
                  </p>
                  <p className="text-[10px] text-t-phos-dim mt-1">
                    {t("model", { provider: d.modelProvider, id: d.modelId })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
