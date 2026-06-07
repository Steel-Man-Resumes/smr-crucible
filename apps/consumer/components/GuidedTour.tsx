"use client";

/**
 * GuidedTour -- the mandatory one-time orientation (master plan Section 3, Stage 0).
 *
 * Three screens: the promise, the journey map, and meet/name your coach.
 * DB-persisted via /api/onboarding/tour (cannot be reset by clearing
 * localStorage). Two "remind me" deferrals are allowed; after that the defer
 * option disappears. Client tier only -- partners/observers/admin are not nagged.
 */

import { useState, useEffect } from "react";
import { useUserTier } from "@/lib/useUserTier";

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
  const [state, setState] = useState<TourState | null>(null);
  const [screen, setScreen] = useState(0);
  const [coachName, setCoachName] = useState("");
  const [closed, setClosed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tier !== "client") return;
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
  }, [tier]);

  if (tier !== "client" || closed || !state || state.tourComplete) return null;

  const canDefer = state.tourDeferrals < 2;

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
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-xl">
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
            <h2 className="text-2xl font-bold text-foreground mb-3">
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
            <h2 className="text-2xl font-bold text-foreground mb-3">
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
            <h2 className="text-2xl font-bold text-foreground mb-3">Meet your coach</h2>
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
              className="w-full px-4 py-3 rounded-xl border-2 border-border text-body bg-white focus:border-sage-600 transition-colors min-h-touch"
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
                className="px-6 py-3 bg-sage-600 text-white rounded-xl text-sm font-medium hover:bg-sage-700 transition-colors min-h-touch"
              >
                Continue
              </button>
            ) : (
              <button
                onClick={complete}
                disabled={saving}
                className="px-6 py-3 bg-sage-600 text-white rounded-xl text-sm font-medium hover:bg-sage-700 disabled:opacity-60 transition-colors min-h-touch"
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
