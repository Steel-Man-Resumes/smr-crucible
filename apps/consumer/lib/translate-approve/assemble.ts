/**
 * Translate and approve (lane D2, slice 1): assemble the approved English.
 *
 * The approved English is written into the same three places a pasted English
 * resume lives today, the fields every gate already treats as the person's own words
 * (finish-gate ownWordsFor, the writer receipt, finishKey):
 *
 *   resumeText        the page, in the order and shape of the original
 *   hookNarrative     the "work the old resume missed" sentences
 *   credentialsText   the licenses-and-training rows, rebuilt by the existing credentialRowsAsText
 *
 * Only source units enter (already English, approved, or typed English) and only while
 * their stored hash is still the hash of the current Spanish line. A pending, held,
 * removed or stale unit never does. A job header that is not source takes its duty
 * lines with it: a duty line left loose would print under the previous employer.
 *
 * Headings come from the fixed table (no model). A heading with no line under it is
 * dropped. Contact lines are copied unchanged. No gate is changed by any of this.
 */
import { credentialRowsAsText, type CredentialRowDraft } from "../credential-rows";
import type { LayoutItem, Unit } from "./units";
import { isSource, sourceText, type UnitState } from "./state";

export interface AssembleInput {
  /** The current split of the Spanish (units and layout). Approvals are checked against these hashes. */
  units: ReadonlyArray<Unit>;
  layout: ReadonlyArray<LayoutItem>;
  states: ReadonlyArray<UnitState>;
  /** The person's rows as they stand (Spanish names). Rows with no approved English name are left out. */
  credentialRows?: ReadonlyArray<CredentialRowDraft>;
}

export type LeftOutWhy = "not_source" | "stale" | "orphaned" | "no_state";

export interface Assembled {
  resumeText: string;
  hookNarrative: string;
  credentialsText: string;
  credentialRows: CredentialRowDraft[];
  /** Ids of the units that entered. */
  used: string[];
  /** Ids that did not, and why. Counts only should leave this module. */
  leftOut: Array<{ id: string; why: LeftOutWhy }>;
}

export function assemble(input: AssembleInput): Assembled {
  const unitById = new Map(input.units.map((u) => [u.id, u]));
  const stateById = new Map(input.states.map((s) => [s.id, s]));
  const used: string[] = [];
  const leftOut: Assembled["leftOut"] = [];

  /** The English a unit contributes, or null with the reason it does not. */
  const english = (id: string): string | null => {
    const unit = unitById.get(id);
    const st = stateById.get(id);
    if (!unit || !st) {
      leftOut.push({ id, why: "no_state" });
      return null;
    }
    if (st.hash !== unit.hash || st.es !== unit.es) {
      leftOut.push({ id, why: "stale" });
      return null;
    }
    if (!isSource(st, unit)) {
      leftOut.push({ id, why: "not_source" });
      return null;
    }
    used.push(id);
    return sourceText(st);
  };

  // A job header decides for its duty lines: not source means none of them enter.
  const headerOk = new Map<string, boolean>();
  for (const item of input.layout) {
    if (item.t !== "unit") continue;
    const unit = unitById.get(item.id);
    const st = stateById.get(item.id);
    if (unit?.kind === "header") headerOk.set(unit.id, !!st && st.hash === unit.hash && isSource(st, unit));
  }

  const out: string[] = [];
  let pendingHeading: string | null = null;
  let pendingBlank = false;
  const push = (line: string) => {
    if (pendingHeading !== null) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(pendingHeading);
      pendingHeading = null;
      pendingBlank = false;
    } else if (pendingBlank && out.length && out[out.length - 1] !== "") {
      out.push("");
      pendingBlank = false;
    }
    out.push(line);
  };

  for (const item of input.layout) {
    if (item.t === "blank") {
      pendingBlank = true;
    } else if (item.t === "heading") {
      pendingHeading = item.en;
    } else if (item.t === "copy") {
      push(item.text);
    } else {
      const unit = unitById.get(item.id);
      if (!unit) continue;
      if (unit.job && headerOk.get(unit.job) === false) {
        leftOut.push({ id: unit.id, why: "orphaned" });
        continue;
      }
      const text = english(unit.id);
      if (text === null) continue;
      push(`${unit.prefix}${text}`);
    }
  }
  const resumeText = out.join("\n").trim();

  // The "work the old resume missed" sentences, with the separators the person used.
  let hookNarrative = "";
  let prevSep = "";
  for (const unit of input.units) {
    if (unit.field !== "hook") continue;
    const text = english(unit.id);
    if (text === null) continue;
    hookNarrative += `${hookNarrative ? prevSep : ""}${text}`;
    prevSep = unit.sep ?? " ";
  }

  // Credential rows: the approved English name, the person's kind and year or status as they typed them.
  const rows: CredentialRowDraft[] = [];
  for (const unit of input.units) {
    if (unit.field !== "credential" || unit.row === undefined) continue;
    const text = english(unit.id);
    if (text === null) continue;
    const base = input.credentialRows?.[unit.row];
    rows.push({ name: text, kind: base?.kind ?? "", when: base?.when ?? "" });
  }

  return { resumeText, hookNarrative, credentialsText: credentialRowsAsText(rows), credentialRows: rows, used, leftOut };
}
