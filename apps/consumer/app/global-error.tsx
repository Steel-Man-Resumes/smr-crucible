"use client";

import { useEffect, useState } from "react";
import { langCookieValue, resolveLocale, type Locale } from "@/i18n/locale";
import enShell from "@/messages/en/refinery-shell.json";
import esShell from "@/messages/es/refinery-shell.json";

/**
 * Last-resort boundary for errors thrown in the root layout itself.
 * Must render its own html/body; styled inline because the app shell
 * (and its CSS) may not have loaded. The intl provider lives in that
 * layout, so the words are read straight from the catalogs, in the
 * language of the site-language cookie (English until the browser can say).
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [locale, setLocale] = useState<Locale>("en");
  useEffect(() => {
    setLocale(resolveLocale(langCookieValue(document.cookie)));
  }, []);
  const w = (locale === "es" ? esShell : enShell).globalError;
  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#eaede9",
          color: "#1c1e1b",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem", maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>
            {w.title}
          </h1>
          <p style={{ fontSize: "0.9rem", color: "#5f665f", marginBottom: "1.5rem" }}>
            {w.body}
          </p>
          <button
            onClick={reset}
            style={{
              minHeight: "44px",
              padding: "0 1.5rem",
              borderRadius: "6px",
              border: "none",
              background: "#9b6d1d",
              color: "#ffffff",
              fontSize: "0.9rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {w.tryAgain}
          </button>
        </div>
      </body>
    </html>
  );
}
