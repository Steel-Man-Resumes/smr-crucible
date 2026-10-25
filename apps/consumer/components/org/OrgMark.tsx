/**
 * <OrgMark> -- STUB for lane C2 (CRM build, 2026-10-25). The brand lane (C3)
 * owns this file and replaces it whole at merge. Same signature as the
 * contract in the build plan; this stub draws the monogram only and never an
 * image, so nothing here reads a logo.
 *
 * The monogram is never empty and never the word "ORG": up to two initials
 * from the organization's name with "(Demo)" removed, on a tone picked by a
 * stable hash of the org id. Text is bone or near-black, whichever clears
 * 4.5:1 on that tone.
 */
const TONES = ["#b98b32", "#4f6b57", "#5f665f", "#8a5410"] as const;
const BONE = "#ece7d9";
const INK = "#121110";

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function initials(name: string): string {
  const words = name.replace(/\(demo\)/gi, "").trim().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  if (!words.length) return "#";
  return (words.length === 1 ? words[0][0] : words[0][0] + words[1][0]).toUpperCase();
}
function tone(orgId: string): string {
  let h = 0;
  for (let i = 0; i < orgId.length; i++) h = (h * 31 + orgId.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

export function OrgMark(props: { orgId: string; name: string; hasLogo: boolean; size?: 24 | 28 | 40 | 120; className?: string }) {
  const size = props.size ?? 40;
  const bg = tone(props.orgId);
  const fg = ratio(BONE, bg) >= 4.5 ? BONE : INK;
  const label = props.name.replace(/\s*\(demo\)\s*/gi, "").trim() || "Organization";
  return (
    <span
      role="img"
      aria-label={label}
      data-org-mark="monogram"
      className={props.className}
      style={{
        display: "inline-grid", placeItems: "center", flex: "none", width: size, height: size, borderRadius: 4,
        background: bg, color: fg, font: `600 ${Math.round(size * 0.42)}px/1 var(--t-mono)`, letterSpacing: "0.02em",
      }}
    >
      {initials(props.name)}
    </span>
  );
}
