/**
 * <OutboundBrandLine> (migration 107, staff pass 2026-10-27 lane S2): the
 * "with Steel Man Resumes" half of a two-part print header, or nothing when
 * the organization is exclusive. Presentational: the page reads the brand
 * (useOrgOutboundBrand) and passes it, so a print renders in tests.
 */
import type { OutboundBrand } from "@crucible/core/src/orgOutboundBrandShared";

export function OutboundBrandLine({ brand, className = "text-xs" }: { brand: OutboundBrand; className?: string }) {
  if (!brand.withLine) return null;
  return <span className={className} data-outbound-brand={brand.branding}>{brand.withLine}</span>;
}
