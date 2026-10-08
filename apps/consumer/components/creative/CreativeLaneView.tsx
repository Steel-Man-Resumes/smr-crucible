"use client";

/**
 * One creative lane: the record and every document built from it, as tabs.
 * Loads the lane's context once and reloads it after a save, so every tab
 * reads the same facts. The open items are computed with the same pure
 * checks the server and the exports use.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CareerLane } from "@crucible/core/src/careerLaneShared";
import type { PracticeEntry, TitleMode } from "@crucible/core/src/practiceRecordShared";
import { buildArtistResumeModel, buildWorkSampleList, type CreativeKindSettings } from "@crucible/core/src/creativeLaneShared";
import type { BioContent } from "@crucible/core/src/creativeBio";
import type { StatementVersion } from "@crucible/core/src/creativeStatement";
import { getCreativeStatus } from "@crucible/core/src/creativeChecks";
import type { Hurdle, HelpSource, PairPlan } from "@crucible/core/src/twoPathPlan";
import { CREATIVE_ERRORS, CREATIVE_TABS, TROY_CREATIVE_LINE, sendJson, type CreativeTab } from "@/lib/creative";
import { PracticeRecordPanel } from "./PracticeRecordPanel";
import { ArtistResumePanel } from "./ArtistResumePanel";
import { BioPanel } from "./BioPanel";
import { StatementCoach } from "./StatementCoach";
import { WorkSamplesPanel } from "./WorkSamplesPanel";
import { PlainTextPanel } from "./PlainTextPanel";
import { TwoPathsPanel } from "./TwoPathsPanel";

export interface CreativeCtx {
  lane: CareerLane;
  partner: CareerLane | null;
  entries: PracticeEntry[];
  settings: CreativeKindSettings;
  bio: BioContent;
  bioRev: number | null;
  statement: { versions: StatementVersion[] };
  statementRev: number | null;
  sampleOrder: string[];
  sampleRev: number | null;
  plan: null | {
    plan: PairPlan;
    goalFromLane: string | null;
    realisticAim: string | null;
    hurdles: Hurdle[];
    notAVerdict: string;
    help: HelpSource[];
  };
}

export function CreativeLaneView({
  laneId,
  allLanes,
  startTab,
  onLanesChanged,
  onAdoptLane,
}: {
  laneId: string;
  allLanes: CareerLane[];
  startTab: CreativeTab | null;
  onLanesChanged: () => void;
  onAdoptLane: (lane: CareerLane) => void;
}) {
  const [ctx, setCtx] = useState<CreativeCtx | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<CreativeTab>(startTab ?? "record");
  const [pages, setPages] = useState<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/creative/${laneId}`);
      if (!res.ok) throw new Error(String(res.status));
      setCtx((await res.json()) as CreativeCtx);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [laneId]);

  useEffect(() => {
    load();
  }, [load]);

  // The settings revision the screen holds; every save is based on it.
  const revRef = useRef(0);
  useEffect(() => {
    revRef.current = Number(ctx?.settings.rev ?? 0);
  }, [ctx]);
  const [notice, setNotice] = useState("");

  const putSettings = useCallback(
    async (body: Record<string, unknown>, optimistic: (s: CreativeKindSettings) => CreativeKindSettings) => {
      setCtx((c) => (c ? { ...c, settings: optimistic(c.settings) } : c));
      const r = await sendJson<{ settings?: CreativeKindSettings }>(`/api/creative/${laneId}`, "PUT", { ...body, rev: revRef.current });
      if (r.ok && r.data.settings) {
        revRef.current = Number(r.data.settings.rev ?? 0);
        setCtx((c) => (c ? { ...c, settings: r.data.settings as CreativeKindSettings } : c));
        setNotice("");
      } else {
        // Changed elsewhere (or refused): show what is really saved, and say so.
        setNotice(r.data.message || CREATIVE_ERRORS.failed);
        load();
      }
      return r.ok;
    },
    [laneId, load]
  );

  const saveSettings = useCallback(
    (patch: Partial<CreativeKindSettings>) =>
      putSettings({ settings: patch }, (cur) => {
        const next: CreativeKindSettings = { ...cur, ...patch };
        if (patch.selection === null) delete next.selection;
        return next;
      }),
    [putSettings]
  );

  /** One facility choice for one entry (never a whole map). */
  const saveTitleMode = useCallback(
    (entryId: string, mode: TitleMode) =>
      putSettings({ titleMode: { entryId, mode } }, (cur) => ({ ...cur, titleModes: { ...(cur.titleModes ?? {}), [entryId]: mode } })),
    [putSettings]
  );

  const model = useMemo(() => (ctx ? buildArtistResumeModel(ctx.entries, ctx.settings) : null), [ctx]);
  const samples = useMemo(() => (ctx ? buildWorkSampleList(ctx.entries, ctx.sampleOrder, ctx.settings) : []), [ctx]);
  const status = useMemo(
    () =>
      ctx && model
        ? getCreativeStatus({
            entries: ctx.entries,
            settings: ctx.settings,
            artistResume: { model, pages },
            bio: ctx.bio,
            statement: { versions: ctx.statement.versions, modelPrints: [] },
            workSamples: samples,
          })
        : null,
    [ctx, model, pages, samples]
  );

  if (failed && !ctx) return <p className="mt-6 text-sm text-t-red" role="alert">{CREATIVE_ERRORS.loadFailed}</p>;
  if (!ctx || !model || !status) return <div className="mt-6 h-40 border border-t-line bg-t-panel" aria-hidden="true" />;

  return (
    <section className="mt-6" data-testid="creative-lane" aria-label={`${ctx.lane.name} creative lane`}>
      <div className="border border-t-line bg-t-panel p-3 sm:p-4">
        <p className="text-sm text-t-white">
          <span className="font-semibold">{ctx.lane.name}</span>
          {ctx.lane.target_role ? <span className="text-t-phos-dim">. {ctx.lane.target_role}</span> : null}
          {ctx.lane.path ? (
            <span className="ml-2 inline-block border border-t-line px-2 text-xs uppercase text-t-phos" data-testid="creative-path">
              {ctx.lane.path === "dream" ? "Dream" : "Realistic"}
            </span>
          ) : null}
        </p>
        <p className="mt-1 text-xs text-t-phos-dim">
          <span className="font-semibold text-t-phos">t.ROY:</span> {TROY_CREATIVE_LINE}
        </p>
      </div>

      {notice && (
        <p className="mt-2 text-sm text-t-red" role="alert" data-testid="creative-notice">
          {notice}
        </p>
      )}

      <nav aria-label="Creative lane tools" className="mt-3 -mx-4 overflow-x-auto px-4">
        <ul className="flex gap-1 min-w-max" role="tablist">
          {CREATIVE_TABS.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                data-testid={`creative-tab-${t.key}`}
                onClick={() => setTab(t.key)}
                className={`t-focus min-h-touch px-3 text-sm border ${
                  tab === t.key ? "border-t-amber bg-t-panel-2 text-t-amber-bright font-semibold" : "border-t-line text-t-phos-dim hover:text-t-white"
                }`}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-4" role="tabpanel">
        {tab === "record" && <PracticeRecordPanel entries={ctx.entries} onChanged={load} />}
        {tab === "resume" && (
          <ArtistResumePanel
            laneId={laneId}
            entries={ctx.entries}
            settings={ctx.settings}
            model={model}
            status={status}
            onSettings={saveSettings}
            onTitleMode={saveTitleMode}
            onPages={setPages}
          />
        )}
        {tab === "bio" && <BioPanel laneId={laneId} ctx={ctx} onSettings={saveSettings} onTitleMode={saveTitleMode} onSaved={load} />}
        {tab === "statement" && <StatementCoach laneId={laneId} statement={ctx.statement} rev={ctx.statementRev} onSaved={load} />}
        {tab === "samples" && (
          <WorkSamplesPanel laneId={laneId} ctx={ctx} rows={samples} status={status} onTitleMode={saveTitleMode} onSaved={load} />
        )}
        {tab === "text" && <PlainTextPanel ctx={ctx} model={model} samples={samples} status={status} />}
        {tab === "plan" && (
          <TwoPathsPanel
            key={ctx.partner?.id ?? "unpaired"}
            ctx={ctx}
            allLanes={allLanes}
            onChanged={async () => {
              onLanesChanged();
              await load();
            }}
            onAdoptLane={onAdoptLane}
          />
        )}
      </div>
    </section>
  );
}
