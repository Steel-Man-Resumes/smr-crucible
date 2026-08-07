/**
 * Context Library — Research-backed, user-aware prompt injection for every AI call.
 *
 * Three layers:
 * 1. Research: theory-backed instructions per use case
 * 2. User: readiness stage, barriers, skills, narrative, record details
 * 3. Job: target role, company, industry, requirements
 *
 * Every AI route imports from here instead of hardcoding context.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

// ─── User Level Detection ───────────────────────────────────────────────────

export type UserLevel = "foundation" | "professional" | "executive";

/**
 * Detect user's level from Forge data. Determines language complexity,
 * resume format, interview difficulty, and disclosure depth.
 */
export function detectUserLevel(forgeData: Record<string, any>): UserLevel {
  const resumeText = (forgeData.resumeText || "").toLowerCase();
  const resumeLength = resumeText.length;
  const output = forgeData.forgeOutput || forgeData;
  const skillCount = (output.skills || []).length;
  const topSalary = output.career_paths?.[0]?.salary_range || "";

  // Executive signals
  const hasAdvancedEd = /doctorate|master'?s?|mba|jd|ph\.?d|m\.?d|esq\b|juris/i.test(resumeText);
  const hasSeniorTitle = /director|vp|vice president|chief|cto|cfo|coo|ceo|partner|principal|senior manager/i.test(resumeText);
  const highSalary = /[89]\d,?\d{3}|1\d{2},?\d{3}|\$[89]\d|100/i.test(topSalary);

  if (hasAdvancedEd || hasSeniorTitle || (resumeLength > 3000 && highSalary)) {
    return "executive";
  }

  // Professional signals
  const hasDegree = /bachelor|associate|b\.?a\b|b\.?s\b|a\.?a\.?s|college|university/i.test(resumeText);
  const hasMidTitle = /manager|supervisor|coordinator|specialist|analyst|lead|technician/i.test(resumeText);

  if (hasDegree || hasMidTitle || resumeLength > 1500 || skillCount > 10) {
    return "professional";
  }

  return "foundation";
}

const LEVEL_DIRECTIVES: Record<UserLevel, string> = {
  foundation: `USER LEVEL: Foundation (entry-level, rebuilding, limited resume history)
LANGUAGE: Write at a 6th grade reading level. Short sentences. No jargon.
TONE: Warm, encouraging, patient. Explain everything. Heavy scaffolding.
RESUME FORMAT: Functional format acceptable if chronological history is thin. Estimate metrics generously.
INTERVIEW: General questions, slow pace, more encouragement. Build confidence.
DISCLOSURE: Simple script, basic timing advice. Don't overwhelm.`,

  professional: `USER LEVEL: Professional (mid-career, solid experience, some education)
LANGUAGE: Professional level. Concise and direct.
TONE: Confident peer. Don't over-explain basics.
RESUME FORMAT: Chronological, real metrics, achievement-dense. Standard professional bar.
INTERVIEW: Behavioral STAR, industry-specific questions, moderate challenge.
DISCLOSURE: Employer-specific strategy with legal context.`,

  executive: `USER LEVEL: Executive (senior, advanced degrees, leadership history)
LANGUAGE: Executive level. Assume expertise. Strategic positioning.
TONE: Colleague-to-colleague. No hand-holding.
RESUME FORMAT: Achievement-dense, metrics-heavy, ATS + human optimization. Board-level impact framing.
INTERVIEW: Executive presence, salary negotiation scenarios, panel interview prep.
DISCLOSURE: Multi-stakeholder strategy, board-level framing, reputation management.`,
};

export type UseCase =
  | "resume"
  | "cover_letter"
  | "disclosure"
  | "interview"
  | "job_search"
  | "resources"
  | "analysis";

export interface UserContext {
  name?: string;
  level?: UserLevel;
  readinessStage?: string;
  barriers?: string[];
  criminalRecord?: {
    type?: string;
    most_recent?: string;
    supervision?: string;
    state?: string;
  };
  skills?: Array<{ name: string; category?: string }>;
  strengths?: Array<{ title: string; evidence: string }>;
  narrative?: string;
  careerPaths?: Array<{ title: string; match_reason?: string }>;
}

export interface JobContext {
  targetJob?: string;
  targetCompany?: string;
  jobDescription?: string;
  requirements?: string[];
  industry?: string;
}

// ─── Research Context by Use Case ───────────────────────────────────────────

const RESEARCH: Record<UseCase, string> = {
  resume: `RESEARCH-BACKED RESUME STANDARDS:

NARRATIVE IDENTITY (McAdams & McLean, 2013): A resume should read like meeting a person, not scanning a form. There is a narrative arc — where they've been, what they've built, where they're going. Redemption sequences (difficulty → growth → contribution) predict well-being and employer confidence.

GENERATIVE IDENTITY (Maruna, 2001): People who successfully rebuild their careers develop "generative scripts" — their past challenges become strengths. Frame career progression as intentional growth, not accident. "Led" not "was assigned to." "Built" not "was responsible for."

SELF-EFFICACY (Bandura, 1977): Mastery experiences are the strongest source of confidence. Every bullet should demonstrate a concrete accomplishment — something they DID and the result it produced. Vague duties build no confidence in the reader OR the candidate.

SCAFFOLDING (Wood, Bruner, Ross, 1976): Each resume iteration should require less AI support. First resume: heavy scaffolding. Third resume: user drives, AI suggests.

COMPETITIVE STANDARD: Every resume must compete at the highest professional level. No generic phrases. No duties language. Numbers in every bullet. Action verbs only. ATS-optimized but human-readable.

INCARCERATION RULE (absolute): NEVER mention incarceration, criminal records, justice involvement, prison, jail, parole, probation — not even obliquely. Employment gaps use years only, never explained. Disclosure happens in person, never on paper.`,

  cover_letter: `RESEARCH-BACKED COVER LETTER STANDARDS:

NARRATIVE IDENTITY (McAdams, 2013): The cover letter IS the redemption narrative — compressed into 300 words. Opening: who they are NOW. Middle: what they've BUILT. Close: what they'll CONTRIBUTE.

SELF-DETERMINATION (Deci & Ryan, 2000): The letter must express autonomy — "I chose this path" not "I'm looking for any opportunity." Competence — specific achievements that prove capability. Relatedness — why THIS company, THIS role.

EMPLOYER PSYCHOLOGY: Hiring managers spend 6-7 seconds on a cover letter. Lead with the strongest match to the job requirements. Second paragraph proves it with numbers. Close with confidence, not desperation.

NEVER: mention records, gaps, "second chances," or anything that requires explanation. The cover letter sells the future, not the past.`,

  disclosure: `RESEARCH-BACKED DISCLOSURE SCIENCE:

BUSHWAY & APEL (2012): Disclosure timing significantly impacts hiring outcomes. Prepared disclosure is 3x more effective than improvised disclosure. The script should be under 30 seconds — acknowledge, pivot, value.

MARUNA (2001): Agency is the strongest predictor of successful desistance. The disclosure script must position the candidate as an AGENT — "I made a mistake, I did the work, I'm here because I chose to be." Not a victim. Not apologetic. Accountable and forward-looking.

EMPLOYER PSYCHOLOGY: What the interviewer is thinking (even if they don't ask):
1. "Will this person be reliable?" → Answer with attendance/consistency data
2. "Is there a safety risk?" → Answer with time since offense + supervision completion
3. "Will other employees be uncomfortable?" → Answer with team leadership evidence
4. "Could this create liability?" → Answer with clean record since, certifications, references

BAN-THE-BOX: Federal contractors and many states/cities prohibit asking about criminal history before conditional offer. But even where legal, employers CANNOT use a record as automatic disqualification — must consider: nature of offense, time elapsed, nature of job (EEOC guidance).

AFFECT LABELING (Lieberman et al., 2007): Naming the anxiety of disclosure reduces its physiological impact by up to 50%. The disclosure planner should help users NAME what they're afraid of before crafting the script.

TRAUMA-INFORMED (SAMHSA, 2014): Never re-traumatize. The user controls what they share, when, and how much. Privacy is non-negotiable. Data deletion is immediate and permanent.`,

  interview: `RESEARCH-BACKED INTERVIEW PREPARATION:

SELF-EFFICACY (Bandura, 1977): The single strongest source of confidence is mastery experience — actually doing the thing and succeeding. Each practice session should end with specific, actionable feedback that builds on what they did well (process praise, Dweck 2006).

STAR METHOD: Situation, Task, Action, Result. Every answer should follow this structure. But go beyond generic STAR — connect actions to QUANTIFIED results from their actual resume.

AFFECT LABELING (Lieberman, 2007): Interview anxiety is normal and reducible. Naming "I'm nervous about the background check question" literally reduces amygdala reactivity. The practice environment should normalize this.

STAGES OF CHANGE (Prochaska, 1983): A user in "preparation" needs different interview prep than one in "action." Preparation users need more scaffolding, more basic questions. Action users need challenging behavioral questions and curveball scenarios.

DISCLOSURE REHEARSAL (Maruna + Bushway): If the user has a record, interview practice MUST include a natural disclosure moment. Not forced. Not the first question. Around exchange 3-4, the AI interviewer should bring up backgrounds naturally, giving the user a chance to practice their prepared script.

GROWTH MINDSET (Dweck, 2006): Feedback should be process-focused: "You did a great job pivoting from the gap question to your warehouse experience" not "You're a natural interviewer."`,

  job_search: `RESEARCH-BACKED JOB SEARCH GUIDANCE:

FAIR-CHANCE EMPLOYMENT: Companies with explicit fair-chance hiring policies have 13% lower turnover and report equal or better job performance from justice-impacted hires (SHRM, 2021).

BAN-THE-BOX IMPACT: In jurisdictions with ban-the-box laws, callback rates for people with records increase 30-40% when criminal history inquiry is delayed to post-offer (Agan & Starr, 2018).

EMPLOYMENT REALITY: <50% of formerly incarcerated people find employment in Year 1. Median earnings $7,500/year. Average time to first job: 6+ months. BUT: those who receive targeted career services have significantly better outcomes.

JOB MATCHING: Prioritize roles where the candidate's EXISTING skills transfer directly. A warehouse worker doesn't need retraining to be a logistics coordinator — they need positioning. Match based on demonstrated capability, not just job title keywords.

SECOND-CHANCE EMPLOYERS: Companies known to actively hire justice-impacted individuals should be highlighted. Not as charity -- as smart business (lower turnover, loyalty). Do NOT cite the Work Opportunity Tax Credit (WOTC) as a current hiring incentive: it expired for hires who begin work after 2025-12-31 and Form 8850 is retired. If an employer incentive is relevant, the Federal Bonding Program is the current one, and never present any incentive as settled without verification.`,

  resources: `RESEARCH-BACKED RESOURCE MATCHING:

BARRIER-SPECIFIC EVIDENCE:
- Criminal Record: Disclosure coaching is the #1 unmet need (ACM COMPASS, 2025). Legal aid for expungement has highest ROI.
- Housing: Stable housing is a prerequisite for sustained employment (Desmond, 2016). Housing-first approaches outperform employment-first.
- Transportation: In car-dependent metros (like Milwaukee), transportation is the #2 barrier after criminal records. Bus passes, ride-share subsidies, bike programs.
- Mental Health: Untreated mental health conditions are the strongest predictor of job loss within 90 days. Peer support + professional services.
- Substance Use: Recovery-friendly workplaces exist and should be matched. MAT-compatible scheduling.

READINESS MATCHING (Prochaska, 1983):
- Precontemplation: Don't push action resources. Offer information and reflection.
- Contemplation: Present options without pressure. "Here's what's available when you're ready."
- Preparation: Concrete next steps with contact info and what to expect.
- Action: Immediate, high-touch resources. Warm handoffs preferred.`,

  analysis: `RESEARCH-BACKED CAREER ANALYSIS:

NARRATIVE IDENTITY (McAdams & McLean, 2013): Redemption sequences (negative → positive) predict well-being and resilience. The analysis should identify and reinforce redemption themes in the user's story.

DESISTANCE THEORY (Maruna, 2001): Agency predicts successful career rebuilding. Identify moments of agency — choices, initiative, self-direction. These become the backbone of the narrative.

AFFECT LABELING (Lieberman et al., 2007): The analysis process itself is therapeutic. Putting experiences into words reduces emotional intensity by up to 50%. Every free-text prompt serves dual purpose: data collection AND emotional processing.

SELF-DETERMINATION (Deci & Ryan, 2000): Never prescribe career paths. Present options with evidence. "Based on your skills, these paths fit" not "You should do this." Autonomy preservation is non-negotiable.

SCAFFOLDING (Wood, Bruner, Ross, 1976): The analysis provides heavy structure initially — identifying skills the user may not recognize. As they return and iterate, the tool should do less and they should do more.

STAGES OF CHANGE (Prochaska & DiClemente, 1983):
- Precontemplation: Identity-focused. "Here's what you bring." 2 career paths max.
- Contemplation: Options-focused. "Here's what's possible." 3 paths, acknowledge ambivalence.
- Preparation: Action-focused. "Here's what to do." 3-5 paths with concrete next steps.
- Action: Execution-focused. "Here's what to do TODAY." Specific employers, applications, timelines.`,
};

// ─── User Context Builder ───────────────────────────────────────────────────

export function buildUserContext(user: UserContext): string {
  const parts: string[] = [];

  if (user.level) {
    parts.push(LEVEL_DIRECTIVES[user.level]);
  }

  if (user.readinessStage) {
    parts.push(`USER READINESS: ${user.readinessStage} (Prochaska Stages of Change). Adapt tone and specificity accordingly.`);
  }

  if (user.narrative) {
    parts.push(`NARRATIVE SUMMARY: ${user.narrative}`);
  }

  if (user.strengths?.length) {
    parts.push(
      `VERIFIED STRENGTHS (from career analysis):\n${user.strengths.map((s) => `- ${s.title}: ${s.evidence}`).join("\n")}`
    );
  }

  if (user.skills?.length) {
    parts.push(`SKILLS: ${user.skills.map((s) => s.name).join(", ")}`);
  }

  if (user.careerPaths?.length) {
    parts.push(
      `CAREER PATHS IDENTIFIED:\n${user.careerPaths.map((cp) => `- ${cp.title}${cp.match_reason ? `: ${cp.match_reason}` : ""}`).join("\n")}`
    );
  }

  if (user.barriers?.length) {
    const safeBarriers = user.barriers
      .filter((b) => b !== "criminal_record")
      .map((b) => b.replace(/_/g, " "));
    if (safeBarriers.length) {
      parts.push(`BARRIERS TO ADDRESS: ${safeBarriers.join(", ")}`);
    }
    if (user.barriers.includes("criminal_record")) {
      parts.push("NOTE: User has a criminal record. NEVER reference this in resumes, cover letters, or any written output. Disclosure happens in person only.");
    }
  }

  return parts.length > 0
    ? `\n\nUSER PROFILE:\n${parts.join("\n\n")}`
    : "";
}

// ─── Job Context Builder ────────────────────────────────────────────────────

export function buildJobContext(job: JobContext): string {
  if (!job.targetJob && !job.targetCompany) return "";

  const parts: string[] = [];
  if (job.targetJob) parts.push(`TARGET ROLE: ${job.targetJob}`);
  if (job.targetCompany) parts.push(`TARGET EMPLOYER: ${job.targetCompany}`);
  if (job.industry) parts.push(`INDUSTRY: ${job.industry}`);
  if (job.jobDescription) parts.push(`JOB DESCRIPTION: ${job.jobDescription}`);
  if (job.requirements?.length) parts.push(`REQUIREMENTS: ${job.requirements.join(", ")}`);

  return `\n\nJOB CONTEXT:\n${parts.join("\n")}`;
}

// ─── Full Context Combiner ──────────────────────────────────────────────────

export function buildFullContext(
  useCase: UseCase,
  user?: UserContext,
  job?: JobContext
): string {
  const sections: string[] = [];

  // Research layer (always included)
  sections.push(RESEARCH[useCase]);

  // User layer (if available)
  if (user) {
    const userCtx = buildUserContext(user);
    if (userCtx) sections.push(userCtx);
  }

  // Job layer (if available)
  if (job) {
    const jobCtx = buildJobContext(job);
    if (jobCtx) sections.push(jobCtx);
  }

  return sections.join("\n\n");
}

// ─── Helper: Extract user context from Forge data ───────────────────────────

export function userContextFromForge(forgeData: Record<string, any>): UserContext {
  const output = forgeData.forgeOutput || forgeData;

  return {
    level: detectUserLevel(forgeData),
    readinessStage: forgeData.readinessStage || undefined,
    barriers: forgeData.challenges || undefined,
    criminalRecord: forgeData.criminalRecord || undefined,
    skills: output.skills || undefined,
    strengths: output.narrative?.strengths || output.strengths || undefined,
    narrative: output.narrative?.summary || undefined,
    careerPaths: output.career_paths || output.careerPaths || undefined,
  };
}
