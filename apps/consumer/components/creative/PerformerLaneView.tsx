"use client";

/**
 * One performer lane: the record and the one-page performer resume built from
 * it, on 8x10 (for the back of a headshot) and US Letter. Loads the lane's
 * context and computes the page and its open items with the same pure
 * functions the server and the export use. Nothing here writes a line for the
 * person, and no photo is made, picked or changed: the headshot stays off the
 * page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CareerLane } from "@crucible/core/src/careerLaneShared";
import type { PracticeEntry, TitleMode } from "@crucible/core/src/practiceRecordShared";
import { MAX_SKILLS, SKILL_MAX, applyPhraseAnswer, stillNeedsProof, NEEDS_PROOF_NOTE, type CreativeKindSettings, type PerformerSkill } from "@crucible/core/src/creativeLaneShared";
import { buildPerformerModel, performerPlainText, performerShownIds, PERFORMER_SECTIONS } from "@crucible/core/src/performerShared";
import { getPerformerStatus } from "@crucible/core/src/performerChecks";
import { exportOpenItemLines } from "@crucible/core/src/creativeChecks";
import { CREATIVE_ERRORS, PERFORMER_TABS, sendJson, type PerformerTab } from "@/lib/creative";
import { PracticeRecordPanel, PERFORMER_SECTION_ORDER } from "./PracticeRecordPanel";
import { FacilityChoices } from "./FacilityChoices";
import { OpenItems, OpenItemAnswersContext, type OpenItemAnswers } from "./OpenItems";
import { CreativePage } from "./CreativePage";
import { TwoPathsPanel } from "./TwoPathsPanel";
import type { CreativeCtx } from "./CreativeLaneView";

interface PerformerCtx {
  lane: CareerLane;
  partner: CareerLane | null;
  plan: CreativeCtx["plan"];
  entries: PracticeEntry[];
  settings: CreativeKindSettings;
}

const inputCls =
  "t-focus w-full min-h-touch bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white focus:border-t-steel focus:outline-none";

const TOP: { key: keyof CreativeKindSettings; label: string; placeholder: string; max: number }[] = [
  { key: "displayName", label: "Your name, as you work under it", placeholder: "Ray Example", max: 120 },
  { key: "discipline", label: "What you do", placeholder: "Actor / Singer", max: 120 },
  { key: "agent", label: "Agent or manager (optional, as they want it listed)", placeholder: "", max: 200 },
  { key: "basedIn", label: "Where you're based (optional)", placeholder: "Chicago, IL", max: 120 },
  { key: "email", label: "Email", placeholder: "you@example.com", max: 160 },
  { key: "phone", label: "Phone (optional)", placeholder: "", max: 40 },
  { key: "website", label: "Website or reel (optional)", placeholder: "", max: 200 },
];
const LOOK: { key: keyof CreativeKindSettings; label: string; placeholder: string; max: number }[] = [
  { key: "height", label: "Height", placeholder: "5'10\"", max: 40 },
  { key: "hair", label: "Hair", placeholder: "Brown", max: 40 },
  { key: "eyes", label: "Eyes", placeholder: "Green", max: 40 },
  { key: "voice", label: "Voice or vocal range (optional)", placeholder: "Baritone", max: 80 },
  { key: "ageRange", label: "Age range you play (like 25-35). Never your age.", placeholder: "25-35", max: 20 },
];
const TEXT_KEYS = [...TOP, ...LOOK].map((f) => f.key as string);

export function PerformerLaneView({ laneId, allLanes, onAdoptLane, onLanesChanged }: { laneId: string; allLanes: CareerLane[]; onAdoptLane: (l: CareerLane) => void; onLanesChanged: () => Promise<void> }) {
  const [ctx, setCtx] = useState<PerformerCtx | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<PerformerTab>("record");
  const [trim, setTrim] = useState<"8x10" | "letter">("8x10");
  const [pages, setPages] = useState<number | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [msg, setMsg] = useState("");
  const [top, setTop] = useState<Record<string, string>>({});
  const [newSkill, setNewSkill] = useState("");
  const revRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/creative/${laneId}`);
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as PerformerCtx;
      setCtx(d);
      revRef.current = Number(d.settings.rev ?? 0);
      setTop(Object.fromEntries(TEXT_KEYS.map((k) => [k, ((d.settings as Record<string, unknown>)[k] as string) ?? ""])));
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
  const saveSkills = (skills: PerformerSkill[]) => put({ settings: { skills } }, (s) => ({ ...s, skills }));

  // One-tap answers (review s2r3), as on the CV and creative screens: does a
  // phrase name the place this lane keeps off. A performer page has no
  // references, so there is never an officer question here.
  const answers = useMemo<OpenItemAnswers>(
    () => ({
      onFacilityWord: (phrase, yes) =>
        put({ phraseAnswer: { phrase, answer: yes ? "yes" : "no" } }, (s) => applyPhraseAnswer(s, phrase, yes ? "yes" : "no") ?? s),
      onOfficer: async () => false,
    }),
    [put]
  );

  const model = useMemo(() => (ctx ? buildPerformerModel(ctx.entries, ctx.settings) : null), [ctx]);
  const status = useMemo(() => (ctx && model ? getPerformerStatus({ entries: ctx.entries, settings: ctx.settings, model, pages }) : null), [ctx, model, pages]);

  if (failed && !ctx) return <p className="mt-6 text-sm text-t-red" role="alert">{CREATIVE_ERRORS.loadFailed}</p>;
  if (!ctx || !model || !status) return <div className="mt-6 h-40 border border-t-line bg-t-panel" aria-hidden="true" />;
  const draft = status.blockCount > 0;
  const skills = ctx.settings.skills ?? [];
  const pageEntries = ctx.entries.filter((e) => PERFORMER_SECTIONS.includes(e.section));
  const pickable = pageEntries.filter((e) => e.section !== "union");
  const picked = Array.isArray(ctx.settings.selection) ? new Set(ctx.settings.selection.map((x) => x.toLowerCase())) : null;
  const shownIds = performerShownIds(model);

  return (
    <OpenItemAnswersContext.Provider value={answers}>
    <section className="mt-6" data-testid="performer-lane" aria-label={`${ctx.lane.name} performer lane`}>
      <div className="border border-t-line bg-t-panel p-3 sm:p-4">
        <p className="text-sm text-t-white">
          <span className="font-semibold">{ctx.lane.name}</span>
          <span className="ml-2 inline-block border border-t-line px-2 text-xs uppercase text-t-phos">Performer</span>
          {ctx.lane.path && <span className="ml-2 inline-block border border-t-line px-2 text-xs uppercase text-t-phos-dim">{ctx.lane.path === "dream" ? "Dream" : "Now"}</span>}
        </p>
        <p className="mt-1 text-xs text-t-phos-dim">
          <span className="font-semibold text-t-phos">t.ROY:</span> One page, built from your record. Roles and billing exactly as credited. Nothing gets added.
        </p>
      </div>
      {notice && <p className="mt-2 text-sm text-t-red" role="alert">{notice}</p>}
      <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Performer tools">
        {PERFORMER_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} data-testid={`performer-tab-${t.key}`} onClick={() => setTab(t.key)} className={`t-focus min-h-touch px-3 text-sm border ${tab === t.key ? "border-t-amber bg-t-panel-2 text-t-amber-bright font-semibold" : "border-t-line text-t-phos-dim hover:text-t-white"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tab === "record" && <PracticeRecordPanel entries={ctx.entries} onChanged={load} order={PERFORMER_SECTION_ORDER} />}
        {tab === "plan" && (
          <TwoPathsPanel
            ctx={{ lane: ctx.lane, partner: ctx.partner, plan: ctx.plan }}
            allLanes={allLanes}
            onChanged={async () => {
              await onLanesChanged();
              await load();
            }}
            onAdoptLane={onAdoptLane}
          />
        )}
        {tab === "page" && (
          <div className="space-y-5" data-testid="performer-panel">
            <form
              className="border border-t-line bg-t-panel p-4 space-y-3"
              data-testid="performer-top"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await put({ settings: top }, (s) => ({ ...s, ...top }));
                setMsg(ok ? "Saved." : "That didn't save. Try again.");
              }}
            >
              <h3 className="text-sm font-semibold uppercase text-t-phos">Top of the page</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {TOP.map((f) => (
                  <label key={f.key} className="block text-sm text-t-white">
                    {f.label}
                    <input className={`${inputCls} mt-1`} value={top[f.key] ?? ""} placeholder={f.placeholder} maxLength={f.max} data-testid={`performer-${f.key}`} onChange={(e) => setTop((t) => ({ ...t, [f.key]: e.target.value }))} />
                  </label>
                ))}
              </div>
              <h3 className="pt-2 text-sm font-semibold uppercase text-t-phos">How you look and sound</h3>
              <p className="text-xs text-t-phos-dim">Only what you want casting to see. No weight, no birth date, no age: a range you play, if you want one.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {LOOK.map((f) => (
                  <label key={f.key} className="block text-sm text-t-white">
                    {f.label}
                    <input className={`${inputCls} mt-1`} value={top[f.key] ?? ""} placeholder={f.placeholder} maxLength={f.max} data-testid={`performer-${f.key}`} onChange={(e) => setTop((t) => ({ ...t, [f.key]: e.target.value }))} />
                  </label>
                ))}
              </div>
              <button type="submit" className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright" data-testid="performer-top-save">Save</button>
              <span aria-live="polite" className="ml-3 text-sm text-t-phos">{msg}</span>
            </form>

            <fieldset className="border border-t-line bg-t-panel p-4 space-y-2" data-testid="performer-skills">
              <legend className="px-1 text-sm text-t-white">Special skills</legend>
              <p className="text-xs text-t-phos-dim">Casting can ask you to show any of these on the spot. Only the ones you tick go on the page.</p>
              {skills.map((sk, i) => (
                <div key={`${sk.text}-${i}`} className="flex flex-wrap items-center gap-2 border border-t-line p-2">
                  <span className="min-w-0 flex-1 break-words text-sm text-t-white">{sk.text}</span>
                  <label className="flex min-h-touch items-center gap-2 text-xs text-t-phos">
                    <input type="checkbox" checked={sk.confirmed} data-testid={`performer-skill-ok-${i}`} onChange={(e) => saveSkills(skills.map((x, j) => (j === i ? { ...x, confirmed: e.target.checked } : x)))} />
                    I can do this on request today
                  </label>
                  <button type="button" className="t-focus min-h-touch px-2 text-xs text-t-phos-dim underline" aria-label={`Remove ${sk.text}`} onClick={() => saveSkills(skills.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              ))}
              {skills.length < MAX_SKILLS && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input className={inputCls} value={newSkill} maxLength={SKILL_MAX} placeholder="Stage combat" data-testid="performer-skill-new" onChange={(e) => setNewSkill(e.target.value)} />
                  <button
                    type="button"
                    className="t-focus min-h-touch px-4 border border-t-line text-sm text-t-white hover:border-t-steel"
                    data-testid="performer-skill-add"
                    onClick={() => {
                      const t = newSkill.trim();
                      if (!t) return;
                      saveSkills([...skills, { text: t, confirmed: false }]);
                      setNewSkill("");
                    }}
                  >
                    Add skill
                  </button>
                </div>
              )}
            </fieldset>

            <label className="flex min-h-touch items-center gap-2 border border-t-line bg-t-panel p-3 text-sm text-t-white">
              <input type="checkbox" checked={ctx.settings.showYears === true} data-testid="performer-show-years" onChange={(e) => put({ settings: { showYears: e.target.checked } }, (s) => ({ ...s, showYears: e.target.checked }))} />
              Show the year on each credit. Your training always shows its years.
            </label>

            {pickable.length > 0 && (
              <fieldset className="border border-t-line bg-t-panel p-3" data-testid="performer-selection">
                <legend className="px-1 text-sm text-t-white">What goes on this page</legend>
                <p className="text-xs text-t-phos-dim">One page, always. If it runs over, untick what you can leave off. Everything stays in your record.</p>
                <div className="mt-2 space-y-1">
                  {pickable.map((e) => {
                    const on = !picked || picked.has(e.id.toLowerCase());
                    return (
                      <label key={e.id} className="flex min-h-touch items-center gap-2 text-sm text-t-white">
                        <input
                          type="checkbox"
                          checked={on}
                          data-testid={`performer-pick-${e.id}`}
                          onChange={(ev) => {
                            const cur = picked ?? new Set(pickable.map((x) => x.id.toLowerCase()));
                            const next = new Set(cur);
                            if (ev.target.checked) next.add(e.id.toLowerCase());
                            else next.delete(e.id.toLowerCase());
                            const all = pickable.every((x) => next.has(x.id.toLowerCase()));
                            const selection = all ? null : [...next];
                            put({ settings: { selection } }, (s) => ({ ...s, selection }));
                          }}
                        />
                        <span className="min-w-0 break-words">{e.title}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}

            <FacilityChoices entries={pageEntries} settings={ctx.settings} onTitleMode={onTitleMode} only="pages" />

            <OpenItems status={status} doc="performer" testId="performer-open-items" />

            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Page size">
              <span className="text-xs text-t-phos-dim">Preview:</span>
              {(["8x10", "letter"] as const).map((t) => (
                <button key={t} type="button" aria-pressed={trim === t} data-testid={`performer-trim-${t}`} onClick={() => setTrim(t)} className={`t-focus min-h-touch px-3 text-sm border ${trim === t ? "border-t-amber text-t-amber-bright" : "border-t-line text-t-phos-dim"}`}>
                  {t === "8x10" ? "8x10 (headshot back)" : "US Letter"}
                </button>
              ))}
            </div>
            <CreativePage
              key={trim}
              request={{ doc: "performer", model, trim, draft, openItems: exportOpenItemLines(status, ctx.entries, ctx.settings, "performer", shownIds) }}
              // The one-page rule counts the 8x10 page (if it fits, Letter fits).
              onPages={(n) => {
                if (trim === "8x10") setPages(n);
              }}
              fallbackText={performerPlainText(model)}
            />

            {stillNeedsProof(ctx.entries, shownIds) > 0 && <p className="text-sm text-t-phos" data-testid="performer-needs-proof">{NEEDS_PROOF_NOTE}</p>}
            <div className="flex flex-wrap gap-2" data-testid="performer-downloads">
              {(
                [
                  ["pdf", "8x10", "PDF 8x10"],
                  ["pdf", "letter", "PDF Letter"],
                  ["docx", "8x10", "Word 8x10"],
                  ["docx", "letter", "Word Letter"],
                  ["html", "letter", "Web page"],
                  ["txt", "letter", "Plain text"],
                ] as const
              ).map(([f, size, label]) => (
                <a key={`${f}-${size}`} href={`/api/creative/${laneId}/export?doc=performer&format=${f}&size=${size}`} className="t-focus min-h-touch inline-flex items-center px-3 border border-t-line text-sm text-t-white hover:border-t-steel">
                  {draft ? "Draft " : ""}
                  {label}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
    </OpenItemAnswersContext.Provider>
  );
}
