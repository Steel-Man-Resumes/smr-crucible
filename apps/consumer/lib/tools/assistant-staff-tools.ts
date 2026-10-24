import { executionBudget } from "./tool-execution";
/** Staff tools reuse the same reach/share doors as the console. No participant coach access. */
import { tool, jsonSchema, type ToolSet } from "ai";
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";
import { oncePerInput } from "./assistant-data-tools";

export function buildStaffTools(initial: OrgActor, onEvidence?: (tool: string, result: unknown) => void): ToolSet {
  async function actor() {
    const core = await import("@crucible/core");
    const current = await core.resolveOrgActor(initial.userId);
    if (!current || current.orgId !== initial.orgId || current.viaPlatformAdmin || current.reach === "none") throw new Error("scope_unavailable");
    return current;
  }
  const safe = <A,>(run: (a: A) => Promise<unknown>) => oncePerInput(async (a: A) => {
    try { return await run(a); }
    catch { return { status: "unavailable", error: "The scoped read failed. Do not guess or treat it as an empty caseload." }; }
  });
  const tools: ToolSet = {
    read_staff_tasks: tool({
      description: "Read current tasks in your allowed organization/caseload only. Returns deadlines and state; completed and assigned tasks are distinct from participant outcomes.",
      parameters: jsonSchema<{clientId?: string}>({ type: "object", properties: { clientId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } }, additionalProperties: false }),
      execute: safe(async ({ clientId }) => {
        const current = await actor();
        const core = await import("@crucible/core");
        const enabled = await core.getOne<{crm_v2: boolean}>("SELECT crm_v2 FROM access_code WHERE id = $1", [current.orgId]);
        if (!enabled?.crm_v2) return { status: "unavailable", error: "Tasks are not enabled for this organization." };
        const rows = await core.listStaffTasks(current, { clientId });
        if (!rows) return { status: "unavailable", error: "Task access is unavailable." };
        return { status: "ok", readAt: new Date().toISOString(), tasks: rows.slice(0, 20).map((t) => ({ id: t.id, title: t.title, dueOn: t.due_on, doneAt: t.done_at, participantId: t.client_user_id, participant: t.client_name?.split(/\s+/)[0], shared: t.shared_with_participant })), more: rows.length > 20 };
      }),
    }),
    read_participant_progress: tool({
      description: "Read the selected allowed participant's shared progress through the staff content door. Sharing off stays off. Does not read private coach, disclosure text or documents.",
      parameters: jsonSchema<{clientId: string}>({ type: "object", properties: { clientId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" } }, required: ["clientId"], additionalProperties: false }),
      execute: safe(async ({ clientId }) => {
        const c = await import("@crucible/core");
        const result = await c.getClientHeader(await actor(), clientId);
        if (!result.ok) return result;
        return { status: "ok", readAt: new Date().toISOString(), participantId: clientId, data: result.rows.map((h) => ({ name: h.name?.split(/\s+/)[0], progress: h.progress, scopes: h.scopes })) };
      }),
    }),
    draft_staff_check_in: tool({
      description: "Prepare the facts for a draft about a participant you may see: a check-in message the staff member will send themselves (purpose check_in, the default) or a case note for their review (purpose case_note). Write the draft in your reply using only these facts and what the staff member reported. Nothing is saved or sent. The staff member can place the draft on the participant's page, where it stays unsaved until they save it.",
      parameters: jsonSchema<{clientId: string; purpose?: "check_in" | "case_note"}>({ type: "object", properties: { clientId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" }, purpose: { type: "string", enum: ["check_in", "case_note"] } }, required: ["clientId"], additionalProperties: false }),
      execute: safe(async ({ clientId, purpose }) => {
        const result = await (await import("@crucible/core")).getClientHeader(await actor(), clientId);
        if (!result.ok) return result;
        const kind = purpose === "case_note" ? "case_note" : "check_in";
        return {
          status: "draft_only", saved: false, sent: false, purpose: kind, participantId: clientId,
          source: result.rows.map((h) => ({ firstName: h.name?.split(/\s+/)[0], progress: h.progress })),
          instruction: kind === "case_note"
            ? "Write the note only from what the staff member told you, in plain professional language. Do not add anything they did not say. Tell them it is a draft for their review and is not saved."
            : "Offer one next step and ask what help they want. Do not invent a meeting, promise or contact attempt. Tell them it is a draft for them to send; nothing was sent.",
        };
      }),
    }),
  };
  const executeOnce = executionBudget(5);
  for (const [name, definition] of Object.entries(tools)) {
    const execute = definition.execute;
    if (execute) definition.execute = (args, options) => executeOnce(name, args, async () => { const result = await execute(args, options); onEvidence?.(name, result); return result; });
  }
  return tools;
}
