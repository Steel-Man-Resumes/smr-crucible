"use client";

/**
 * <OrgMark> -- an organization's mark: its logo, or its monogram.
 *
 * The logo comes only from /api/org/brand/{orgId}/logo, which serves it to
 * people who belong to that organization. Never an external URL. With no
 * logo (or if the image fails to load) the mark is the monogram: up to two
 * initials from the name, "(Demo)" stripped, on one of four workshop tones
 * picked by a stable hash of the org id, bone text at 4.5:1 or better. It is
 * never empty, never the word "ORG", never a gray box.
 *
 * Contract (CRM BUILD-PLAN section 1): C1 and C2 import this exact signature.
 */
import { useState } from "react";
import { Building2 } from "lucide-react";
import { orgMonogram } from "@crucible/core/src/orgBrandShared";

export type OrgMarkSize = 24 | 28 | 40 | 120;

const FONT: Record<OrgMarkSize, number> = { 24: 10, 28: 11, 40: 15, 120: 44 };

export function OrgMark(props: { orgId: string; name: string; hasLogo: boolean; size?: OrgMarkSize; className?: string }) {
  const { orgId, name, hasLogo, size = 28, className = "" } = props;
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };

  if (hasLogo && !failed) {
    return (
      <img
        src={`/api/org/brand/${encodeURIComponent(orgId)}/logo`}
        alt={name ? `${name} logo` : ""}
        width={size}
        height={size}
        style={box}
        onError={() => setFailed(true)}
        className={`flex-none rounded-[4px] bg-[#ece7d9] object-contain ${className}`}
        data-org-mark="logo"
      />
    );
  }

  const mono = orgMonogram(orgId, name);
  return (
    <span
      role="img"
      aria-label={name || "Organization"}
      style={{ ...box, backgroundColor: mono.background, color: mono.color, fontSize: FONT[size] }}
      className={`grid flex-none place-items-center rounded-[4px] font-semibold leading-none ${className}`}
      data-org-mark="monogram"
    >
      {mono.initials ? <span aria-hidden="true">{mono.initials}</span> : <Building2 size={Math.round(size * 0.55)} aria-hidden="true" />}
    </span>
  );
}
