/**
 * Context Library: source-grounded practice guidance and context for AI calls.
 *
 * Three layers:
 * 1. Practice guidance: fact and choice boundaries per use case
 * 2. User: readiness stage, barriers, skills, narrative, record details
 * 3. Job: target role, company, industry, requirements
 *
 * Every AI route imports from here instead of hardcoding context.
 */

import { resumeRulesBlock } from "@crucible/core/src/resumeRules";

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
RESUME FORMAT: Dated history in reverse order even when it is thin; never a dateless functional page. With little or no work history, lead with what the person does have (education, training, programs, volunteer or informal work), each with the dates in the form the person gave. Never guess a year or invent an entry. Use only numbers the person gave. If a line has no number, leave it without one. Never estimate.
INTERVIEW: Match the selected role and practice mode. Ask relevant follow-ups and offer explanation when the person wants it.
DISCLOSURE: Simple script, basic timing advice. Don't overwhelm.`,

  professional: `USER LEVEL: Professional (mid-career, solid experience, some education)
LANGUAGE: Professional level. Concise and direct.
TONE: Confident peer. Don't over-explain basics.
RESUME FORMAT: Chronological and dated. Specific, plain lines; numbers only as the person gave them. Standard professional bar.
INTERVIEW: Match the selected role and practice mode. Ask relevant follow-ups and offer explanation when the person wants it.
DISCLOSURE: Use the selected setting and the person's own facts. Legal context must be current and verified.`,

  executive: `USER LEVEL: Executive (senior, advanced degrees, leadership history)
LANGUAGE: Executive level. Assume expertise. Strategic positioning.
TONE: Colleague-to-colleague. No hand-holding.
RESUME FORMAT: Chronological and dated, achievement-focused from the person's own facts; numbers only as the person gave them, never added. Readable by software and by a person.
INTERVIEW: Match the selected role and practice mode. Ask relevant follow-ups and offer explanation when the person wants it.
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

// ─── Practice Guidance by Use Case ───────────────────────────────────────────

const PRACTICE_GUIDANCE: Record<UseCase, string> = {
  resume: `RESUME PRACTICE GUIDANCE:
Use only the person's supplied facts. Reword clearly and organize their experience for the target role without adding duties, scope, tools, credentials, dates, frequency, numbers, results or personal qualities. Keep help and supervision limits. Preserve every date in the form the person gave. A job posting names employer needs; it is not evidence that the person meets them. Career-analysis suggestions are not verified facts. If a useful fact is missing, ask the person or leave it out.
Make the page specific, readable and useful for discussing the person's actual work. Keep dated history; do not hide gaps or invent their explanation. Follow the active request's rule for the person's chosen treatment of inside work. Do not infer a record from work, education or a gap.
${resumeRulesBlock("truth")}`,

  cover_letter: `COVER LETTER PRACTICE GUIDANCE:
Connect the person's supplied experience to the stated role using concrete facts. The posting supplies the target, not the applicant's qualifications. Use the supplied resume and any explicitly confirmed additions; do not treat generated strengths or analysis as proof. Keep the letter only as long as the evidence supports. A short factual letter is acceptable.
State interest as interest. Do not invent a motive, company connection, result, habit, feeling, availability, transportation, physical capability or future guarantee. Preserve the size of each duty and the job where it occurred. Include numbers only as supplied. Do not explain gaps or introduce record information. Do not invent a redemption story or assume that hardship made the person stronger.`,

  interview: `INTERVIEW PRACTICE GUIDANCE:
Ask one relevant question at a time, using the selected practice mode, the person's supplied experience and the target job. Keep employer requirements separate from candidate facts. Ask a follow-up when an action, example or result is missing; never supply it. A behavioral example can cover the situation, the person's action and what happened, when the person has those details. Other questions may need a direct answer instead.
Give feedback on what the person actually said: clarity, relevance, specificity and whether the answer addresses the question. Describe a likely interviewer concern as a possibility, not knowledge of their thoughts. Suggest a small next practice step. Do not promise confidence, symptom relief or hiring results.
Practice record questions only when the user selected or requested that practice. Respect their choice about what to share. Never infer a record or force an admission. Any stronger answer uses only the person's supplied facts, preserves explicit negatives and acknowledges missing details. If a full answer would require invention, ask for the missing detail instead.`,

  disclosure: `RECORD-CONVERSATION PRACTICE GUIDANCE:
Help the person prepare for the question and setting they chose. Let them decide what to share. Use only their own supplied account; do not ask for private record details to make practice more realistic. Do not introduce charges, sentence, supervision status or an explanation they did not give. Never turn a disputed or unknown event into an admission.
Offer clear wording and a chance to practice. When discussing responsibility, stay with conduct the person actually acknowledged. Do not invent remorse, lessons, transformation, elapsed time, supervision completion, references or a clean record. Silence about the record is not evidence of poor accountability.
Do not state what an employer will think or guarantee acceptance. Treat an employer's possible concern as uncertain. Legal requirements depend on the location, employer, role and hiring stage; do not make an unverified legal claim or advise concealment. For a legal question, identify the context needed and direct the person to an appropriate current source or qualified help. Do not claim that this exercise treats anxiety or trauma, or promise deletion behavior that the product has not established.`,

  job_search: `JOB SEARCH PRACTICE GUIDANCE:
Use plain words such as employers that hire people with records when that is relevant to the person's request. Match roles to the experience the person actually supplied. Explain the specific overlap and any requirement not yet supported. A related job title does not establish a skill, credential or readiness for a different role.
Use only jobs, employer statements and requirements supplied by available sources. Distinguish a retrieved opening from a suggested search direction. If no listings are available, say so and offer a concrete search action; do not invent openings, salary, hiring policy or employer interest. An employer policy is not a promise that a person will be hired.
Do not add claims about turnover, callback rates, population employment, earnings or program effectiveness. Do not promise that training is unnecessary. Verify the current availability and eligibility of an incentive before presenting it as usable; do not assume a tax credit or bonding program is active or applicable.`,

  resources: `RESOURCE MATCHING PRACTICE GUIDANCE:
Start with the need the person identified and the help they want now. Do not infer a diagnosis, urgency or inability to work from a barrier label. Offer manageable next steps and respect their choice to decline or defer.
Use available source information to explain what a resource provides, where it operates, eligibility, cost, contact method and the next action. Distinguish verified details from details to check. Never invent a service, opening, warm introduction or eligibility decision. Do not claim one barrier, service or treatment predicts employment outcomes or has the highest return without appropriate evidence. Medical or legal questions need current authoritative information or qualified help; this career tool does not diagnose or treat.`,

  analysis: `CAREER EXPLORATION GUIDANCE:
Separate the person's facts from possible interpretations. Identify skills only when a supplied example supports them; label a possible skill or career direction as something to check with the person. Do not turn hardship, a record or a gap into a strength, motive, recovery story or diagnosis.
Offer career options with a specific connection to the person's work, interests and constraints. Explain what is known, what is missing and one practical next step. Let the person choose. Do not invent qualifications, pay, employer demand or outcomes. Keep generated analysis separate from the person's confirmed facts in later writing.
Adjust detail to the person's questions and preferences. A readiness label is context, not a diagnosis or proof of ability. Do not claim that analysis is therapeutic or guarantees emotional, behavioral or employment improvement.`,

};

// ─── User Context Builder ───────────────────────────────────────────────────

export function buildUserContext(user: UserContext): string {
  const parts: string[] = [];

  if (user.level) {
    parts.push(LEVEL_DIRECTIVES[user.level]);
  }

  if (user.readinessStage) {
    parts.push(`USER READINESS: ${user.readinessStage} (context only; follow the person's stated needs and preferences).`);
  }

  if (user.narrative) {
    parts.push(`NARRATIVE SUMMARY: ${user.narrative}`);
  }

  if (user.strengths?.length) {
    parts.push(
      `CAREER-ANALYSIS SUGGESTIONS (not independent verification; use a supplied example or ask the person):\n${user.strengths.map((s) => `- ${s.title}: ${s.evidence}`).join("\n")}`
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
      parts.push("Record-related support was selected. Do not introduce record facts into resumes or letters. Discuss the topic only in the requested support or practice context; do not infer details from this label.");
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

  // Practice guidance (always included)
  sections.push(PRACTICE_GUIDANCE[useCase]);

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
