"use client";
/**
 * useOrgModules(): the organization's module switches (org_profile.modules,
 * migration 103) for the staff sidebar, so a switched-off module (referrals,
 * custom fields) leaves the nav instead of opening a page that says "off".
 *
 * Safe by default: until the profile loads, and on any failure, the answer is
 * null, which the nav reads as "all on" (the behaviour before this hook). One
 * request per five minutes, shared by every caller. Only staff call it
 * (enabled false for everyone else), and GET /api/org/profile checks
 * org.cohort.view itself.
 */
import { useEffect, useState } from "react";

export type OrgModules = Readonly<Record<string, boolean>>;

const TTL_MS = 5 * 60 * 1000;
// Keyed by organization, so an account that changes organization (or a view-as) never reads another org's switches.
let cache: { key: string; modules: OrgModules | null; at: number } | null = null;
let inflight: { key: string; p: Promise<OrgModules | null> } | null = null;

/** Only boolean switches survive: anything else in the payload is ignored. Pure, exported for tests. */
export function readModules(payload: unknown): OrgModules | null {
  const raw = (payload as { profile?: { modules?: unknown } } | null)?.profile?.modules;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "boolean") out[k] = v;
  return out;
}

export function loadOrgModules(orgKey: string | null | undefined, fetcher: typeof fetch = fetch): Promise<OrgModules | null> {
  const key = orgKey ?? "";
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.modules);
  if (inflight && inflight.key === key) return inflight.p;
  const p = fetcher("/api/org/profile", { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then(readModules)
    .catch(() => null)
    .then((modules) => { cache = { key, modules, at: Date.now() }; if (inflight?.key === key) inflight = null; return modules; });
  inflight = { key, p };
  return p;
}

export function resetOrgModulesCache(): void { cache = null; inflight = null; }

export function useOrgModules(enabled: boolean, orgKey: string | null | undefined): OrgModules | null {
  const key = orgKey ?? "";
  const [modules, setModules] = useState<OrgModules | null>(() => (enabled && cache?.key === key ? cache.modules : null));
  useEffect(() => {
    if (!enabled) { setModules(null); return; }
    let live = true;
    setModules(cache?.key === key ? cache.modules : null);
    loadOrgModules(key).then((m) => { if (live) setModules(m); });
    return () => { live = false; };
  }, [enabled, key]);
  return modules;
}
