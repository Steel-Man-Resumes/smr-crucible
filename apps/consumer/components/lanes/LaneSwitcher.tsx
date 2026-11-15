"use client";

/**
 * The lane switcher at the top of the resume tools (the Tailor and the
 * Library). Shows which lane the tool is working in, switches lanes, adds a
 * lane, and opens one lane's settings: name, the kind of job, format (with
 * the plain explainer) and length. Archive, never delete; archived lanes can
 * be brought back.
 */

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LANE_GOAL_PRESETS, laneToolHref } from "@/lib/lane-goals";
import type { CareerLane, LaneLength, CvType } from "@crucible/core/src/careerLaneShared";
import { CV_TYPES, LANE_LENGTHS, MAIN_LANE_KEY, laneKindOf } from "@crucible/core/src/careerLaneShared";
import { MAIN_LANE_LABEL } from "@/lib/lanes";
import type { LanesApi } from "./useLanes";

type Panel = null | "new" | "edit";

async function send(url: string, method: "POST" | "PATCH", body: unknown, failedMessage: string): Promise<{ ok: true; lane: CareerLane } | { ok: false; message: string }> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.lane) return { ok: true, lane: d.lane };
    return { ok: false, message: d.message || failedMessage };
  } catch {
    return { ok: false, message: failedMessage };
  }
}

export function LaneSwitcher({
  lanes: api,
  value,
  onChange,
  includeAll = false,
  label,
}: {
  lanes: LanesApi;
  /** The lane shown: a lane id, "main", or "all" when includeAll. */
  value: string;
  onChange: (choice: string) => void;
  includeAll?: boolean;
  label?: string;
}) {
  const t = useTranslations("refineryResume.lanes");
  const router = useRouter();
  const selectId = useId();
  const [panel, setPanel] = useState<Panel>(null);
  const [openingLane, setOpeningLane] = useState<CareerLane | null>(null);
  const shownLane = api.lanes.find((l) => l.id === value) ?? null;
  useEffect(() => {
    if (!openingLane || api.switching || api.error || api.active !== openingLane.id) return;
    const href = laneToolHref(laneKindOf(openingLane), openingLane.id);
    if (href) router.push(href);
    setOpeningLane(null);
  }, [openingLane, api.switching, api.error, api.active, router]);

  if (!api.loaded) {
    return <div className="h-12 border border-t-line bg-t-panel" aria-hidden="true" />;
  }

  return (
    <section data-testid="lane-switcher" aria-label={t("switcher.ariaLanes")} className="border border-t-line bg-t-panel p-3 sm:p-4">
      {api.error && <p role="alert" className="mb-2 text-sm text-t-red">{api.error} <button type="button" onClick={() => void api.refresh()} className="underline">{t("switcher.reload")}</button></p>}
      {openingLane && <p role="status" className="mb-2 text-sm text-t-phos-dim">{api.error ? <>{t("switcher.created")} <button type="button" onClick={() => void api.setActive(openingLane.id)} className="t-focus min-h-touch text-t-amber-bright underline">{t("switcher.tryAgain")}</button></> : t("switcher.opening")}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2">
        <label htmlFor={selectId} className="shrink-0 text-xs font-mono uppercase tracking-wide text-t-phos-dim">
          {label ?? t("switcher.workingIn")}
        </label>
        <select
          id={selectId}
          data-testid="lane-select"
          disabled={api.switching}
          value={value}
          onChange={(e) => {
            setPanel(null);
            onChange(e.target.value);
          }}
          className="t-focus min-h-touch min-w-0 w-full flex-1 sm:max-w-xs bg-t-bg border border-t-line px-2 py-1 text-sm font-semibold text-t-white focus:border-t-steel focus:outline-none"
        >
          {includeAll && <option value="all">{t("switcher.allLanes")}</option>}
          {api.lanes.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          <option value={MAIN_LANE_KEY}>{MAIN_LANE_LABEL === "Main" ? t("switcher.main") : MAIN_LANE_LABEL}</option>
        </select>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="lane-new"
            onClick={() => setPanel(panel === "new" ? null : "new")}
            aria-expanded={panel === "new"}
            className="t-focus min-h-touch flex-1 sm:flex-none px-3 text-sm font-medium text-t-amber-bright hover:text-t-amber border border-t-line"
          >
            {t("switcher.newLane")}
          </button>
          {shownLane && (
            <button
              type="button"
              data-testid="lane-settings"
              onClick={() => setPanel(panel === "edit" ? null : "edit")}
              aria-expanded={panel === "edit"}
              className="t-focus min-h-touch flex-1 sm:flex-none px-3 text-sm font-medium text-t-phos hover:text-t-white border border-t-line"
            >
              {t("switcher.settings")}
            </button>
          )}
        </div>
      </div>

      {shownLane && panel !== "edit" && (
        <p className="mt-2 text-xs text-t-phos-dim" data-testid="lane-summary">
          {shownLane.target_role ? `${t("switcher.aiming", { role: shownLane.target_role })} ` : ""}
          {laneKindOf(shownLane) === "resume" ? t("switcher.formatSummary", { format: shownLane.format === "hybrid" ? t("switcher.hybridSaved") : t("editForm.formatChrono.label"), length: t(`length.${shownLane.length_pref}.label`) }) : t("switcher.laneSummary", { kind: ((preset) => (preset ? t(`goal.${preset.id}.label`) : t("switcher.documents")))(LANE_GOAL_PRESETS.find((goal) => goal.kind === laneKindOf(shownLane))) })}
        </p>
      )}

      {panel === "new" && (
        <NewLaneForm
          onCancel={() => setPanel(null)}
          onCreated={(lane) => {
            setPanel(null);
            api.adoptLane(lane);
            const toolHref = laneToolHref(lane.kind || "resume", lane.id);
            if (toolHref) setOpeningLane(lane);
            else onChange(lane.id);
          }}
        />
      )}
      {panel === "edit" && shownLane && (
        <EditLaneForm
          lane={shownLane}
          onCancel={() => setPanel(null)}
          onSaved={() => {
            setPanel(null);
            api.refresh();
          }}
          onArchived={() => {
            setPanel(null);
            onChange(includeAll ? "all" : MAIN_LANE_KEY);
            api.refresh();
          }}
        />
      )}

      {api.archived.length > 0 && (
        <details className="mt-3 text-xs" data-testid="lane-archived">
          <summary className="cursor-pointer text-t-phos-dim hover:text-t-white">
            {t("switcher.archived", { count: api.archived.length })}
          </summary>
          <ul className="mt-2 space-y-1">
            {api.archived.map((l) => (
              <ArchivedRow key={l.id} lane={l} onBack={() => api.refresh()} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ArchivedRow({ lane, onBack }: { lane: CareerLane; onBack: () => void }) {
  const t = useTranslations("refineryResume.lanes");
  const [msg, setMsg] = useState("");
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="text-t-phos">{lane.name}</span>
      <button
        type="button"
        aria-label={t("switcher.bringBackAria", { name: lane.name })}
        className="t-focus text-t-steel hover:text-t-white underline"
        onClick={async () => {
          const r = await send(`/api/lanes/${lane.id}`, "PATCH", { archived: false }, t("switcher.failed"));
          if (r.ok) onBack();
          else setMsg(r.message);
        }}
      >
        {t("switcher.bringBack")}
      </button>
      {msg && <span className="text-t-red" role="alert">{msg}</span>}
    </li>
  );
}

const inputCls =
  "t-focus w-full min-h-touch bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white focus:border-t-steel focus:outline-none";

function NewLaneForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (lane: CareerLane) => void }) {
  const t = useTranslations("refineryResume.lanes");
  const [goalId, setGoalId] = useState("employment");
  const goal = LANE_GOAL_PRESETS.find((preset) => preset.id === goalId) || LANE_GOAL_PRESETS[0];
  const [cvType, setCvType] = useState<CvType>("academic");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      data-testid="lane-new-form"
      className="mt-3 space-y-3 border-t border-t-line pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        const r = await send("/api/lanes", "POST", { name: name.trim() || goal.name, targetRole: target, kind: goal.kind, ...(goal.kind === "cv" ? { cvType } : {}) }, t("switcher.failed"));
        setBusy(false);
        if (r.ok) onCreated(r.lane);
        else setError(r.message);
      }}
    >
      <h3 className="font-semibold text-t-white">{t("newForm.title")}</h3>
      <p className="text-sm text-t-phos">{t("newForm.intro")}</p>
      <label className="block text-sm text-t-white">
        {t("newForm.goal")}
        <select className={`${inputCls} mt-1`} value={goalId} onChange={(e) => setGoalId(e.target.value)} disabled={busy} data-testid="lane-goal">
          {LANE_GOAL_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{t(`goal.${preset.id}.label`)}</option>)}
        </select>
      </label>
      <p className="text-sm text-t-phos-dim" data-testid="lane-goal-description">{t(`goal.${goal.id}.description`)}</p>
      {goal.kind === "cv" && <label className="block text-sm text-t-white">
        {t("newForm.cvType")}
        <select className={`${inputCls} mt-1`} value={cvType} onChange={(e) => setCvType(e.target.value as CvType)} disabled={busy}>
          {CV_TYPES.map((type) => <option key={type} value={type}>{t(`cvType.${type}`)}</option>)}
        </select>
      </label>}
      <label className="block text-sm text-t-white">
        {t("newForm.aiming")} <span className="text-t-phos-dim">{t("newForm.optional")}</span>
        <input className={`${inputCls} mt-1`} value={target} maxLength={200} placeholder={t(`goal.${goal.id}.example`)} onChange={(e) => setTarget(e.target.value)} disabled={busy} />
      </label>
      <label className="block text-sm text-t-white">
        {t("newForm.laneName")}
        <input className={`${inputCls} mt-1`} value={name} maxLength={60} placeholder={t(`goal.${goal.id}.name`)} onChange={(e) => setName(e.target.value)} disabled={busy} />
        <span className="mt-1 block text-xs text-t-phos-dim">{t("newForm.leaveBlank", { name: t(`goal.${goal.id}.name`) })}</span>
      </label>
      <p className="text-xs text-t-phos-dim">{t("newForm.caregiving")}</p>
      {error && <p className="text-sm text-t-red" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright disabled:opacity-50">
          {busy ? t("newForm.saving") : t("newForm.create")}
        </button>
        <button type="button" onClick={onCancel} className="t-focus min-h-touch px-3 text-sm text-t-phos-dim hover:text-t-white">
          {t("newForm.cancel")}
        </button>
      </div>
    </form>
  );
}

function EditLaneForm({
  lane,
  onCancel,
  onSaved,
  onArchived,
}: {
  lane: CareerLane;
  onCancel: () => void;
  onSaved: () => void;
  onArchived: () => void;
}) {
  const t = useTranslations("refineryResume.lanes");
  const [name, setName] = useState(lane.name);
  const [target, setTarget] = useState(lane.target_role ?? "");
  const [length, setLength] = useState<LaneLength>(lane.length_pref);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const resumeLane = laneKindOf(lane) === "resume";
  const documentHref = laneToolHref(laneKindOf(lane), lane.id);

  return (
    <form
      data-testid="lane-edit-form"
      className="mt-3 space-y-4 border-t border-t-line pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        // Format is not sent: the stored value (and any hybrid answers) stays
        // as it is until the hybrid layout can actually be rendered.
        const r = await send(`/api/lanes/${lane.id}`, "PATCH", {
          name,
          targetRole: target,
          ...(resumeLane ? { lengthPref: length } : {}),
        }, t("switcher.failed"));
        setBusy(false);
        if (r.ok) onSaved();
        else setError(r.message);
      }}
    >
      <label className="block text-sm text-t-white">
        {t("editForm.laneName")}
        <input className={`${inputCls} mt-1`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="block text-sm text-t-white">
        {t("editForm.aiming")}
        <input className={`${inputCls} mt-1`} value={target} maxLength={200} onChange={(e) => setTarget(e.target.value)} />
      </label>

      {resumeLane ? <>
      <section className="space-y-2" data-testid="lane-format" aria-labelledby="lane-format-heading">
        <h3 id="lane-format-heading" className="text-sm font-semibold text-t-white">{t("editForm.formatTitle")}</h3>
        <div className="border border-t-line p-3">
          <span className="block text-sm font-semibold text-t-white">{t("editForm.formatChrono.label")}</span>
          <span className="block text-xs text-t-phos-dim">{t("editForm.formatChrono.body")}</span>
        </div>
        <p className="text-xs text-t-phos-dim" data-testid="lane-hybrid-coming">{t("editForm.hybridComing")}</p>
        <p className="text-xs text-t-phos-dim">{t("editForm.noFunctional")}</p>
      </section>

      <fieldset className="space-y-2" data-testid="lane-length">
        <legend className="text-sm font-semibold text-t-white">{t("editForm.length")}</legend>
        {LANE_LENGTHS.map((l) => (
          <label key={l} className="flex gap-3 border border-t-line p-3 cursor-pointer">
            <input type="radio" name="lane-length" value={l} checked={length === l} onChange={() => setLength(l)} className="mt-1" />
            <span>
              <span className="block text-sm font-semibold text-t-white">{t(`length.${l}.label`)}</span>
              <span className="block text-xs text-t-phos-dim">{t(`length.${l}.body`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      </> : documentHref ? <p className="text-sm text-t-phos-dim">{t.rich("editForm.docsIn", { link: (chunks) => <Link href={documentHref} className="t-focus text-t-amber-bright underline underline-offset-2">{chunks}</Link> })}</p> : null}

      {error && <p className="text-sm text-t-red" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright disabled:opacity-50">
          {busy ? t("editForm.saving") : t("editForm.save")}
        </button>
        <button type="button" onClick={onCancel} className="t-focus min-h-touch px-3 text-sm text-t-phos-dim hover:text-t-white">
          {t("editForm.cancel")}
        </button>
      </div>

      <div className="border-t border-t-line pt-3">
        {confirmArchive ? (
          <div className="space-y-2">
            <p className="text-sm text-t-phos">{t("editForm.archiveAsk")}</p>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="lane-archive-confirm"
                className="t-focus min-h-touch px-3 text-sm font-medium border border-t-line text-t-white"
                onClick={async () => {
                  const r = await send(`/api/lanes/${lane.id}`, "PATCH", { archived: true }, t("switcher.failed"));
                  if (r.ok) onArchived();
                  else setError(r.message);
                }}
              >
                {t("editForm.archiveIt")}
              </button>
              <button type="button" onClick={() => setConfirmArchive(false)} className="t-focus min-h-touch px-3 text-sm text-t-phos-dim">
                {t("editForm.keepIt")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" data-testid="lane-archive" onClick={() => setConfirmArchive(true)} className="t-focus text-sm text-t-phos-dim hover:text-t-white underline">
            {t("editForm.archive")}
          </button>
        )}
      </div>
    </form>
  );
}
