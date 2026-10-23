/** Public evidence labels shared by directory links and search results. */
export function resourceEvidenceLabel(band: unknown, date?: string | null, reason?: string | null) {
  const when = date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null;
  if (band === "A") return { label: "Steel Man's checked directory", detail: when ? `Last checked ${when}. Confirm availability before traveling.` : "Check the source and confirm availability before traveling.", uncertain: false };
  const label = band === "B" ? "Listed, not yet checked by us" : band === "C" ? "Found, not confirmed" : "Verification not available";
  return { label, detail: [reason?.trim(), when ? `Source reviewed ${when}.` : "", "Call first to confirm service and eligibility."].filter(Boolean).join(" "), uncertain: true };
}
export function employerEvidenceLabel(band: unknown) {
  return band === "A" ? "Hires people with records" : band === "B" ? "Reported hiring evidence" : "Evidence needs checking";
}
