/** Shared, client-safe job search choices and evidence. No provider, AI or database imports. */
export type FilterMode = "must" | "prefer";
export interface SearchRule<T> { value: T; mode: FilterMode }
export const PAY_PERIODS = ["hour", "day", "week", "month", "year"] as const;
export type PayPeriod = typeof PAY_PERIODS[number];
export const JOB_SHIFTS = ["day", "evening", "night", "weekend", "rotating"] as const;
export type JobShift = typeof JOB_SHIFTS[number];
export const JOB_ARRANGEMENTS = ["onsite", "hybrid", "remote"] as const;
export type JobArrangement = typeof JOB_ARRANGEMENTS[number];
export const JOB_TYPES = ["full_time", "part_time", "contract", "temporary", "internship", "apprenticeship"] as const;
export type JobEmploymentType = typeof JOB_TYPES[number];
export const SENIORITY_LEVELS = ["entry", "junior", "mid", "senior", "manager"] as const;
export type JobSeniority = typeof SENIORITY_LEVELS[number];
export interface SearchCoordinates { latitude: number; longitude: number }
export interface JobSearchFilters {
  version: 1;
  radiusMiles: SearchRule<number | null>;
  origin: SearchCoordinates | null;
  pay: { minimum: number | null; period: PayPeriod; currency: string; mode: FilterMode };
  shifts: SearchRule<JobShift[]>;
  arrangements: SearchRule<JobArrangement[]>;
  employmentTypes: SearchRule<JobEmploymentType[]>;
  postedWithinDays: SearchRule<number | null>;
  employerKind: SearchRule<"direct" | "staffing" | null>;
  seniority: SearchRule<JobSeniority[]>;
  experience: SearchRule<"none_required" | "under_3_years" | "3_plus_years" | null>;
  maximumTravelPercent: SearchRule<number | null>;
  requiredKeywords: SearchRule<string[]>;
  excludedEmployers: string[];
  excludedKeywords: string[];
  includeUnknown: boolean;
}
export interface JobSearchEvidence {
  salary: { minimum: number | null; maximum: number | null; currency: string | null; period: PayPeriod | null; rawPeriod: string | null; estimated: boolean };
  coordinates: SearchCoordinates | null;
  postedAt: string | null;
  employmentTypes: JobEmploymentType[] | null;
  arrangements: JobArrangement[] | null;
  shifts: JobShift[] | null;
  seniority: JobSeniority[] | null;
  experienceYears: number | null;
  noExperienceRequired: boolean | null;
  employerKind: "direct" | "staffing" | null;
  travelPercent: number | null;
  source: string;
  fetchedAt: string;
  warnings: string[];
}
export function defaultJobSearchFilters(): JobSearchFilters {
  return { version: 1, radiusMiles: { value: 25, mode: "must" }, origin: null,
    pay: { minimum: null, period: "hour", currency: "USD", mode: "must" },
    shifts: { value: [], mode: "must" }, arrangements: { value: [], mode: "must" }, employmentTypes: { value: [], mode: "must" },
    postedWithinDays: { value: 30, mode: "must" }, employerKind: { value: null, mode: "must" }, seniority: { value: [], mode: "prefer" },
    experience: { value: null, mode: "must" }, maximumTravelPercent: { value: null, mode: "must" }, requiredKeywords: { value: [], mode: "must" },
    excludedEmployers: [], excludedKeywords: [], includeUnknown: true };
}
export class InvalidJobSearchFilters extends Error {}
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new InvalidJobSearchFilters("Search filters must be an object.");
  return v as Record<string, unknown>;
};
function mode(v: unknown, fallback: FilterMode): FilterMode {
  if (v === undefined) return fallback;
  if (v !== "must" && v !== "prefer") throw new InvalidJobSearchFilters("Choose must-have or preference.");
  return v;
}
function number(v: unknown, min: number, max: number): number | null {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new InvalidJobSearchFilters(`Choose a number between ${min} and ${max}.`);
  return v;
}
function strings(v: unknown, allowed?: readonly string[]): string[] {
  if (!Array.isArray(v) || v.length > 20 || v.some(x => typeof x !== "string" || x.length > 100)) throw new InvalidJobSearchFilters("Use up to 20 short filter terms.");
  const values = [...new Set(v.map(x => x.trim()).filter(Boolean))];
  if (allowed && values.some(x => !allowed.includes(x))) throw new InvalidJobSearchFilters("One search choice is not supported.");
  return values;
}
/** A partial override keeps saved fields. Bad values fail visibly; radius is never clamped or widened. */
export function readJobSearchFilters(raw: unknown, base = defaultJobSearchFilters()): JobSearchFilters {
  if (raw === undefined) return structuredClone(base);
  const r = object(raw);
  const out = structuredClone(base);
  if (Object.keys(r).some(key => !(key in out))) throw new InvalidJobSearchFilters("Unrecognized search filter.");
  if (r.version !== undefined && r.version !== 1) throw new InvalidJobSearchFilters("Reload your search filters.");
  for (const key of ["radiusMiles", "postedWithinDays", "maximumTravelPercent"] as const) if (r[key] !== undefined) {
    const item = object(r[key]);
    out[key] = { value: item.value === undefined ? out[key].value : number(item.value, key === "postedWithinDays" ? 1 : 0, key === "radiusMiles" ? 500 : key === "postedWithinDays" ? 365 : 100), mode: mode(item.mode, out[key].mode) };
  }
  const choices = { shifts: JOB_SHIFTS, arrangements: JOB_ARRANGEMENTS, employmentTypes: JOB_TYPES, seniority: SENIORITY_LEVELS, requiredKeywords: undefined };
  for (const key of Object.keys(choices) as (keyof typeof choices)[]) if (r[key] !== undefined) {
    const item = object(r[key]);
    (out[key] as SearchRule<string[]>) = { value: item.value === undefined ? out[key].value : strings(item.value, choices[key]), mode: mode(item.mode, out[key].mode) };
  }
  for (const [key, allowed] of [["employerKind", ["direct", "staffing"]], ["experience", ["none_required", "under_3_years", "3_plus_years"]]] as const) if (r[key] !== undefined) {
    const item = object(r[key]);
    if (item.value !== undefined && item.value !== null && !allowed.includes(item.value as never)) throw new InvalidJobSearchFilters("Unsupported search requirement.");
    (out[key] as SearchRule<unknown>) = { value: item.value === undefined ? out[key].value : item.value, mode: mode(item.mode, out[key].mode) };
  }
  if (r.pay !== undefined) {
    const p = object(r.pay);
    if (p.period !== undefined && !PAY_PERIODS.includes(p.period as PayPeriod)) throw new InvalidJobSearchFilters("Choose a pay period.");
    if (p.currency !== undefined && (typeof p.currency !== "string" || !/^[A-Z]{3}$/.test(p.currency))) throw new InvalidJobSearchFilters("Use a three-letter currency code.");
    out.pay = { minimum: p.minimum === undefined ? out.pay.minimum : number(p.minimum, 0, 10_000_000), period: (p.period as PayPeriod) || out.pay.period, currency: (p.currency as string) || out.pay.currency, mode: mode(p.mode, out.pay.mode) };
  }
  if (r.origin !== undefined) {
    if (r.origin === null) out.origin = null;
    else { const p = object(r.origin); const latitude = number(p.latitude, -90, 90), longitude = number(p.longitude, -180, 180); if (latitude === null || longitude === null) throw new InvalidJobSearchFilters("Location coordinates are missing."); out.origin = { latitude, longitude }; }
  }
  for (const key of ["excludedEmployers", "excludedKeywords"] as const) if (r[key] !== undefined) out[key] = strings(r[key]);
  if (r.includeUnknown !== undefined) { if (typeof r.includeUnknown !== "boolean") throw new InvalidJobSearchFilters("Choose whether to include unknown fields."); out.includeUnknown = r.includeUnknown; }
  return out;
}
export type SearchFilterField = "distance" | "pay" | "shift" | "arrangement" | "type" | "freshness" | "employer" | "seniority" | "experience" | "travel" | "requirements" | "excluded_employer" | "excluded_keyword";
export interface JobFilterAssessment { included: boolean; unknown: SearchFilterField[]; requiredUnknown: SearchFilterField[]; unmet: SearchFilterField[]; preferred: SearchFilterField[]; distanceMiles: number | null }
export function distanceMiles(a: SearchCoordinates, b: SearchCoordinates): number {
  const rad = (v: number) => v * Math.PI / 180;
  const dlat = rad(b.latitude-a.latitude), dlon = rad(b.longitude-a.longitude);
  const h = Math.sin(dlat/2)**2 + Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dlon/2)**2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(Math.min(1,h)), Math.sqrt(Math.max(0,1-h)));
}
const fold = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const contains = (text: string, term: string) => (` ${fold(text)} `).includes(` ${fold(term)} `);
export function assessJobSearch(job: { title: string; company: string; full_description?: string; description?: string; evidence?: JobSearchEvidence }, filters: JobSearchFilters, now = Date.now()): JobFilterAssessment {
  const e = job.evidence;
  const result: JobFilterAssessment = { included: true, unknown: [], requiredUnknown: [], unmet: [], preferred: [], distanceMiles: e?.coordinates && filters.origin ? distanceMiles(filters.origin,e.coordinates) : null };
  const check = (field: SearchFilterField, outcome: boolean | null, strength: FilterMode) => {
    if (outcome === null) { result.unknown.push(field); if (strength === "must") { result.requiredUnknown.push(field); if (!filters.includeUnknown) result.included=false; } }
    else if (!outcome) { if (strength === "must") { result.unmet.push(field); result.included=false; } else result.preferred.push(field); }
  };
  const choices = (field: SearchFilterField, rule: SearchRule<string[]>, value: string[] | null | undefined) => { if (rule.value.length) check(field,value?.length ? rule.value.some(x=>value.includes(x)) : null,rule.mode); };
  if (filters.excludedEmployers.some(x=>contains(job.company,x))) { result.unmet.push("excluded_employer"); result.included=false; }
  const text = [job.title,job.full_description||job.description||""].join("\n");
  if (filters.excludedKeywords.some(x=>contains(text,x))) { result.unmet.push("excluded_keyword"); result.included=false; }
  if (filters.radiusMiles.value !== null) check("distance", result.distanceMiles === null ? null : result.distanceMiles <= filters.radiusMiles.value,filters.radiusMiles.mode);
  if (filters.pay.minimum !== null) {
    const salary=e?.salary;
    check("pay", !salary || salary.estimated || salary.minimum===null || salary.period!==filters.pay.period || salary.currency!==filters.pay.currency || (salary.maximum!==null && salary.minimum>salary.maximum) ? null : salary.minimum>=filters.pay.minimum,filters.pay.mode);
  }
  choices("shift",filters.shifts,e?.shifts); choices("arrangement",filters.arrangements,e?.arrangements); choices("type",filters.employmentTypes,e?.employmentTypes); choices("seniority",filters.seniority,e?.seniority);
  if (filters.postedWithinDays.value!==null) { const date=e?.postedAt ? Date.parse(e.postedAt) : NaN; check("freshness", !Number.isFinite(date) || date>now+86400000 ? null : now-date<=filters.postedWithinDays.value*86400000,filters.postedWithinDays.mode); }
  if (filters.employerKind.value) check("employer",e?.employerKind ? e.employerKind===filters.employerKind.value : null,filters.employerKind.mode);
  if (filters.experience.value) check("experience", filters.experience.value==="none_required" ? e?.noExperienceRequired===true ? true : e?.experienceYears===null || e?.experienceYears===undefined ? null : e.experienceYears===0 : e?.experienceYears===null || e?.experienceYears===undefined ? null : filters.experience.value==="under_3_years" ? e.experienceYears<3 : e.experienceYears>=3,filters.experience.mode);
  if (filters.maximumTravelPercent.value!==null) check("travel",e?.travelPercent===null || e?.travelPercent===undefined ? null : e.travelPercent<=filters.maximumTravelPercent.value,filters.maximumTravelPercent.mode);
  if (filters.requiredKeywords.value.length) check("requirements",filters.requiredKeywords.value.every(x=>contains(text,x)) ? true : null,filters.requiredKeywords.mode);
  return result;
}
/** Stable nested serialization; every actual filter choice belongs in the cache key. */
export function canonicalSearchFilters(filters: JobSearchFilters): string {
  const stable = (v: unknown): unknown => Array.isArray(v) ? [...v].map(stable).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))) : v && typeof v==="object" ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,value])=>[k,stable(value)])) : v;
  return JSON.stringify(stable(filters));
}

/** The coach and any search forms can publish the same validated filter surface. */
export const JOB_SEARCH_FILTER_SCHEMA: Record<string, unknown> = (() => {
  const strength={type:"string",enum:["must","prefer"]};
  const rule=(value:unknown)=>({type:"object",properties:{value,mode:strength},additionalProperties:false});
  const optionalNumber=(minimum:number,maximum:number)=>({type:["number","null"],minimum,maximum});
  const list=(values?:readonly string[])=>({type:"array",maxItems:20,items:values?{type:"string",enum:values}:{type:"string",maxLength:100}});
  return {type:"object",additionalProperties:false,description:"Use only choices the person stated. Omitted fields retain their saved lane choices. Unknown evidence is not a match.",properties:{
    version:{type:"integer",const:1},radiusMiles:rule(optionalNumber(0,500)),origin:{anyOf:[{type:"null"},{type:"object",required:["latitude","longitude"],additionalProperties:false,properties:{latitude:{type:"number",minimum:-90,maximum:90},longitude:{type:"number",minimum:-180,maximum:180}}}]},
    pay:{type:"object",additionalProperties:false,properties:{minimum:optionalNumber(0,10000000),period:{type:"string",enum:PAY_PERIODS},currency:{type:"string",pattern:"^[A-Z]{3}$"},mode:strength}},
    shifts:rule(list(JOB_SHIFTS)),arrangements:rule(list(JOB_ARRANGEMENTS)),employmentTypes:rule(list(JOB_TYPES)),postedWithinDays:rule(optionalNumber(1,365)),seniority:rule(list(SENIORITY_LEVELS)),
    experience:rule({type:["string","null"],enum:["none_required","under_3_years","3_plus_years",null]}),employerKind:rule({type:["string","null"],enum:["direct","staffing",null]}),maximumTravelPercent:rule(optionalNumber(0,100)),requiredKeywords:rule(list()),excludedEmployers:list(),excludedKeywords:list(),includeUnknown:{type:"boolean"},
  }};
})();
