/**
 * The staff t.ROY tool registry (lane S1, staff pass 2026-10-27).
 *
 * buildStaffTools (assistant-staff-tools.ts) builds the core reads and
 * drafts, then merges every module listed here BEFORE it wraps the set in
 * the five-call budget and the evidence collector, so a module's tools obey
 * the same budget, the same one-person hold and the same logging.
 *
 * TO ADD A LANE'S TOOLS: export a StaffToolModule from
 * lib/tools/staff/<name>.ts (see ./types.ts for the rules) and add it to
 * STAFF_TOOL_MODULES. Nothing else: the route, the answer stream and the
 * chat's activity lines read this list. A name used twice throws at build
 * time, so a lane cannot shadow another lane's tool or a core tool.
 *
 * Safe to import in the browser: the chat reads the activity lines and the
 * streamed list from here (modules never import @crucible/core at the top).
 */
import type { ToolSet } from "ai";
import type { StaffToolContext, StaffToolModule } from "./types";
import { navigationTools } from "./navigate";
import { directoryTools } from "./directory";

export type { StaffToolContext, StaffToolModule } from "./types";

export const STAFF_TOOL_MODULES: readonly StaffToolModule[] = [
  navigationTools,
  directoryTools,
  // Boss wiring, staff pass lanes (each lane's file exports its module):
  // S3 viewTools (./view-tools), S5 handoffTools (./handoff-tools), S6 directory contribution tools.
];

/** Every module's tools, merged. Throws on a duplicate name, including one already in `existing`. */
export function composeStaffTools(ctx: StaffToolContext, existing: ToolSet = {}, modules: readonly StaffToolModule[] = STAFF_TOOL_MODULES): ToolSet {
  const out: ToolSet = {};
  for (const m of modules) {
    for (const [name, t] of Object.entries(m.build(ctx))) {
      if (name in existing || name in out) throw new Error(`staff tool "${name}" is defined twice (module ${m.id})`);
      // Every module tool fails closed: a thrown error is "unavailable", never an empty answer.
      const run = t.execute;
      if (run) {
        t.execute = async (args, options) => {
          try { return await run(args, options); }
          catch { return { status: "unavailable", error: "This step failed. Do not guess, and do not treat it as empty." }; }
        };
      }
      out[name] = t;
    }
  }
  return out;
}

/** Tools whose results the checked staff answer re-emits, so the chat can show their button or card. */
export function staffStreamedTools(modules: readonly StaffToolModule[] = STAFF_TOOL_MODULES): ReadonlySet<string> {
  return new Set(modules.flatMap((m) => m.streamed ?? []));
}

/** The chat's activity line for each module tool. */
export function staffToolActivity(modules: readonly StaffToolModule[] = STAFF_TOOL_MODULES): Readonly<Record<string, string>> {
  return Object.assign({}, ...modules.map((m) => m.activity ?? {}));
}
