"use client";

/**
 * The last part of the finish page: where to go next. The Refinery, Troy's
 * letter (a plain link, no signup here), and "clear this computer". The
 * Google review ask (ReviewAsk) is placed by the page right under the
 * download, after a finished download only.
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { TBtn } from "@crucible/consumer-ui";
import { ClearThisComputerPanel } from "@/components/ClearThisComputer";
import { GOOGLE_REVIEW_URL } from "@/lib/finish-gate";
import { useSeatless } from "@/components/forge/useSeatless";
import { SEAT_PAGE } from "@/lib/refinery-access";

export const LETTERS_URL = "https://steelmanresumes.com/letters";

export function ReviewAsk({ onDismiss }: { onDismiss: () => void }) {
  const t = useTranslations("forgeOutput.nextStep");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-t-line bg-t-panel px-4 py-3" data-testid="review-ask">
      <div className="w-full">
        <p className="text-xl font-semibold text-t-white">{t("review.title")}</p>
        <p className="mt-3 text-base leading-relaxed text-t-phos">{t("review.body")}</p>
        <p className="mt-3 text-sm text-t-phos-dim">{t("review.note")}</p>
      </div>
      <a
        href={GOOGLE_REVIEW_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="t-focus text-sm font-semibold text-t-amber-bright underline underline-offset-2 hover:text-t-white"
      >
        {t("review.leave")}
      </a>
      <button onClick={onDismiss} className="t-focus text-xs text-t-phos-dim underline underline-offset-2 hover:text-t-white">
        {t("review.skip")}
      </button>
    </div>
  );
}

export function NextStep({
  isDemo,
  audience,
  refineryCta,
  refinerySubtext,
}: {
  isDemo: boolean;
  audience: string;
  refineryCta: string;
  refinerySubtext: string;
}) {
  const t = useTranslations("forgeOutput.nextStep");
  const router = useRouter();
  // No Refinery seat yet (public sign-ups closed): the button asks for one
  // instead of sending the person into a wall. Download and email stay above.
  const seatless = useSeatless();

  return (
    <section id="finish-next" aria-labelledby="finish-next-heading" className="scroll-mt-20 border-t border-t-line pt-8">
      <h2 id="finish-next-heading" className="mb-3 text-xl font-bold text-t-white">
        {t("heading")}
      </h2>

      {isDemo && audience === "partner" ? (
        <div className="mb-6 border border-t-line bg-t-panel p-6">
          <h3 className="mb-2 text-lg font-bold text-t-white">{t("partner.title")}</h3>
          <p className="mb-4 text-sm leading-relaxed text-t-phos-dim">
            {t("partner.body")}
          </p>
          <div className="flex flex-col gap-2">
            <TBtn onClick={() => router.push("/partner")} className="w-full">
              {t("partner.back")}
            </TBtn>
            <a
              href="mailto:troyrichardcarr@gmail.com?subject=Partner%20access%20request"
              className="t-focus w-full border border-t-line px-4 py-3 text-center text-sm font-medium text-t-phos transition-colors hover:border-t-phos-dim hover:text-t-white"
            >
              {t("partner.request", { email: "troyrichardcarr@gmail.com" })}
            </a>
            <button
              onClick={() => router.push("/login?callbackUrl=/dashboard/partner")}
              className="t-focus w-full px-4 py-3 text-sm text-t-phos-dim transition-colors hover:text-t-white"
            >
              {t("partner.signIn")}
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-6 border border-t-line bg-t-panel p-5">
          <h3 className="mb-2 text-lg font-bold leading-snug text-t-white">{t("refinery.title")}</h3>
          <p className="mb-4 text-sm leading-relaxed text-t-phos-dim">
            {t("refinery.body")}
            {seatless && ` ${t("refinery.seatlessNote")}`}
          </p>
          <TBtn onClick={() => router.push(seatless ? SEAT_PAGE : "/login?from=forge")} className="mb-2 w-full text-base">
            {seatless ? t("refinery.askSeat") : refineryCta.toLowerCase()}
          </TBtn>
          {!seatless && <p className="text-center text-xs text-t-phos-dim">{refinerySubtext}</p>}
        </div>
      )}

      <p className="mb-6 text-sm text-t-phos-dim">
        {t.rich("letter", {
          link: (chunks) => (
            <a
              href={LETTERS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="t-focus text-t-amber-bright underline underline-offset-2 hover:text-t-white"
            >
              {chunks}
            </a>
          ),
        })}
      </p>

      <ClearThisComputerPanel />
    </section>
  );
}
