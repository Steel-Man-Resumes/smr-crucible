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
let cache: { brand: OutboundBrand; at: number } | null = null;
let inflight: Promise<OutboundBrand | null> | null = null;

/** Pure, exported for tests: the payload's brand, rebuilt through the one helper so a malformed answer cannot print odd words. */
export function readOutboundBrand(payload: unknown, fallbackName?: string | null): OutboundBrand {
  const b = (payload as { brand?: { orgName?: unknown; branding?: unknown } } | null)?.brand;
  const name = typeof b?.orgName === "string" && b.orgName ? b.orgName : fallbackName ?? null;
  return orgOutboundBrand({ name, branding: b?.branding });
}

export function loadOrgOutboundBrand(fetcher: typeof fetch = fetch): Promise<OutboundBrand | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.brand);
  if (inflight) return inflight;
  inflight = fetcher("/api/org/outbound-brand", { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j ? readOutboundBrand(j) : null))
    .catch(() => null)
    .then((brand) => { if (brand) cache = { brand, at: Date.now() }; inflight = null; return brand; });
  return inflight;
}

export function resetOrgOutboundBrandCache(): void { cache = null; inflight = null; }

/** `orgName` is what the page already shows, used until (and unless) the answer names the organization. */
export function useOrgOutboundBrand(orgName: string | null | undefined): OutboundBrand {
  const [brand, setBrand] = useState<OutboundBrand | null>(() => cache?.brand ?? null);
  useEffect(() => {
    let live = true;
    loadOrgOutboundBrand().then((b) => { if (live && b) setBrand(b); });
    return () => { live = false; };
  }, []);
  if (brand && (brand.orgName || !orgName)) return brand;
  return orgOutboundBrand({ name: orgName, branding: brand?.branding });
}
