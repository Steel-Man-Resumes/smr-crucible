/**
 * One readable place line from provider fields. Providers repeat the state or
 * country inside the city field ("Milwaukee, Wisconsin" plus state
 * "Wisconsin"), so the joined line read "Milwaukee, Wisconsin, Wisconsin".
 * Each part is split on commas and a segment that names the same place as an
 * earlier one (case, punctuation, or state code versus state name) is dropped.
 */
const STATES: Record<string, string> = {
  al:"alabama",ak:"alaska",az:"arizona",ar:"arkansas",ca:"california",co:"colorado",ct:"connecticut",de:"delaware",dc:"district of columbia",fl:"florida",ga:"georgia",hi:"hawaii",id:"idaho",il:"illinois",in:"indiana",ia:"iowa",ks:"kansas",ky:"kentucky",la:"louisiana",me:"maine",md:"maryland",ma:"massachusetts",mi:"michigan",mn:"minnesota",ms:"mississippi",mo:"missouri",mt:"montana",ne:"nebraska",nv:"nevada",nh:"new hampshire",nj:"new jersey",nm:"new mexico",ny:"new york",nc:"north carolina",nd:"north dakota",oh:"ohio",ok:"oklahoma",or:"oregon",pa:"pennsylvania",ri:"rhode island",sc:"south carolina",sd:"south dakota",tn:"tennessee",tx:"texas",ut:"utah",vt:"vermont",va:"virginia",wa:"washington",wv:"west virginia",wi:"wisconsin",wy:"wyoming",pr:"puerto rico",
};
const COUNTRY = new Set(["us", "usa", "united states", "united states of america", "u s", "u s a"]);
export function placeKey(segment: string): string {
  const s = segment.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (COUNTRY.has(s)) return "country:us";
  return STATES[s] ? `state:${STATES[s]}` : Object.values(STATES).includes(s) ? `state:${s}` : s;
}
export function normalizeLocation(...parts: (string | null | undefined)[]): string {
  const seen = new Set<string>(), out: string[] = [];
  for (const part of parts) {
    if (typeof part !== "string") continue;
    for (const raw of part.split(",")) {
      const segment = raw.trim();
      if (!segment) continue;
      const key = placeKey(segment);
      if (!key || seen.has(key)) continue;
      seen.add(key); out.push(segment);
    }
  }
  return out.join(", ");
}
