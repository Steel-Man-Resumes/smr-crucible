import Link from "next/link";
import { tenant } from "@/lib/tenant-config";

export type ProductName = "forge" | "refinery";

const PRODUCT = {
  forge: {
    label: "The Forge",
    icon: "/brand/forge-icon.png",
    lockup: "/brand/forge-lockup.png",
  },
  refinery: {
    label: "The Refinery",
    icon: "/brand/refinery-icon.png",
    lockup: "/brand/refinery-lockup.png",
  },
} as const;

interface BrandProps {
  compact?: boolean;
  inverse?: boolean;
  href?: string;
  className?: string;
}

export function SteelManBrand({ compact = false, inverse = false, href = "/", className = "" }: BrandProps) {
  const content = (
    <span className={`inline-flex items-center gap-2.5 ${inverse ? "text-[#ece7d9]" : "text-t-white"} ${className}`}>
      <img
        src={inverse ? "/brand/steel-man-mark-light.svg" : "/brand/steel-man-mark-dark.svg"}
        alt=""
        className="h-9 w-14 object-contain"
      />
      {!compact && (
        <span className="leading-none">
          <strong className="block text-sm font-semibold">Steel Man Resumes</strong>
          <span className={`mt-1 block font-term text-[9px] uppercase ${inverse ? "text-[#b9bdb6]" : "text-t-bone-dim"}`}>
            Career intelligence
          </span>
        </span>
      )}
    </span>
  );

  return href ? <Link href={href} aria-label="Steel Man Resumes">{content}</Link> : content;
}

export function ProductBrand({ product, compact = false, href, className = "" }: BrandProps & { product: ProductName }) {
  const item = PRODUCT[product];
  const content = (
    <span className={`inline-flex min-w-0 items-center ${className}`}>
      <img
        src={compact ? item.icon : item.lockup}
        alt={compact ? item.label : `${item.label} by Steel Man Resumes`}
        className={compact ? "h-10 w-10 flex-none object-contain" : "h-12 w-auto max-w-[120px] object-contain sm:max-w-[132px]"}
      />
    </span>
  );
  return href ? <Link href={href} aria-label={item.label}>{content}</Link> : content;
}

export function ProductFamilyBrand({ product, productHref, className = "" }: { product: ProductName; productHref?: string; className?: string }) {
  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <span className="sm:hidden"><SteelManBrand compact /></span>
      <span className="hidden sm:inline-flex"><SteelManBrand /></span>
      <span className="h-9 w-px bg-t-line" aria-hidden="true" />
      <ProductBrand product={product} href={productHref} />
    </div>
  );
}

export function CoBrandLockup({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const partner = tenant.config.partnerBrand;
  return (
    <div className={`flex items-center gap-3 ${className}`} aria-label="Example partner co-branding">
      {partner.logoPath ? (
        <img src={partner.logoPath} alt="" className="h-10 w-10 flex-none rounded-[5px] object-contain" />
      ) : (
        <span className="grid h-10 w-10 flex-none place-items-center rounded-[5px] font-term text-[10px] font-bold text-white" style={{ backgroundColor: partner.primaryColor }}>ORG</span>
      )}
      {!compact && (
        <span className="min-w-0 leading-tight">
          <strong className="block text-xs text-t-white">{partner.name}</strong>
          <span className="block font-term text-[9px] text-t-bone-dim">{partner.descriptor}</span>
        </span>
      )}
      <span className="h-9 w-px bg-t-line" aria-hidden="true" />
      <span className="leading-tight">
        <span className="block font-term text-[8px] uppercase text-t-bone-dim">Powered by</span>
        <strong className="block text-[11px] text-t-white">Steel Man Resumes</strong>
      </span>
    </div>
  );
}
