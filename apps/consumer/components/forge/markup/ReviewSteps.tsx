/**
 * The finish page's two-part review, named (Troy 2026-10-20: "make it clear
 * what's happening, and that there's an end coming"). Step 1 is t.ROY reading
 * the person's page while the writer works. Step 2 is the changes he made.
 * Then the finished page. Each step says what it is and what comes next.
 */

import { useTranslations } from "next-intl";

const STEPS = [{ n: 1 }, { n: 2 }, { n: 3 }] as const;

export function ReviewSteps({ step }: { step: 1 | 2 | 3 }) {
  const t = useTranslations("forgeFinish.reviewSteps");
  return (
    <nav aria-label={t("aria")} className="mt-6 border border-t-line bg-t-panel px-4 py-3" data-testid="review-steps" data-step={step}>
      <ol className="grid gap-2 sm:grid-cols-3">
        {STEPS.map((s) => {
          const state = s.n < step ? "done" : s.n === step ? "now" : "next";
          return (
            <li key={s.n} aria-current={state === "now" ? "step" : undefined} className={state === "next" ? "opacity-60" : ""}>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center border text-xs font-bold ${
                    state === "done" ? "border-t-amber bg-t-amber text-white" : state === "now" ? "border-t-amber text-t-amber-bright" : "border-t-line text-t-phos-dim"
                  }`}
                >
                  {state === "done" ? "✓" : s.n}
                </span>
                <span className={`text-sm ${state === "now" ? "font-bold text-t-white" : "text-t-phos"}`}>
                  {t(`steps.${s.n}.name`)}
                  <span className="sr-only">{state === "done" ? t("stateDone") : state === "now" ? t("stateNow") : t("stateNext")}</span>
                </span>
              </div>
              {state === "now" && <p className="mt-1 pl-8 text-xs text-t-phos-dim">{t(`steps.${s.n}.note`)}</p>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
