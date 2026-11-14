"use client";

/**
 * "Beta en español" (Spanish beta, 2026-11-15). Shown only while the site is in
 * Spanish. A quiet pill that opens a plain, honest note (the Spanish is new,
 * a computer helped write it, a person has not yet reviewed it, resumes stay in
 * English) and a short box to say what sounded wrong. The box posts to the same
 * route the Help page and the t.ROY drawer use (/api/support-request), as a
 * "confusing" report that starts with "[Español]", so a person reads it and no
 * new store exists. It claims nothing the product cannot back: no "reviewed",
 * no "fluent", no promise of a reply.
 */
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

type Status = "idle" | "sending" | "sent" | "signin" | "error";

export function SpanishBetaNotice() {
  const locale = useLocale();
  const t = useTranslations("ui.betaNotice");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  if (locale !== "es") return null;

  async function send() {
    if (!text.trim() || status === "sending") return;
    setStatus("sending");
    try {
      const res = await fetch("/api/support-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: `[Español] ${text.trim()}`, category: "confusing", page: pathname ?? "", includeContext: false }),
      });
      if (res.status === 401) setStatus("signin");
      else setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="fixed bottom-3 left-3 z-40 max-w-[calc(100vw-1.5rem)]" data-testid="spanish-beta-notice">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("openAria")}
          className="rounded-full border border-[#b9cdbd] bg-white px-3 py-1.5 text-xs font-medium text-[#344b38] shadow-sm transition-colors hover:bg-[#e3ede5]"
        >
          {t("pill")}
        </button>
      ) : (
        <div role="dialog" aria-label={t("pill")} className="w-[22rem] max-w-full space-y-2 rounded-[8px] border border-[#b9cdbd] bg-white p-3 text-xs text-[#344b38] shadow-md">
          <p className="font-semibold">{t("pill")}</p>
          <p>{t("intro")}</p>
          {status === "sent" ? (
            <p>{t("sent")}</p>
          ) : (
            <>
              <label htmlFor="spanish-beta-text" className="block font-medium">{t("label")}</label>
              <textarea
                id="spanish-beta-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={1800}
                rows={3}
                placeholder={t("placeholder")}
                className="w-full rounded-[6px] border border-[#b9cdbd] px-2 py-1.5 text-sm text-[#1f2e22]"
              />
              {status === "signin" && <p className="text-amber-800">{t("signIn")}</p>}
              {status === "error" && <p className="text-amber-800">{t("error")}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={send}
                  disabled={!text.trim() || status === "sending"}
                  className="rounded-[5px] bg-[#3f6b47] px-3 py-1.5 font-medium text-white transition-colors hover:bg-[#35593b] disabled:bg-gray-300"
                >
                  {status === "sending" ? t("sending") : t("send")}
                </button>
                <button type="button" onClick={() => setOpen(false)} className="rounded-[5px] border border-[#b9cdbd] bg-white px-3 py-1.5 font-medium transition-colors hover:bg-[#e3ede5]">
                  {t("close")}
                </button>
              </div>
            </>
          )}
          {status === "sent" && (
            <button type="button" onClick={() => { setOpen(false); setStatus("idle"); setText(""); }} className="rounded-[5px] border border-[#b9cdbd] bg-white px-3 py-1.5 font-medium transition-colors hover:bg-[#e3ede5]">
              {t("close")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
