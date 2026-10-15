/** Preserve the listing provider when a board result becomes a saved application. */
export function jobSourceForSave(jobId: string, searchSource?: string): string {
  if (jobId.startsWith("adzuna-")) return "adzuna";
  if (jobId.startsWith("usajobs-")) return "usajobs";
  if (jobId.startsWith("cos-") || searchSource === "careeronestop") return "careeronestop";
  return "jsearch";
}
