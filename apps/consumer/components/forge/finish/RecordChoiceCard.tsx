"use client";

/**
 * DEC-51: the record on the page is a spectrum the person chooses, shown once
 * above the fix list with a preview of exactly which entries it touches. The
 * pass that applies it runs on the written document (lib/record-choice.ts),
 * so the page can never say one thing and print another.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { recordEntryLabel, type RecordChoice, type RecordEntry } from "@/lib/record-choice";
import { useServerText } from "@/components/ServerTextProvider";

const BTN = "t-focus min-h-touch border px-3 py-2 text-left text-xs transition-colors";

const OPTIONS: Array<{ value: RecordChoice }> = [{ value: "off" }, { value: "state" }, { value: "facility" }];

export function RecordChoiceCard({
  choice,
  entries,
  sourceWithheld,
  busy,
  onChoose,
  decisionKey,
}: {
  decisionKey?: string;
  choice: RecordChoice;
  /** Inside entries found on the written page by the pass. */
  entries: RecordEntry[];
  /** Source lines held back (older runs, or lines outside any job entry). */
  sourceWithheld: string[];
  busy: boolean;
  onChoose: (choice: RecordChoice) => void;
}) {
  const t = useTranslations("forgeFinish.recordChoice");
  const ts = useServerText();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (!decisionKey) return;
    try { setCollapsed(sessionStorage.getItem(`forge-record-choice:${decisionKey}`) === choice); } catch { /* Keep the choice usable without storage. */ }
  }, [decisionKey, choice]);
  if (collapsed) return (
    <div className="mb-4 border border-t-line bg-t-panel px-4 py-3" data-testid="record-choice-done">
      <p className="text-xs text-t-phos">{t("yourChoice", { label: OPTIONS.some((o) => o.value === choice) ? t(`options.${choice}.label`) : "" })}</p>
      {busy && <p role="status" className="mt-1 text-xs text-t-phos">{t("updating")}</p>}
      <button type="button" disabled={busy} className="t-focus mt-1 min-h-touch text-xs text-t-phos underline disabled:opacity-60" onClick={() => setCollapsed(false)}>{t("change")}</button>
    </div>
  );
  if (entries.length === 0 && sourceWithheld.length === 0) return null;
  const preview =
    choice === "off"
      ? Array.from(new Set([...entries.map((e) => recordEntryLabel(e, "off")), ...sourceWithheld]))
      : choice === "state"
        ? entries.map((e) => recordEntryLabel(e, "state"))
        : entries.map((e) => e.header);
  return (
    <section className="mb-4 border border-t-line bg-t-panel px-4 py-3" data-testid="record-choice-card" aria-labelledby="record-choice-title">
      <p id="record-choice-title" className="text-xs font-bold uppercase text-t-amber-bright">{t("title")}</p>
      <p className="mt-1 text-xs leading-relaxed text-t-phos">
        {t("intro")}
      </p>
      <div className="mt-3 grid gap-2" role="radiogroup" aria-label={t("radioAria")}>
        {OPTIONS.map((o) => {
          const on = o.value === choice;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => {
                setCollapsed(true);
                try { if (decisionKey) sessionStorage.setItem(`forge-record-choice:${decisionKey}`, o.value); } catch { /* Optional UI preference. */ }
                if (!on) onChoose(o.value);
              }}
              className={`${BTN} ${on ? "border-t-amber bg-t-panel-2 text-t-white" : "border-t-line bg-t-panel text-t-phos hover:border-t-phos-dim hover:text-t-white"} disabled:opacity-60`}
              data-testid={`record-choice-${o.value}`}
            >
              <span className="block text-sm font-semibold">{t(`options.${o.value}.label`)}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed">{t(`options.${o.value}.body`)}</span>
            </button>
          );
        })}
      </div>
      {preview.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-t-phos-dim">
            {choice === "off" ? t("previewOff") : choice === "state" ? t("previewState") : t("previewFacility")}
          </p>
          <ul className="mt-1 space-y-1">
            {preview.map((line, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-t-phos" data-testid="record-choice-preview">
                &ldquo;{ts(line)}&rdquo;
              </li>
            ))}
          </ul>
        </div>
      )}
      {busy && <p role="status" className="mt-2 text-xs text-t-phos">{t("rebuilding")}</p>}
    </section>
  );
}
