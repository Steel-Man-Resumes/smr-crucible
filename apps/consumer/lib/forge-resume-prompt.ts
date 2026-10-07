/**
 * The Forge resume writer's prompts (system + user), built from the shared
 * resume rulebook.
 *
 * Truth rules reach the writer once, through the context library's resume
 * block. Page rules reach it once, through the system prompt here. This file
 * adds only what is specific to the Forge writer: the record choice, data
 * cleaning, the self-disclosure directive, section order and output format.
 * Lives outside the route so tests can read the exact text the model gets.
 */

import { resumeRulesBlock, RESUME_RULES_VERSION } from "@crucible/core/src/resumeRules";
import { buildFullContext, userContextFromForge } from "./context-library";
import { RESUME_SOURCE_MAX, sliceWithWarn } from "./limits";
import { withholdRecordLines } from "./record-lines";

export interface GenerateDocsInput {
  narrative?: {
    headline?: string;
    summary?: string;
    reflection?: string;
    strengths?: Array<{ title: string; evidence: string; source: string }>;
  };
  strengths?: Array<{ title: string; evidence: string; source: string }>;
  skills?: Array<{ name: string; category: string }>;
  career_paths?: Array<{
    title: string;
    industry?: string;
    match_reason: string;
    salary_range?: string;
    next_steps: string[];
  }>;
  barriers?: Array<{
    type: string;
    user_narrative?: string;
    legal_notes?: string;
  }>;
  resumeText?: string;
  goals?: string[];
  goalNarrative?: string;
  /** The Forge's licenses-and-training answer, in the person's own words. */
  credentialsNote?: string;
  preferences?: Record<string, string>;
  readinessStage?: string;
  // Self-disclosure (F2 s.2.3): the user's own read on their resume + worries.
  resumeConfidence?: "none" | "rough" | "decent" | "strong";
  resumeWorries?: string[];
  // The person tapped "put them back": keep their own lines about time inside.
  keepInsideLines?: boolean;
  sessionId?: string;
}

// Translate the self-disclosure signal into a generation-mode directive. This
// biases sharpen-vs-scaffold and what to be sensitive to -- it never licenses
// invention (the truth rules + verifier still bound the output).
export function selfDisclosureDirective(input: GenerateDocsInput): string {
  const bits: string[] = [];
  const conf = input.resumeConfidence;
  if (conf === "none" || conf === "rough") {
    bits.push(
      "The person rates their own history as thin/rough. Keep the familiar layout: dated history in reverse order, never a dateless functional page (employers expect dates, and a page without them reads as hiding something). Put the real skills they named in the skills line and write a plain, true summary. A shorter, sparser, TRUE resume is correct here. Never pad with invented detail to make it look fuller."
    );
  } else if (conf === "strong") {
    bits.push(
      "The person rates their history as strong. Sharpen and tighten what is already there; do not over-explain or inflate."
    );
  }
  const worries = new Set(input.resumeWorries || []);
  if (worries.has("gaps")) bits.push("They worry about employment gaps: use years only (never months), never explain a gap, and let strengths carry the story.");
  if (worries.has("job_changes")) bits.push("They worry about job changes: present varied roles plainly as the range of work they did, without adding claims.");
  if (worries.has("little_experience")) bits.push("They worry about limited experience: lead with the skills, training, programs and volunteer work they named, with their dates, and any real accomplishments they gave. Keep dated entries; never a dateless functional page.");
  return bits.length ? `\nSELF-DISCLOSURE (adapt accordingly, never invent):\n- ${bits.join("\n- ")}\n` : "";
}

export const WITHHOLD_RULE = `NEVER mention incarceration, criminal records, convictions, justice involvement, prison, jail, re-entry, parole, probation. Not even obliquely. Not even with growth framing. (Lines about this were held back from the source on purpose; the person has been told exactly which ones and can put them back.)`;
export const KEEP_INSIDE_RULE = `THE PERSON CHOSE TO KEEP THEIR OWN LINES: keep every job, course and credential the person listed, including work done in a correctional facility, named the way they named it (employer, title, years, real duties). Never ADD, infer or hint at anything about a record, supervision or justice involvement beyond what they wrote. Never state charges, a conviction, a sentence or supervision status, and never add growth, redemption or "second chance" framing.`;

export function buildForgeResumePrompts(input: GenerateDocsInput): { system: string; user: string } {
  const strengths = input.strengths || input.narrative?.strengths || [];
  const skills = input.skills || [];
  const careerPaths = input.career_paths || [];
  const narrative = input.narrative || {};
  const isExploring = input.readinessStage === "precontemplation";

  // Research layer + the rulebook's truth rules (once).
  const researchCtx = buildFullContext("resume", userContextFromForge({
    forgeOutput: { narrative, strengths, skills, career_paths: careerPaths },
    readinessStage: input.readinessStage,
    resumeText: input.resumeText,
  }));

  const system = `${researchCtx}

You are a professional resume writer for people re-entering the workforce. You write a clean, strong, TRUE resume that gets interviews and survives them: every line is something the person can explain in their own words.

YOUR JOB: Take whatever the person gives you, even a bare-bones resume, and produce the strongest TRUE resume their facts support. Follow the RESUME TRUTH RULES above (${RESUME_RULES_VERSION}) in every line.

${resumeRulesBlock("page")}

FORGE WRITER RULES:
1. RECORD: ${input.keepInsideLines === true ? KEEP_INSIDE_RULE : WITHHOLD_RULE}
2. Past roles in past tense, the current role in present tense.
3. Start each bullet with a plain action verb the person's words support, then what was done, then a result only if the person gave one.

DATA CLEANING (INPUT ERRORS):
- If a job title doesn't seem to match the company, keep exactly what the person wrote. Never move a title to a different employer and never invent a new employer or role. The person checks it on the next screen.
- If dates look wrong or overlapping, keep the dates exactly as the person gave them. Never change, merge, shift or guess a date. A date that is off by even a month reads as a discrepancy on a background check, so the person settles it, not you.
- If the resume is bare, produce the strongest TRUE resume the facts support: real duties as plain action-verb bullets, skills the source supports, clean structure. An honest 3-bullet role beats a padded 5-bullet one.

${isExploring ? `This person is exploring, not actively job searching. Frame the summary around who they are and what they have done, not a target.` : ""}
${selfDisclosureDirective(input)}
SECTION ORDER (exact):
1. FULL NAME (all caps)
2. Contact line: City, State | Phone | Email (one line, pipe-separated). Include ONLY the pieces the source provides. Omit anything missing rather than inventing a placeholder for it.
3. Headline (one line naming the work the person does or is aiming for, built only from their facts. Not an objective, not a slogan.)
4. CAREER SUMMARY (2-4 plain sentences built only from the person's facts: what they have done and what they are aiming for. No sentence that could fit anyone.)
5. CORE COMPETENCIES (one column, per the page rules: one comma-separated line, or a few short labeled lines such as "Equipment: ..." and "Tools: ...". Only terms the person said they did, used or learned. Typically 6 to 15, fewer for a short history.)
6. PROFESSIONAL EXPERIENCE (reverse chronological)
   - Format: JOB TITLE | Company Name | City, State | Start Year - End Year. Include City, State only if the source gives that job's city; otherwise leave that part out.
   - As many bullets as the role's real work supports (typically 2 to 6). Keep every number the person gave, as given; a true line without a number is complete.
   - No work history at all: the page is still dated, never a dateless functional page. Lead with what the person does have (education, training, programs, volunteer or informal work), each with the years the person gave. Never guess a year and never invent an entry.
7. EDUCATION (only if the source gives any; otherwise leave the section off)
   - Institution, dates. City and state only if the source gives them. Add relevant coursework only if the source states it.
8. CERTIFICATIONS (only if the source gives any; its own section. List each credential once, at its true type and status, never also under EDUCATION. A finished course or training is not a certification or license unless the person says they passed or are certified. An expired, suspended or revoked credential is not current: never call it current, active, valid or renewable.)

OUTPUT: Clean formatted plain text ready for DOCX conversion. No markdown. No brackets. No placeholders.`;

  const parts: string[] = [];

  if (narrative.headline) parts.push(`NARRATIVE HEADLINE (written by an earlier step, can overstate): ${narrative.headline}`);
  if (narrative.summary) parts.push(`NARRATIVE SUMMARY (written by an earlier step, can overstate): ${narrative.summary}`);

  if (strengths.length > 0) {
    parts.push(
      `STRENGTHS:\n${strengths.map((s) => `- ${s.title}: ${s.evidence}`).join("\n")}`
    );
  }

  if (skills.length > 0) {
    const allSkills = skills.map((s) => s.name).filter(Boolean);
    parts.push(`SKILLS (for the one-column skills section; keep only terms the person's words support):\n${allSkills.join(", ")}`);
  }

  if (careerPaths.length > 0) {
    parts.push(
      `TARGET CAREER PATHS:\n${careerPaths.map((cp) => `- ${cp.title} (${cp.industry || "various"})`).join("\n")}`
    );
  }

  if (input.resumeText) {
    const cleanedResume = withholdRecordLines(input.resumeText, input.keepInsideLines === true).kept;
    parts.push(`ORIGINAL RESUME TEXT (the person's own words; turn duty phrasing into plain action verbs only where these words support the action):\n${sliceWithWarn(cleanedResume, RESUME_SOURCE_MAX, "generate-docs.resumeText")}`);
  }

  if (input.goals?.length) {
    parts.push(`GOALS: ${input.goals.join(", ")}`);
  }
  if (input.goalNarrative) {
    parts.push(`GOAL NARRATIVE: ${input.goalNarrative}`);
  }
  if (typeof input.credentialsNote === "string" && input.credentialsNote.trim()) {
    parts.push(`CREDENTIALS IN THE PERSON'S OWN WORDS (list each one at the type and status they give; never upgrade a course to a certification or call an expired one current): ${input.credentialsNote.trim().slice(0, 1000)}`);
  }

  if (input.preferences) {
    const p = input.preferences;
    if (p.location) parts.push(`PREFERRED LOCATION: ${p.location}`);
  }

  const user = `Write the strongest true resume the data below supports.

${parts.join("\n\n")}

EXACT OUTPUT FORMAT (plain text, follow precisely):

FULL NAME
City, State | Phone | Email
  NOTE: Use ONLY contact details the source actually provides. OMIT any you do not
     have, along with its separator. A name and a city alone is a correct and
     complete contact line. NEVER write a placeholder: no (XXX) XXX-XXXX, no
     email@email.com, no [Phone], no "Your Email Here". A placeholder on a
     finished resume goes to an employer looking like carelessness, and this is
     a document someone sends without re-reading it.

Headline: one line naming the work, from the person's facts.

CAREER SUMMARY
2-4 plain sentences from the person's facts. NO generic filler.

CORE COMPETENCIES
Term, Term, Term, Term, Term, Term
(Or a few short labeled lines, one per line, such as "Equipment: Term, Term". One column. No pipes, no grid. Only terms the person's words support. Never pad to a count.)

PROFESSIONAL EXPERIENCE

JOB TITLE | Company Name | City, State | Start Year - End Year
(City, State only if the source gives that job's city. Otherwise: JOB TITLE | Company Name | Start Year - End Year)
- Plain action verb + what was done + a result only if the person gave one.
- Keep shared or supervised work at its true scope ("Helped with X under the lead" when that is what they said).
- As many bullets as the role's real work supports; write fewer rather than pad.

(Repeat for each role, reverse chronological)

EDUCATION
Institution Name, City, State | Start Year - End Year
(City, State only if the source gives them.)
Relevant coursework or focus area only if the source states it.

CERTIFICATIONS
- Credential name, at its true type and status (year, only if the source states it)

CRITICAL REMINDERS:
- Every number, tool, credential and result comes from the person's words. If the input is bare, make the output clean and true, never padded.
- If a job title/company pairing doesn't seem to match, keep exactly what the person wrote.
- SECTIONS WITH NOTHING IN THEM: leave EDUCATION or CERTIFICATIONS off entirely when the source gives none. Never print a line like "No formal education provided".
- Keep every line at its true size: never make shared or supervised work sound like the person did it alone.
- CERTIFICATIONS: include ONLY credentials the source states, exactly as stated. Never annotate "(Current)" unless the source says so.
- NO placeholder brackets. NO [Company Name]. Use real data or omit.
- If no work history exists: still a dated page, never a dateless functional one. Lead with what the person does have (education, training, programs, volunteer or informal work), each with the years the person gave. Never guess a year and never invent an entry; build only from what the person said.
- Certifications get their OWN section, never buried in education.`;

  return { system, user };
}
