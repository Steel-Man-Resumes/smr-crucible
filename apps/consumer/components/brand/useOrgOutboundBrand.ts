"use client";
/**
 * useOrgOutboundBrand(): how the staff member's organization brands what they
 * send out (migration 107), for print headers and anything else drawn in the
 * browser. Co-branded until the answer arrives and on any failure, so a slow
 * or failed read never drops Steel Man Resumes by mistake. Never a price.
 * One request per five minutes, shared by every caller.
 */
import { useEffect, useState } from "react";
import { orgOutboundBrand, type OutboundBrand } from "@crucible/core/src/orgOutboundBrandShared";

const TTL_MS = 5 * 60 * 1000;
// Keyed by organization, so a change of organization (or a view-as) never prints another org's brand.
let cache: { key: string; brand: OutboundBrand; at: number } | null = null;
let inflight: { key: string; p: Promise<OutboundBrand | null> } | null = null;

/** Pure, exported for tests: the payload's brand, rebuilt through the one helper so a malformed answer cannot print odd words. */
export function readOutboundBrand(payload: unknown, fallbackName?: string | null): OutboundBrand {
  const b = (payload as { brand?: { orgName?: unknown; branding?: unknown } } | null)?.brand;
  const name = typeof b?.orgName === "string" && b.orgName ? b.orgName : fallbackName ?? null;
  return orgOutboundBrand({ name, branding: b?.branding });
}

export function loadOrgOutboundBrand(orgKey: string | null | undefined, fetcher: typeof fetch = fetch): Promise<OutboundBrand | null> {
  const key = orgKey ?? "";
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.brand);
  if (inflight && inflight.key === key) return inflight.p;
  const p = fetcher("/api/org/outbound-brand", { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j ? readOutboundBrand(j) : null))
    .catch(() => null)
    .then((brand) => { if (brand) cache = { key, brand, at: Date.now() }; if (inflight?.key === key) inflight = null; return brand; });
  inflight = { key, p };
  return p;
}

export function resetOrgOutboundBrandCache(): void { cache = null; inflight = null; }

/** `orgName` is what the page already shows, used until (and unless) the answer names the organization. `orgKey` keys the cache. */
export function useOrgOutboundBrand(orgName: string | null | undefined, orgKey?: string | null): OutboundBrand {
  const key = orgKey ?? "";
  const [brand, setBrand] = useState<OutboundBrand | null>(() => (cache?.key === key ? cache.brand : null));
  useEffect(() => {
    let live = true;
    setBrand(cache?.key === key ? cache.brand : null);
    loadOrgOutboundBrand(key).then((b) => { if (live && b) setBrand(b); });
    return () => { live = false; };
  }, [key]);
  if (brand && (brand.orgName || !orgName)) return brand;
  return orgOutboundBrand({ name: orgName, branding: brand?.branding });
}
