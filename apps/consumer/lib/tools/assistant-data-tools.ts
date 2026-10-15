import { tool, jsonSchema, type ToolSet } from "ai";
import { checkPremium } from "../premium-server";
import { ResourceListSelection } from "@crucible/core/src/resourceListShared";
import { applyExactCorrection } from "../assistant-correction";
import { RESOURCE_AREAS } from "@crucible/core/src/resourceDirectoryShared";
import type { SelectedWork } from "../assistant-work-context";

/** Share one in-flight/result promise per input in a request; failures never become empty coverage. */
export function oncePerInput<A, R>(run: (args: A) => Promise<R>) {
  const calls = new Map<string, Promise<R>>();
  return (args: A) => {
    const key = JSON.stringify(args);
    if (!calls.has(key)) calls.set(key, run(args));
    return calls.get(key)!;
  };
}
const objectSchema = <T>(properties: Record<string, unknown>, required: string[] = []) => jsonSchema<T>({ type: "object", properties, required, additionalProperties: false });
const id = { type: "string", pattern: "^[0-9a-fA-F-]{36}$" };
const text = { type: "string", maxLength: 160 };
function safe<A, R>(run: (args: A) => Promise<R>) {
  return oncePerInput(async (args: A) => {
    try { return await run(args); }
    catch { return { status: "unavailable", error: "The lookup could not be completed. Do not describe this as no coverage or a completed save." }; }
  });
}
export function buildDataTools(userId: string, selectedWork?: SelectedWork | null): ToolSet {
  async function resourceGate<T>(read: () => Promise<T>): Promise<T | { status: "blocked"; error: string }> {
    const blocked = await checkPremium(userId, "resources");
    if (blocked) { const body = await blocked.json(); return { status: "blocked", error: body.error }; }
    return read();
  }
  return {
    search_verified_employers: tool({
      description: "Search published employer evidence, separately from live job openings. Explain location, scope, source, checked/expiry dates and caveats. Never infer acceptance of a person's record.",
      parameters: objectSchema<{q?: string; state?: string; industry?: string}>({ q: text, state: { type: "string", minLength: 2, maxLength: 2 }, industry: text }),
      execute: safe(async (args) => { const result = await (await import("@crucible/core")).searchVerifiedEmployers(args); return { ...result, data: result.data.slice(0, 8), more: result.data.length > 8 }; }),
    }),
    get_verified_employer: tool({
      description: "Read one current published employer by canonical ID. Unavailable/withdrawn evidence is never a recommendation.",
      parameters: objectSchema<{id: string}>({ id }, ["id"]),
      execute: safe(async ({ id }) => (await import("@crucible/core")).getVerifiedEmployer(id)),
    }),
    search_verified_resources: tool({
      description: "Find published support services for a location and needs the person supplied. Ask only missing eligibility questions. Do not infer location or eligibility from private papers. Empty coverage and lookup failure are different.",
      parameters: objectSchema<{state: string | null; areas: string[]; countyKeys?: string[]; cityKey?: string; zip?: string}>({ state: { type: ["string", "null"], maxLength: 2 }, areas: { type: "array", items: { type: "string", enum: [...RESOURCE_AREAS] }, minItems: 1, maxItems: 5 }, countyKeys: { type: "array", items: text, maxItems: 5 }, cityKey: text, zip: { type: "string", maxLength: 10 } }, ["state", "areas"]),
      execute: safe(async (args) => resourceGate(async () => { const result = await (await import("@crucible/core")).searchVerifiedResources(args); return { ...result, data: result.data.slice(0, 8), more: result.data.length > 8 }; })),
    }),
    get_verified_resource: tool({
      description: "Read current published service contact/apply details, eligibility, fees, documents and limits by canonical ID. Unknown requirements stay unknown. Never invent an appointment or receipt of service.",
      parameters: objectSchema<{id: string}>({ id }, ["id"]),
      execute: safe(async ({ id }) => resourceGate(async () => (await import("@crucible/core")).getVerifiedResource(id))),
    }),
    search_resource_chains: tool({
      description: "Find approved support plans by the supplied state and goal. Returns real chain keys for get_resource_chain, never inferred keys.",
      parameters: objectSchema<{state?: string; q?: string}>({ state: { type: "string", minLength: 2, maxLength: 2 }, q: text }),
      execute: safe(async (args) => resourceGate(async () => {
        const result = await (await import("@crucible/core")).searchApprovedResourceChains(args);
        return { ...result, data: result.data.slice(0, 8), more: result.data.length > 8 };
      })),
    }),
    read_saved_resources: tool({
      description: "Read your saved resource choices and refresh their current sources. Without an artifact ID, list your latest saved lists. A withdrawn/expired service stays unavailable; saving never meant service receipt.",
      parameters: objectSchema<{artifactId?: string}>({ artifactId: id }),
      execute: safe(async ({ artifactId }) => resourceGate(async () => {
        const core = await import("@crucible/core");
        if (artifactId) return core.reopenResourceList(userId, artifactId);
        const lists = await core.listArtifacts(userId, { type: "resource_list", limit: 10 });
        return { status: "ok", readAt: new Date().toISOString(), lists: lists.map((a) => ({ artifactId: a.id, savedAt: a.created_at })) };
      })),
    }),
    get_resource_chain: tool({
      description: "Read approved prerequisite steps for a published service chain. Only use chain keys from published search/detail results; do not invent dependencies.",
      parameters: objectSchema<{chainKey: string}>({ chainKey: text }, ["chainKey"]),
      execute: safe(async ({ chainKey }) => resourceGate(async () => (await import("@crucible/core")).getApprovedResourceChain(chainKey))),
    }),
    save_resource_list: tool({
      description: "Prepare a confirmation card for the person's chosen published resources and steps. The person must click Save in the card; this tool does not save or book anything. Never say saved until the browser reports the actual save.",
      parameters: objectSchema<{serviceIds: string[]; chainKeys?: string[]}>({ serviceIds: { type: "array", items: id, maxItems: 10 }, chainKeys: { type: "array", items: text, maxItems: 5 } }, ["serviceIds"]),
      execute: safe(async (raw) => {
        const args = ResourceListSelection.parse(raw);
        const blocked = await checkPremium(userId, "resources");
        if (blocked) return { status: "blocked", error: (await blocked.json()).error };
        const c = await import("@crucible/core");
        const records = await Promise.all(args.serviceIds.map((id) => c.getVerifiedResource(id)));
        if (records.some((r) => r.status !== "ok" || !r.data)) return { status: "unavailable", error: "A selected service is no longer available. Refresh the results." };
        const chains = await Promise.all(args.chainKeys.map((key) => c.getApprovedResourceChain(key)));
        if (chains.some((r) => r.status !== "ok" || !r.data.length)) return { status: "unavailable", error: "An approved step list changed or is unavailable. Refresh it first." };
        return { status: "needs_confirmation", action: "save_resources", serviceIds: args.serviceIds, chainKeys: args.chainKeys, names: [...records.map((r) => r.data?.service_name ?? r.data?.org_name ?? "Service"), ...chains.map((r) => r.data[0]?.goal ?? "Approved steps")], saved: false };
      }),
    }),
    preview_document_correction: tool({
      description: "Preview a single exact text correction in the selected saved resume. Use only facts the person gave. Does not save; a visible before/after card requires their click. Changing work facts requires the person's own correction, never an invented fact.",
      parameters: objectSchema<{before: string; after: string}>({ before: { type: "string", minLength: 1, maxLength: 2000 }, after: { type: "string", maxLength: 2000 } }, ["before", "after"]),
      execute: safe(async ({ before, after }) => {
        if (!selectedWork?.revision) return { status: "unavailable", error: "Open the saved resume to correct first." };
        const c = await import("@crucible/core");
        const revision = await c.getLatestRevision(userId, selectedWork.revision.artifactId);
        if (!revision || revision.doc_kind !== "resume" || revision.id !== selectedWork.revision.id) return { status: "unavailable", error: "The resume changed. Reopen it before previewing a correction." };
        if (!applyExactCorrection(revision.resume_text, before, after)) return { status: "unavailable", error: "The exact text must appear once. Choose a more specific passage." };
        return { status: "needs_confirmation", action: "correct_document", revisionId: revision.id, artifactId: revision.artifact_id, before, after, saved: false };
      }),
    }),
  };
}
