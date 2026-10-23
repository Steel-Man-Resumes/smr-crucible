/** Only explicit choices and explicit listing requirements can exclude a job. */
export interface JobFitPreferences {
  excludedTitles: string[];
  noDriving: boolean;
  noHeavyLifting: boolean;
  noOvernight: boolean;
}
export function readJobFit(value: unknown): JobFitPreferences {
  const v = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    excludedTitles: Array.isArray(v.excludedTitles) ? [...new Set(v.excludedTitles.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 60)).filter(Boolean))].slice(0, 12) : [],
    noDriving: v.noDriving === true, noHeavyLifting: v.noHeavyLifting === true, noOvernight: v.noOvernight === true,
  };
}
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function jobFitExclusion(job: { title: string; requirements?: string[]; description?: string; full_description?: string }, p: JobFitPreferences): string | null {
  if (p.excludedTitles.some((title) => (` ${words(job.title)} `).includes(` ${words(title)} `) && words(title))) return "A job title you excluded";
  const lines = [...(job.requirements || []), job.full_description || job.description || ""].join("\n").split(/[\n.!?;]+/);
  for (const line of lines) {
    if (/\b(?:not required|no .{0,25}required|not necessary|optional|preferred)\b/i.test(line)) continue;
    if (!/\b(?:must|required|requires|requirement|mandatory)\b/i.test(line)) continue;
    if (p.noDriving && /\b(?:driv(?:e|ing|er's license|ers license)|CDL|commercial driver)\b/i.test(line)) return "Driving is listed as required";
    if (p.noHeavyLifting && /\b(?:heavy lifting|lift(?:ing)? (?:up to |at least )?(?:[5-9]\d|\d{3,})\s*(?:pounds|lbs))\b/i.test(line)) return "Heavy lifting is listed as required";
    if (p.noOvernight && /\b(?:overnight|night shift|third shift|3rd shift)\b/i.test(line)) return "Overnight work is listed as required";
  }
  return null;
}
