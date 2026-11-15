"use client";

/**
 * Start a creative lane: what you make, a name for the lane, and whether this
 * is the dream or the work you do now. Facts carry over; nothing is asked twice.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { CareerLane, LanePath } from "@crucible/core/src/careerLaneShared";
import { sendJson } from "@/lib/creative";

const inputCls =
  "t-focus w-full min-h-touch bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white focus:border-t-steel focus:outline-none";

export function StartCreativeLane({
  first,
  onCreated,
  onCancel,
}: {
  first: boolean;
  onCreated: (lane: CareerLane) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("refineryResume.creative.startLane");
  const ts = useTranslations("refineryResume.creative.shared");
  const [what, setWhat] = useState("");
  const [name, setName] = useState("");
  const [path, setPath] = useState<LanePath | "none">("dream");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <form
      data-testid="creative-start"
      className="mt-6 border border-t-line bg-t-panel p-4 sm:p-5 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        const laneName = (name || what).trim().slice(0, 40);
        const r = await sendJson<{ lane?: CareerLane }>("/api/lanes", "POST", {
          name: laneName,
          targetRole: what,
          kind: "creative",
          path: path === "none" ? null : path,
        });
        setBusy(false);
        if (r.ok && r.data.lane) onCreated(r.data.lane);
        else setError(r.data.message || ts("didntSave"));
      }}
    >
      <h2 className="text-sm font-semibold uppercase text-t-phos">{first ? t("first") : t("another")}</h2>
      <p className="text-sm text-t-phos-dim">{t("blurb")}</p>
      <label className="block text-sm text-t-white">
        {t("whatLabel")}
        <input className={`${inputCls} mt-1`} value={what} maxLength={120} placeholder={t("whatPlaceholder")} onChange={(e) => setWhat(e.target.value)} required />
      </label>
      <label className="block text-sm text-t-white">
        {t("nameLabel")} <span className="text-t-phos-dim">{t("optional")}</span>
        <input className={`${inputCls} mt-1`} value={name} maxLength={40} placeholder={t("namePlaceholder")} onChange={(e) => setName(e.target.value)} />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm text-t-white">{t("dreamOrNow")}</legend>
        {(
          [
            ["dream", t("path.dream.label"), t("path.dream.body")],
            ["realistic", t("path.realistic.label"), t("path.realistic.body")],
            ["none", t("path.none.label"), t("path.none.body")],
          ] as const
        ).map(([v, label, body]) => (
          <label key={v} className="flex gap-3 border border-t-line p-3 cursor-pointer">
            <input type="radio" name="creative-path" value={v} checked={path === v} onChange={() => setPath(v)} className="mt-1" />
            <span>
              <span className="block text-sm font-semibold text-t-white">{label}</span>
              <span className="block text-xs text-t-phos-dim">{body}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && <p className="text-sm text-t-red" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !what.trim()} className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright disabled:opacity-50">
          {busy ? ts("saving") : t("startThis")}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="t-focus min-h-touch px-3 text-sm text-t-phos-dim hover:text-t-white">
            {ts("cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
