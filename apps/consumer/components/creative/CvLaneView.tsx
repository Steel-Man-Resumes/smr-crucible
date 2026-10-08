"use client";

/**
 * One CV lane: the record and the CV built from it. Loads the lane's context
 * (record, choices, open items) and computes the CV and its open items with
 * the same pure functions the server and the export use.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CV_TYPES, type CareerLane, type CvType } from "@crucible/core/src/careerLaneShared";
import type { PracticeEntry, TitleMode } from "@crucible/core/src/practiceRecordShared";
import type { CreativeKindSettings } from "@crucible/core/src/creativeLaneShared";
import { buildCvModel, cvPageCap, cvPlainText, CV_TYPE_COPY } from "@crucible/core/src/cvShared";
import { getCvStatus } from "@crucible/core/src/cvChecks";
import { exportOpenItemLines } from "@crucible/core/src/creativeChecks";
import { stillNeedsProof, NEEDS_PROOF_NOTE, shownEntryIds } from "@crucible/core/src/creativeLaneShared";
import { CREATIVE_ERRORS, CV_TABS, sendJson } from "@/lib/creative";
import { PracticeRecordPanel, CV_SECTION_ORDER } from "./PracticeRecordPanel";
import { FacilityChoices } from "./FacilityChoices";
import { OpenItems } from "./OpenItems";
import { CreativePage } from "./CreativePage";

interface CvCtx {
  lane: CareerLane;
  cvType: CvType;
  entries: PracticeEntry[];
  settings: CreativeKindSettings;
}

const inputCls =
  "t-focus w-full min-h-touch bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white focus:border-t-steel focus:outline-none";

const TOP: { key: keyof CreativeKindSettings; label: string; placeholder: string }[] = [
  { key: "displayName", label: "Your name, as you want it printed", placeholder: "Ray Example" },
  { key: "discipline", label: "Your field (optional)", placeholder: "Adult education" },
  { key: "basedIn", label: "Where you're based", placeholder: "Toledo, OH" },
  { key: "email", label: "Email", placeholder: "you@example.com" },
  { key: "phone", label: "Phone (optional)", placeholder: "" },
  { key: "website", label: "Website (optional)", placeholder: "" },
];

export function CvLaneView({ laneId }: { laneId: string }) {
  const [ctx, setCtx] = useState<CvCtx | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<"record" | "cv">("record");
  const [pages, setPages] = useState<number | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [msg, setMsg] = useState("");
  const [top, setTop] = useState<Record<string, string>>({});
  const revRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/creative/${laneId}`);
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as CvCtx;
      setCtx(d);
      revRef.current = Number(d.settings.rev ?? 0);
      setTop(Object.fromEntries([...TOP.map((f) => f.key), "interests", "languages"].map((k) => [k, ((d.settings as Record<string, unknown>)[k] as string) ?? ""])));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [laneId]);
  useEffect(() => {
    load();
  }, [load]);

  const put = useCallback(
    async (body: Record<string, unknown>, optimistic: (s: CreativeKindSettings) => CreativeKindSettings) => {
      setCtx((c) => (c ? { ...c, settings: optimistic(c.settings) } : c));
      const r = await sendJson<{ settings?: CreativeKindSettings }>(`/api/creative/${laneId}`, "PUT", { ...body, rev: revRef.current });
      if (r.ok && r.data.settings) {
        revRef.current = Number(r.data.settings.rev ?? 0);
        setCtx((c) => (c ? { ...c, settings: r.data.settings as CreativeKindSettings } : c));
        setNotice("");
      } else {
        setNotice(r.data.message || CREATIVE_ERRORS.failed);
        load();
      }
      return r.ok;
    },
    [laneId, load]
  );
  const onTitleMode = useCallback(
    (entryId: string, mode: TitleMode) => put({ titleMode: { entryId, mode } }, (s) => ({ ...s, titleModes: { ...(s.titleModes ?? {}), [entryId]: mode } })),
    [put]
  );

  const model = useMemo(() => (ctx ? buildCvModel(ctx.entries, ctx.settings, ctx.cvType) : null), [ctx]);
  const status = useMemo(() => (ctx && model ? getCvStatus({ entries: ctx.entries, settings: ctx.settings, cvType: ctx.cvType, model, pages }) : null), [ctx, model, pages]);

  if (failed && !ctx) return <p className="mt-6 text-sm text-t-red" role="alert">{CREATIVE_ERRORS.loadFailed}</p>;
  if (!ctx || !model || !status) return <div className="mt-6 h-40 border border-t-line bg-t-panel" aria-hidden="true" />;
  const draft = status.blockCount > 0;
  const cap = cvPageCap(ctx.cvType);
  const shownIds = model.sections.flatMap((x) => (x.rows ?? []).map((r) => r.entryId));
  // References on the page right now, as they print (the person picks who leads; never by date).
  const refRows = model.sections.find((x) => x.key === "reference")?.rows ?? [];

  return (
    <section className="mt-6" data-testid="cv-lane" aria-label={`${ctx.lane.name} CV lane`}>
      <div className="border border-t-line bg-t-panel p-3 sm:p-4">
        <p className="text-sm text-t-white">
          <span className="font-semibold">{ctx.lane.name}</span>
          <span className="ml-2 inline-block border border-t-line px-2 text-xs uppercase text-t-phos" data-testid="cv-type">{CV_TYPE_COPY[ctx.cvType].label}</span>
        </p>
        <p className="mt-1 text-xs text-t-phos-dim">
          <span className="font-semibold text-t-phos">t.ROY:</span> Every line comes from your record, dated, newest first. Nothing gets added.
        </p>
      </div>
      {notice && <p className="mt-2 text-sm text-t-red" role="alert">{notice}</p>}
      <div className="mt-3 flex gap-1" role="tablist" aria-label="CV tools">
        {CV_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} data-testid={`cv-tab-${t.key}`} onClick={() => setTab(t.key)} className={`t-focus min-h-touch px-3 text-sm border ${tab === t.key ? "border-t-amber bg-t-panel-2 text-t-amber-bright font-semibold" : "border-t-line text-t-phos-dim hover:text-t-white"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tab === "record" && <PracticeRecordPanel entries={ctx.entries} onChanged={load} order={CV_SECTION_ORDER} />}
        {tab === "cv" && (
          <div className="space-y-5" data-testid="cv-panel">
            <fieldset className="border border-t-line bg-t-panel p-3">
              <legend className="px-1 text-sm text-t-white">Kind of CV</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {CV_TYPES.map((t) => (
                  <label key={t} className={`flex gap-2 border p-2 cursor-pointer ${ctx.cvType === t ? "border-t-amber" : "border-t-line"}`}>
                    <input
                      type="radio"
                      name="cv-kind"
                      className="mt-1"
                      checked={ctx.cvType === t}
                      data-testid={`cv-switch-${t}`}
                      onChange={async () => {
                        // Show the choice at once; the saved lane replaces it.
                        setCtx((c) => (c ? { ...c, cvType: t } : c));
                        const r = await sendJson(`/api/lanes/${laneId}`, "PATCH", { cvType: t });
                        if (r.ok) load();
                        else setNotice(r.data.message || CREATIVE_ERRORS.failed);
                      }}
                    />
                    <span>
                      <span className="block text-sm font-semibold text-t-white">{CV_TYPE_COPY[t].label}</span>
                      <span className="block text-xs text-t-phos-dim">{CV_TYPE_COPY[t].body}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <form
              className="border border-t-line bg-t-panel p-4 space-y-3"
              data-testid="cv-top"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await put({ settings: top }, (s) => ({ ...s, ...top }));
                setMsg(ok ? "Saved." : "That didn't save. Try again.");
              }}
            >
              <h3 className="text-sm font-semibold uppercase text-t-phos">Top of the page</h3>
              <p className="text-xs text-t-phos-dim">No photo, birth date, age, family status or nationality. A CV here never asks for them.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {TOP.map((f) => (
                  <label key={f.key} className="block text-sm text-t-white">
                    {f.label}
                    <input className={`${inputCls} mt-1`} value={top[f.key] ?? ""} placeholder={f.placeholder} maxLength={200} data-testid={`cv-${f.key}`} onChange={(e) => setTop((t) => ({ ...t, [f.key]: e.target.value }))} />
                  </label>
                ))}
              </div>
              <label className="block text-sm text-t-white">
                Interests, in your words (optional)
                <textarea className={`${inputCls} mt-1`} rows={2} maxLength={600} value={top.interests ?? ""} data-testid="cv-interests" onChange={(e) => setTop((t) => ({ ...t, interests: e.target.value }))} />
              </label>
              <label className="block text-sm text-t-white">
                Languages and skills, in your words (optional)
                <input className={`${inputCls} mt-1`} maxLength={300} value={top.languages ?? ""} data-testid="cv-languages" onChange={(e) => setTop((t) => ({ ...t, languages: e.target.value }))} />
              </label>
              <button type="submit" className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright" data-testid="cv-top-save">Save</button>
              <span aria-live="polite" className="ml-3 text-sm text-t-phos">{msg}</span>
            </form>

            {refRows.length >= 2 && (
              <fieldset className="border border-t-line bg-t-panel p-3" data-testid="cv-lead-reference">
                <legend className="px-1 text-sm text-t-white">Your first reference</legend>
                <p className="text-xs text-t-phos-dim">You pick who leads. A teacher, supervisor or colleague who knows your work is the strongest start.</p>
                <div className="mt-2 space-y-1">
                  {refRows.map((r) => (
                    <label key={r.entryId} className="flex gap-2 text-sm text-t-white cursor-pointer">
                      <input
                        type="radio"
                        name="cv-lead-reference"
                        checked={(ctx.settings.leadReference ?? "").toLowerCase() === r.entryId.toLowerCase()}
                        data-testid={`cv-lead-${r.entryId}`}
                        onChange={() => put({ settings: { leadReference: r.entryId } }, (s) => ({ ...s, leadReference: r.entryId.toLowerCase() }))}
                      />
                      <span>{r.parts.map((p) => p.text + (p.after ?? "")).join(" ")}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <FacilityChoices entries={ctx.entries.filter((e) => e.section !== "work")} settings={ctx.settings} onTitleMode={onTitleMode} only="pages" />

            <p className="text-xs text-t-phos-dim" data-testid="cv-length">
              {cap ? `Up to ${cap} pages, like a resume. Never padded.` : "As long as your real record. Never padded."}
              {pages ? ` Right now: ${pages} ${pages === 1 ? "page" : "pages"}.` : ""}
            </p>

            <OpenItems status={status} doc="cv" testId="cv-open-items" />

            <CreativePage
              request={{ doc: "cv", model, draft, openItems: exportOpenItemLines(status, ctx.entries, ctx.settings, "cv", shownEntryIds(model)) }}
              onPages={setPages}
              fallbackText={cvPlainText(model)}
            />

            {stillNeedsProof(ctx.entries, shownIds) > 0 && <p className="text-sm text-t-phos" data-testid="cv-needs-proof">{NEEDS_PROOF_NOTE}</p>}
            <div className="flex flex-wrap gap-2" data-testid="cv-downloads">
              {(["pdf", "docx", "txt"] as const).map((f) => (
                <a key={f} href={`/api/creative/${laneId}/export?doc=cv&format=${f}`} className="t-focus min-h-touch inline-flex items-center px-3 border border-t-line text-sm text-t-white hover:border-t-steel">
                  {draft ? "Draft " : ""}
                  {f === "pdf" ? "PDF" : f === "docx" ? "Word" : "Plain text"}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
