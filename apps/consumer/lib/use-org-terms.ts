"use client";
/**
 * useOrgTerms(): the organization's own words ("participant", "case
 * manager", "program"...) for any staff screen (house lane L3a).
 *
 * Safe by default: the first render, a signed-out page, a person in no
 * organization, a failed request and an organization that never ran setup all
 * get the default words, never a blank and never an error. One request per
 * page load is shared by every component that asks (module cache, five
 * minutes), and the setup wizard calls invalidateOrgTerms() after saving so
 * the new words show without a reload.
 *
 * Server code uses getOrgTerms(orgId, userId) from @crucible/core instead.
 */
import { useEffect, useState } from "react";
import {
  DEFAULT_ORG_TERMS, capTerm, pluralTerm, resolveOrgTerms, type OrgTerms, type TermKey,
} from "@crucible/core/src/orgStructureShared";

export interface OrgWords extends OrgTerms {
  /** True once the organization's own words have loaded (or failed to, and the defaults stand). */
  ready: boolean;
  /** "participant" -> "Participant", for headings and sentence starts. */
  cap: (key: TermKey) => string;
  /** Plural of a single word ("program" -> "programs"). participant uses the stored plural. */
  plural: (key: TermKey) => string;
}

/** Pure: words plus helpers. Exported for tests. */
export function orgWords(terms: OrgTerms, ready: boolean): OrgWords {
  return {
    ...terms,
    ready,
    cap: (key) => capTerm(terms[key]),
    plural: (key) => (key === "participant" || key === "participants" ? terms.participants : pluralTerm(terms[key])),
  };
}

const TTL_MS = 5 * 60 * 1000;
let cache: { terms: OrgTerms; at: number } | null = null;
let inflight: Promise<OrgTerms> | null = null;
const listeners = new Set<(t: OrgTerms) => void>();

/** Fetch (or reuse) the words. Never rejects. */
export function loadOrgTerms(fetcher: typeof fetch = fetch): Promise<OrgTerms> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.terms);
  if (inflight) return inflight;
  inflight = fetcher("/api/org/profile", { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => resolveOrgTerms(d?.profile?.terms ?? null))
    .catch(() => resolveOrgTerms(null))
    .then((terms) => {
      cache = { terms, at: Date.now() };
      inflight = null;
      listeners.forEach((l) => l(terms));
      return terms;
    });
  return inflight;
}

/** Drop the cached words (after the wizard or the words editor saves) and tell every mounted hook. */
export function invalidateOrgTerms(next?: Partial<OrgTerms>): void {
  cache = next ? { terms: { ...DEFAULT_ORG_TERMS, ...next }, at: Date.now() } : null;
  if (cache) listeners.forEach((l) => l(cache!.terms));
  else void loadOrgTerms();
}

/** Forget the cached words without reloading (tests, and sign-out). */
export function resetOrgTermsCache(): void {
  cache = null;
  inflight = null;
}

export function useOrgTerms(): OrgWords {
  const [terms, setTerms] = useState<OrgTerms>(() => cache?.terms ?? DEFAULT_ORG_TERMS);
  const [ready, setReady] = useState<boolean>(() => !!cache);
  useEffect(() => {
    let live = true;
    const on = (t: OrgTerms) => { if (live) { setTerms(t); setReady(true); } };
    listeners.add(on);
    loadOrgTerms().then(on);
    return () => { live = false; listeners.delete(on); };
  }, []);
  return orgWords(terms, ready);
}
