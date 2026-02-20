/**
 * gen_coverletter — Cover Letter generator (3 tones × targeted employer)
 *
 * Consumes: profile.v1, employers_enriched.v1, signals.v1
 * Output: DOCX — one per invocation (tone + target employer passed via params)
 * Params: { tone: 'bold' | 'friendly' | 'professional', target_employer_index: number }
 */
import { getRunData, uploadFile, insert, emitEvent } from '@crucible/core';
import { parseAIJson } from './repairJson';
import type { ProfileV1Type, EmployersV1Type, SignalsV1Type } from '@crucible/core';
import Anthropic from '@anthropic-ai/sdk';
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle,
} from 'docx';
import type { ArtifactJobData, GeneratorResult } from './types';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

function getAnthropic(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── Prompt Template ────────────────────────────────────────────

function buildCoverLetterPrompt(
  profile: ProfileV1Type,
  employer: EmployerData,
  signals: SignalsV1Type,
  tone: string
): string {
  const location = [profile.city, profile.state].filter(Boolean).join(', ');
  const yearsExp = calculateYearsExperience(profile.work_history);

  const workHighlights = profile.work_history.slice(0, 3).map(w => {
    const bullets = (w.bullets || []).slice(0, 3).join('; ');
    return `${w.title} at ${w.company}: ${bullets}`;
  }).join('\n');

  const activeBarriers = Object.entries(signals.barriers)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, ' '));

  const barrierContext = signals.barriers_any
    ? `BARRIER CONTEXT: The candidate has ${activeBarriers.join(', ')}. Address this naturally — one sentence maximum, positioned as growth and accountability. Do NOT over-explain, apologize, or dedicate a paragraph to it. If the barrier is a criminal record, something like "I've built a strong track record of reliability since then" is sufficient. If the barrier is an employment gap, a brief "I took time to [reason] and am now fully committed to [target]" works.`
    : ''; // Omit entirely when no barriers — empty variable makes Claude think something is missing

  let result = COVERLETTER_PROMPT_TEMPLATE
    .replace('{{CANDIDATE_NAME}}', profile.full_name)
    .replace('{{CANDIDATE_EMAIL}}', profile.email || '')
    .replace('{{CANDIDATE_PHONE}}', profile.phone || '')
    .replace('{{CANDIDATE_LOCATION}}', location)
    .replace('{{YEARS_EXP}}', String(yearsExp))
    .replace('{{WORK_HIGHLIGHTS}}', workHighlights)
    .replace('{{CERTIFICATIONS}}', profile.certifications.join(', ') || 'None listed')
    .replace('{{TARGET_ROLES}}', signals.target_roles.join(', '))
    .replace('{{SKILLS_TECHNICAL}}', signals.skills_technical.slice(0, 8).join(', '))
    .replace('{{EMPLOYER_NAME}}', employer.name)
    .replace('{{EMPLOYER_INDUSTRY}}', employer.industry)
    .replace('{{EMPLOYER_LOCATION}}', employer.location)
    .replace('{{EMPLOYER_WHY_GOOD_FIT}}', employer.why_good_fit)
    .replace('{{EMPLOYER_CONTACT_NAME}}', employer.contact_name || '')
    .replace('{{EMPLOYER_APPROACH}}', employer.approach_strategy || '')
    .replace('{{EMPLOYER_INTEL}}', employer.company_intel || '')
    .replace('{{TONE}}', tone)
    .replace('{{TONE_INSTRUCTIONS}}', TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.professional)
    .replace('{{BARRIER_CONTEXT}}', barrierContext);

  // Clean up empty lines from omitted barrier context
  if (!signals.barriers_any) {
    result = result.replace(/\n{3,}/g, '\n\n');
  }

  return result;
}

const TONE_INSTRUCTIONS: Record<string, string> = {
  bold: `TONE: BOLD
- Lead with your biggest achievement, quantified. Numbers first, context second.
- Confidence without arrogance. "I managed a team of 12 and reduced shrink by 15%" not "I believe I could potentially contribute."
- Short, punchy sentences. Active voice only. No filler phrases.
- The reader should feel this person KNOWS they can do the job and is doing the employer a favor by applying.
- Cadence: achievement → proof → why this company → call to action.`,

  friendly: `TONE: FRIENDLY
- Warm opening that shows genuine interest in the company. Story-driven.
- "What drew me to [Company] is..." — show you've done your homework.
- Conversational but professional. You're a real person, not a template.
- Weave achievements into narrative naturally: "During my 9 years at Piggly Wiggly, I found that managing a team well means..."
- The reader should feel they'd enjoy working with this person.
- Cadence: connection → story → skills → enthusiasm → availability.`,

  professional: `TONE: PROFESSIONAL
- Traditional business letter format. Formal but not stiff.
- "I am writing to express my interest in the [Role] position at [Company]."
- Structured: intro → qualifications → company fit → closing.
- Reference specific role requirements and match them to experience.
- The reader should see a well-organized, reliable professional.
- Cadence: intent → qualifications → alignment → next steps.`,
};

export const COVERLETTER_PROMPT_TEMPLATE = `You are writing a cover letter for a real person applying to a real company. This is not a template — it must be filled with actual details from the candidate's profile and the employer's information.

CANDIDATE:
- Name: {{CANDIDATE_NAME}}
- Email: {{CANDIDATE_EMAIL}}
- Phone: {{CANDIDATE_PHONE}}
- Location: {{CANDIDATE_LOCATION}}
- Years of experience: {{YEARS_EXP}}
- Target roles: {{TARGET_ROLES}}
- Key skills: {{SKILLS_TECHNICAL}}
- Certifications: {{CERTIFICATIONS}}

WORK HIGHLIGHTS:
{{WORK_HIGHLIGHTS}}

TARGET EMPLOYER:
- Company: {{EMPLOYER_NAME}}
- Industry: {{EMPLOYER_INDUSTRY}}
- Location: {{EMPLOYER_LOCATION}}
- Why they're a fit: {{EMPLOYER_WHY_GOOD_FIT}}
- Contact name (if available): {{EMPLOYER_CONTACT_NAME}}
- Approach strategy: {{EMPLOYER_APPROACH}}
- Company intel: {{EMPLOYER_INTEL}}

{{BARRIER_CONTEXT}}

{{TONE_INSTRUCTIONS}}

REQUIREMENTS:
1. Address the letter to "Dear Hiring Manager at {{EMPLOYER_NAME}}" — or to the contact name if available: "Dear {{EMPLOYER_CONTACT_NAME}}"
2. The letter must be 250-350 words. Not shorter, not longer.
3. ZERO placeholder text. No [brackets], no "your company", no generic fill-ins. Every reference must use REAL data.
4. Reference at least ONE specific achievement from the work highlights with real numbers/details.
5. Explain why THIS company specifically — use the company intel and fit reasoning. Not "I'm excited about your company" without substance.
6. If barriers exist, address them naturally — don't lead with them, but don't hide them. One sentence, positioned as growth.
7. End with a clear call to action: specific next step (call, visit, email).
8. Do NOT include the candidate's address block or date — we handle formatting. Just the greeting through the sign-off.

Return a JSON object:
{
  "greeting": "Dear Hiring Manager at Acme Corp,",
  "body": "The full body of the cover letter, with paragraph breaks indicated by \\n\\n",
  "sign_off": "Sincerely,",
  "word_count": 285
}

Return ONLY valid JSON.`;

// ── Employer data shape ────────────────────────────────────────

interface EmployerData {
  name: string;
  industry: string;
  location: string;
  why_good_fit: string;
  contact_name: string | null;
  approach_strategy: string;
  company_intel: string;
}

// ── DOCX Builder ───────────────────────────────────────────────

const GOLD = 'D4A84B';
const DARK = '1a1a1a';
const GRAY = '666666';

function buildDocx(
  profile: ProfileV1Type,
  employerName: string,
  tone: string,
  content: { greeting: string; body: string; sign_off: string }
): Promise<Buffer> {
  const children: Paragraph[] = [];
  const location = [profile.city, profile.state, profile.zip].filter(Boolean).join(', ');

  // Letterhead: candidate name
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: [new TextRun({ text: profile.full_name.toUpperCase(), bold: true, size: 32, font: 'Calibri', color: DARK })],
  }));

  // Contact info line
  const contactParts = [profile.phone, profile.email, location].filter(Boolean);
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: contactParts.join('  |  '), size: 20, font: 'Calibri', color: GRAY })],
  }));

  // Gold accent line
  children.push(new Paragraph({
    spacing: { after: 300 },
    border: { bottom: { color: GOLD, size: 8, style: BorderStyle.SINGLE, space: 4 } },
    children: [],
  }));

  // Greeting
  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: content.greeting, size: 22, font: 'Calibri', color: DARK })],
  }));

  // Body paragraphs
  const paragraphs = content.body.split(/\n\n+/);
  for (const para of paragraphs) {
    if (!para.trim()) continue;
    children.push(new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: para.trim(), size: 22, font: 'Calibri' })],
    }));
  }

  // Sign off
  children.push(new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: content.sign_off, size: 22, font: 'Calibri' })],
  }));

  children.push(new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text: profile.full_name, bold: true, size: 22, font: 'Calibri' })],
  }));

  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc).then(b => Buffer.from(b));
}

// ── Main Generator ─────────────────────────────────────────────

export async function generateCoverLetter(job: ArtifactJobData): Promise<GeneratorResult> {
  const { runId, bundleId, orgId, projectId, artifactKey, params } = job;

  const tone = (params.tone as string) || 'professional';
  const targetIndex = (params.target_employer_index as number) ?? 0;

  // Read frozen data products
  const profile = await getRunData<ProfileV1Type>(runId, 'profile.v1');
  const employers = await getRunData<EmployersV1Type>(runId, 'employers_enriched.v1');
  const signals = await getRunData<SignalsV1Type>(runId, 'signals.v1');

  // Get target employer
  const targetEmployer = employers.tier1[targetIndex];
  if (!targetEmployer) {
    throw new Error(`No Tier 1 employer at index ${targetIndex} — only ${employers.tier1.length} available`);
  }

  const employerData: EmployerData = {
    name: targetEmployer.name,
    industry: targetEmployer.industry,
    location: targetEmployer.location,
    why_good_fit: targetEmployer.why_good_fit,
    contact_name: targetEmployer.contact_name,
    approach_strategy: targetEmployer.approach_strategy,
    company_intel: targetEmployer.company_intel,
  };

  const anthropic = getAnthropic();
  const prompt = buildCoverLetterPrompt(profile, employerData, signals, tone);

  console.log(`[gen_coverletter] Calling Claude for ${tone} cover letter targeting ${targetEmployer.name}...`);
  const startTime = Date.now();

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const latencyMs = Date.now() - startTime;
  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  console.log(`[gen_coverletter] Claude responded in ${latencyMs}ms`);

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'AI_CALL_COMPLETED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_coverletter',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: {
      provider: 'anthropic', model: CLAUDE_MODEL, latency_ms: latencyMs,
      token_estimate: (message.usage?.input_tokens || 0) + (message.usage?.output_tokens || 0),
      tone, target_employer: targetEmployer.name,
    },
  });

  const content = await parseAIJson(text);

  const letterContent = {
    greeting: content.greeting || `Dear Hiring Manager at ${targetEmployer.name},`,
    body: content.body || '',
    sign_off: content.sign_off || 'Sincerely,',
  };

  if (!letterContent.body || letterContent.body.length < 100) {
    throw new Error(`Cover letter body too short (${letterContent.body?.length || 0} chars) — AI may have failed`);
  }

  // Build DOCX
  const docxBuffer = await buildDocx(profile, targetEmployer.name, tone, letterContent);

  // Upload to R2
  const safeName = (profile.full_name || 'Candidate').replace(/[^a-zA-Z0-9]/g, '_');
  const safeEmployer = targetEmployer.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
  const fileName = `${safeName}_CoverLetter_${capitalize(tone)}_${safeEmployer}.docx`;
  const objectKey = `${orgId}/${projectId}/artifacts/${runId}/${fileName}`;
  const fileObject = await uploadFile(
    orgId, objectKey, docxBuffer,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );

  // Display title mapping
  const displayTitles: Record<string, string> = {
    bold: 'Cover Letter (Bold)',
    friendly: 'Cover Letter (Friendly)',
    professional: 'Cover Letter (Professional)',
  };

  const artifact = await insert<{ id: string }>('artifact', {
    org_id: orgId,
    run_id: runId,
    project_id: projectId,
    artifact_type: artifactKey,
    artifact_key: artifactKey,
    bundle_id: bundleId,
    file_object_id: fileObject.id,
    display_title: displayTitles[tone] || `Cover Letter (${capitalize(tone)})`,
    display_section: 'apply',
    preview_type: 'none',
    order_index: tone === 'bold' ? 11 : tone === 'friendly' ? 12 : 13,
    version: 1,
    review_status: 'pending',
  });

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'ARTIFACT_GENERATED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_coverletter',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: {
      artifact_id: artifact.id, artifact_key: artifactKey,
      file_name: fileName, byte_size: docxBuffer.length,
      tone, target_employer: targetEmployer.name,
    },
  });

  console.log(`[gen_coverletter] Cover letter generated: ${fileName} (${docxBuffer.length} bytes)`);

  return { artifactKey, fileObjectId: fileObject.id, fileName, byteSize: docxBuffer.length };
}

// ── Utilities ──────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function calculateYearsExperience(workHistory: Array<{ start_date: string | null }>): number {
  if (!workHistory || workHistory.length === 0) return 0;
  const earliest = workHistory[workHistory.length - 1];
  const startYear = parseInt(earliest?.start_date?.match(/\d{4}/)?.[0] || '0');
  if (startYear === 0) return 0;
  return Math.max(0, new Date().getFullYear() - startYear);
}
