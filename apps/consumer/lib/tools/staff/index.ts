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
import type { StaffToolContext, StaffToolModule, StreamedShape } from "./types";
import { navigationTools } from "./navigate";
import { directoryTools } from "./directory";
import { viewToolsModule } from "./view-tools";
import { handoffToolModule } from "./handoff-tools";

export type { StaffToolContext, StaffToolModule, StreamedShape, StreamedFieldSource } from "./types";

export const STAFF_TOOL_MODULES: readonly StaffToolModule[] = [
  navigationTools,
  directoryTools,
  // Staff pass lanes (integration 2026-10-28): S3 own-view tools, S5 handoffs.
  // S4 adds no t.ROY tool. S6 contribution tools join when S6 merges.
  viewToolsModule,
  handoffToolModule,
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
  return new Set(modules.flatMap((m) => Object.keys(m.streamed ?? {})));
}

/** Each streamed tool's declared result shape (types.ts StreamedShape). */
export function staffStreamedShapes(modules: readonly StaffToolModule[] = STAFF_TOOL_MODULES): ReadonlyMap<string, StreamedShape> {
  return new Map(modules.flatMap((m) => Object.entries(m.streamed ?? {})));
}

/** Problems with a module's declarations (a registry test runs this on every module). Empty means sound. */
export function streamedDeclarationProblems(modules: readonly StaffToolModule[] = STAFF_TOOL_MODULES): string[] {
  const problems: string[] = [];
  for (const m of modules) {
    for (const [toolName, shape] of Object.entries(m.streamed ?? {})) {
      for (const [key, source] of Object.entries(shape)) {
        if (!["server", "staff", "draft"].includes(source)) problems.push(`${m.id}.${toolName}.${key}: unknown source ${String(source)}`);
        if (source === "draft" && key !== "draftBody") problems.push(`${m.id}.${toolName}.${key}: only draftBody may hold model-written words`);
      }
      if (!Object.hasOwn(shape, "status")) problems.push(`${m.id}.${toolName}: status must be declared`);
    }
  }
  return problems;
}

/** The chat's activity line for each module tool. */
export function staffToolActivity(modules: readonly StaffToolModule[] = STAFF_TOOL_MODULES): Readonly<Record<string, string>> {
  return Object.assign({}, ...modules.map((m) => m.activity ?? {}));
}
