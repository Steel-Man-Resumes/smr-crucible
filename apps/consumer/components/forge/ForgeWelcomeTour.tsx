"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { sessionPending } from "@/lib/session-policy";
import { isForgeSignInPage } from "@/lib/forge-access";
import { FocusDialog } from "./FocusDialog";

// Copy lives in messages/*/ui.json under welcomeTour.steps.<id>; keep the ids in step with it.
const STEPS = [
  { id: "one", tools: ["a", "b", "c", "d"] },
  { id: "two", tools: ["a", "b", "c"] },
  { id: "three", tools: ["a", "b", "c"] },
  { id: "four", tools: [] as string[] },
];

export function ForgeWelcomeTour() {
  const t = useTranslations("ui.welcomeTour");
  const tc = useTranslations("common.actions");
  const pathname = usePathname();
  const { data, status } = useSession();
  const uid = data?.user?.id;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  // Do not interrupt a returning person's output or an active generation.
  const entry = pathname === "/start" || pathname === "/resume";
  useEffect(() => {
    if (!entry || status !== "authenticated" || !uid || sessionPending(data?.user as any)) return;
    try { if (localStorage.getItem(`forge_welcome_v1:${uid}`)) return; } catch { return; }
    setStep(0);
    setOpen(true);
  }, [entry, status, uid, data?.user]);
  const close = () => {
    if (uid) { try { localStorage.setItem(`forge_welcome_v1:${uid}`, "1"); } catch {} }
    setOpen(false);
  };
  if (!isForgeSignInPage(pathname) || !uid) return null;
  const current = STEPS[step];
  return <>
    {pathname === "/start" && <button type="button" onClick={() => { setStep(0); setOpen(true); }} className="t-focus mx-4 mt-3 min-h-touch text-sm underline underline-offset-4">{t("open")}</button>}
    <FocusDialog open={open} title={t("dialogTitle")} onClose={close} closeLabel={t("skipTour")}>
      <div className="mx-auto max-w-2xl" aria-live="polite">
        <p className="text-sm text-t-phos-dim">{t("progress", { step: step + 1, total: STEPS.length })}</p>
        <h3 className="mt-3 text-3xl font-semibold">{t(`steps.${current.id}.title`)}</h3>
        <p className="mt-5 text-lg leading-relaxed">{t(`steps.${current.id}.body`)}</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">{current.tools.map((tool) => <div key={tool} className="border border-t-amber/40 bg-t-panel p-4 text-t-amber-bright">{t(`steps.${current.id}.tools.${tool}`)}</div>)}</div>
        <div className="mt-8 flex justify-between gap-4">
          <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)} className="t-focus min-h-touch px-4 disabled:opacity-40">{tc("back")}</button>
          <button type="button" onClick={() => step === STEPS.length - 1 ? close() : setStep(step + 1)} className="t-focus min-h-touch bg-t-amber px-6 font-semibold text-ws-bg">{step === STEPS.length - 1 ? t("finish") : tc("next")}</button>
        </div>
      </div>
    </FocusDialog>
  </>;
}
