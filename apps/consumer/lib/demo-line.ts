/**
 * The sample-data line for "(Demo)" organizations, word for word in the shell
 * banner (RefineryShell) and on the printed Insights report (InsightsReport,
 * DEMO_PRINT_LINE).
 *
 * WHY THESE WORDS (house build 2026-10-26, L1). The old line said "The
 * employers and local services named are real". Demo organizations can also
 * show employers that are made up (marked fictional), so that sentence was no
 * longer true. The line now says what holds in every demo: the participants
 * are fictional, so is any employer marked fictional, and a real employer or
 * service appears only as a place, never as a claim that anyone applied there
 * or was hired.
 */
export const DEMO_SAMPLE_LINE =
  "Sample data. The participants are fictional, and so is any employer marked fictional. Real employers and local services are named only as places; no application or hire shown here took place.";

/** A demo organization says so in its name: "Name (Demo)". */
export function isDemoOrgName(name: string | null | undefined): boolean {
  return /\(Demo\)\s*$/.test(name ?? "");
}
