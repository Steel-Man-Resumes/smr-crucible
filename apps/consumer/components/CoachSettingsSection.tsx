"use client";

/**
 * CoachSettingsSection -- Settings -> "Your Coach" (master plan Section 5).
 *
 * Lets the user rename and tune the coach the guided tour introduced:
 * coaching style, response length, focus mode, and an advanced creativity slider.
 * Self-contained: hydrates from GET /api/coach/settings, saves via POST.
 */

import { useState, useEffect } from "react";
import { TBtn } from "@crucible/consumer-ui";

type Style = "supportive" | "balanced" | "direct";
type Length = "brief" | "full";
type Focus = "guide" | "answer";

interface Settings {
  coachName: string;
  coachStyle: Style;
  coachLength: Length;
  coachFocus: Focus;
  coachCreativity: number;
}

const STYLE_OPTIONS: { value: Style; label: string; hint: string }[] = [
  { value: "supportive", label: "Supportive", hint: "Warm, encouraging" },
  { value: "balanced", label: "Balanced", hint: "Warm and direct" },
  { value: "direct", label: "Direct", hint: "Efficient, no warm-up" },
];

export function CoachSettingsSection() {
  const [s, setS] = useState<Settings | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/coach/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.data) setS(j.data as Settings);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!s) return null;

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => (prev ? { ...prev, [key]: value } : prev));
    setStatus("idle");
  }

  async function save() {
    if (!s) return;
    setStatus("saving");
    try {
      const res = await fetch("/api/coach/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      setStatus(res.ok ? "saved" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-t-white mb-1">Your Coach</h2>
      <p className="text-sm text-t-phos-dim mb-4">
        Your coach guides you through your job search. Make it yours.
      </p>

      <div className="bg-t-panel border border-t-line p-5 space-y-5">
        {/* Name */}
        <div>
          <label className="text-sm font-medium text-t-white block mb-1">Coach name</label>
          <input
            value={s.coachName}
            onChange={(e) => update("coachName", e.target.value)}
            maxLength={40}
            placeholder="Guide"
            className="w-full px-4 py-3 border border-t-line text-base bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch"
          />
        </div>

        {/* Style */}
        <div>
          <label className="text-sm font-medium text-t-white block mb-2">Coaching style</label>
          <div className="grid grid-cols-3 gap-2">
            {STYLE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => update("coachStyle", o.value)}
                className={`t-focus border p-3 text-left transition-colors ${
                  s.coachStyle === o.value
                    ? "border-t-amber bg-t-panel-2"
                    : "border-t-line bg-t-panel hover:border-t-phos-dim"
                }`}
              >
                <span className="block text-sm font-semibold text-t-white">{o.label}</span>
                <span className="block text-xs text-t-phos-dim mt-0.5">{o.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Length + Focus toggles */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-t-white block mb-2">Response length</label>
            <div className="flex gap-2">
              {(["brief", "full"] as Length[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => update("coachLength", v)}
                  className={`t-focus flex-1 border px-3 py-2.5 text-sm font-medium capitalize transition-colors ${
                    s.coachLength === v
                      ? "border-t-amber bg-t-panel-2 text-t-amber-bright"
                      : "border-t-line bg-t-panel text-t-phos-dim hover:border-t-phos-dim"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-t-white block mb-2">Focus</label>
            <div className="flex gap-2">
              {([
                { v: "guide" as Focus, label: "Guide me" },
                { v: "answer" as Focus, label: "Just answer" },
              ]).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => update("coachFocus", o.v)}
                  className={`t-focus flex-1 border px-3 py-2.5 text-sm font-medium transition-colors ${
                    s.coachFocus === o.v
                      ? "border-t-amber bg-t-panel-2 text-t-amber-bright"
                      : "border-t-line bg-t-panel text-t-phos-dim hover:border-t-phos-dim"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Advanced */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-sm font-medium text-t-phos-dim hover:text-t-amber-bright"
          >
            {showAdvanced ? "Hide advanced" : "Advanced settings"}
          </button>
          {showAdvanced && (
            <div className="mt-3">
              <label className="text-sm font-medium text-t-white block mb-1">
                How creative should your coach be?{" "}
                <span className="text-t-phos-dim font-normal">({s.coachCreativity})</span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={s.coachCreativity}
                onChange={(e) => update("coachCreativity", parseInt(e.target.value, 10))}
                className="w-full accent-t-amber"
              />
              <div className="flex justify-between text-xs text-t-phos-dim">
                <span>Focused advice</span>
                <span>More exploratory</span>
              </div>
            </div>
          )}
        </div>

        {/* Save */}
        <div className="flex items-center gap-3 pt-1">
          <TBtn onClick={save} disabled={status === "saving"} size="sm">
            {status === "saving" ? "saving..." : "save"}
          </TBtn>
          {status === "saved" && <span className="text-sm text-t-amber-bright">Saved.</span>}
          {status === "error" && <span className="text-sm text-t-red">Could not save.</span>}
        </div>
      </div>
    </section>
  );
}
