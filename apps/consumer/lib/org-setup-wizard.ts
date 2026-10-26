/**
 * The setup wizard's state, pure (house lane L3a). The component
 * (components/org/OrgSetupWizard.tsx) only renders this and calls these
 * functions; the tests (lib/__tests__/org-setup-wizard.test.ts) run them.
 *
 * Picking a type fills the words, modules and groups from that type's
 * template, but never over something the admin already changed by hand.
 */
import {
  checkUnitTree, normalizeTerms, templateFor, UNIT_MAX_DEPTH, DEFAULT_TIMEZONE,
  type OrgModules, type OrgModule, type OrgTerms, type OrgType, type TermKey, type UnitDraft, type UnitKind,
} from "@crucible/core/src/orgStructureShared";

export const WIZARD_STEPS = ["type", "words", "groups", "modules", "finish"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];
export const STEP_TITLES: Record<WizardStep, string> = {
  type: "What kind of organization is this?",
  words: "The words your team uses",
  groups: "How your work is organized",
  modules: "What you want to use",
  finish: "Check and finish",
};

export interface WizardState {
  step: WizardStep;
  orgType: OrgType | null;
  terms: OrgTerms;
  modules: OrgModules;
  units: UnitDraft[];
  displayName: string;
  timezone: string;
  /** What the admin changed by hand; a new type never overwrites these. */
  touched: { terms: Partial<Record<TermKey, true>>; modules: Partial<Record<OrgModule, true>>; units: boolean };
  /** The organization already has groups: setup leaves them alone. */
  hasExistingUnits: boolean;
}

export function initialWizard(opts: { orgType?: OrgType | null; terms?: OrgTerms; modules?: OrgModules; displayName?: string | null; timezone?: string; hasExistingUnits?: boolean } = {}): WizardState {
  const base = templateFor(opts.orgType ?? "other");
  return {
    step: "type",
    orgType: opts.orgType ?? null,
    terms: opts.terms ? { ...opts.terms } : base.terms,
    modules: opts.modules ? { ...opts.modules } : base.modules,
    units: opts.hasExistingUnits ? [] : base.units,
    displayName: opts.displayName ?? "",
    timezone: opts.timezone ?? DEFAULT_TIMEZONE,
    // Words and modules that came from a saved profile count as chosen.
    touched: {
      terms: opts.terms ? Object.fromEntries(Object.keys(opts.terms).map((k) => [k, true])) as Partial<Record<TermKey, true>> : {},
      modules: opts.modules ? Object.fromEntries(Object.keys(opts.modules).map((k) => [k, true])) as Partial<Record<OrgModule, true>> : {},
      units: false,
    },
    hasExistingUnits: !!opts.hasExistingUnits,
  };
}

/** Pick a type: untouched words, modules and groups follow its template. */
export function chooseType(s: WizardState, type: OrgType): WizardState {
  const t = templateFor(type);
  const terms = { ...s.terms };
  for (const k of Object.keys(t.terms) as TermKey[]) if (!s.touched.terms[k]) terms[k] = t.terms[k];
  const modules = { ...s.modules };
  for (const k of Object.keys(t.modules) as OrgModule[]) if (!s.touched.modules[k]) modules[k] = t.modules[k];
  return { ...s, orgType: type, terms, modules, units: s.hasExistingUnits || s.touched.units ? s.units : t.units };
}

/** Reset words to the chosen type's suggestions (the "Use the suggested words" button). */
export function resetTerms(s: WizardState): WizardState {
  return { ...s, terms: templateFor(s.orgType ?? "other").terms, touched: { ...s.touched, terms: {} } };
}

export function setTerm(s: WizardState, key: TermKey, value: string): WizardState {
  return { ...s, terms: { ...s.terms, [key]: value }, touched: { ...s.touched, terms: { ...s.touched.terms, [key]: true } } };
}

export function setModule(s: WizardState, key: OrgModule, on: boolean): WizardState {
  return { ...s, modules: { ...s.modules, [key]: on }, touched: { ...s.touched, modules: { ...s.touched.modules, [key]: true } } };
}

/* ---------------------------------------------------------- the tree --- */

/** A path is the index at each level: [0] top first, [0, 2] its third child. */
export type TreePath = number[];

function mapAt(nodes: UnitDraft[], path: TreePath, fn: (n: UnitDraft) => UnitDraft | null): UnitDraft[] {
  const [i, ...rest] = path;
  const out: UnitDraft[] = [];
  nodes.forEach((n, idx) => {
    if (idx !== i) { out.push(n); return; }
    if (rest.length === 0) { const r = fn(n); if (r) out.push(r); return; }
    out.push({ ...n, children: mapAt(n.children ?? [], rest, fn) });
  });
  return out;
}

export function renameUnit(s: WizardState, path: TreePath, name: string): WizardState {
  return { ...s, units: mapAt(s.units, path, (n) => ({ ...n, name })), touched: { ...s.touched, units: true } };
}
export function setUnitKind(s: WizardState, path: TreePath, kind: UnitKind): WizardState {
  return { ...s, units: mapAt(s.units, path, (n) => ({ ...n, kind })), touched: { ...s.touched, units: true } };
}
export function removeUnit(s: WizardState, path: TreePath): WizardState {
  return { ...s, units: mapAt(s.units, path, () => null), touched: { ...s.touched, units: true } };
}
/** Add a group at the top (path []) or inside the group at `path`; refused past 4 levels. */
export function addUnit(s: WizardState, path: TreePath, unit: UnitDraft = { kind: "program", name: "" }): WizardState {
  if (path.length === 0) return { ...s, units: [...s.units, unit], touched: { ...s.touched, units: true } };
  if (path.length >= UNIT_MAX_DEPTH) return s;
  return { ...s, units: mapAt(s.units, path, (n) => ({ ...n, children: [...(n.children ?? []), unit] })), touched: { ...s.touched, units: true } };
}
export function resetUnits(s: WizardState): WizardState {
  return { ...s, units: templateFor(s.orgType ?? "other").units, touched: { ...s.touched, units: false } };
}

/* ---------------------------------------------------------- checking --- */

/** What stops this step from moving on, in plain words. Empty = fine. */
export function stepProblems(s: WizardState, step: WizardStep = s.step): string[] {
  switch (step) {
    case "type": return s.orgType ? [] : ["Pick the closest one. You can change it later."];
    case "words": return normalizeTerms(s.terms).problems.map((p) => p.message).filter((m, i, a) => a.indexOf(m) === i);
    case "groups": return s.hasExistingUnits ? [] : checkUnitTree(s.units).map((p) => p.message).filter((m, i, a) => a.indexOf(m) === i);
    case "modules": return [];
    case "finish": return s.displayName.trim().length > 120 ? ["Keep the name to 120 characters."] : [];
  }
}

export function nextStep(step: WizardStep): WizardStep {
  const i = WIZARD_STEPS.indexOf(step);
  return WIZARD_STEPS[Math.min(i + 1, WIZARD_STEPS.length - 1)];
}
export function prevStep(step: WizardStep): WizardStep {
  const i = WIZARD_STEPS.indexOf(step);
  return WIZARD_STEPS[Math.max(i - 1, 0)];
}

/** The body POSTed to /api/org/setup. */
export function setupPayload(s: WizardState): Record<string, unknown> {
  return {
    orgType: s.orgType,
    displayName: s.displayName.trim() || null,
    timezone: s.timezone,
    terms: s.terms,
    modules: s.modules,
    units: s.hasExistingUnits ? [] : s.units.map(function clean(n: UnitDraft): UnitDraft {
      return { kind: n.kind, name: n.name.trim(), children: (n.children ?? []).map(clean) };
    }),
  };
}

/** A sentence that shows the words in use, for the preview. */
export function previewSentence(t: OrgTerms): string {
  return `Alma is the ${t.case_manager} for 12 ${t.participants}. Each ${t.participant} has one ${t.enrollment} in a ${t.program} at the main ${t.site}.`;
}

/** Count groups in a tree. */
export function countUnits(nodes: readonly UnitDraft[]): number {
  return nodes.reduce((n, u) => n + 1 + countUnits(u.children ?? []), 0);
}
