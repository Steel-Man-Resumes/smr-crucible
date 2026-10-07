/**
 * Carrying a Forge run onto a NEW account: only with the person's yes.
 *
 * Shared-computer rule (hotfix 2026-10-07). The create-account form used to
 * send whatever Forge run sat in this browser's localStorage, and
 * /api/auth/register saved it into the new account. On a library or
 * reentry-center computer that put the previous person's resume and record
 * answers into the next person's account. Now the form shows an UNTICKED box,
 * and both sides need an explicit yes: the form sends the run only when the
 * box is ticked, and the route saves it only when the body also carries
 * `saveForgeRun: true`.
 *
 * No imports on purpose: the login page (client) and the register route
 * (server) both use this file.
 */

/** The save box starts unticked. Never make this true. */
export const SAVE_FORGE_RUN_DEFAULT = false;

/** Largest Forge run register will save (UTF-8 bytes of its JSON). Same cap as /api/forge/save. */
export const MAX_FORGE_RUN_BYTES = 1_000_000;

/** Largest register request body, measured on what actually arrived. */
export const MAX_REGISTER_BODY_BYTES = 1_500_000;

type ForgeRun = Record<string, any>;

function asRun(v: unknown): ForgeRun | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as ForgeRun) : null;
}

/** Is there work worth saving? The same test register has always applied. */
export function forgeRunHasWork(v: unknown): boolean {
  const run = asRun(v);
  return !!run && !!(run.forgeOutput || run.resumeText);
}

/** The name on the resume in the run, if any, for the "(started by ...)" line. */
export function forgeRunName(v: unknown): string {
  const run = asRun(v);
  const raw = run?.resumeDoc?.contact?.name || run?.forgeOutput?.contact?.name;
  return typeof raw === "string" ? raw.trim().slice(0, 80) : "";
}

/** The run stored in this browser (raw localStorage value), or null when it has no work. */
export function readStoredForgeRun(stored: string | null): ForgeRun | null {
  if (!stored) return null;
  try {
    const run = JSON.parse(stored);
    return forgeRunHasWork(run) ? (run as ForgeRun) : null;
  } catch {
    return null;
  }
}

/** Client: the Forge fields for the register body. Nothing unless the box is ticked. */
export function forgeRegisterFields(
  run: unknown,
  saveTicked: boolean
): { forge?: ForgeRun; saveForgeRun?: true } {
  if (saveTicked !== true || !forgeRunHasWork(run)) return {};
  return { forge: run as ForgeRun, saveForgeRun: true };
}

export type ForgeRunDecision =
  | { ok: true; run: ForgeRun | null }
  | { ok: false; reason: "too_large" };

/**
 * Server: the run register may persist. `run` is null unless the body says
 * `saveForgeRun: true` AND carries a run with work in it. Never logs or
 * returns anything about the run's contents.
 */
export function forgeRunToPersist(body: unknown): ForgeRunDecision {
  const b = asRun(body);
  if (!b || b.saveForgeRun !== true || !forgeRunHasWork(b.forge)) {
    return { ok: true, run: null };
  }
  const bytes = new TextEncoder().encode(JSON.stringify(b.forge)).length;
  if (bytes > MAX_FORGE_RUN_BYTES) return { ok: false, reason: "too_large" };
  return { ok: true, run: b.forge as ForgeRun };
}
