"use client";

/**
 * GuidedTour -- the mandatory one-time orientation (master plan Section 3, Stage 0).
 *
 * Three screens: the promise, the journey map, and meet/name your coach.
 * DB-persisted via /api/onboarding/tour (cannot be reset by clearing
 * localStorage). Two "remind me" deferrals are allowed; after that the defer
 * option disappears. Client tier only -- partners/observers/admin are not nagged.
 */

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useUserTier } from "@/lib/useUserTier";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Once deferred/closed, don't re-pop on every remount this session ("remind me
// next login" means next session, not next page nav).
const SUPPRESS_KEY = "guided_tour_suppressed";

interface TourState {
  tourComplete: boolean;
  tourDeferrals: number;
  coachName: string;
}

const SCREENS = 3;

const JOURNEY = [
  "Build your foundation",
  "Know your target",
  "Prepare your materials",
  "Plan your approach",
  "Practice",
  "Apply and track",
];

export function GuidedTour() {
  const tier = useUserTier();
  const pathname = usePathname();
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
    try {
      if (sessionStorage.getItem(SUPPRESS_KEY) === "1") {
        setClosed(true);
        return;
      }
    } catch {}
    let cancelled = false;
    fetch("/api/onboarding/tour")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.data) {
          setState(j.data as TourState);
          // Pre-fill only a real custom name, not the default "Guide"
          if (j.data.coachName && j.data.coachName !== "Guide") {
            setCoachName(j.data.coachName);
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tier, onHome]);

  const visible = tier === "client" && onHome && !closed && !!state && !state.tourComplete;
  const canDefer = !!state && state.tourDeferrals < 2;

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
  }, [visible, canDefer]);

  if (!visible) return null;

  async function complete() {
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
    setClosed(true);
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
    setClosed(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/60 backdrop-blur-sm">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-tour-heading"
        className="bg-white rounded-[7px] max-w-lg w-full p-6 sm:p-8 shadow-xl"
      >
        {/* progress dots */}
        <div className="flex gap-1.5 mb-6">
          {Array.from({ length: SCREENS }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${i <= screen ? "bg-sage-600" : "bg-gray-200"}`}
            />
          ))}
        </div>

        {screen === 0 && (
          <div>
            <h2 id="guided-tour-heading" className="text-2xl font-bold text-foreground mb-3">
              Every tool. For free. If you qualify.
            </h2>
            <p className="text-body text-muted leading-relaxed mb-3">
              Steel Man walks you from your first day home to your first day hired -- your
              story, your resume, disclosure planning, interview practice, job matching, and
              follow-through.
            </p>
            <p className="text-body text-foreground font-medium">
              The process matters. Start here.
            </p>
          </div>
        )}

        {screen === 1 && (
          <div>
            <h2 id="guided-tour-heading" className="text-2xl font-bold text-foreground mb-3">
              Your journey, one step at a time
            </h2>
            <ol className="space-y-2 mb-4">
              {JOURNEY.map((s, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 text-body text-foreground"
                >
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-sage-100 text-sage-700 text-sm font-semibold flex-shrink-0">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
            <p className="text-sm text-muted">
              Skipping steps is a bad idea. The process is designed to work.
            </p>
          </div>
        )}

        {screen === 2 && (
          <div>
            <h2 id="guided-tour-heading" className="text-2xl font-bold text-foreground mb-3">Meet your coach</h2>
            <p className="text-body text-muted leading-relaxed mb-4">
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
              className="w-full px-4 py-3 rounded-[6px] border-2 border-border text-body bg-white focus:border-sage-600 transition-colors min-h-touch"
            />
            <p className="text-xs text-muted mt-2">
              You can change this anytime in Settings.
            </p>
          </div>
        )}

        {/* actions */}
        <div className="flex items-center justify-between gap-3 mt-8">
          <div>
            {canDefer && (
              <button
                onClick={defer}
                className="text-sm text-muted hover:text-foreground transition-colors"
              >
                Remind me next login
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {screen > 0 && (
              <button
                onClick={() => setScreen(screen - 1)}
                className="px-4 py-2.5 text-sm font-medium text-muted hover:text-foreground"
              >
                Back
              </button>
            )}
            {screen < SCREENS - 1 ? (
              <button
                onClick={() => setScreen(screen + 1)}
                className="px-6 py-3 bg-sage-600 text-white rounded-[6px] text-sm font-medium hover:bg-sage-700 transition-colors min-h-touch"
              >
                Continue
              </button>
            ) : (
              <button
                onClick={complete}
                disabled={saving}
                className="px-6 py-3 bg-sage-600 text-white rounded-[6px] text-sm font-medium hover:bg-sage-700 disabled:opacity-60 transition-colors min-h-touch"
              >
                {saving ? "Starting..." : "Start"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
