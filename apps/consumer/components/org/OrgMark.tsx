/**
 * <OrgMark> -- the organization's mark: its logo, or a monogram.
 *
 * STUB (CRM wave 2026-10-25, BUILD-PLAN section 1). Lane C3 owns this file and
 * replaces it whole at merge with the real one (logo from
 * /api/org/brand/{orgId}/logo when hasLogo). This stub renders the monogram
 * only, with the exact signature, so the staff sidebar can ship first. It never
 * renders an empty box or the word "ORG".
 */
const TONES = [
  { bg: "#b98b32", fg: "#121110" }, // gold: bone text fails 4.5:1 here, so dark text
  { bg: "#4f6b57", fg: "#ece7d9" }, // phos-dark
  { bg: "#5f665f", fg: "#ece7d9" }, // steel
  { bg: "#8a5410", fg: "#ece7d9" }, // soft amber
] as const;

export function orgMonogram(name: string): string {
  const words = name.replace(/\(Demo\)\s*$/i, "").trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  const letters = words.length >= 2 ? [words[0], words[1]] : words.length === 1 ? [words[0]] : [];
  const out = letters.map((w) => (w.match(/[A-Za-z0-9]/)?.[0] ?? "").toUpperCase()).join("");
  return out || "?";
}

export function orgTone(orgId: string): (typeof TONES)[number] {
  let h = 0;
  for (let i = 0; i < orgId.length; i++) h = (h * 31 + orgId.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

export const ORG_MARK_TONES = TONES;

export function OrgMark(props: { orgId: string; name: string; hasLogo: boolean; size?: 24 | 28 | 40 | 120; className?: string }) {
  const size = props.size ?? 40;
  const tone = orgTone(props.orgId || props.name);
  return (
    <span
      role="img"
      aria-label={props.name.replace(/\s*\(Demo\)\s*$/i, "").trim() || "Organization"}
      className={`inline-grid flex-none place-items-center rounded-[4px] font-semibold ${props.className ?? ""}`}
      style={{ width: size, height: size, background: tone.bg, color: tone.fg, fontSize: Math.round(size * 0.4), lineHeight: 1 }}
    >
      {orgMonogram(props.name)}
    </span>
  );
}
