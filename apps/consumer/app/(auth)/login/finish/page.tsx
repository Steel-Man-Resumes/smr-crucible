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

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TBtn } from "@crucible/consumer-ui";
import { emailCallbackTarget } from "@/lib/sign-in-link";

export default function FinishSignInPage() {
  return (
    <Suspense>
      <FinishSignIn />
    </Suspense>
  );
}

function FinishSignIn() {
  const searchParams = useSearchParams();
  const [going, setGoing] = useState(false);
  // undefined while checking (first render), null when the link is not valid.
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setTarget(emailCallbackTarget(window.location.origin, new URLSearchParams(searchParams.toString())));
  }, [searchParams]);

  return (
    <main className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-start bg-t-bg px-4 py-10 font-body sm:justify-center sm:py-14">
      <div className="app-panel w-full max-w-md p-6 sm:p-8">
        <p className="app-eyebrow mb-2 text-[#4f6b57]">Private career workspace</p>
        {target !== null ? (
          <>
            <h1 className="text-2xl font-semibold text-t-white">Finish signing in</h1>
            <p className="mt-2 mb-6 text-sm text-t-bone-dim">
              Press the button to finish signing in to Steel Man Resumes.
            </p>
            <TBtn
              type="button"
              disabled={going || !target}
              onClick={() => {
                if (!target) return;
                setGoing(true);
                window.location.assign(target);
              }}
              className="w-full !border-[#4f6b57] !bg-[#4f6b57] hover:!bg-[#3d5745]"
            >
              {going ? "Signing you in..." : "Finish signing in"}
            </TBtn>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-t-white">This link is not complete</h1>
            <p className="mt-2 mb-6 text-sm text-t-bone-dim">
              Part of the sign-in link is missing. Ask for a new one on the sign-in page.
            </p>
            <Link href="/login" className="text-sm text-t-amber-bright underline underline-offset-2">
              Go to sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
