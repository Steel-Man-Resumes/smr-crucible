"use client";

/**
 * One tap before the Forge keeps anything: the Terms, the Privacy Policy and
 * the AI-processing notice, for accounts that never saw the sign-up checkbox
 * (email link, Google, older accounts). Security review 3a r1, M4.
 *
 * Records the acceptance through /api/auth/accept-terms (the same consent rows
 * registration writes), refreshes the session so its `terms` claim is re-read
 * from that row, and goes back to where the person was headed.
 *
 * If this person ticked the same box on the email-link form in this browser,
 * the page records it without a second tap (TERMS_TICKED_KEY, same address,
 * same version, within a day). A box ticked on another device, or a link sent
 * by someone else, never accepts for anyone: it only ever skips one tap for the
 * person who ticked it, here.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { TBtn } from "@crucible/consumer-ui";
import { PRIVACY_URL, TERMS_URL, TERMS_VERSION } from "@/lib/terms";
import { safeLoginReturn, sessionPending, termsCurrent } from "@/lib/session-policy";
import { TERMS_TICKED_KEY, tickedFor } from "@/lib/terms-ticked";
import { signOutOfForge } from "@/components/forge/ForgeAccountBar";

export default function TermsPage() {
  return (
    <Suspense>
      <AcceptTerms />
    </Suspense>
  );
}

function AcceptTerms() {
  const searchParams = useSearchParams();
  const { data, status, update } = useSession();
  const user = data?.user as { email?: string | null; terms?: unknown; termsVersion?: unknown; mfa?: unknown; claim?: unknown } | undefined;
  // Back to where they were (a Forge screen or a Refinery page); the Forge's
  // first screen when no return address was given.
  const next = searchParams.get("callbackUrl") ? safeLoginReturn(searchParams.get("callbackUrl")) : "/welcome";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const auto = useRef(false);
  // One navigation only: after update() the session says terms are accepted,
  // and the effect below would otherwise start a second one.
  const leaving = useRef(false);
  function go() {
    if (leaving.current) return;
    leaving.current = true;
    window.location.assign(next);
  }

  /** source: how the person accepted (L4): a tap here, or the box on the email-link form. */
  async function accept(source: "terms_page" | "email_form_checkbox") {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/auth/accept-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept: true, source }),
      });
      if (!res.ok) throw new Error(String(res.status));
      try {
        localStorage.removeItem(TERMS_TICKED_KEY);
      } catch {
        // ignore
      }
      await update();
      go();
    } catch {
      setError("We couldn't save that. Try again.");
      setSaving(false);
    }
  }

  useEffect(() => {
    if (status !== "authenticated" || !user || sessionPending(user) || auto.current || saving) return;
    if (termsCurrent(user, TERMS_VERSION)) {
      go();
      return;
    }
    let ticked: unknown = null;
    try {
      ticked = JSON.parse(localStorage.getItem(TERMS_TICKED_KEY) || "null");
    } catch {
      ticked = null;
    }
    if (tickedFor(ticked, user.email, TERMS_VERSION)) {
      auto.current = true;
      void accept("email_form_checkbox");
    }
  }, [status, user?.email, user?.terms]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="forge-workshop flex min-h-[calc(100vh-72px)] flex-col items-center justify-start bg-t-bg px-4 py-10 font-body sm:justify-center sm:py-14">
      <div className="w-full max-w-md border border-t-line bg-t-panel p-6 shadow-[4px_4px_0_#000] sm:p-8" data-testid="terms-page">
        <p className="mb-2 font-term text-[11px] font-bold uppercase text-t-amber-bright">/forge</p>
        <h1 className="font-display text-2xl font-bold uppercase text-t-white">One thing before you start</h1>
        {status === "unauthenticated" ? (
          <p className="mt-3 text-sm text-t-bone-dim">
            Sign in first.{" "}
            <a href="/login" className="font-medium text-t-amber-bright underline underline-offset-2">
              Go to sign in
            </a>
          </p>
        ) : (
          <>
            <p className="mt-3 text-base leading-relaxed text-t-white" data-testid="terms-copy">
              Before the Forge keeps anything you tell it, we need your OK. Tapping I agree means you accept
              our{" "}
              <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="text-t-amber-bright underline underline-offset-2">
                Terms
              </a>{" "}
              and{" "}
              <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="text-t-amber-bright underline underline-offset-2">
                Privacy Policy
              </a>
              , and you understand your answers are processed with AI to build your resume and career tools.
            </p>
            <p className="mt-3 text-sm text-t-bone-dim">It&apos;s still free. You only do this once.</p>
            {error && (
              <p role="alert" className="mt-3 text-sm text-t-red">
                {error}
              </p>
            )}
            <TBtn
              type="button"
              disabled={saving || status !== "authenticated"}
              onClick={() => void accept("terms_page")}
              className="mt-6 w-full !text-[#14100a]"
            >
              {saving ? "Saving..." : "I agree"}
            </TBtn>
            {user?.email && (
              <p className="mt-4 text-xs text-t-bone-dim">
                Signed in as {user.email}. Not you?{" "}
                <button
                  type="button"
                  onClick={() => void signOutOfForge({ clearRun: true })}
                  className="font-medium text-t-white underline underline-offset-2"
                >
                  Sign out
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
