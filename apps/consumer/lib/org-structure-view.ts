/**
 * The Structure page's pure helpers (house lane L3a): the unit rows from
 * /api/org/structure turned into a tree, where a unit may move to, and the
 * plain lines under each unit. Tests: lib/__tests__/org-structure-view.test.ts.
 */
import {
  ENROLLABLE_KINDS, UNIT_MAX_DEPTH, pluralTerm, unitKindWord, type OrgTerms, type UnitKind,
} from "@crucible/core/src/orgStructureShared";

export interface UnitLite {
  id: string; parent_id: string | null; kind: UnitKind; name: string; status: "active" | "closed";
  staff_count: number; open_enrollments: number; capacity?: number | null;
}
export interface UnitNode<U extends UnitLite = UnitLite> { unit: U; depth: number; children: UnitNode<U>[] }

/**
 * Rows to a tree, sorted by name, closed ones dropped unless asked for. A row
 * whose parent is missing (or hidden because closed) shows at the top rather
 * than vanishing.
 */
export function buildUnitTree<U extends UnitLite>(units: readonly U[], opts: { showClosed?: boolean } = {}): UnitNode<U>[] {
  const visible = units.filter((u) => opts.showClosed || u.status === "active");
  const ids = new Set(visible.map((u) => u.id));
  const kids = new Map<string | null, U[]>();
  for (const u of visible) {
    const p = u.parent_id && ids.has(u.parent_id) ? u.parent_id : null;
    kids.set(p, [...(kids.get(p) ?? []), u]);
  }
  const sort = (a: U, b: U) => Number(a.status === "closed") - Number(b.status === "closed") || a.name.localeCompare(b.name);
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number): UnitNode<U>[] =>
    (kids.get(parent) ?? []).sort(sort).filter((u) => !seen.has(u.id) && (seen.add(u.id), true))
      .map((u) => ({ unit: u, depth, children: depth >= 10 ? [] : walk(u.id, depth + 1) }));
  return walk(null, 1);
}

/** Every id under `id` (not including it). */
export function descendantIds(units: readonly UnitLite[], id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const u of units) if (u.parent_id === cur && !out.has(u.id)) { out.add(u.id); stack.push(u.id); }
  }
  return out;
}

/** Level of a unit, top = 1. */
export function unitDepth(units: readonly UnitLite[], id: string): number {
  const byId = new Map(units.map((u) => [u.id, u]));
  let d = 0; let cur = byId.get(id); let guard = 0;
  while (cur && guard++ < 10) { d++; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
  return d;
}

/** How many levels sit under a unit (0 = none). */
export function subtreeHeight(units: readonly UnitLite[], id: string, guard = 0): number {
  if (guard > 10) return 0;
  const kids = units.filter((u) => u.parent_id === id);
  return kids.length ? 1 + Math.max(...kids.map((k) => subtreeHeight(units, k.id, guard + 1))) : 0;
}

/** Open units `id` can move under without a cycle or going past 4 levels. `null` (the top) is always allowed. */
export function moveTargets<U extends UnitLite>(units: readonly U[], id: string): U[] {
  const below = descendantIds(units, id);
  const h = subtreeHeight(units, id);
  return units.filter((u) => u.status === "active" && u.id !== id && !below.has(u.id) && unitDepth(units, u.id) + 1 + h <= UNIT_MAX_DEPTH);
}

/** "2 staff · 14 active" in the organization's words; "(that you can see)" when the counts are only the viewer's reach. */
export function unitCountsLine(u: UnitLite, terms: OrgTerms, partial: boolean): string {
  const parts = [`${u.staff_count} ${u.staff_count === 1 ? terms.staff_member : pluralTerm(terms.staff_member)}`];
  if (ENROLLABLE_KINDS.includes(u.kind)) {
    parts.push(`${u.open_enrollments} ${u.open_enrollments === 1 ? terms.participant : terms.participants}${partial ? " you can see" : ""}`);
    if (u.capacity) parts.push(`room for ${u.capacity}`);
  }
  return parts.join(" · ");
}

/** "Program", "Cohort", ... in the organization's words, capitalized. */
export function unitKindLabel(kind: UnitKind, terms: OrgTerms): string {
  const w = unitKindWord(kind, terms);
  return w.charAt(0).toUpperCase() + w.slice(1);
}
