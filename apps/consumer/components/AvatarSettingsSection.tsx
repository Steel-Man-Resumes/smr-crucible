"use client";

/**
 * Phase 7.7 (illustrated half) -- Settings -> Account -> Your picture.
 *
 * Builds a zero-PII illustrated avatar from a small set of options and saves
 * the CHOICE (not an image) to users.ui_avatar via /api/user/ui-prefs. No
 * photo, no upload, no R2. The photo + AI-headshot path is R2-gated and shown
 * only as a "coming soon" note. Saving dispatches UI_PREFS_EVENT so the nav
 * avatar updates without a reload.
 */

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { TBtn } from "@crucible/consumer-ui";
import { IllustratedAvatar, AVATAR_FILLS } from "@/components/IllustratedAvatar";
import { UI_PREFS_EVENT } from "@/lib/ui-prefs-apply";
import {
  AVATAR_SHAPES,
  AVATAR_COLORS,
  AVATAR_ACCENTS,
  type AvatarChoice,
  type AvatarShape,
  type AvatarColor,
  type AvatarAccent,
  type UiPrefs,
} from "@crucible/core/src/uiPrefsShared";

const SHAPE_LABELS: Record<AvatarShape, string> = {
  circle: "Circle",
  square: "Rounded",
  hex: "Hex",
  shield: "Shield",
};
const ACCENT_LABELS: Record<AvatarAccent, string> = {
  solid: "Plain",
  ring: "Ring",
  corner: "Dot",
};

export function AvatarSettingsSection() {
  const { data: session } = useSession();
  const fallbackInitial = (session?.user?.name || session?.user?.email || "?")
    .trim()
    .charAt(0)
    .toUpperCase();

  const [choice, setChoice] = useState<AvatarChoice>({
    shape: "circle",
    color: "slate",
    accent: "solid",
    initial: "",
  });
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    fetch("/api/user/ui-prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.data?.avatar) setChoice(j.data.avatar as AvatarChoice);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  function update<K extends keyof AvatarChoice>(key: K, value: AvatarChoice[K]) {
    setChoice((prev) => ({ ...prev, [key]: value }));
    setStatus("idle");
  }

  async function save() {
    setStatus("saving");
    // Fall back to the name/email initial if the user left it blank.
    const toSave: AvatarChoice = {
      ...choice,
      initial: choice.initial || fallbackInitial,
    };
    try {
      const res = await fetch("/api/user/ui-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: toSave }),
      });
      if (res.ok) {
        const j = await res.json().catch(() => null);
        setStatus("saved");
        window.dispatchEvent(
          new CustomEvent(UI_PREFS_EVENT, { detail: (j?.data ?? {}) as UiPrefs })
        );
        setTimeout(() => setStatus("idle"), 2500);
      } else {
        setStatus("idle");
      }
    } catch {
      setStatus("idle");
    }
  }

  if (!loaded) return null;

  return (
    <div className="bg-t-panel p-5 border border-t-line mt-4">
      <h3 className="font-semibold text-t-white mb-1">Your picture</h3>
      <p className="text-sm text-t-phos-dim mb-4">
        Build a simple icon for your account. It is a drawing, not a photo, and it
        never goes on your resume.
      </p>

      <div className="flex items-start gap-5">
        <IllustratedAvatar
          choice={choice}
          fallbackInitial={fallbackInitial}
          size={72}
          className="flex-shrink-0"
        />

        <div className="flex-1 space-y-4">
          {/* Shape */}
          <div>
            <label className="text-xs text-t-phos-dim uppercase block mb-2">Shape</label>
            <div className="flex flex-wrap gap-2">
              {AVATAR_SHAPES.map((s) => (
                <Pill key={s} label={SHAPE_LABELS[s]} selected={choice.shape === s} onClick={() => update("shape", s as AvatarShape)} />
              ))}
            </div>
          </div>

          {/* Color */}
          <div>
            <label className="text-xs text-t-phos-dim uppercase block mb-2">Color</label>
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={choice.color === c}
                  onClick={() => update("color", c as AvatarColor)}
                  className={`t-focus h-9 w-9 rounded-full border-2 transition-transform ${
                    choice.color === c ? "border-t-amber scale-110" : "border-t-line"
                  }`}
                  style={{ backgroundColor: AVATAR_FILLS[c].bg }}
                />
              ))}
            </div>
          </div>

          {/* Accent */}
          <div>
            <label className="text-xs text-t-phos-dim uppercase block mb-2">Accent</label>
            <div className="flex flex-wrap gap-2">
              {AVATAR_ACCENTS.map((a) => (
                <Pill key={a} label={ACCENT_LABELS[a]} selected={choice.accent === a} onClick={() => update("accent", a as AvatarAccent)} />
              ))}
            </div>
          </div>

          {/* Initial */}
          <div>
            <label className="text-xs text-t-phos-dim uppercase block mb-2">Letter</label>
            <input
              value={choice.initial}
              onChange={(e) => update("initial", e.target.value.slice(0, 1).toUpperCase())}
              placeholder={fallbackInitial}
              maxLength={1}
              className="w-16 px-3 py-2 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors text-center"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-5">
        <TBtn onClick={save} disabled={status === "saving"} size="sm">
          {status === "saving" ? "saving..." : "save picture"}
        </TBtn>
        {status === "saved" && <span className="text-sm text-t-amber-bright">Saved.</span>}
      </div>

      <p className="text-xs text-t-phos-dim mt-4 pt-3 border-t border-t-line">
        Photo and AI headshot options are coming soon.
      </p>
    </div>
  );
}

function Pill({
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
      className={`t-focus border px-3 py-2 text-sm font-medium transition-colors ${
        selected
          ? "border-t-amber bg-t-panel-2 text-t-amber-bright"
          : "border-t-line bg-t-panel text-t-phos-dim hover:border-t-phos-dim"
      }`}
    >
      {label}
    </button>
  );
}
