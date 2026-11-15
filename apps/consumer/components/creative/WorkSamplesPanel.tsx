"use client";

/** The work-sample list: the person's works, strongest first. Every field is what they typed. */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { stillNeedsProof, type WorkSampleRow } from "@crucible/core/src/creativeLaneShared";
import type { TitleMode } from "@crucible/core/src/practiceRecordShared";
import type { CreativeStatus } from "@crucible/core/src/creativeChecks";
import { sendJson } from "@/lib/creative";
import { OpenItems } from "./OpenItems";
import { FacilityChoices } from "./FacilityChoices";
import type { CreativeCtx } from "./CreativeLaneView";

export function WorkSamplesPanel({
  laneId,
  ctx,
  rows,
  status,
  onTitleMode,
  onSaved,
}: {
  laneId: string;
  ctx: CreativeCtx;
  rows: WorkSampleRow[];
  status: CreativeStatus;
  onTitleMode: (entryId: string, mode: TitleMode) => Promise<boolean>;
  onSaved: () => void;
}) {
  const t = useTranslations("refineryResume.creative.samples");
  const ts = useTranslations("refineryResume.creative.shared");
  const [order, setOrder] = useState(rows);
  const [msg, setMsg] = useState("");
  useEffect(() => setOrder(rows), [rows]);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next.map((r, k) => ({ ...r, number: k + 1 })));
  };

  const choices = <FacilityChoices entries={ctx.entries} settings={ctx.settings} onTitleMode={onTitleMode} only="works" />;
  if (!rows.length) {
    return (
      <div className="space-y-4">
        {choices}
        <p className="border border-t-line bg-t-panel p-3 text-sm text-t-phos-dim" data-testid="samples-empty">
          {t("empty")}
        </p>
        <OpenItems status={status} doc="work_samples" testId="samples-open-items" />
      </div>
    );
  }
  return (
    <div className="space-y-4" data-testid="samples-panel">
      <p className="text-sm text-t-phos-dim">{ts("samplesHow")}</p>
      {choices}
      <ol className="space-y-2">
        {order.map((r, i) => (
          <li key={r.entryId} className="flex gap-3 border border-t-line bg-t-panel p-3" data-testid="sample-row">
            <span className="font-mono text-sm text-t-phos">{i + 1}.</span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-t-white">
                <span className="italic">{r.title}</span>, {r.year}
              </p>
              <p className="text-t-phos-dim">{[r.medium, r.size].filter(Boolean).join(", ")}</p>
              {r.description && <p className="text-t-white">{r.description}</p>}
              {r.fileName && <p className="text-xs text-t-phos-dim">{t("file", { name: r.fileName })}</p>}
            </div>
            <div className="flex flex-col gap-1">
              <button type="button" className="t-focus min-h-touch px-2 border border-t-line text-t-white disabled:opacity-40" disabled={i === 0} aria-label={t("moveUp", { title: r.title })} onClick={() => move(i, -1)}>
                {t("up")}
              </button>
              <button type="button" className="t-focus min-h-touch px-2 border border-t-line text-t-white disabled:opacity-40" disabled={i === order.length - 1} aria-label={t("moveDown", { title: r.title })} onClick={() => move(i, 1)}>
                {t("down")}
              </button>
            </div>
          </li>
        ))}
      </ol>
      {stillNeedsProof(ctx.entries, order.map((x) => x.entryId)) > 0 && (
        <p className="text-sm text-t-phos" data-testid="samples-needs-proof">{ts("needsProof")}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="samples-save"
          className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright"
          onClick={async () => {
            const r = await sendJson(`/api/creative/${laneId}/docs`, "PUT", { type: "work_sample_list", order: order.map((x) => x.entryId), rev: ctx.sampleRev });
            setMsg(r.ok ? t("orderSaved") : r.data.message || ts("didntSave"));
            if (r.ok) onSaved();
          }}
        >
          {t("saveOrder")}
        </button>
        <a href={`/api/creative/${laneId}/export?doc=work_samples&format=txt`} className="t-focus min-h-touch inline-flex items-center px-3 border border-t-line text-sm text-t-white">{t("plainText")}</a>
        <a href={`/api/creative/${laneId}/export?doc=work_samples&format=csv`} className="t-focus min-h-touch inline-flex items-center px-3 border border-t-line text-sm text-t-white">{t("csv")}</a>
      </div>
      <p aria-live="polite" className="text-sm text-t-phos">{msg}</p>
      <OpenItems status={status} doc="work_samples" testId="samples-open-items" />
    </div>
  );
}
