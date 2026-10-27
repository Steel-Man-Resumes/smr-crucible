/**
 * Outbound branding (migration 107, staff pass 2026-10-27 lane S2): the parts
 * with no database, safe for client components and email builders.
 *
 * ONE helper, orgOutboundBrand(org), decides how anything staff send out of
 * the Refinery is branded: printed reports, the Insights print, CSV
 * downloads, invite and digest emails. Co-branded "<Organization> with Steel
 * Man Resumes" by default; the organization's name alone only when a platform
 * admin marked the organization exclusive (Troy, 2026-10-27: co-branded
 * "unless they pay for exclusive branding"). Never a price, anywhere.
 *
 * The name is cleaned the way the shell cleans it: a trailing "(Demo)" is
 * kept off the brand line (the demo notice says that separately), control
 * characters and line breaks are removed (a CSV first line or an email
 * subject must stay one line), and it is capped at 120 characters. No name
 * at all falls back to Steel Man Resumes alone, never a stand-in name.
 */
export type OrgBranding = "co_brand" | "exclusive";
export const ORG_BRANDINGS: readonly OrgBranding[] = ["co_brand", "exclusive"];
export const DEFAULT_ORG_BRANDING: OrgBranding = "co_brand";
export const STEEL_MAN = "Steel Man Resumes";

export function isOrgBranding(v: unknown): v is OrgBranding {
  return typeof v === "string" && (ORG_BRANDINGS as readonly string[]).includes(v);
}

/** Unknown, missing or malformed: the default. Exclusive must be said exactly. */
export function resolveOrgBranding(v: unknown): OrgBranding {
  return isOrgBranding(v) ? v : DEFAULT_ORG_BRANDING;
}

export interface OutboundBrand {
  branding: OrgBranding;
  /** The organization's name as printed, or "" when none is known. */
  orgName: string;
  /** True when Steel Man Resumes appears beside the organization. */
  coBranded: boolean;
  /** One line for a header, a CSV first line or an email footer: "Lakeshore Works with Steel Man Resumes". */
  line: string;
  /** The words after the organization's name in a two-part header ("with Steel Man Resumes"), or null when exclusive. */
  withLine: string | null;
  /** For an email's From display name and the subject prefix. */
  senderName: string;
}

/** The organization's name for outbound use: one line, no "(Demo)", 120 characters at most. */
export function outboundOrgName(name: string | null | undefined): string {
  return String(name ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s*\(Demo\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
}

export function orgOutboundBrand(org: { name?: string | null; branding?: unknown } | null | undefined): OutboundBrand {
  const orgName = outboundOrgName(org?.name);
  const branding = resolveOrgBranding(org?.branding);
  // Exclusive needs a name to stand on: with none, Steel Man Resumes still signs it.
  if (branding === "exclusive" && orgName) {
    return { branding, orgName, coBranded: false, line: orgName, withLine: null, senderName: orgName };
  }
  if (!orgName) {
    return { branding, orgName: "", coBranded: true, line: STEEL_MAN, withLine: null, senderName: STEEL_MAN };
  }
  return { branding, orgName, coBranded: true, line: `${orgName} with ${STEEL_MAN}`, withLine: `with ${STEEL_MAN}`, senderName: `${orgName} via ${STEEL_MAN}` };
}

/** A CSV cell, quoted, with spreadsheet formula starters defused. */
function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * The first line of every CSV staff download: who it is from and what it is,
 * one quoted cell. `what` is fixed words from the route ("Caseload",
 * "Insights", "Activity log"), `on` is YYYY-MM-DD.
 */
export function outboundCsvHeaderLine(brand: OutboundBrand, what: string, on: string): string {
  return csvCell(`${brand.line}. ${what}, downloaded ${on}.`);
}

/** Put the header line on top of a CSV body (keeps a byte-order mark first if the body has one). */
export function withOutboundCsvHeader(csv: string, brand: OutboundBrand, what: string, on: string): string {
  const bom = csv.startsWith("﻿") ? "﻿" : "";
  const body = bom ? csv.slice(1) : csv;
  return `${bom}${outboundCsvHeaderLine(brand, what, on)}\r\n${body}`;
}

/** An email footer line: "Sent by Lakeshore Works with Steel Man Resumes." */
export function outboundEmailFooter(brand: OutboundBrand): string {
  return `Sent by ${brand.line}.`;
}
