"use client";

/**
 * GuidedTour -- the mandatory one-time orientation (master plan Section 3, Stage 0).
 *
 * Five screens: the promise, what the Forge resume is (and what the Refinery
 * adds), the real tools along the six steps, Settings, and meet/name your coach.
 * Only tools that exist today are taught; planned ones are named once, plainly,
 * as not built yet.
 * DB-persisted via /api/onboarding/tour (cannot be reset by clearing
 * localStorage). Two "remind me" deferrals are allowed; after that the defer
 * option disappears. Client tier only -- partners/observers/admin are not nagged.
 */

import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUserTier } from "@/lib/useUserTier";
import { JOURNEY_STAGES } from "@crucible/core/src/journeyStages";
import {
  FALLBACK_TOUR_STATE,
  NEXT_STEP_CHANGED_EVENT,
  TOUR_SETTINGS_PICKS,
  TOUR_TOOLS,
  TOUR_NOT_BUILT_YET,
  canCloseTour,
  canDeferTour,
  isTourRequested,
  isTourVisible,
  type TourState,
} from "@/lib/guidedTour";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Once deferred/closed, don't re-pop on every remount this session ("remind me
// next login" means next session, not next page nav).
const SUPPRESS_KEY = "guided_tour_suppressed";

const SCREENS = 5;
const COACH_SCREEN = SCREENS - 1;

// The six plain steps, read from the one vocabulary the dashboard uses.
const JOURNEY = JOURNEY_STAGES.filter((st) => st.stage >= 1).map((st) => st.short);

export function GuidedTour() {
  const tier = useUserTier();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?tour=1 is an explicit request (the "Your next step" card links here). It
  // overrides "closed" and "deferred this session" so the button always opens it.
  const requested = isTourRequested(searchParams);
  const [state, setState] = useState<TourState | null>(null);
  const [screen, setScreen] = useState(0);
  const [coachName, setCoachName] = useState("");
  const [closed, setClosed] = useState(false);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // The tour is a full-screen modal; only show it on the dashboard HOME so it can
  // never cover a tool page's form (F7 -- it was overlaying the disclosure planner).
  const onHome = pathname === "/dashboard";

  useEffect(() => {
    if (tier !== "client" || !onHome) return;
    if (requested) {
      // Explicit request: forget any earlier close or defer and start from screen 1.
      try {
        sessionStorage.removeItem(SUPPRESS_KEY);
      } catch {}
      setClosed(false);
      setScreen(0);
    } else {
      try {
        if (sessionStorage.getItem(SUPPRESS_KEY) === "1") {
          setClosed(true);
          return;
        }
      } catch {}
    }
    let cancelled = false;
    fetch("/api/onboarding/tour")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        if (j?.data) {
          setState(j.data as TourState);
          // Pre-fill only a real custom name, not the default "Guide"
          if (j.data.coachName && j.data.coachName !== "Guide") {
            setCoachName(j.data.coachName);
          }
        } else if (requested) {
          // Could not read the state: an explicit request still opens the tour.
          setState(FALLBACK_TOUR_STATE);
        }
      })
      .catch(() => {
        if (!cancelled && requested) setState(FALLBACK_TOUR_STATE);
      });
    return () => {
      cancelled = true;
    };
  }, [tier, onHome, requested]);

  const visible = isTourVisible({ tier, onHome, closed, state, requested });
  const canDefer = canDeferTour(state);
  const canClose = canCloseTour(state);

  // Focus the panel when the tour opens (WCAG 2.4.3 focus order).
  useEffect(() => {
    if (visible) panelRef.current?.focus();
  }, [visible]);

  // Trap Tab/Shift+Tab within the panel; Escape mirrors the existing "Remind
  // me next login" dismiss action (only available while defers remain).
  useEffect(() => {
    if (!visible) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (canDefer) {
          e.preventDefault();
          defer();
        } else if (canClose) {
          e.preventDefault();
          close();
        }
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !panel.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, canDefer, canClose]);

  if (!visible) return null;

  // Close the modal and drop ?tour=1 so the same card link can be pressed again.
  function close() {
    setClosed(true);
    if (requested) router.replace("/dashboard", { scroll: false });
  }

  function announceNextStepChanged() {
    try {
      window.dispatchEvent(new Event(NEXT_STEP_CHANGED_EVENT));
    } catch {}
  }

  async function complete(openSettings = false) {
    setSaving(true);
    try {
      await fetch("/api/onboarding/tour", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          coachName: coachName.trim() || undefined,
        }),
      });
    } catch {}
    announceNextStepChanged();
    close();
    if (openSettings) router.push("/dashboard/settings");
  }

  async function defer() {
    try {
      sessionStorage.setItem(SUPPRESS_KEY, "1");
    } catch {}
    try {
      await fetch("/api/onboarding/tour", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "defer" }),
      });
    } catch {}
    announceNextStepChanged();
    close();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-tour-heading"
        className="bg-t-panel border border-t-line max-w-lg w-full max-h-[92vh] overflow-y-auto p-5 sm:p-8 shadow-xl"
      >
        {/* progress bars */}
        <div className="flex gap-1.5 mb-5" aria-hidden="true">
          {Array.from({ length: SCREENS }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 ${i <= screen ? "bg-t-amber" : "bg-t-line"}`}
            />
          ))}
        </div>
        <p className="font-term text-[11px] font-semibold uppercase text-t-bone-dim mb-2">
          {screen + 1} of {SCREENS}
        </p>

        {screen === 0 && (
          <div>
            <h2 id="guided-tour-heading" className="text-2xl font-bold text-t-white mb-3">
              Every tool. For free. If you qualify.
            </h2>
            <p className="text-base text-t-bone-dim leading-relaxed mb-3">
              Steel Man walks you from your resume to a job offer, one step at a time.
            </p>
            <p className="text-base text-t-white font-medium">
              Here is how the pieces fit. It takes about a minute.
            </p>
          </div>
        )}

        {screen === 1 && (
          <div>
            <h2 id="guided-tour-heading" className="text-2xl font-bold text-t-white mb-3">
              Your Forge resume is a general one
            </h2>
            <p className="text-base text-t-bone-dim leading-relaxed mb-4">
              The Forge built you one strong resume that works for many jobs. The Refinery
              makes it fit each job you go after.
            </p>
            <ol className="space-y-2 mb-4">
              {JOURNEY.map((label, i) => (
                <li key={label} className="flex items-center gap-3 text-base text-t-white">
                  <span className="flex items-center justify-center w-6 h-6 border border-t-line bg-t-panel-2 text-t-amber-bright text-sm font-semibold flex-shrink-0">
                    {i + 1}
                  </span>
                  {label}
                </li>
              ))}
            </ol>
            <p className="text-sm text-t-bone-dim">
              Tools open as you work through these. You can look at what is locked and see what opens it.
            </p>
          </div>
        )}

        {screen === 2 && (
          <div>
            <h2 id="guided-tour-heading" className="text-2xl font-bold text-t-white mb-3">
              The tools, in order
            </h2>
            <ul className="space-y-2.5 mb-4">
              {TOUR_TOOLS.map((t) => (
                <li key={t.name} className="text-sm leading-snug">
                  <span className="font-semibold text-t-white">{t.name}.</span>{" "}
                  <span className="text-t-bone-dim">{t.line}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-t-bone-dim leading-relaxed">
              {TOUR_NOT_BUILT_YET}
            </p>
          </div>
        )}

        {screen === 3 && (
          <div>
            <h2 id="guided-tour-heading" className="text-2xl font-bold text-t-white mb-3">
              What you can do in Settings
            </h2>
            <ul className="space-y-3 mb-4">
              {TOUR_SETTINGS_PICKS.map((t) => (
                <li key={t.name} className="text-base leading-snug">
                  <span className="font-semibold text-t-white">{t.name}.</span>{" "}
                  <span className="text-t-bone-dim">{t.line}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-t-bone-dim">
              Take a look early. You will find it in the menu.
            </p>
          </div>
        )}

        {screen === COACH_SCREEN && (
          <div>
            <h2 id="guided-tour-heading" className="text-2xl font-bold text-t-white mb-3">Meet your coach</h2>
            <p className="text-base text-t-bone-dim leading-relaxed mb-4">
              This is your coach. They know your story and are here to help you move. What
              would you like to call them? Many people use a name from someone who believed
              in them.
            </p>
            <input
              value={coachName}
              onChange={(e) => setCoachName(e.target.value)}
              maxLength={40}
              placeholder="Guide"
              aria-label="Name your coach"
              className="w-full px-4 py-3 border border-t-line text-base min-h-touch"
            />
            <p className="text-xs text-t-bone-dim mt-2">
              You can change this anytime in Settings.
            </p>
          </div>
        )}

        {/* actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-6">
          <div>
            {canDefer && (
              <button
                onClick={defer}
                className="t-focus text-sm text-t-bone-dim hover:text-t-white transition-colors"
              >
                Remind me next login
              </button>
            )}
            {canClose && (
              <button
                onClick={close}
                className="t-focus text-sm text-t-bone-dim hover:text-t-white transition-colors"
              >
                Close
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {screen > 0 && (
              <button
                onClick={() => setScreen(screen - 1)}
                className="t-focus px-4 py-2.5 text-sm font-medium text-t-bone-dim hover:text-t-white"
              >
                Back
              </button>
            )}
            {screen < SCREENS - 1 ? (
              <button
                onClick={() => setScreen(screen + 1)}
                className="t-focus px-6 py-3 bg-t-amber text-white text-sm font-semibold hover:bg-t-amber-bright transition-colors min-h-touch"
              >
                Continue
              </button>
            ) : (
              <>
                <button
                  onClick={() => complete(true)}
                  disabled={saving}
                  className="t-focus px-4 py-3 border border-t-amber text-t-amber-bright text-sm font-semibold hover:bg-t-panel-2 disabled:opacity-60 transition-colors min-h-touch"
                >
                  Start, then open Settings
                </button>
                <button
                  onClick={() => complete()}
                  disabled={saving}
                  className="t-focus px-6 py-3 bg-t-amber text-white text-sm font-semibold hover:bg-t-amber-bright disabled:opacity-60 transition-colors min-h-touch"
                >
                  {saving ? "Starting..." : "Start"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
