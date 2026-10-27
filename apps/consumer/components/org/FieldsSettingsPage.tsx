"use client";

/**
 * <FieldsSettingsPage> -- /dashboard/fields (house build L4).
 *
 * The organization's own fields, set up without a code change: add, rename,
 * reorder, retire, bring back; types with choices; required and help; and a
 * sensitive switch with a plain explanation. A field whose name talks about a
 * record or health is sensitive automatically, and the page says why.
 *
 * Managers only change things (org.settings.manage, checked again on the
 * server and by the database). Everyone else on staff sees the list read-only,
 * so they know what the fields mean.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useOrgTerms } from "@/lib/use-org-terms";
import {
  CUSTOM_FIELD_TYPES, CUSTOM_FIELD_TYPE_HELP, CUSTOM_FIELD_TYPE_LABELS, SENSITIVE_EXPLANATION, SENSITIVE_FORCED_EXPLANATION, SENSITIVE_LOCKED_EXPLANATION, isChoiceType, sensitiveWordIn,
  type CustomFieldDef, type CustomFieldEntity, type CustomFieldOption, type CustomFieldType,
} from "@crucible/core/src/customFieldsShared";

const input = "plain-field t-focus w-full rounded-[4px] border px-3 py-2 text-sm";
/** "a" or "an" before an org's own word. */
const article = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");
/** Tab labels and help in the organization's own words (L3a, useOrgTerms). Exported for tests. */
export function entityWords(terms: { participant: string; enrollment: string; program: string; caseload: string }) {
  return {
    label: { participant: `About ${article(terms.participant)} ${terms.participant}`, enrollment: `About ${article(terms.enrollment)} ${terms.enrollment}` } as Record<CustomFieldEntity, string>,
    help: {
      participant: `These show on each ${terms.participant}'s page, as columns and filters on People, and in the ${terms.caseload} spreadsheet.`,
      enrollment: `These show on each ${terms.enrollment} in a ${terms.program}, on the ${terms.participant}'s page.`,
    } as Record<CustomFieldEntity, string>,
  };
}

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/org/fields", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    return res.ok ? { ok: true } : { ok: false, error: d.error || "That did not save. Try again." };
  } catch {
    return { ok: false, error: "That did not save. Check your connection and try again." };
  }
}

export function FieldsSettingsPage() {
  const [defs, setDefs] = useState<CustomFieldDef[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [failed, setFailed] = useState(false);
  const [entity, setEntity] = useState<CustomFieldEntity>("participant");
  const terms = useOrgTerms();
  const words = entityWords(terms);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/org/fields?retired=1", { cache: "no-store" });
      if (!res.ok) { setFailed(true); return; }
      const d = await res.json();
      setDefs(d.defs ?? []); setCanManage(!!d.canManage); setFailed(false);
    } catch { setFailed(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const live = useMemo(() => (defs ?? []).filter((d) => d.entity === entity && !d.retiredAt).sort((a, b) => a.position - b.position), [defs, entity]);
  const retired = useMemo(() => (defs ?? []).filter((d) => d.entity === entity && d.retiredAt), [defs, entity]);

  async function act(body: Record<string, unknown>, ok: string) {
    setMsg(null);
    const r = await post(body);
    setMsg(r.ok ? { kind: "ok", text: ok } : { kind: "err", text: r.error! });
    if (r.ok) await load();
    return r.ok;
  }
  async function move(id: string, by: number) {
    const ids = live.map((d) => d.id);
    const i = ids.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setDefs((cur) => (cur ?? []).map((d) => (ids.includes(d.id) ? { ...d, position: ids.indexOf(d.id) } : d)));
    await act({ action: "reorder", entity, ids }, "New order saved.");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-3xl font-bold text-t-white">Fields</h1>
      <p className="mt-1 text-sm text-t-phos">
        The details your organization keeps about the people you serve, in your own words.{canManage ? " Funders change what they ask for; you change these without waiting on anyone." : ""}
      </p>

      <div role="tablist" aria-label="Where the field goes" className="mt-5 flex flex-wrap gap-1 border-b border-t-line">
        {(["participant", "enrollment"] as const).map((e) => (
          <button key={e} role="tab" aria-selected={entity === e} onClick={() => { setEntity(e); setEditing(null); setAdding(false); setMsg(null); }}
            className={`t-focus -mb-px min-h-touch border-b-2 px-4 text-sm ${entity === e ? "border-t-amber font-semibold text-t-white" : "border-transparent text-t-phos-dim hover:text-t-white"}`}>
            {words.label[e]}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-t-phos-dim">{words.help[entity]}</p>

      {failed && (
        <div role="alert" className="mt-4 border border-t-amber bg-t-panel px-4 py-4">
          <p className="text-sm text-t-white">The fields did not load. Nothing was lost.</p>
          <button type="button" onClick={load} className="t-focus mt-2 min-h-touch text-sm font-semibold text-t-amber-bright underline underline-offset-4">Try again</button>
        </div>
      )}
      {!defs && !failed && <p role="status" className="mt-4 text-sm text-t-phos-dim">Getting your fields.</p>}
      {msg && <p role={msg.kind === "err" ? "alert" : "status"} className={`mt-3 text-sm ${msg.kind === "err" ? "text-t-amber-bright" : "text-t-phos"}`}>{msg.text}</p>}
      {defs && !canManage && <p role="note" className="mt-3 border-l-[3px] border-t-amber bg-t-panel px-3 py-2 text-xs text-t-white">Only someone who manages your organization&apos;s settings can change fields. Here is what each one means.</p>}

      {defs && (
        <ul className="mt-4 space-y-2">
          {live.length === 0 && <li className="border border-t-line bg-t-panel px-4 py-4 text-sm text-t-phos">No fields here yet.{canManage ? " Add the first one below." : ""}</li>}
          {live.map((d, i) => (
            <li key={d.id} className="border border-t-line bg-t-panel px-4 py-3">
              {editing === d.id ? (
                <FieldForm initial={d} onCancel={() => setEditing(null)} onSubmit={async (v) => { if (await act({ action: "update", id: d.id, ...v }, `Saved "${v.label}".`)) setEditing(null); }} />
              ) : (
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-[12rem] flex-1">
                    <p className="text-sm font-semibold text-t-white">
                      {d.label}
                      {d.required && <span className="ml-2 text-[11px] font-normal text-t-bone-dim">needed</span>}
                      {(d.sensitive || sensitiveWordIn(d)) && <span className="ml-2 border border-t-amber px-1.5 text-[11px] font-normal text-t-amber-bright">sensitive</span>}
                    </p>
                    <p className="text-xs text-t-phos-dim">{CUSTOM_FIELD_TYPE_LABELS[d.type]}{isChoiceType(d.type) ? `: ${d.options.filter((o) => !o.retired).map((o) => o.label).join(", ")}` : ""}</p>
                    {d.help && <p className="mt-1 text-xs text-t-phos">{d.help}</p>}
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap items-center gap-1">
                      <button type="button" aria-label={`Move ${d.label} up`} disabled={i === 0} onClick={() => move(d.id, -1)} className="t-focus min-h-touch px-2 text-xs text-t-phos-dim hover:text-t-white disabled:opacity-30">&uarr;</button>
                      <button type="button" aria-label={`Move ${d.label} down`} disabled={i === live.length - 1} onClick={() => move(d.id, 1)} className="t-focus min-h-touch px-2 text-xs text-t-phos-dim hover:text-t-white disabled:opacity-30">&darr;</button>
                      <button type="button" onClick={() => { setEditing(d.id); setAdding(false); }} className="t-focus min-h-touch px-2 text-xs text-t-white underline underline-offset-4">Edit</button>
                      <button type="button" onClick={() => { if (window.confirm(`Retire "${d.label}"? Answers already given stay on each person's page and in exports. Nobody can fill it in until you bring it back.`)) act({ action: "retire", id: d.id }, `Retired "${d.label}". Its answers are kept.`); }}
                        className="t-focus min-h-touch px-2 text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-amber-bright">Retire</button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {defs && canManage && (adding ? (
        <div className="mt-4 border border-t-amber bg-t-panel px-4 py-4">
          <h2 className="text-sm font-semibold text-t-white">Add a field {words.label[entity].replace(/^About/, "about")}</h2>
          <FieldForm onCancel={() => setAdding(false)} onSubmit={async (v) => { if (await act({ action: "create", entity, ...v }, `Added "${v.label}".`)) setAdding(false); }} />
        </div>
      ) : (
        <button type="button" onClick={() => { setAdding(true); setEditing(null); }} className="t-focus mt-4 min-h-touch rounded-[4px] bg-[#4f6b57] px-4 text-sm font-semibold text-white hover:bg-[#3d5745]">Add a field</button>
      ))}

      {retired.length > 0 && (
        <details className="mt-6 border border-t-line bg-t-panel px-4 py-2">
          <summary className="t-focus flex min-h-touch cursor-pointer items-center text-sm text-t-white">Retired fields ({retired.length})</summary>
          <p className="text-xs text-t-phos-dim">Their answers stay on people&apos;s pages and in exports. Nobody can fill them in.</p>
          <ul className="mt-2 space-y-1 pb-2">
            {retired.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-t-phos">
                <span>{d.label} <span className="text-xs text-t-phos-dim">({CUSTOM_FIELD_TYPE_LABELS[d.type]})</span></span>
                {canManage && <button type="button" onClick={() => act({ action: "restore", id: d.id }, `Brought back "${d.label}".`)} className="t-focus min-h-touch px-2 text-xs underline underline-offset-4">Bring back</button>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-8 text-xs text-t-phos-dim">
        Want these as columns? Open <Link href="/dashboard/people" className="t-focus underline underline-offset-4">People</Link> and choose Columns. To set what each role sees first, go to <Link href="/dashboard/layouts" className="t-focus underline underline-offset-4">Layouts</Link>.
      </p>
    </div>
  );
}

interface FieldFormValue { label: string; type: CustomFieldType; required: boolean; help: string; sensitive: boolean; options: CustomFieldOption[] }

function FieldForm({ initial, onSubmit, onCancel }: { initial?: CustomFieldDef; onSubmit: (v: FieldFormValue) => Promise<void>; onCancel: () => void }) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [type, setType] = useState<CustomFieldType>(initial?.type ?? "text");
  const [required, setRequired] = useState(initial?.required ?? false);
  const [help, setHelp] = useState(initial?.help ?? "");
  const [sensitive, setSensitive] = useState(initial?.sensitive ?? false);
  const [options, setOptions] = useState<CustomFieldOption[]>(initial?.options ?? []);
  const [newChoice, setNewChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const forced = sensitiveWordIn({ label, key: initial?.key, help });
  // Sensitive is one way: once a field is sensitive it stays so (the server and the database refuse lowering it).
  const locked = !!initial?.sensitive;
  const choice = isChoiceType(type);
  const id = initial?.id ?? "new";

  function addChoice() {
    const l = newChoice.trim();
    if (!l || options.some((o) => !o.retired && o.label.toLowerCase() === l.toLowerCase())) return;
    setOptions([...options, { id: "", label: l }]);
    setNewChoice("");
  }

  return (
    <form className="mt-3 space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      if (!label.trim() || busy) return;
      setBusy(true);
      try { await onSubmit({ label: label.trim(), type, required, help: help.trim(), sensitive: sensitive || !!forced || locked, options: options.map((o) => (o.id ? o : { label: o.label, ...(o.retired ? { retired: true } : {}) }) as CustomFieldOption) }); }
      finally { setBusy(false); }
    }}>
      <div>
        <label htmlFor={`fl-${id}`} className="block text-xs font-medium text-t-white">Name</label>
        <input id={`fl-${id}`} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="For example: Housing status" className={`${input} mt-1`} />
      </div>
      <div>
        <label htmlFor={`ft-${id}`} className="block text-xs font-medium text-t-white">Kind of answer</label>
        {initial ? (
          <p className="mt-1 text-sm text-t-phos">{CUSTOM_FIELD_TYPE_LABELS[type]} <span className="text-xs text-t-phos-dim">(fixed once a field is made, so every answer stays readable)</span></p>
        ) : (
          <>
            <select id={`ft-${id}`} value={type} onChange={(e) => setType(e.target.value as CustomFieldType)} className={`${input} mt-1`}>
              {CUSTOM_FIELD_TYPES.map((t) => <option key={t} value={t}>{CUSTOM_FIELD_TYPE_LABELS[t]}</option>)}
            </select>
            <p className="mt-0.5 text-[11px] text-t-phos-dim">{CUSTOM_FIELD_TYPE_HELP[type]}</p>
          </>
        )}
      </div>
      {choice && (
        <fieldset>
          <legend className="text-xs font-medium text-t-white">Choices</legend>
          <ul className="mt-1 space-y-1">
            {options.map((o, i) => (
              <li key={`${o.id}-${i}`} className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`fo-${id}-${i}`}>Choice {i + 1}</label>
                <input id={`fo-${id}-${i}`} value={o.label} maxLength={80} disabled={o.retired} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={`${input} max-w-xs disabled:opacity-50`} />
                {o.id ? (
                  <button type="button" onClick={() => setOptions(options.map((x, j) => (j === i ? { ...x, retired: !x.retired } : x)))} className="t-focus min-h-touch px-2 text-xs text-t-phos-dim underline underline-offset-4">
                    {o.retired ? "Bring back" : "Retire"}
                  </button>
                ) : (
                  <button type="button" onClick={() => setOptions(options.filter((_, j) => j !== i))} className="t-focus min-h-touch px-2 text-xs text-t-phos-dim underline underline-offset-4">Remove</button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <label className="sr-only" htmlFor={`fn-${id}`}>New choice</label>
            <input id={`fn-${id}`} value={newChoice} maxLength={80} onChange={(e) => setNewChoice(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChoice(); } }} placeholder="Add a choice" className={`${input} max-w-xs`} />
            <button type="button" onClick={addChoice} className="t-focus min-h-touch rounded-[4px] border border-t-line px-3 text-xs text-t-white">Add</button>
          </div>
          <p className="mt-1 text-[11px] text-t-phos-dim">A choice someone already picked can be retired, not removed, so their answer still reads right.</p>
        </fieldset>
      )}
      <div>
        <label htmlFor={`fh-${id}`} className="block text-xs font-medium text-t-white">Help line (optional)</label>
        <input id={`fh-${id}`} value={help} maxLength={300} onChange={(e) => setHelp(e.target.value)} placeholder="What staff should put here" className={`${input} mt-1`} />
      </div>
      <label className="flex min-h-touch items-center gap-2 text-sm text-t-phos">
        <input type="checkbox" className="t-focus" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        Needed: staff cannot save the person&apos;s details with this left empty
      </label>
      <div>
        <label className="flex min-h-touch items-center gap-2 text-sm text-t-phos">
          <input type="checkbox" className="t-focus" checked={sensitive || !!forced || locked} disabled={!!forced || locked} onChange={(e) => setSensitive(e.target.checked)} aria-describedby={`fs-${id}`} />
          Sensitive
        </label>
        <p id={`fs-${id}`} className="text-[11px] text-t-phos-dim">
          {locked ? SENSITIVE_LOCKED_EXPLANATION : forced ? SENSITIVE_FORCED_EXPLANATION(forced) : SENSITIVE_EXPLANATION}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy || !label.trim() || (choice && !options.some((o) => !o.retired))} className="t-focus min-h-touch rounded-[4px] bg-[#4f6b57] px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving..." : initial ? "Save" : "Add field"}</button>
        <button type="button" onClick={onCancel} className="t-focus min-h-touch px-3 text-sm text-t-phos-dim underline underline-offset-4">Cancel</button>
      </div>
    </form>
  );
}
