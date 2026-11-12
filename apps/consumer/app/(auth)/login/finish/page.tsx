"use client";

/**
 * "Finish signing in": where every emailed sign-in link lands.
 *
 * Mail scanners open links as an email arrives. If the link signed in on
 * arrival, a scanner would use up the one-time link and start a session nobody
 * asked for. This page only shows a button; the sign-in happens when a person
 * presses it. The button goes to this site's /api/auth/callback/resend, built
 * here from the link's own token, email and same-site callbackUrl
 * (lib/sign-in-link.ts), so the page cannot be pointed anywhere else.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { TBtn } from "@crucible/consumer-ui";
import { EMAIL_LINK_PAGE, emailCallbackTarget } from "@/lib/sign-in-link";

/** This tab's copy of the validated sign-in target, after the URL is cleaned. */
const TARGET_KEY = "smr_finish_sign_in";

export default function FinishSignInPage() {
  return (
    <Suspense>
      <FinishSignIn />
    </Suspense>
  );
}

function FinishSignIn() {
  const t = useTranslations("auth.finish");
  const searchParams = useSearchParams();
  const [going, setGoing] = useState(false);
  // undefined while checking (first render), null when the link is not valid.
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  // Next updates useSearchParams after replaceState, so the effect runs again
  // with no parameters; this keeps the target read the first time.
  const readOnce = useRef<string | null>(null);
  useEffect(() => {
    const fromLink = emailCallbackTarget(window.location.origin, new URLSearchParams(searchParams.toString()));
    if (fromLink) {
      // Take the token and email out of the address bar and history as soon
      // as they are read. The target is kept for this tab only, so a refresh
      // still works.
      try {
        sessionStorage.setItem(TARGET_KEY, fromLink);
      } catch {
        // storage blocked: the button still works from memory
      }
      readOnce.current = fromLink;
      window.history.replaceState(null, "", EMAIL_LINK_PAGE);
      setTarget(fromLink);
      return;
    }
    if (readOnce.current) {
      setTarget(readOnce.current);
      return;
    }
    // After a refresh: this tab's saved target, re-checked with the same rule.
    let savedOk: string | null = null;
    try {
      const saved = sessionStorage.getItem(TARGET_KEY);
      savedOk = saved ? emailCallbackTarget(window.location.origin, new URL(saved).searchParams) : null;
    } catch {
      savedOk = null;
    }
    setTarget(savedOk);
  }, [searchParams]);

  return (
    <main className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-start bg-t-bg px-4 py-10 font-body sm:justify-center sm:py-14">
      <div className="app-panel w-full max-w-md p-6 sm:p-8">
        <p className="app-eyebrow mb-2 text-[#4f6b57]">{t("eyebrow")}</p>
        {target !== null ? (
          <>
            <h1 className="text-2xl font-semibold text-t-white">{t("title")}</h1>
            {(() => {
              // The FULL address the link signs in to (round 2: a masked one
              // looks the same for a lookalike address). The person holding the
              // link already has it in the URL.
              let who: string | null = null;
              try {
                who = target ? new URL(target).searchParams.get("email") : null;
              } catch {
                who = null;
              }
              return (
                <div className="mt-2 mb-6 text-sm text-t-bone-dim" data-testid="finish-sign-in-as">
                  {who ? (
                    <>
                      <p>{t("signsYouInAs")}</p>
                      <p className="mt-1 break-all text-base font-semibold text-t-white" data-testid="finish-email">{who}</p>
                      <p className="mt-3">{t("notYou")}</p>
                    </>
                  ) : (
                    <p>{t("pressButton")}</p>
                  )}
                </div>
              );
            })()}
            <TBtn
              type="button"
              disabled={going || !target}
              onClick={() => {
                if (!target) return;
                setGoing(true);
                try {
                  sessionStorage.removeItem(TARGET_KEY);
                } catch {
                  // ignore
                }
                window.location.assign(target);
              }}
              className="w-full !border-[#4f6b57] !bg-[#4f6b57] hover:!bg-[#3d5745]"
            >
              {going ? t("going") : t("button")}
            </TBtn>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-t-white">{t("incompleteTitle")}</h1>
            <p className="mt-2 mb-6 text-sm text-t-bone-dim">
              {t("incompleteBody")}
            </p>
            <Link href="/login" className="text-sm text-t-amber-bright underline underline-offset-2">
              {t("goToSignIn")}
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
