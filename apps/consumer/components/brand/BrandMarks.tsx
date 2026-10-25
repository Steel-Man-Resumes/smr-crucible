import Link from "next/link";
import { OrgMark } from "@/components/org/OrgMark";

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
            Career report
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

/**
 * The participant's co-brand chip: the organization they joined, beside the
 * Refinery lockup. Rendered only when the role payload carries a co-brand
 * organization, which happens only for a member of an organization on the
 * co-brand or full tier (getParticipantCoBrand). A solo participant, the
 * public and the sign-in page get nothing: no placeholder box, no stand-in
 * name. The old env-driven partner lockup is gone for that reason.
 */
export function MemberCoBrandChip({ orgId, name, hasLogo, className = "" }: { orgId: string; name: string; hasLogo: boolean; className?: string }) {
  const tip = `Your seat comes through ${name}. What you share with them is your choice. See or change it in Settings.`;
  return (
    <Link
      href="/dashboard/settings"
      title={tip}
      aria-label={`With ${name}. ${tip}`}
      className={`t-focus min-h-touch items-center gap-2 rounded-[4px] px-2 text-xs text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white ${className}`}
      data-cobrand-chip
    >
      <OrgMark orgId={orgId} name={name} hasLogo={hasLogo} size={28} />
      <span className="max-w-[160px] truncate">With {name}</span>
    </Link>
  );
}
