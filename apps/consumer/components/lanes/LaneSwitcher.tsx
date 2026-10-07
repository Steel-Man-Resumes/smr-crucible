"use client";

/**
 * The lane switcher at the top of the resume tools (the Tailor and the
 * Library). Shows which lane the tool is working in, switches lanes, adds a
 * lane, and opens one lane's settings: name, the kind of job, format (with
 * the plain explainer) and length. Archive, never delete; archived lanes can
 * be brought back.
 */

import { useId, useState } from "react";
import type { CareerLane, LaneFormat, LaneLength } from "@crucible/core/src/careerLaneShared";
import { LANE_LENGTHS, MAIN_LANE_KEY, hybridAllowed } from "@crucible/core/src/careerLaneShared";
import {
  FACTS_CARRY_COPY,
  FORMAT_COPY,
  HYBRID_CONDITION_COPY,
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
  const selectId = useId();
  const [panel, setPanel] = useState<Panel>(null);
  const shownLane = api.lanes.find((l) => l.id === value) ?? null;

  if (!api.loaded) {
    return <div className="h-12 border border-t-line bg-t-panel" aria-hidden="true" />;
  }

  return (
    <section data-testid="lane-switcher" aria-label="Career lanes" className="border border-t-line bg-t-panel p-3 sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2">
        <label htmlFor={selectId} className="shrink-0 text-xs font-mono uppercase tracking-wide text-t-phos-dim">
          {label}
        </label>
        <select
          id={selectId}
          data-testid="lane-select"
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
          {FORMAT_COPY[shownLane.format].label}. {LENGTH_COPY[shownLane.length_pref].label}.
        </p>
      )}

      {panel === "new" && (
        <NewLaneForm
          onCancel={() => setPanel(null)}
          onCreated={(lane) => {
            setPanel(null);
            api.adoptLane(lane);
            onChange(lane.id);
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
        className="t-focus text-t-steel hover:text-t-white underline"
        onClick={async () => {
          const r = await send(`/api/lanes/${lane.id}`, "PATCH", { archived: false });
          if (r.ok) onBack();
          else setMsg(r.message);
        }}
      >
        Bring back
      </button>
      {msg && <span className="text-t-red">{msg}</span>}
    </li>
  );
}

const inputCls =
  "t-focus w-full min-h-touch bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white focus:border-t-steel focus:outline-none";

function NewLaneForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (lane: CareerLane) => void }) {
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
        const r = await send("/api/lanes", "POST", { name, targetRole: target });
        setBusy(false);
        if (r.ok) onCreated(r.lane);
        else setError(r.message);
      }}
    >
      <p className="text-sm text-t-phos">{FACTS_CARRY_COPY}</p>
      <label className="block text-sm text-t-white">
        Lane name
        <input className={`${inputCls} mt-1`} value={name} maxLength={60} placeholder="Kitchen" onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="block text-sm text-t-white">
        What kind of job?
        <input className={`${inputCls} mt-1`} value={target} maxLength={200} placeholder="Line cook" onChange={(e) => setTarget(e.target.value)} />
      </label>
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
  const [format, setFormat] = useState<LaneFormat>(lane.format);
  const [uneven, setUneven] = useState(lane.hybrid_uneven_history);
  const [fieldChange, setFieldChange] = useState(lane.hybrid_field_change);
  const [length, setLength] = useState<LaneLength>(lane.length_pref);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const canHybrid = hybridAllowed(uneven, fieldChange);

  function setCondition(which: "uneven" | "field", on: boolean) {
    if (which === "uneven") setUneven(on);
    else setFieldChange(on);
    // A hybrid lane loses a condition: back to dates first, visibly.
    if (!on && format === "hybrid") setFormat("chronological");
  }

  return (
    <form
      data-testid="lane-edit-form"
      className="mt-3 space-y-4 border-t border-t-line pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        const r = await send(`/api/lanes/${lane.id}`, "PATCH", {
          name,
          targetRole: target,
          format,
          hybridUnevenHistory: uneven,
          hybridFieldChange: fieldChange,
          lengthPref: length,
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
        What kind of job?
        <input className={`${inputCls} mt-1`} value={target} maxLength={200} onChange={(e) => setTarget(e.target.value)} />
      </label>

      <fieldset className="space-y-2" data-testid="lane-format">
        <legend className="text-sm font-semibold text-t-white">Resume format</legend>
        {(["chronological", "hybrid"] as LaneFormat[]).map((f) => {
          const disabled = f === "hybrid" && !canHybrid;
          return (
            <label key={f} className={`flex gap-3 border border-t-line p-3 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
              <input type="radio" name="lane-format" value={f} checked={format === f} disabled={disabled} onChange={() => setFormat(f)} className="mt-1" />
              <span>
                <span className="block text-sm font-semibold text-t-white">{FORMAT_COPY[f].label}</span>
                <span className="block text-xs text-t-phos-dim">{FORMAT_COPY[f].body}</span>
              </span>
            </label>
          );
        })}
        <div className="pl-1 space-y-1">
          <label className="flex gap-2 text-xs text-t-phos">
            <input type="checkbox" checked={uneven} onChange={(e) => setCondition("uneven", e.target.checked)} />
            {HYBRID_CONDITION_COPY.uneven}
          </label>
          <label className="flex gap-2 text-xs text-t-phos">
            <input type="checkbox" checked={fieldChange} onChange={(e) => setCondition("field", e.target.checked)} />
            {HYBRID_CONDITION_COPY.fieldChange}
          </label>
        </div>
        <p className="text-xs text-t-phos-dim">{NO_FUNCTIONAL_COPY}</p>
      </fieldset>

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
            <p className="text-sm text-t-phos">Archive this lane? Its resumes stay in your Library. You can bring it back.</p>
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
