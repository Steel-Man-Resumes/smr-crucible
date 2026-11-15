"use client";

/**
 * LoginHistoryCard -- "Recent security activity".
 *
 * A read-only timeline of account security events: sign-ins, two-step
 * verification changes, and password changes, each with when and a coarse
 * location. Complements ActiveDevicesCard (which lists current sessions and can
 * revoke them); this one is history and takes no actions.
 *
 * Standalone: export for the Settings-IA pass to place in the Security section.
 * Reads GET /api/user/login-events (ownership-scoped). Never shows a raw IP.
 */

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { labelForLoginEvent } from "@/lib/login-event-labels";

interface LoginEventRow {
  event: string;
  device: string;
  location: string | null;
  createdAt: string;
}

function fmtWhen(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(locale === "es" ? "es" : undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function LoginHistoryCard() {
  const t = useTranslations("refineryAccount.loginHistory");
  const locale = useLocale();
  const [data, setData] = useState<LoginEventRow[] | null>(null);
  const [error, setError] = useState("");

  const eventLabel = (key: string) => (t.has(`events.${key}`) ? t(`events.${key}`) : labelForLoginEvent(key));

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/login-events")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => !cancelled && setData(d.events || []))
      .catch(() => !cancelled && setError(t("loadError")));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-t-panel p-5 border border-t-line mt-4">
      <h3 className="font-semibold text-t-white">{t("title")}</h3>
      <p className="text-sm text-t-phos-dim mt-0.5 mb-3">
        {t("intro")}
      </p>
      {error && <p className="text-xs text-t-red">{error}</p>}
      {!data && !error && <p className="text-xs text-t-phos-dim">{t("loading")}</p>}
      {data && data.length === 0 && (
        <p className="text-xs text-t-phos-dim">{t("empty")}</p>
      )}
      {data && data.length > 0 && (
        <ul className="space-y-3">
          {data.map((e, i) => (
            <li
              key={i}
              className="flex items-baseline justify-between gap-3 border-t border-t-line pt-3 first:border-t-0 first:pt-0"
            >
              <span>
                <span className="text-sm text-t-white block">
                  {eventLabel(e.event)}
                </span>
                <span className="text-xs text-t-phos-dim">
                  {e.device}
                  {e.location ? ` · ${e.location}` : ""}
                </span>
              </span>
              <span className="text-[10px] text-t-phos-dim flex-shrink-0">
                {fmtWhen(e.createdAt, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
