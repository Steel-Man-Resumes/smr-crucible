"use client";

/** Step one of the hurdle planner: pick every hurdle in the way (several allowed). */

import { useTranslations } from "next-intl";
import { HURDLE_ORDER, type HurdleId } from "@/lib/hurdles/graph";

export function HurdlePicker({ selected, onToggle }: { selected: HurdleId[]; onToggle: (h: HurdleId) => void }) {
  const t = useTranslations("refineryInterview.picker");
  const th = useTranslations("refineryInterview.hurdles");
  return (
    <fieldset className="mb-8">
      <legend className="font-medium text-t-white mb-1">{t("legend")}</legend>
      <p className="text-xs text-t-phos-dim mb-3">
        {t("note")}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {HURDLE_ORDER.map((h) => {
          const on = selected.includes(h);
          return (
            <button
              key={h}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(h)}
              data-testid={`hurdle-${h}`}
              className={`t-focus text-left px-3 py-2.5 border transition-colors min-h-touch ${
                on ? "bg-t-panel-2 border-t-amber" : "bg-t-panel border-t-line hover:border-t-amber"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-t-white">
                <span aria-hidden="true" className={`inline-block w-3.5 h-3.5 border ${on ? "bg-t-amber border-t-amber" : "border-t-line"}`} />
                {th(`h.${h}.label`)}
              </span>
              <span className="block text-xs text-t-phos-dim mt-0.5 pl-5">{th(`h.${h}.blurb`)}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
