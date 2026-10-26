"use client";

/**
 * <OrgSetupWizard> -- first-run setup for an organization's owner, and the
 * same screens later from Settings (house lane L3a, migration 103).
 *
 * Five short steps: what kind of organization, the words your team uses, how
 * the work is organized (programs, sites, caseloads), what to switch on, and
 * a check before finishing. Every suggestion comes from the type's template
 * (packages/core/src/orgStructureShared.ts) and every one can be changed.
 * Nothing is saved until Finish, and Finish writes it all at once.
 *
 * State and rules live in lib/org-setup-wizard.ts (tested). This file only
 * renders: one question per screen, big targets, works at phone width,
 * keyboard and screen reader friendly (each step's heading takes focus).
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  COMMON_TIMEZONES, MODULE_INFO, ORG_MODULES, ORG_TEMPLATES, ORG_TYPES, ORG_TYPE_INFO, TERM_KEYS, TERM_LABELS, UNIT_KINDS,
  UNIT_MAX_DEPTH, termProblem, unitKindWord, type OrgProfile, type OrgType, type UnitDraft, type UnitKind,
} from "@crucible/core/src/orgStructureShared";
import {
  STEP_TITLES, WIZARD_STEPS, addUnit, chooseType, countUnits, initialWizard, nextStep, prevStep, previewSentence, removeUnit,
  renameUnit, resetTerms, resetUnits, setModule, setTerm, setUnitKind, setupPayload, stepProblems, type TreePath, type WizardState,
} from "@/lib/org-setup-wizard";
import { invalidateOrgTerms } from "@/lib/use-org-terms";

const KIND_LABEL: Record<UnitKind, string> = {
  program: "Program", cohort: "Cohort", site: "Site", facility: "Facility", housing_unit: "Housing unit",
  office: "Office", team: "Team", caseload: "Caseload", other: "Other group",
};

const btn = "t-focus min-h-[44px] px-4 py-2 text-sm font-semibold border rounded-[4px]";
const primary = `${btn} bg-t-amber text-[#14100a] border-t-amber disabled:opacity-50`;
const quiet = `${btn} bg-t-panel text-t-phos border-t-line hover:text-t-white`;
const field = "plain-field t-focus w-full bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2 min-h-[44px]";

export function OrgSetupWizard() {
  const [loaded, setLoaded] = useState<"loading" | "ready" | "denied" | "failed" | "not_ready">("loading");
  const [state, setState] = useState<WizardState | null>(null);
  const [wasDone, setWasDone] = useState(false);
  const [existing, setExisting] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ unitsCreated: number } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [p, s] = await Promise.all([
          fetch("/api/org/profile").then(async (r) => (r.ok ? r.json() : { status: r.status })),
          fetch("/api/org/structure").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        if (p.status === 403 || p.status === 401) { setLoaded("denied"); return; }
        if (!p.profile) { setLoaded("failed"); return; }
        if (!p.canManage) { setLoaded("denied"); return; }
        if (s && s.ready === false) { setLoaded("not_ready"); return; }
        const profile = p.profile as OrgProfile;
        const openUnits = (s?.units ?? []).filter((u: { status: string }) => u.status === "active").length;
        setExisting(openUnits);
        setWasDone(!!profile.setupCompletedAt);
        setState(initialWizard(profile.saved
          ? { orgType: profile.orgType, terms: profile.terms, modules: profile.modules, displayName: profile.displayName, timezone: profile.timezone, hasExistingUnits: openUnits > 0 }
          : { hasExistingUnits: openUnits > 0 }));
        setLoaded("ready");
      } catch { setLoaded("failed"); }
    })();
  }, []);

  useEffect(() => { heading.current?.focus(); }, [state?.step, done]);

  if (loaded === "loading") return <Frame><p className="text-sm text-t-phos-dim">Getting your organization...</p></Frame>;
  if (loaded === "denied") return (
    <Frame>
      <h1 className="text-2xl font-bold text-t-white mb-2">Set up your organization</h1>
      <p className="text-sm text-t-phos">Only your organization&apos;s owner can change its setup. Ask them, or look at how it is organized on the Structure page.</p>
      <Link href="/dashboard/structure" className="t-focus inline-block mt-4 text-sm font-semibold text-t-amber-bright underline underline-offset-4">Structure</Link>
    </Frame>
  );
  if (loaded === "not_ready") return <Frame><p className="text-sm text-t-phos">Setup is not switched on yet. Try again after the next update.</p></Frame>;
  if (loaded === "failed" || !state) return (
    <Frame>
      <p role="alert" className="text-sm text-t-white">This page did not load. Nothing was changed.</p>
      <button type="button" onClick={() => location.reload()} className={`${quiet} mt-3`}>Try again</button>
    </Frame>
  );

  if (done) return (
    <Frame>
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold text-t-white mb-2 outline-none">You are set up</h1>
      <p className="text-sm text-t-phos mb-2">
        Your words are in place across the workspace.{done.unitsCreated > 0 ? ` ${done.unitsCreated} ${done.unitsCreated === 1 ? "group was" : "groups were"} added.` : ""}
      </p>
      <p className="text-sm text-t-phos-dim mb-6">Next: put your team in the right groups, so each person sees the {state.terms.participants} they work with.</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/dashboard/structure" className={primary}>Put staff in groups</Link>
        <Link href="/dashboard/today" className={quiet}>Go to Today</Link>
      </div>
    </Frame>
  );

  const s = state;
  const problems = stepProblems(s);
  const stepNo = WIZARD_STEPS.indexOf(s.step) + 1;
  const go = (next: WizardState) => { setMsg(null); setState(next); };

  async function finish() {
    if (busy) return;
    for (const st of WIZARD_STEPS) {
      const p = stepProblems(s, st);
      if (p.length) { setMsg(p[0]); setState({ ...s, step: st }); return; }
    }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/org/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(setupPayload(s)) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || "That did not save. Nothing was changed."); return; }
      invalidateOrgTerms(s.terms);
      setDone({ unitsCreated: d.unitsCreated ?? 0 });
    } catch {
      setMsg("That did not save. Check your connection and try again. Nothing was changed.");
    } finally { setBusy(false); }
  }

  return (
    <Frame>
      <p className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim mb-1">
        {wasDone ? "Change your setup" : "Set up your organization"} · Step {stepNo} of {WIZARD_STEPS.length}
      </p>
      <ol aria-label="Steps" className="flex gap-1 mb-5">
        {WIZARD_STEPS.map((st, i) => (
          <li key={st} aria-current={st === s.step ? "step" : undefined} className={`h-1.5 flex-1 rounded-full ${i < stepNo ? "bg-t-amber" : "bg-t-line"}`}>
            <span className="sr-only">{STEP_TITLES[st]}{st === s.step ? " (this step)" : ""}</span>
          </li>
        ))}
      </ol>
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold text-t-white mb-2 outline-none">{STEP_TITLES[s.step]}</h1>

      {s.step === "type" && <TypeStep s={s} onPick={(t) => go(chooseType(s, t))} />}
      {s.step === "words" && <WordsStep s={s} onChange={go} />}
      {s.step === "groups" && <GroupsStep s={s} existing={existing} onChange={go} />}
      {s.step === "modules" && <ModulesStep s={s} onChange={go} />}
      {s.step === "finish" && <FinishStep s={s} existing={existing} onChange={go} />}

      {(msg || (problems.length > 0 && s.step !== "type")) && (
        <p role="alert" className="text-sm text-t-amber-bright border border-t-amber bg-t-panel px-4 py-3 mt-5">{msg ?? problems[0]}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mt-6 pt-5 border-t border-t-line">
        {s.step !== "type" ? <button type="button" className={quiet} onClick={() => go({ ...s, step: prevStep(s.step) })}>Back</button> : <span />}
        {s.step === "finish" ? (
          <button type="button" className={primary} disabled={busy} onClick={finish}>{busy ? "Saving..." : wasDone ? "Save changes" : "Finish setup"}</button>
        ) : (
          <button type="button" className={primary} disabled={problems.length > 0} onClick={() => go({ ...s, step: nextStep(s.step) })}>Next</button>
        )}
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="max-w-3xl mx-auto px-4 py-8 sm:py-10">{children}</div>;
}

function TypeStep({ s, onPick }: { s: WizardState; onPick: (t: OrgType) => void }) {
  return (
    <fieldset>
      <legend className="text-sm text-t-phos-dim mb-4">Pick the closest one. It only suggests words and groups; you can change every one of them next, and again later.</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {ORG_TYPES.map((t) => (
          <label key={t} className={`focus-within:outline focus-within:outline-2 focus-within:outline-t-amber flex gap-3 items-start cursor-pointer border rounded-[4px] px-4 py-3 min-h-[44px] ${s.orgType === t ? "border-t-amber bg-t-panel" : "border-t-line bg-t-panel/60 hover:border-t-phos-dim"}`}>
            <input type="radio" name="org-type" value={t} checked={s.orgType === t} onChange={() => onPick(t)} className="t-focus mt-1" />
            <span>
              <span className="block text-sm font-semibold text-t-white">{ORG_TYPE_INFO[t].label}</span>
              <span className="block text-xs text-t-phos-dim">{ORG_TYPE_INFO[t].help}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function WordsStep({ s, onChange }: { s: WizardState; onChange: (n: WizardState) => void }) {
  return (
    <section>
      <p className="text-sm text-t-phos-dim mb-4">These words replace ours everywhere your team works. Use what people at your organization already say.</p>
      <div className="bg-t-panel border border-t-line px-4 py-3 mb-5" aria-live="polite">
        <p className="text-xs uppercase tracking-wide text-t-phos-dim mb-1">How it reads</p>
        <p className="text-sm text-t-white">{previewSentence(s.terms)}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {TERM_KEYS.map((k) => {
          const problem = termProblem(k, s.terms[k]);
          return (
            <div key={k}>
              <label htmlFor={`term-${k}`} className="block text-sm font-medium text-t-white">{TERM_LABELS[k].label}</label>
              <p id={`term-${k}-help`} className="text-xs text-t-phos-dim mb-1">{TERM_LABELS[k].help}</p>
              <input id={`term-${k}`} value={s.terms[k]} maxLength={40} onChange={(e) => onChange(setTerm(s, k, e.target.value))}
                aria-invalid={problem ? true : undefined} aria-describedby={`term-${k}-help${problem ? ` term-${k}-err` : ""}`} className={field} />
              {problem && <p id={`term-${k}-err`} className="text-xs text-t-amber-bright mt-1">{problem}</p>}
            </div>
          );
        })}
      </div>
      <button type="button" className={`${quiet} mt-5`} onClick={() => onChange(resetTerms(s))}>Use the suggested words</button>
      <p className="text-xs text-t-phos-dim mt-3">The word for the people you serve names the person, never their record. Words like &quot;offender&quot; or &quot;inmate&quot; are not accepted.</p>
    </section>
  );
}

function GroupsStep({ s, existing, onChange }: { s: WizardState; existing: number; onChange: (n: WizardState) => void }) {
  if (s.hasExistingUnits) return (
    <section>
      <p className="text-sm text-t-phos">You already have {existing} {existing === 1 ? "group" : "groups"}. Setup will leave them as they are.</p>
      <p className="text-sm text-t-phos-dim mt-2">Add, rename, move or close groups on the Structure page, any time.</p>
      <Link href="/dashboard/structure" className="t-focus inline-block mt-3 text-sm font-semibold text-t-amber-bright underline underline-offset-4">Open Structure</Link>
    </section>
  );
  const note = ORG_TEMPLATES[s.orgType ?? "other"].note;
  return (
    <section>
      <p className="text-sm text-t-phos-dim mb-2">Programs, cohorts, sites, offices or caseloads. People are enrolled in a {s.terms.program}, a cohort or a {s.terms.caseload}; staff are put in any group, and see the people in it.</p>
      <p className="text-sm text-t-phos mb-4">{note}</p>
      {s.units.length === 0 ? <p className="text-sm text-t-phos-dim bg-t-panel border border-t-line px-4 py-3">No groups yet. That is fine: you can start flat and add groups later.</p> : (
        <ul className="space-y-2" aria-label="Your groups">
          {s.units.map((u, i) => <UnitEditor key={i} unit={u} path={[i]} s={s} onChange={onChange} />)}
        </ul>
      )}
      <div className="flex flex-wrap gap-3 mt-4">
        <button type="button" className={quiet} onClick={() => onChange(addUnit(s, []))}>Add a group</button>
        <button type="button" className={quiet} onClick={() => onChange(resetUnits(s))}>Use the suggested groups</button>
      </div>
      <p className="text-xs text-t-phos-dim mt-3">{countUnits(s.units)} {countUnits(s.units) === 1 ? "group" : "groups"}, up to {UNIT_MAX_DEPTH} levels deep.</p>
    </section>
  );
}

function UnitEditor({ unit, path, s, onChange }: { unit: UnitDraft; path: TreePath; s: WizardState; onChange: (n: WizardState) => void }) {
  const id = `unit-${path.join("-")}`;
  const label = unit.name.trim() || "this group";
  return (
    <li className="bg-t-panel border border-t-line p-3" style={{ marginLeft: `${Math.min(path.length - 1, 3) * 0.75}rem` }}>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[10rem]">
          <label htmlFor={`${id}-name`} className="block text-xs text-t-phos-dim mb-1">Name</label>
          <input id={`${id}-name`} value={unit.name} maxLength={80} onChange={(e) => onChange(renameUnit(s, path, e.target.value))} className={field} />
        </div>
        <div>
          <label htmlFor={`${id}-kind`} className="block text-xs text-t-phos-dim mb-1">Kind</label>
          <select id={`${id}-kind`} value={unit.kind} onChange={(e) => onChange(setUnitKind(s, path, e.target.value as UnitKind))} className={field}>
            {UNIT_KINDS.map((k) => <option key={k} value={k}>{k === "program" || k === "site" || k === "team" || k === "caseload" ? capWord(unitKindWord(k, s.terms)) : KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          {path.length < UNIT_MAX_DEPTH && (
            <button type="button" className={quiet} onClick={() => onChange(addUnit(s, path, { kind: "cohort", name: "" }))} aria-label={`Add a group inside ${label}`}>Add inside</button>
          )}
          <button type="button" className={quiet} onClick={() => onChange(removeUnit(s, path))} aria-label={`Remove ${label}`}>Remove</button>
        </div>
      </div>
      {unit.children && unit.children.length > 0 && (
        <ul className="space-y-2 mt-2" aria-label={`Inside ${label}`}>
          {unit.children.map((c, i) => <UnitEditor key={i} unit={c} path={[...path, i]} s={s} onChange={onChange} />)}
        </ul>
      )}
    </li>
  );
}

function ModulesStep({ s, onChange }: { s: WizardState; onChange: (n: WizardState) => void }) {
  return (
    <fieldset>
      <legend className="text-sm text-t-phos-dim mb-4">Switch on what helps. Anything off stays out of your team&apos;s way, and you can turn it on later.</legend>
      <ul className="space-y-2">
        {ORG_MODULES.map((m) => (
          <li key={m}>
            <label className="flex items-start gap-3 bg-t-panel border border-t-line px-4 py-3 cursor-pointer min-h-[44px]">
              <input type="checkbox" className="t-focus mt-1" checked={s.modules[m]} onChange={(e) => onChange(setModule(s, m, e.target.checked))} />
              <span>
                <span className="block text-sm font-semibold text-t-white">{MODULE_INFO[m].label}</span>
                <span className="block text-xs text-t-phos-dim">{MODULE_INFO[m].help}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function FinishStep({ s, existing, onChange }: { s: WizardState; existing: number; onChange: (n: WizardState) => void }) {
  const on = ORG_MODULES.filter((m) => s.modules[m]).map((m) => MODULE_INFO[m].label);
  const n = countUnits(s.units);
  return (
    <section className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="setup-name" className="block text-sm font-medium text-t-white">Name to show your team (optional)</label>
          <p id="setup-name-help" className="text-xs text-t-phos-dim mb-1">Leave it blank to keep the name you signed up with.</p>
          <input id="setup-name" value={s.displayName} maxLength={120} aria-describedby="setup-name-help" onChange={(e) => onChange({ ...s, displayName: e.target.value })} className={field} />
        </div>
        <div>
          <label htmlFor="setup-tz" className="block text-sm font-medium text-t-white">Time zone</label>
          <p className="text-xs text-t-phos-dim mb-1">Used for due dates and &quot;today&quot;.</p>
          <select id="setup-tz" value={s.timezone} onChange={(e) => onChange({ ...s, timezone: e.target.value })} className={field}>
            {!COMMON_TIMEZONES.some((z) => z.id === s.timezone) && <option value={s.timezone}>{s.timezone}</option>}
            {COMMON_TIMEZONES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
          </select>
        </div>
      </div>
      <dl className="bg-t-panel border border-t-line divide-y divide-t-line text-sm">
        <Row k="Kind of organization" v={ORG_TYPE_INFO[s.orgType ?? "other"].label} />
        <Row k="Your words" v={`${s.terms.participant} / ${s.terms.participants}, ${s.terms.case_manager}, ${s.terms.program}, ${s.terms.site}`} />
        <Row k="Groups" v={s.hasExistingUnits ? `Keeping your ${existing} existing ${existing === 1 ? "group" : "groups"}` : n === 0 ? "None yet" : `${n} to add`} />
        <Row k="Switched on" v={on.length ? on.join(", ") : "Nothing extra"} />
      </dl>
      <p className="text-xs text-t-phos-dim">Saving records who changed the setup and when. You can come back here from Settings at any time.</p>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="px-4 py-2 sm:flex sm:gap-4">
      <dt className="text-t-phos-dim sm:w-48 shrink-0">{k}</dt>
      <dd className="text-t-white">{v}</dd>
    </div>
  );
}

function capWord(w: string) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : w; }
