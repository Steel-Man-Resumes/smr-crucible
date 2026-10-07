"use client";

/**
 * The last part of the finish page: where to go next. The Refinery, the
 * Google review ask (only after a finished download, once per visit, never a
 * popup), Troy's letter (a plain link, no signup here), and "clear this
 * computer".
 */

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { TBtn } from "@crucible/consumer-ui";
import { ClearThisComputerPanel } from "@/components/ClearThisComputer";
import { GOOGLE_REVIEW_URL, REVIEW_ASK_LINE } from "@/lib/finish-gate";

export const LETTERS_URL = "https://steelmanresumes.com/letters";

export function ReviewAsk({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-t-line bg-t-panel px-4 py-3" data-testid="review-ask">
      <p className="text-sm text-t-white">{REVIEW_ASK_LINE}</p>
      <a
        href={GOOGLE_REVIEW_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="t-focus text-sm font-semibold text-t-amber-bright underline underline-offset-2 hover:text-t-white"
      >
        Leave a review
      </a>
      <button onClick={onDismiss} className="t-focus text-xs text-t-phos-dim underline underline-offset-2 hover:text-t-white">
        No thanks
      </button>
    </div>
  );
}

export function NextStep({
  isDemo,
  audience,
  refineryCta,
  refinerySubtext,
  reviewAsk,
}: {
  isDemo: boolean;
  audience: string;
  refineryCta: string;
  refinerySubtext: string;
  /** The review ask, already gated by the page (finished download, once). */
  reviewAsk: ReactNode;
}) {
  const router = useRouter();

  return (
    <section id="finish-next" aria-labelledby="finish-next-heading" className="scroll-mt-20 border-t border-t-line pt-8">
      <h2 id="finish-next-heading" className="mb-3 text-xl font-bold text-t-white">
        Next step
      </h2>

      {reviewAsk && <div className="mb-4">{reviewAsk}</div>}

      {isDemo && audience === "partner" ? (
        <div className="mb-6 border border-t-line bg-t-panel p-6">
          <h3 className="mb-2 text-lg font-bold text-t-white">That&apos;s the client experience, end to end.</h3>
          <p className="mb-4 text-sm leading-relaxed text-t-phos-dim">
            Every client who runs The Forge lands in The Refinery with all of this pre-loaded. As a partner, you get an
            anonymous statistical overview of your cohort. It never includes their resume content.
          </p>
          <div className="flex flex-col gap-2">
            <TBtn onClick={() => router.push("/partner")} className="w-full">
              back to the partner overview
            </TBtn>
            <a
              href="mailto:troyrichardcarr@gmail.com?subject=Partner%20access%20request"
              className="t-focus w-full border border-t-line px-4 py-3 text-center text-sm font-medium text-t-phos transition-colors hover:border-t-phos-dim hover:text-t-white"
            >
              Request partner access: troyrichardcarr@gmail.com
            </a>
            <button
              onClick={() => router.push("/login?callbackUrl=/dashboard/partner")}
              className="t-focus w-full px-4 py-3 text-sm text-t-phos-dim transition-colors hover:text-t-white"
            >
              Already set up? Sign in to the partner dashboard
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-6 border border-t-line bg-t-panel p-5">
          <h3 className="mb-2 text-lg font-bold leading-snug text-t-white">The Refinery aims this resume at real jobs.</h3>
          <p className="mb-4 text-sm leading-relaxed text-t-phos-dim">
            Your Forge resume is a strong general one. In The Refinery you tailor it to one job at a time, practice
            interviews, plan what to say about your record, and use a job board that marks employers we checked for
            hiring people with records. When you create your free account, everything you built here is waiting there.
          </p>
          <TBtn onClick={() => router.push("/login?from=forge")} className="mb-2 w-full text-base">
            {refineryCta.toLowerCase()}
          </TBtn>
          <p className="text-center text-xs text-t-phos-dim">{refinerySubtext}</p>
        </div>
      )}

      <p className="mb-6 text-sm text-t-phos-dim">
        Troy&apos;s letter comes out Sunday and Wednesday. It&apos;s short and practical.{" "}
        <a
          href={LETTERS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="t-focus text-t-amber-bright underline underline-offset-2 hover:text-t-white"
        >
          Read it here
        </a>
        .
      </p>

      <ClearThisComputerPanel />
    </section>
  );
}
