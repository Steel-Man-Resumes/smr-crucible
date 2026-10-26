"use client";

/**
 * <CustomFieldsPanel> -- the organization's own fields on a person's page
 * (house build L4): the participant's fields, and each enrollment's fields
 * when enrollments exist in this workspace (migration 103; hidden otherwise).
 *
 * Who sees what: staff who reach this person (the read is reach-checked in
 * core and by the database reach policy). Who edits: staff who can write
 * notes about them; every change is on the activity log (database trigger).
 * The participant never sees these. Sensitive fields are marked: they are
 * never sent to t.ROY or any AI tool.
 */
import { useCallback, useEffect, useState } from "react";
import { CUSTOM_FIELD_TYPE_LABELS, formatCustomFieldValue, isSensitiveField, type CustomFieldDef } from "@crucible/core/src/customFieldsShared";

type Values = Record<string, unknown>;
interface Staff { id: string; name: string }
interface Enrollment { id: string; programName: string | null; status: string; enrolledOn: string | null; exitedOn: string | null }
/** An earlier answer (custom_field_value_version, 104). Managers only. */
export interface EarlierAnswer { key: string; value: unknown; setBy: string | null; setAt: string | null; change: "changed" | "cleared"; replacedBy: string | null; replacedAt: string }
type History = Record<string, EarlierAnswer[]>;

const input = "plain-field t-focus w-full rounded-[4px] border px-3 py-2 text-sm";

/** Fields to show for a record: live ones, plus retired ones that still hold an answer. */
export function fieldsToShow(defs: CustomFieldDef[], values: Values): CustomFieldDef[] {
  return defs.filter((d) => !d.retiredAt || (values[d.key] !== undefined && values[d.key] !== null))
    .sort((a, b) => Number(!!a.retiredAt) - Number(!!b.retiredAt) || a.position - b.position);
}

export function CustomFieldsPanel({ clientId, first }: { clientId: string; first: string }) {
  const [state, setState] = useState<{ defs: CustomFieldDef[]; values: Values; staff: Staff[]; canEdit: boolean; history: EarlierAnswer[] } | null>(null);
  const [enr, setEnr] = useState<{ defs: CustomFieldDef[]; values: Record<string, Values>; enrollments: Enrollment[] | null; history: History } | null>(null);
  const load = useCallback(async () => {
    const [p, e] = await Promise.all([
      fetch(`/api/org/fields/values?entity=participant&participant=${clientId}&history=1`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/org/fields/values?entity=enrollment&participant=${clientId}&history=1`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (p) setState({ defs: p.defs ?? [], values: p.values?.[clientId] ?? {}, staff: p.staff ?? [], canEdit: !!p.canEdit, history: p.history?.[clientId] ?? [] });
    if (e) setEnr({ defs: e.defs ?? [], values: e.values ?? {}, enrollments: e.enrollments ?? null, history: e.history ?? {} });
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  if (!state) return null;
  const personFields = fieldsToShow(state.defs, state.values);
  const enrollmentFieldsExist = !!enr && enr.defs.some((d) => !d.retiredAt) && (enr.enrollments?.length ?? 0) > 0;
  if (personFields.length === 0 && !enrollmentFieldsExist) return null;

  return (
    <section aria-labelledby="person-details-h" className="mb-5 border border-t-line bg-t-panel px-4 py-4" data-testid="custom-fields-panel">
      <h2 id="person-details-h" className="text-sm font-semibold text-t-white">Details your organization keeps</h2>
      <p className="mt-0.5 text-[11px] text-t-phos-dim">{first} does not see these. Changes are on your organization&apos;s activity log.</p>
      {personFields.length > 0 && (
        <RecordFields entity="participant" entityId={clientId} defs={personFields} values={state.values} staff={state.staff} canEdit={state.canEdit} onSaved={load} earlier={state.history} allDefs={state.defs} />
      )}
      {enrollmentFieldsExist && enr!.enrollments!.map((e) => {
        const vals = enr!.values[e.id] ?? {};
        const defs = fieldsToShow(enr!.defs, vals);
        if (!defs.length) return null;
        return (
          <div key={e.id} className="mt-4 border-t border-t-line pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-t-amber-bright">
              {e.programName ?? "Enrollment"} <span className="font-normal normal-case text-t-bone-dim">{e.status}{e.enrolledOn ? `, since ${e.enrolledOn}` : ""}</span>
            </h3>
            <RecordFields entity="enrollment" entityId={e.id} defs={defs} values={vals} staff={state.staff} canEdit={state.canEdit} onSaved={load} earlier={enr!.history[e.id] ?? []} allDefs={enr!.defs} />
          </div>
        );
      })}
    </section>
  );
}

function RecordFields({ entity, entityId, defs, values, staff, canEdit, onSaved, earlier = [], allDefs = defs }: {
  entity: "participant" | "enrollment"; entityId: string; defs: CustomFieldDef[]; values: Values; staff: Staff[]; canEdit: boolean; onSaved: () => void;
  earlier?: EarlierAnswer[]; allDefs?: CustomFieldDef[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Values>(values);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const staffNames = new Map(staff.map((s) => [s.id, s.name]));
  useEffect(() => { if (!editing) setDraft(values); }, [values, editing]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null); setErrors({});
    // Send only what changed, so a retired field's old answer is never re-sent.
    const changed: Values = {};
    for (const d of defs) if (!d.retiredAt && JSON.stringify(draft[d.key] ?? null) !== JSON.stringify(values[d.key] ?? null)) changed[d.key] = draft[d.key] ?? null;
    if (!Object.keys(changed).length) { setBusy(false); setEditing(false); return; }
    try {
      const res = await fetch("/api/org/fields/values", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ entity, entityId, values: changed }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setEditing(false); setMsg("Saved."); onSaved(); }
      else { setErrors(d.fieldErrors ?? {}); setMsg(d.error || "That did not save. Try again."); }
    } catch {
      setMsg("That did not save. Nothing was lost on this screen; try again.");
    } finally { setBusy(false); }
  }

  if (!editing) {
    return (
      <div className="mt-3">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {defs.map((d) => {
            const text = formatCustomFieldValue(d, values[d.key], staffNames);
            return (
              <div key={d.id} className="min-w-0">
                <dt className="text-[11px] uppercase tracking-wide text-t-bone-dim">
                  {d.label}{d.retiredAt ? " (retired)" : ""}{isSensitiveField(d) ? <span className="ml-1 normal-case text-t-amber-bright">sensitive</span> : null}
                </dt>
                <dd className="whitespace-pre-wrap break-words text-sm text-t-white">
                  {text ? (d.type === "url" ? <a href={String(values[d.key])} target="_blank" rel="noopener noreferrer nofollow" className="t-focus underline underline-offset-4">{text}</a> : text) : <span className="text-t-phos-dim">Not filled in</span>}
                </dd>
              </div>
            );
          })}
        </dl>
        {msg && <p role="status" className="mt-2 text-xs text-t-phos">{msg}</p>}
        <EarlierAnswers earlier={earlier} defs={allDefs} staffNames={staffNames} />
        {canEdit && defs.some((d) => !d.retiredAt) && (
          <button type="button" onClick={() => { setDraft(values); setEditing(true); setMsg(null); }} className="t-focus mt-3 min-h-touch rounded-[4px] border border-t-line px-3 text-xs font-medium text-t-white hover:border-t-line-strong">
            Edit details
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={save} className="mt-3 space-y-3">
      {defs.filter((d) => !d.retiredAt).map((d) => (
        <FieldInput key={d.id} def={d} value={draft[d.key]} staff={staff} error={errors[d.key]} onChange={(v) => setDraft({ ...draft, [d.key]: v })} />
      ))}
      {msg && <p role="alert" className="text-xs text-t-amber-bright">{msg}</p>}
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} className="t-focus min-h-touch rounded-[4px] bg-[#4f6b57] px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving..." : "Save"}</button>
        <button type="button" onClick={() => { setEditing(false); setErrors({}); setMsg(null); }} className="t-focus min-h-touch px-3 text-sm text-t-phos-dim underline underline-offset-4">Cancel</button>
      </div>
    </form>
  );
}

export function FieldInput({ def: d, value, staff, error, onChange }: { def: CustomFieldDef; value: unknown; staff: Staff[]; error?: string; onChange: (v: unknown) => void }) {
  const id = `cf-${d.id}`;
  const help = d.help ? <p id={`${id}-help`} className="mt-0.5 text-[11px] text-t-phos-dim">{d.help}</p> : null;
  const described = [d.help ? `${id}-help` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined;
  const label = (
    <label htmlFor={id} className="block text-xs font-medium text-t-white">
      {d.label}{d.required ? <span className="text-t-amber-bright"> (needed)</span> : null}
      {isSensitiveField(d) ? <span className="ml-1 font-normal text-t-amber-bright">sensitive, never sent to AI tools</span> : null}
    </label>
  );
  const live = d.options.filter((o) => !o.retired || (Array.isArray(value) ? value.includes(o.id) : value === o.id));
  let control;
  switch (d.type) {
    case "long_text":
      control = <textarea id={id} aria-describedby={described} rows={3} maxLength={5000} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className={input} />; break;
    case "number":
      control = <input id={id} aria-describedby={described} type="number" inputMode="decimal" step="any" value={typeof value === "number" ? value : typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} className={input} />; break;
    case "date":
      control = <input id={id} aria-describedby={described} type="date" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)} className={input} />; break;
    case "boolean":
      control = (
        <select id={id} aria-describedby={described} value={value === true ? "yes" : value === false ? "no" : ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "yes")} className={input}>
          <option value="">Not answered</option><option value="yes">Yes</option><option value="no">No</option>
        </select>
      ); break;
    case "single_select":
      control = (
        <select id={id} aria-describedby={described} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)} className={input}>
          <option value="">Not chosen</option>
          {live.map((o) => <option key={o.id} value={o.id}>{o.label}{o.retired ? " (retired)" : ""}</option>)}
        </select>
      ); break;
    case "multi_select": {
      const chosen = new Set(Array.isArray(value) ? value.map(String) : []);
      control = (
        <fieldset id={id} aria-describedby={described} className="flex flex-wrap gap-x-4">
          <legend className="sr-only">{d.label}</legend>
          {live.map((o) => (
            <label key={o.id} className="flex min-h-touch items-center gap-2 text-sm text-t-phos">
              <input type="checkbox" className="t-focus" checked={chosen.has(o.id)} onChange={(e) => { const n = new Set(chosen); if (e.target.checked) n.add(o.id); else n.delete(o.id); onChange(Array.from(n)); }} />
              {o.label}{o.retired ? " (retired)" : ""}
            </label>
          ))}
        </fieldset>
      ); break;
    }
    case "staff_member":
      control = (
        <select id={id} aria-describedby={described} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)} className={input}>
          <option value="">Nobody</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      ); break;
    case "url":
      control = <input id={id} aria-describedby={described} type="url" inputMode="url" maxLength={2000} placeholder="https://" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className={input} />; break;
    default:
      control = <input id={id} aria-describedby={described} type="text" maxLength={500} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className={input} />;
  }
  return (
    <div>
      {label}
      <div className="mt-1">{control}</div>
      {help}
      {error && <p id={`${id}-err`} role="alert" className="mt-0.5 text-xs text-t-red">{error}</p>}
      <span className="sr-only">{CUSTOM_FIELD_TYPE_LABELS[d.type]}</span>
    </div>
  );
}

/**
 * Earlier answers, newest first: what a field said before someone changed or
 * cleared it, who had set it and who replaced it. The server sends these only
 * to people who manage the organization's settings, within their reach.
 */
export function EarlierAnswers({ earlier, defs, staffNames }: { earlier: EarlierAnswer[]; defs: CustomFieldDef[]; staffNames: ReadonlyMap<string, string> }) {
  if (!earlier.length) return null;
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
  const who = (id: string | null) => (id ? staffNames.get(id) ?? "someone no longer on staff" : "the system");
  return (
    <details className="mt-3 text-xs text-t-phos">
      <summary className="t-focus inline-flex min-h-touch cursor-pointer items-center text-t-bone-dim underline underline-offset-4">Earlier answers ({earlier.length})</summary>
      <ul className="mt-2 space-y-1">
        {earlier.map((h, i) => {
          const d = byKey.get(h.key);
          const text = d ? formatCustomFieldValue(d, h.value, staffNames) : "";
          return (
            <li key={`${h.key}-${h.replacedAt}-${i}`}>
              <span className="text-t-white">{d?.label ?? "A field"}</span> was <span className="text-t-white">{text || "empty"}</span>
              {h.setBy || h.setAt ? `, set by ${who(h.setBy)}${h.setAt ? ` on ${day(h.setAt)}` : ""}` : ""}.{" "}
              {h.change === "cleared" ? "Cleared" : "Changed"} by {who(h.replacedBy)} on {day(h.replacedAt)}.
            </li>
          );
        })}
      </ul>
    </details>
  );
}
