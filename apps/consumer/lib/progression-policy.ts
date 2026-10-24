/** Server policy chooses grants; model output and browser fields never set amounts. */
export const PROGRESSION_STEPS = ['foundation','direction','tailor','apply','interview','offer'] as const;
export type ProgressionStep = typeof PROGRESSION_STEPS[number];
export function isProgressionStep(value: unknown): value is ProgressionStep { return typeof value === 'string' && (PROGRESSION_STEPS as readonly string[]).includes(value); }
export interface ProgressionPolicy {
 starter_calls: number; tailored_calls: number; applied_calls: number;
 bonus_calls: number; bonus_daily_cap: number; bonus_monthly_cap: number;
 daily_usd: number; reserve_usd: number;
 /** Migration 093. Extra daily calls at Steel Man status. Ships 0 (off); absent before 093 is applied. */
 steel_man_bonus_calls?: number;
}
export function validProgressionPolicy(p: unknown): p is ProgressionPolicy {
 if (!p || typeof p !== 'object') return false;
 const o = p as Record<string,unknown>;
 for (const key of ['starter_calls','tailored_calls','applied_calls','bonus_calls','bonus_daily_cap','bonus_monthly_cap']) if (!Number.isInteger(o[key]) || Number(o[key]) < 0) return false;
 return Number(o.starter_calls)>=1 && Number(o.starter_calls)<=Number(o.tailored_calls) && Number(o.tailored_calls)<=Number(o.applied_calls) && Number(o.applied_calls)<=100 && Number(o.bonus_calls)>=1 && Number(o.bonus_calls)<=10 && Number(o.bonus_daily_cap)<=20 && Number(o.bonus_monthly_cap)<=100 && Number.isFinite(o.daily_usd) && Number(o.daily_usd)>=0.1 && Number(o.daily_usd)<=20 && Number.isFinite(o.reserve_usd) && Number(o.reserve_usd)>=0.01 && Number(o.reserve_usd)<=2 && Number(o.reserve_usd)<=Number(o.daily_usd);
}
/** Forge and essential support retain their own allowances. Voice is separately sponsored. */
export const PROGRESSION_AI = ['assistant','coach','resume','resume-full','resume-fine-tune','interview','follow-up','apply-email','fit-check','next-step-why','career-plan'] as const;
export function countsForProgression(endpoint: string) { return (PROGRESSION_AI as readonly string[]).includes(endpoint); }
export function baseAllowance(policy: ProgressionPolicy, facts: {tailored:boolean;applied:boolean;steelMan?:boolean}) {
 const step = facts.steelMan && Number.isInteger(policy.steel_man_bonus_calls) ? Math.max(0, Math.min(20, policy.steel_man_bonus_calls as number)) : 0;
 return (facts.applied ? policy.applied_calls : facts.tailored ? policy.tailored_calls : policy.starter_calls) + step;
}
export function canGrantBonus(policy: ProgressionPolicy, day: number, month: number) { return day + policy.bonus_calls <= policy.bonus_daily_cap && month + policy.bonus_calls <= policy.bonus_monthly_cap; }
export const STEP_COPY: Record<ProgressionStep,{label:string;href:string;reason:string}> = {
 foundation:{label:'Your starting resume',href:'/dashboard/vault',reason:'Save your starting resume.'},
 direction:{label:'Choose a job',href:'/dashboard/jobs',reason:'Save a real opening you want to pursue.'},
 tailor:{label:'Tailor your resume',href:'/dashboard/application-tailor',reason:'Choose a job and a resume so the changes have a clear purpose.'},
 apply:{label:'Prepare and apply',href:'/dashboard/applications',reason:'Save a resume tailored to your chosen job.'},
 interview:{label:'Prepare for the interview',href:'/dashboard/interview',reason:'Record an application or tell us you have an interview. Practice is available anytime.'},
 offer:{label:'Your next move',href:'/dashboard/applications',reason:'Update the application when you receive an offer.'},
};
