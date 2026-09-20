"use client";

/**
 * <StaffWorkflowSettings> -- Settings -> "My workflow".
 *
 * Every control here changes something on a screen this person uses. Nothing
 * here can change what they are allowed to see.
 *
 * Saves on change, one control at a time, and says when it has. An owner also
 * gets "make this the default for everyone", which sets what new and
 * undecided staff see; each person's own choice still wins for them.
 */
import { useEffect, useState } from "react";
import {
  CASELOAD_COLUMNS, CASELOAD_COLUMN_LABELS, CASELOAD_SORTS, CASELOAD_SORT_LABELS,
  NOTE_KINDS, NOTE_KIND_LABELS, CLIENT_TABS, CLIENT_TAB_LABELS, LANDINGS, LANDING_LABELS, TODAY_SECTION_KEYS,
  type StaffPrefs, type CaseloadColumn,
} from "@crucible/core/src/staffPrefsShared";

const TODAY_LABELS: Record<string, string> = {
  tasks: "My tasks", interviews: "Interviews coming up", followups: "Follow-ups due", answered: "They answered me",
  acknowledgement: "Waiting on an acknowledgement", quiet: "Gone quiet", never_started: "Never started", unassigned: "Not assigned to anyone",
};

interface State { effective: StaffPrefs; own: Partial<StaffPrefs>; orgDefaults: Partial<StaffPrefs>; canSetOrgDefaults: boolean }

/** `workspace`: the participant pages exist for this org, so their options mean something. */
export function StaffWorkflowSettings({ workspace }: { workspace: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/org/prefs").then((r) => (r.ok ? r.json() : null)).then(setState).catch(() => {});
  }, []);

  async function put(body: Record<string, unknown>, message: string) {
    const res = await fetch("/api/org/prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) { setState(await res.json()); setSaved(message); } else setSaved("That did not save.");
  }
  const change = (patch: Partial<StaffPrefs>) => state && put({ own: { ...state.own, ...patch } }, "Saved.");

  if (!state) return null;
  const p = state.effective;
  const select = "t-focus bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2 w-full sm:w-72";
  const toggleColumn = (c: CaseloadColumn) =>
    change({ caseloadHidden: p.caseloadHidden.includes(c) ? p.caseloadHidden.filter((x) => x !== c) : [...p.caseloadHidden, c] });

  return (
    <section className="mb-8" aria-labelledby="workflow-heading">
      <h2 id="workflow-heading" className="text-lg font-bold text-t-white mb-1">My workflow</h2>
      <p className="text-sm text-t-phos-dim mb-4">How your screens are arranged. It changes what you see first, never what you are allowed to see.</p>

      <div className="bg-t-panel border border-t-line p-5 space-y-6">
        <div>
          <label htmlFor="wf-sort" className="block font-medium text-t-white mb-1">Order my caseload by</label>
          <select id="wf-sort" className={select} value={p.caseloadSort} onChange={(e) => change({ caseloadSort: e.target.value as StaffPrefs["caseloadSort"] })}>
            {CASELOAD_SORTS.map((k) => <option key={k} value={k}>{CASELOAD_SORT_LABELS[k]}</option>)}
          </select>
          <p className="text-xs text-t-phos-dim mt-1">You can still re-sort on the page. This is what it opens with.</p>
        </div>

        <fieldset>
          <legend className="font-medium text-t-white mb-2">Columns on my caseload</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {CASELOAD_COLUMNS.map((c) => (
              <label key={c} className="text-sm text-t-phos flex items-center gap-2">
                <input type="checkbox" className="t-focus" checked={!p.caseloadHidden.includes(c)} onChange={() => toggleColumn(c)} />
                {CASELOAD_COLUMN_LABELS[c]}
              </label>
            ))}
          </div>
          <p className="text-xs text-t-phos-dim mt-1">The person&apos;s name always shows.</p>
        </fieldset>

        {workspace && (<>
        <div>
          <label htmlFor="wf-landing" className="block font-medium text-t-white mb-1">When I sign in, take me to</label>
          <select id="wf-landing" className={select} value={p.landing} onChange={(e) => change({ landing: e.target.value as StaffPrefs["landing"] })}>
            {LANDINGS.map((k) => <option key={k} value={k}>{LANDING_LABELS[k]}</option>)}
          </select>
        </div>

        <fieldset>
          <legend className="font-medium text-t-white mb-2">Sections on my Today page</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {TODAY_SECTION_KEYS.map((k) => (
              <label key={k} className="text-sm text-t-phos flex items-center gap-2">
                <input type="checkbox" className="t-focus" checked={!p.todayHidden.includes(k)}
                  onChange={() => change({ todayHidden: p.todayHidden.includes(k) ? p.todayHidden.filter((x) => x !== k) : [...p.todayHidden, k] })} />
                {TODAY_LABELS[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="wf-tab" className="block font-medium text-t-white mb-1">When I open a participant, start on</label>
          <select id="wf-tab" className={select} value={p.clientTab} onChange={(e) => change({ clientTab: e.target.value as StaffPrefs["clientTab"] })}>
            {CLIENT_TABS.map((k) => <option key={k} value={k}>{CLIENT_TAB_LABELS[k]}</option>)}
          </select>
          <p className="text-xs text-t-phos-dim mt-1">
            Starting on something they shared counts as opening it, and they can see that you did. &ldquo;Your notes&rdquo; never does.
          </p>
        </div>

        <div>
          <label htmlFor="wf-kind" className="block font-medium text-t-white mb-1">A new note starts as a</label>
          <select id="wf-kind" className={select} value={p.noteKind} onChange={(e) => change({ noteKind: e.target.value as StaffPrefs["noteKind"] })}>
            {NOTE_KINDS.map((k) => <option key={k} value={k}>{NOTE_KIND_LABELS[k]}</option>)}
          </select>
        </div>

        <label className="text-sm text-t-phos flex items-start gap-2">
          <input type="checkbox" className="t-focus mt-1" checked={p.noteVisible} onChange={(e) => change({ noteVisible: e.target.checked })} />
          <span>
            <span className="text-t-white font-medium">Start with &ldquo;let them see this note&rdquo; ticked</span>
            <span className="block text-xs text-t-phos-dim">You still choose on every note. Off is the safer habit.</span>
          </span>
        </label>

        </>)}

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-t-line">
          <button onClick={() => put({ own: {} }, "Back to your organization's defaults.")} className="t-focus text-xs text-t-phos-dim underline hover:text-t-white">
            Use my organization&apos;s defaults
          </button>
          {state.canSetOrgDefaults && (
            <button onClick={() => put({ orgDefaults: state.effective }, "These are now the default for everyone at your organization.")}
              className="t-focus text-xs text-t-phos-dim underline hover:text-t-white">
              Make this the default for everyone here
            </button>
          )}
          <p role="status" aria-live="polite" className="text-xs text-t-amber-bright ml-auto">{saved}</p>
        </div>
      </div>
    </section>
  );
}
