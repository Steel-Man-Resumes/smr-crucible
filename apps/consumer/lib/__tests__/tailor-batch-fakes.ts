/**
 * Test doubles for multi-job tailoring: an in-memory account (application
 * rows, artifacts, AI actions), a claim store with the same rules as the
 * migration 093 statement, and stand-ins for the three inner route handlers.
 * The generator is a fake. No provider and no database are ever reached.
 */
import type { ClaimStore } from "../tailor-batch-route";
import type { ClaimResult, PendingResult } from "../tailor-batch-server";

export const RESUME = { formatVersion: 3, meta: { targetJob: "x" }, experience: [], skills: [] };
const STALE_MS = 6 * 60_000;

export interface AccountOptions {
  failTitles?: Set<string>;
  failSaveOnce?: Set<string>;
  allowance?: number;
  flags?: string[];
  /** Resolves the generator only when the test says so (two-tab races). */
  hold?: Promise<void>;
  /** Advance this clock while the generator runs (timeouts). */
  onGenerate?: () => void;
}

export function makeAccount(userId = "00000000-0000-4000-8000-0000000000a1", opts: AccountOptions = {}) {
  const applications: Array<{ id: string; title: string; company: string; source_id: string; status: string }> = [];
  const artifacts: Array<{ id: string; type: string; targetContext: Record<string, unknown>; content: unknown; laneId: string | null }> = [];
  const claimRows = new Map<string, { status: string; attempts: number; claimedAt: number; artifactId: string | null; applicationId: string | null; pending: PendingResult | null }>();
  const counters = { actions: 0, generatorCalls: 0, clock: 1_000_000 };
  let seq = 0;
  const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const failSave = new Set(opts.failSaveOnce ?? []);

  const claims: ClaimStore = {
    async ready() {},
    async claim(key): Promise<ClaimResult> {
      const row = claimRows.get(key);
      if (!row) { claimRows.set(key, { status: "running", attempts: 1, claimedAt: counters.clock, artifactId: null, applicationId: null, pending: null }); return { kind: "claimed", attempts: 1 }; }
      const takeover = row.status === "failed" || row.status === "generated" || (row.status === "running" && row.claimedAt < counters.clock - STALE_MS);
      if (takeover) {
        Object.assign(row, { status: "running", attempts: Math.min(row.attempts + 1, 50), claimedAt: counters.clock });
        if (row.pending) return { kind: "pending", pending: row.pending, applicationId: row.applicationId };
        return { kind: "claimed", attempts: row.attempts, applicationId: row.applicationId };
      }
      if (row.status === "saved" && row.artifactId) return { kind: "saved", artifactId: row.artifactId, applicationId: row.applicationId };
      return { kind: "busy" };
    },
    async release(key) { const r = claimRows.get(key); if (r && r.status === "running") r.status = "failed"; },
    async markGenerated(key, pending, applicationId) { Object.assign(claimRows.get(key)!, { status: "generated", pending, applicationId }); },
    async markSaved(key, artifactId, applicationId) { Object.assign(claimRows.get(key)!, { status: "saved", artifactId, applicationId, pending: null }); },
    async findSaved(key) { return artifacts.find(a => a.type === "resume" && a.targetContext.batchKey === key)?.id ?? null; },
  };

  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const guard = (request: Request) => {
    // The real artifacts route enforces this header (app/api/artifacts/route.ts:143-148).
    const expected = request.headers.get("x-expected-account-id");
    return expected !== null && expected !== userId ? json({ error: "Your account changed. Reload before saving this work." }, 409) : null;
  };
  const inner = {
    async applications(request: Request) {
      const body = await request.json();
      const existing = applications.find(a => a.source_id && a.source_id === body.source_id);
      if (existing) return json({ application: { id: existing.id, status: existing.status }, duplicate: true });
      const row = { id: id(), title: body.job_title, company: body.company, source_id: body.source_id || "", status: body.status || "saved" };
      applications.push(row);
      return json({ application: row }, 201);
    },
    async artifacts(request: Request) {
      const refused = guard(request);
      if (refused) return refused;
      const body = await request.json();
      if (body.type === "resume" && failSave.has(body.targetContext.targetJob)) { failSave.delete(body.targetContext.targetJob); return json({ error: "Failed to save." }, 500); }
      const row = { id: id(), type: body.type, targetContext: body.targetContext, content: body.content, laneId: body.laneId ?? null };
      artifacts.push(row);
      return json({ data: { id: row.id } }, 201);
    },
    async generate(request: Request) {
      counters.generatorCalls++;
      const body = await request.json();
      const title = body.job.title as string;
      if (opts.hold) await opts.hold;
      opts.onGenerate?.();
      if (opts.allowance !== undefined && counters.actions >= opts.allowance) return json({ code: "tool_allowance_used", error: "Your current AI allowance or spending limit is reached." }, 429);
      if (opts.failTitles?.has(title)) return json({ error: "Could not generate career package. Please try again." }, 500);
      counters.actions++;
      return json({ resume: { ...RESUME, meta: { targetJob: title } }, coverLetter: `Letter for ${title}`, grounding: { flags: (opts.flags ?? []).map(claim => ({ claim })) }, tailoringNotes: ["note"], echo: body });
    },
  };
  return { userId, applications, artifacts, claimRows, claims, inner, counters };
}
