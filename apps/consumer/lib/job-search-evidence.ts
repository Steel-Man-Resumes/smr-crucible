/** Deterministic source normalization. Missing evidence stays unknown. */
import type { JobArrangement, JobEmploymentType, JobSearchEvidence, JobShift, JobSeniority, PayPeriod } from "@crucible/core/src/jobSearchFilters";
import type { JSearchJob } from "./job-search-types";
export function payPeriod(value: unknown): PayPeriod | null {
  const s=typeof value==="string" ? value.trim().toUpperCase() : "";
  return ({ HOUR:"hour", HOURLY:"hour", PH:"hour", DAY:"day", DAILY:"day", PD:"day", WEEK:"week", WEEKLY:"week", PW:"week", MONTH:"month", MONTHLY:"month", PM:"month", YEAR:"year", YEARLY:"year", ANNUAL:"year", PA:"year", PY:"year" } as Record<string,PayPeriod>)[s] || null;
}
const finite=(n:unknown):number|null=>typeof n==="number" && Number.isFinite(n) && n>=0 ? n : null;
export function evidenceForJob(j:JSearchJob,now=new Date().toISOString()):JobSearchEvidence {
  const text=[j.job_title,j.job_description,...(j.job_highlights?.Qualifications||[])].join("\n");
  const warnings:string[]=[];
  const types:JobEmploymentType[]=[];
  const rawTypes=[...(Array.isArray(j.job_employment_types)?j.job_employment_types:[]),j.job_employment_type||""].filter((value):value is string=>typeof value==="string");
  for(const raw of rawTypes){const value=raw.toLowerCase().replace(/[\s_-]/g,""); const found=({fulltime:"full_time",parttime:"part_time",contractor:"contract",contract:"contract",temporary:"temporary",intern:"internship",internship:"internship",apprenticeship:"apprenticeship"} as Record<string,JobEmploymentType>)[value]; if(found&&!types.includes(found))types.push(found);}
  const rawSingle=(typeof j.job_employment_type==="string"?j.job_employment_type:"").toLowerCase().replace(/[\s_-]/g,"");
  const contradictoryType=!!rawSingle&&((rawSingle==="parttime"&&rawTypes.some(x=>x==="FULLTIME"))||(rawSingle==="fulltime"&&rawTypes.some(x=>x==="PARTTIME")));
  if(contradictoryType)warnings.push("Source reports conflicting employment types.");
  const arrangements:JobArrangement[]=[];
  if(j.job_is_remote===true)arrangements.push("remote");
  if(/\bhybrid (?:work|role|position|schedule)|\b(?:work|role|position|schedule)[^.!?\n]{0,20}\bhybrid\b/i.test(text))arrangements.push("hybrid");
  if(/\bon[- ]site (?:work|role|position|required)|\b(?:work|working) on[- ]site\b/i.test(text))arrangements.push("onsite");
  const shifts:JobShift[]=[];
  const shiftTests:Record<JobShift,RegExp>={day:/\b(?:day|first|1st) shift\b/i,evening:/\b(?:evening|second|2nd) shift\b/i,night:/\b(?:night|overnight|third|3rd) shift\b/i,weekend:/\bweekend (?:shift|work|schedule)|\b(?:work|working|required) weekends\b/i,rotating:/\brotating (?:shift|schedule)/i};
  const affirmative=text.split(/[.!?\n]+/).filter(line=>! /\b(?:no (?:night|overnight|weekend)|not required|optional|preferred)\b/i.test(line)).join("\n");
  for(const [key,regex]of Object.entries(shiftTests))if(regex.test(affirmative))shifts.push(key as JobShift);
  const seniority:JobSeniority[]=[];
  for(const [level,regex]of Object.entries({entry:/\bentry[- ]level\b/i,junior:/\b(?:junior|jr\.?)\b/i,mid:/\bmid[- ](?:level|career)\b/i,senior:/\b(?:senior|sr\.?)\b/i,manager:/\b(?:manager|supervisor|director)\b/i}))if(regex.test(j.job_title))seniority.push(level as JobSeniority);
  const experience=affirmative.match(/\b(?:minimum (?:of )?|at least |requires? )?(\d{1,2})\+? years?(?: of)? (?:relevant |related |professional )?experience\b/i);
  const noExperience=/\bno (?:prior )?experience (?:is )?(?:required|necessary)\b/i.test(text);
  const travel=text.match(/\b(?:travel[^.!?\n]{0,20}?(\d{1,3})\s*%|(\d{1,3})\s*%[^.!?\n]{0,15}travel)/i);
  const min=finite(j.job_min_salary),max=finite(j.job_max_salary);
  if(payPeriod(j.job_salary_period)==="hour"&&((min??0)>10000||(max??0)>10000))warnings.push("Unusually high source pay. Verify the original posting.");
  if(min!==null&&max!==null&&min>max)warnings.push("Source pay range is inconsistent. Check the posting.");
  if((min!==null||max!==null)&&!payPeriod(j.job_salary_period))warnings.push("Source did not identify a comparable pay period.");
  const latitude=j.job_latitude,longitude=j.job_longitude;
  const coords=typeof latitude==="number"&&Number.isFinite(latitude)&&Math.abs(latitude)<=90&&typeof longitude==="number"&&Number.isFinite(longitude)&&Math.abs(longitude)<=180?{latitude,longitude}:null;
  return {salary:{minimum:min,maximum:max,currency:j.job_salary_currency||null,period:payPeriod(j.job_salary_period),rawPeriod:j.job_salary_period||null,estimated:j.salary_is_predicted===true},coordinates:coords,
    postedAt:j.job_posted_at_datetime_utc||null,employmentTypes:contradictoryType?null:types.length?types:null,arrangements:arrangements.length?arrangements:null,shifts:shifts.length?shifts:null,seniority:seniority.length?seniority:null,
    experienceYears:noExperience?0:experience?Number(experience[1]):null,noExperienceRequired:noExperience?true:experience?false:null,employerKind:j.employer_kind||(/\b(?:staffing|recruitment|employment) agency\b/i.test(text)?"staffing":null),travelPercent:/\bno travel (?:is )?required\b/i.test(text)?0:travel&&Number(travel[1]||travel[2])<=100?Number(travel[1]||travel[2]):null,
    source:j.source||"jsearch",fetchedAt:j.fetched_at||now,warnings};
}
export function formatSourceSalary(e:JobSearchEvidence["salary"]):string|null {
  const {minimum:min,maximum:max}=e;
  if(min===null&&max===null)return null;
  const n=(v:number)=>new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(v);
  const range=min!==null&&max!==null?min===max?n(min):`${n(min)} to ${n(max)}`:min!==null?`${n(min)}+`:`Up to ${n(max!)}`;
  return `${e.currency||"Currency not supplied"} ${range} / ${e.period||e.rawPeriod||"period not supplied"}${e.estimated?" (provider estimate)":""}`;
}
