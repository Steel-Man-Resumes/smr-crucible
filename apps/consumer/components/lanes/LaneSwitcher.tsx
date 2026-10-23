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
import { LANE_GOAL_PRESETS, laneToolHref } from "@/lib/lane-goals";
import { CV_TYPE_COPY } from "@crucible/core/src/cvShared";
import type { CareerLane, LaneLength, CvType } from "@crucible/core/src/careerLaneShared";
import { CV_TYPES, LANE_LENGTHS, MAIN_LANE_KEY, laneKindOf } from "@crucible/core/src/careerLaneShared";
import {
  FACTS_CARRY_COPY,
  FORMAT_COPY,
  HYBRID_COMING_COPY,
  formatSummaryLabel,
  LANE_ERROR_COPY,
  LENGTH_COPY,
  MAIN_LANE_LABEL,
  NO_FUNCTIONAL_COPY,
} from "@/lib/lanes";
import type { LanesApi } from "./useLanes";

type Panel = null | "new" | "edit";

async function send(url: string, method: "POST" | "PATCH", body: unknown): Promise<{ ok: true; lane: CareerLane } | { ok: false; message: string }> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.lane) return { ok: true, lane: d.lane };
    return { ok: false, message: d.message || LANE_ERROR_COPY.failed };
  } catch {
    return { ok: false, message: LANE_ERROR_COPY.failed };
  }
}

export function LaneSwitcher({
  lanes: api,
  value,
  onChange,
  includeAll = false,
  label = "Working in",
}: {
  lanes: LanesApi;
  /** The lane shown: a lane id, "main", or "all" when includeAll. */
  value: string;
  onChange: (choice: string) => void;
  includeAll?: boolean;
  label?: string;
}) {
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
    <section data-testid="lane-switcher" aria-label="Career lanes" className="border border-t-line bg-t-panel p-3 sm:p-4">
      {api.error && <p role="alert" className="mb-2 text-sm text-t-red">{api.error} <button type="button" onClick={() => void api.refresh()} className="underline">Reload</button></p>}
      {openingLane && <p role="status" className="mb-2 text-sm text-t-phos-dim">{api.error ? <>The lane was created. <button type="button" onClick={() => void api.setActive(openingLane.id)} className="t-focus min-h-touch text-t-amber-bright underline">Try opening it again</button></> : "Opening your lane..."}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2">
        <label htmlFor={selectId} className="shrink-0 text-xs font-mono uppercase tracking-wide text-t-phos-dim">
          {label}
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
          {includeAll && <option value="all">All lanes</option>}
          {api.lanes.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          <option value={MAIN_LANE_KEY}>{MAIN_LANE_LABEL}</option>
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
            New lane
          </button>
          {shownLane && (
            <button
              type="button"
              data-testid="lane-settings"
              onClick={() => setPanel(panel === "edit" ? null : "edit")}
              aria-expanded={panel === "edit"}
              className="t-focus min-h-touch flex-1 sm:flex-none px-3 text-sm font-medium text-t-phos hover:text-t-white border border-t-line"
            >
              Lane settings
            </button>
          )}
        </div>
      </div>

      {shownLane && panel !== "edit" && (
        <p className="mt-2 text-xs text-t-phos-dim" data-testid="lane-summary">
          {shownLane.target_role ? `Aiming at ${shownLane.target_role}. ` : ""}
          {laneKindOf(shownLane) === "resume" ? `${formatSummaryLabel(shownLane.format)}. ${LENGTH_COPY[shownLane.length_pref].label}.` : `${LANE_GOAL_PRESETS.find((goal) => goal.kind === laneKindOf(shownLane))?.label || "Documents"} lane.`}
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
            Archived lanes ({api.archived.length})
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
  const [msg, setMsg] = useState("");
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="text-t-phos">{lane.name}</span>
      <button
        type="button"
        aria-label={`Bring back ${lane.name}`}
        className="t-focus text-t-steel hover:text-t-white underline"
        onClick={async () => {
          const r = await send(`/api/lanes/${lane.id}`, "PATCH", { archived: false });
          if (r.ok) onBack();
          else setMsg(r.message);
        }}
      >
        Bring back
      </button>
      {msg && <span className="text-t-red" role="alert">{msg}</span>}
    </li>
  );
}

const inputCls =
  "t-focus w-full min-h-touch bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white focus:border-t-steel focus:outline-none";

function NewLaneForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (lane: CareerLane) => void }) {
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
        const r = await send("/api/lanes", "POST", { name: name.trim() || goal.name, targetRole: target, kind: goal.kind, ...(goal.kind === "cv" ? { cvType } : {}) });
        setBusy(false);
        if (r.ok) onCreated(r.lane);
        else setError(r.message);
      }}
    >
      <h3 className="font-semibold text-t-white">What are you working toward?</h3>
      <p className="text-sm text-t-phos">{FACTS_CARRY_COPY} A lane holds one goal and its documents. Format stays inside the lane.</p>
      <label className="block text-sm text-t-white">
        Your goal
        <select className={`${inputCls} mt-1`} value={goalId} onChange={(e) => setGoalId(e.target.value)} disabled={busy} data-testid="lane-goal">
          {LANE_GOAL_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
        </select>
      </label>
      <p className="text-sm text-t-phos-dim" data-testid="lane-goal-description">{goal.description}</p>
      {goal.kind === "cv" && <label className="block text-sm text-t-white">
        CV type
        <select className={`${inputCls} mt-1`} value={cvType} onChange={(e) => setCvType(e.target.value as CvType)} disabled={busy}>
          {CV_TYPES.map((type) => <option key={type} value={type}>{CV_TYPE_COPY[type].label}</option>)}
        </select>
      </label>}
      <label className="block text-sm text-t-white">
        What work are you aiming at? <span className="text-t-phos-dim">(optional)</span>
        <input className={`${inputCls} mt-1`} value={target} maxLength={200} placeholder={goal.example} onChange={(e) => setTarget(e.target.value)} disabled={busy} />
      </label>
      <label className="block text-sm text-t-white">
        Lane name
        <input className={`${inputCls} mt-1`} value={name} maxLength={60} placeholder={goal.name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        <span className="mt-1 block text-xs text-t-phos-dim">Leave blank to use “{goal.name}”.</span>
      </label>
      <p className="text-xs text-t-phos-dim">Caregiving, returning to work and gaps in work can be part of a conversation with t.ROY. Use the goal you choose for your lane name.</p>
      {error && <p className="text-sm text-t-red" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright disabled:opacity-50">
          {busy ? "Saving..." : "Create lane"}
        </button>
        <button type="button" onClick={onCancel} className="t-focus min-h-touch px-3 text-sm text-t-phos-dim hover:text-t-white">
          Cancel
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
        });
        setBusy(false);
        if (r.ok) onSaved();
        else setError(r.message);
      }}
    >
      <label className="block text-sm text-t-white">
        Lane name
        <input className={`${inputCls} mt-1`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="block text-sm text-t-white">
        What work are you aiming at?
        <input className={`${inputCls} mt-1`} value={target} maxLength={200} onChange={(e) => setTarget(e.target.value)} />
      </label>

      {resumeLane ? <>
      <section className="space-y-2" data-testid="lane-format" aria-labelledby="lane-format-heading">
        <h3 id="lane-format-heading" className="text-sm font-semibold text-t-white">Resume format</h3>
        <div className="border border-t-line p-3">
          <span className="block text-sm font-semibold text-t-white">{FORMAT_COPY.chronological.label}</span>
          <span className="block text-xs text-t-phos-dim">{FORMAT_COPY.chronological.body}</span>
        </div>
        <p className="text-xs text-t-phos-dim" data-testid="lane-hybrid-coming">{HYBRID_COMING_COPY}</p>
        <p className="text-xs text-t-phos-dim">{NO_FUNCTIONAL_COPY}</p>
      </section>

      <fieldset className="space-y-2" data-testid="lane-length">
        <legend className="text-sm font-semibold text-t-white">Length</legend>
        {LANE_LENGTHS.map((l) => (
          <label key={l} className="flex gap-3 border border-t-line p-3 cursor-pointer">
            <input type="radio" name="lane-length" value={l} checked={length === l} onChange={() => setLength(l)} className="mt-1" />
            <span>
              <span className="block text-sm font-semibold text-t-white">{LENGTH_COPY[l].label}</span>
              <span className="block text-xs text-t-phos-dim">{LENGTH_COPY[l].body}</span>
            </span>
          </label>
        ))}
      </fieldset>
      </> : documentHref ? <p className="text-sm text-t-phos-dim">This lane’s document choices are in <Link href={documentHref} className="t-focus text-t-amber-bright underline underline-offset-2">its own workspace</Link>.</p> : null}

      {error && <p className="text-sm text-t-red" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright disabled:opacity-50">
          {busy ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="t-focus min-h-touch px-3 text-sm text-t-phos-dim hover:text-t-white">
          Cancel
        </button>
      </div>

      <div className="border-t border-t-line pt-3">
        {confirmArchive ? (
          <div className="space-y-2">
            <p className="text-sm text-t-phos">Archive this lane? Its resumes stay in My resumes. You can bring it back.</p>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="lane-archive-confirm"
                className="t-focus min-h-touch px-3 text-sm font-medium border border-t-line text-t-white"
                onClick={async () => {
                  const r = await send(`/api/lanes/${lane.id}`, "PATCH", { archived: true });
                  if (r.ok) onArchived();
                  else setError(r.message);
                }}
              >
                Archive it
              </button>
              <button type="button" onClick={() => setConfirmArchive(false)} className="t-focus min-h-touch px-3 text-sm text-t-phos-dim">
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button type="button" data-testid="lane-archive" onClick={() => setConfirmArchive(true)} className="t-focus text-sm text-t-phos-dim hover:text-t-white underline">
            Archive this lane
          </button>
        )}
      </div>
    </form>
  );
}
