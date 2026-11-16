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
 * change. A refused save (for example read only while an operator views as the
 * person) puts the page back as it was saved and shows the route's words.
 */

import { useEffectiveRole } from "@/components/RoleProvider";
import { useEffect, useState } from "react";
import { applyUiPrefs, UI_PREFS_EVENT } from "@/lib/ui-prefs-apply";
import { readSaveError } from "@/lib/save-error";
import { SaveError } from "./SaveError";
import type { UiPrefs, FontScale, Density } from "@crucible/core";
import { LanguageSwitch } from "./LanguageSwitch";
import { useTranslations } from "next-intl";

interface CoachA11y {
  coachPlainLanguage: boolean;
  coachVoice: boolean;
  coachLanguage: "en" | "es";
}

// Labels come from the catalog (refineryAccount.settings.accessibility), by the key named here.
const FONT_OPTIONS: { value: FontScale; label: string }[] = [
  { value: "normal", label: "fontNormal" },
  { value: "large", label: "fontLarge" },
  { value: "xl", label: "fontXl" },
];
const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: "comfortable", label: "densityComfortable" },
  { value: "compact", label: "densityCompact" },
];
// Tri-state motion: follow the device, or force on/off.
const MOTION_OPTIONS: { value: "auto" | "on" | "off"; label: string }[] = [
  { value: "auto", label: "motionAuto" },
  { value: "off", label: "motionOff" },
  { value: "on", label: "motionOn" },
];

export function AccessibilitySettingsSection() {
  // Staff have t.ROY, not a career coach (staff pass S2, walk T03).
  const staff = !!useEffectiveRole()?.orgRole;
  const tLang = useTranslations("common.lang");
  // t = the save-failure words (the same ones the consent panel uses); ta = this section's own words.
  const t = useTranslations("refineryAccount.consent");
  const ta = useTranslations("refineryAccount.settings.accessibility");
  const helper = staff ? ta("helperStaff") : ta("helperCoach");
  const [coach, setCoach] = useState<CoachA11y | null>(null);
  const [prefs, setPrefs] = useState<UiPrefs | null>(null);
  const [error, setError] = useState<{ part: "coach" | "prefs"; message: string } | null>(null);

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

  // Reading-help toggles persist to the existing coach settings storage. The
  // switch moves at once and moves back if the save is refused.
  async function saveCoach(patch: Partial<CoachA11y>) {
    const before = coach;
    setError(null);
    setCoach((prev) => (prev ? { ...prev, ...patch } : prev));
    try {
      const res = await fetch("/api/coach/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) { setCoach(before); setError({ part: "coach", message: await readSaveError(res, t("saveFallback")) }); }
    } catch {
      setCoach(before);
      setError({ part: "coach", message: t("connectionError") });
    }
  }

  // Display prefs persist to ui-prefs AND apply to the live page immediately.
  // If the save is refused, the page goes back to the saved look and says why.
  function showPrefs(next: UiPrefs) {
    applyUiPrefs(next);
    window.dispatchEvent(new CustomEvent(UI_PREFS_EVENT, { detail: next }));
    setPrefs(next);
  }
  async function savePrefs(patch: Partial<UiPrefs>) {
    const before = { ...(prefs ?? { fontScale: "normal", density: "comfortable", reducedMotion: null, avatar: null }) } as UiPrefs;
    const next = { ...before, ...patch } as UiPrefs;
    setError(null);
    showPrefs(next);
    try {
      const res = await fetch("/api/user/ui-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) { showPrefs(before); setError({ part: "prefs", message: await readSaveError(res, t("saveFallback")) }); }
    } catch {
      showPrefs(before);
      setError({ part: "prefs", message: t("connectionError") });
    }
  }

  const motionValue: "auto" | "on" | "off" =
    prefs?.reducedMotion === true ? "on" : prefs?.reducedMotion === false ? "off" : "auto";

  return (
    <div className="bg-t-panel border border-t-line p-5 space-y-6">
      {/* Reading help */}
      <div id="settings-reading-help">
        <h3 className="font-semibold text-t-white mb-1">{ta("readingHelp")}</h3>
        <p className="text-sm text-t-phos-dim mb-3">
          {ta("readingHelpNote")}
        </p>
        <div className="space-y-3">
          <ToggleRow
            id="settings-plain-language"
            label={ta("plainLanguage")}
            hint={ta("plainLanguageHint", { helper })}
            on={!!coach?.coachPlainLanguage}
            onToggle={() => saveCoach({ coachPlainLanguage: !coach?.coachPlainLanguage })}
          />
          <ToggleRow
            id="settings-read-aloud"
            label={ta("readAloud")}
            hint={staff ? ta("readAloudHintStaff") : ta("readAloudHintCoach")}
            on={!!coach?.coachVoice}
            onToggle={() => saveCoach({ coachVoice: !coach?.coachVoice })}
          />
        </div>
        <SaveError message={error?.part === "coach" ? error.message : null} />
      </div>

      {/* Site language: one setting for every translated screen and the coach (i18n/locale.ts). */}
      <div id="settings-spanish" className="border-t border-t-line pt-5">
        {/* Bilingual on purpose: a person who landed in the wrong language can find it. */}
        <label className="text-sm font-medium text-t-white block mb-1">Language / Idioma</label>
        <p className="text-sm text-t-phos-dim mb-2">{tLang("hint")}</p>
        <LanguageSwitch variant="pills" />
        <p className="mt-2 text-xs text-t-phos-dim">{tLang("settingsNote")}</p>
      </div>

      {/* Text size and motion: one block for the Settings tour (settings-display) */}
      <div id="settings-display" className="space-y-6">
      <div id="settings-text-size" className="border-t border-t-line pt-5">
        <label className="text-sm font-medium text-t-white block mb-1">{ta("textSize")}</label>
        <p className="text-sm text-t-phos-dim mb-2">{ta("textSizeHint")}</p>
        <div className="flex flex-wrap gap-2">
          {FONT_OPTIONS.map((o) => (
            <PillButton
              key={o.value}
              label={ta(o.label)}
              selected={(prefs?.fontScale ?? "normal") === o.value}
              onClick={() => savePrefs({ fontScale: o.value })}
            />
          ))}
        </div>
      </div>

      {/* Motion */}
      <div id="settings-motion" className="border-t border-t-line pt-5">
        <label className="text-sm font-medium text-t-white block mb-1">{ta("motion")}</label>
        <p className="text-sm text-t-phos-dim mb-2">
          {ta("motionHint")}
        </p>
        <div className="flex flex-wrap gap-2">
          {MOTION_OPTIONS.map((o) => (
            <PillButton
              key={o.value}
              label={ta(o.label)}
              selected={motionValue === o.value}
              onClick={() =>
                savePrefs({ reducedMotion: o.value === "auto" ? null : o.value === "on" })
              }
            />
          ))}
        </div>
      </div>
      </div>

      {/* Density */}
      <div id="settings-spacing" className="border-t border-t-line pt-5">
        <label className="text-sm font-medium text-t-white block mb-1">{ta("spacing")}</label>
        <p className="text-sm text-t-phos-dim mb-2">{ta("spacingHint")}</p>
        <div className="flex flex-wrap gap-2">
          {DENSITY_OPTIONS.map((o) => (
            <PillButton
              key={o.value}
              label={ta(o.label)}
              selected={(prefs?.density ?? "comfortable") === o.value}
              onClick={() => savePrefs({ density: o.value })}
            />
          ))}
        </div>
        <SaveError message={error?.part === "prefs" ? error.message : null} />
      </div>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  on,
  onToggle,
}: {
  /** A one-line target id for the Settings tour. */
  id?: string;
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div id={id} className="flex items-center justify-between gap-4">
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
