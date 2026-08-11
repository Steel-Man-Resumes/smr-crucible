"use client";

/**
 * Phase 7.2 -- Settings -> Accessibility.
 *
 * Surfaces the reading-help toggles that already existed only inside the chat
 * panel (plain language, read aloud, Spanish) alongside three new app-wide
 * display prefs (text size, motion, density). The reading-help toggles reuse
 * the EXISTING /api/coach/settings storage (coach_plain_language / coach_voice
 * / coach_language) -- no new column, no duplicate source of truth. The display
 * prefs use /api/user/ui-prefs and apply to the live page the moment they
 * change.
 */

import { useEffect, useState } from "react";
import { applyUiPrefs, UI_PREFS_EVENT } from "@/lib/ui-prefs-apply";
import type { UiPrefs, FontScale, Density } from "@crucible/core";

interface CoachA11y {
  coachPlainLanguage: boolean;
  coachVoice: boolean;
  coachLanguage: "en" | "es";
}

const FONT_OPTIONS: { value: FontScale; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
  { value: "xl", label: "Extra large" },
];
const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];
// Tri-state motion: follow the device, or force on/off.
const MOTION_OPTIONS: { value: "auto" | "on" | "off"; label: string }[] = [
  { value: "auto", label: "Match my device" },
  { value: "off", label: "Allow motion" },
  { value: "on", label: "Reduce motion" },
];

export function AccessibilitySettingsSection() {
  const [coach, setCoach] = useState<CoachA11y | null>(null);
  const [prefs, setPrefs] = useState<UiPrefs | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/coach/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.data) {
          setCoach({
            coachPlainLanguage: !!j.data.coachPlainLanguage,
            coachVoice: !!j.data.coachVoice,
            coachLanguage: j.data.coachLanguage === "es" ? "es" : "en",
          });
        }
      })
      .catch(() => {});
    fetch("/api/user/ui-prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.data) setPrefs(j.data as UiPrefs);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Reading-help toggles persist to the existing coach settings storage.
  function saveCoach(patch: Partial<CoachA11y>) {
    setCoach((prev) => (prev ? { ...prev, ...patch } : prev));
    fetch("/api/coach/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }

  // Display prefs persist to ui-prefs AND apply to the live page immediately.
  function savePrefs(patch: Partial<UiPrefs>) {
    setPrefs((prev) => {
      const next = { ...(prev ?? { fontScale: "normal", density: "comfortable", reducedMotion: null, avatar: null }), ...patch } as UiPrefs;
      applyUiPrefs(next);
      window.dispatchEvent(new CustomEvent(UI_PREFS_EVENT, { detail: next }));
      return next;
    });
    fetch("/api/user/ui-prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }

  const motionValue: "auto" | "on" | "off" =
    prefs?.reducedMotion === true ? "on" : prefs?.reducedMotion === false ? "off" : "auto";

  return (
    <div className="bg-t-panel border border-t-line p-5 space-y-6">
      {/* Reading help */}
      <div>
        <h3 className="font-semibold text-t-white mb-1">Reading help</h3>
        <p className="text-sm text-t-phos-dim mb-3">
          These also work from the chat panel. Change them here and they stay changed.
        </p>
        <div className="space-y-3">
          <ToggleRow
            label="Plain language"
            hint="Shorter words and simpler sentences from your coach."
            on={!!coach?.coachPlainLanguage}
            onToggle={() => saveCoach({ coachPlainLanguage: !coach?.coachPlainLanguage })}
          />
          <ToggleRow
            label="Read aloud"
            hint="Your coach can read its answers out loud."
            on={!!coach?.coachVoice}
            onToggle={() => saveCoach({ coachVoice: !coach?.coachVoice })}
          />
          <ToggleRow
            label="Spanish (Espanol)"
            hint="Your coach replies in Spanish."
            on={coach?.coachLanguage === "es"}
            onToggle={() =>
              saveCoach({ coachLanguage: coach?.coachLanguage === "es" ? "en" : "es" })
            }
          />
        </div>
      </div>

      {/* Text size */}
      <div className="border-t border-t-line pt-5">
        <label className="text-sm font-medium text-t-white block mb-1">Text size</label>
        <p className="text-sm text-t-phos-dim mb-2">Make the words bigger across the whole app.</p>
        <div className="flex flex-wrap gap-2">
          {FONT_OPTIONS.map((o) => (
            <PillButton
              key={o.value}
              label={o.label}
              selected={(prefs?.fontScale ?? "normal") === o.value}
              onClick={() => savePrefs({ fontScale: o.value })}
            />
          ))}
        </div>
      </div>

      {/* Motion */}
      <div className="border-t border-t-line pt-5">
        <label className="text-sm font-medium text-t-white block mb-1">Motion</label>
        <p className="text-sm text-t-phos-dim mb-2">
          Cut down on animations. &quot;Match my device&quot; follows your phone or computer setting.
        </p>
        <div className="flex flex-wrap gap-2">
          {MOTION_OPTIONS.map((o) => (
            <PillButton
              key={o.value}
              label={o.label}
              selected={motionValue === o.value}
              onClick={() =>
                savePrefs({ reducedMotion: o.value === "auto" ? null : o.value === "on" })
              }
            />
          ))}
        </div>
      </div>

      {/* Density */}
      <div className="border-t border-t-line pt-5">
        <label className="text-sm font-medium text-t-white block mb-1">Spacing</label>
        <p className="text-sm text-t-phos-dim mb-2">Comfortable is roomier. Compact fits more on screen.</p>
        <div className="flex flex-wrap gap-2">
          {DENSITY_OPTIONS.map((o) => (
            <PillButton
              key={o.value}
              label={o.label}
              selected={(prefs?.density ?? "comfortable") === o.value}
              onClick={() => savePrefs({ density: o.value })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-t-white">{label}</p>
        <p className="text-xs text-t-phos-dim">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onToggle}
        className={`t-focus relative flex-shrink-0 h-7 w-12 rounded-full border transition-colors ${
          on ? "bg-t-amber border-t-amber" : "bg-t-panel-2 border-t-line"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-t-white transition-transform ${
            on ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function PillButton({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`t-focus border px-4 py-2.5 text-sm font-medium transition-colors min-h-touch ${
        selected
          ? "border-t-amber bg-t-panel-2 text-t-amber-bright"
          : "border-t-line bg-t-panel text-t-phos-dim hover:border-t-phos-dim"
      }`}
    >
      {label}
    </button>
  );
}
