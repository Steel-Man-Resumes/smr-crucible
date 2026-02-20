import type { PipelineDef, StepHandler, StepContext } from '@crucible/core';
import { query, getOne, insert, uploadFile, getSignedUrl, emitStepEvent, emitAICallEvent, extractAndParseJSON } from '@crucible/core';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } from 'docx';

// --- Pipeline Definition ---

export const careerIntakeV1: PipelineDef = {
  key: 'career_intake_v1',
  version: '1.0',
  steps: [
    { key: 'extract',  critical: true,  maxRetries: 2, timeoutMs: 60000 },
    { key: 'parse',    critical: true,  maxRetries: 2, timeoutMs: 120000 },
    { key: 'analyze',  critical: true,  maxRetries: 1, timeoutMs: 180000 },
    { key: 'generate', critical: true,  maxRetries: 1, timeoutMs: 180000 },
  ],
};

// --- AI Clients ---

function getAnthropic(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function getOpenAI(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const GPT_MODEL = 'gpt-4o-mini';

// --- Step Handlers ---

export const careerIntakeHandlers: Record<string, StepHandler> = {
  extract: extractStep,
  parse: parseStep,
  analyze: analyzeStep,
  generate: generateStep,
};

// ============================================================
// STEP 1: EXTRACT — Pull text from uploaded documents
// ============================================================

interface DocumentRow {
  id: string;
  kind: string;
  object_key: string;
  mime_type: string;
  byte_size: number;
}

async function extractStep(
  ctx: StepContext,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // Load uploaded documents for this project
  const documents = await query<DocumentRow>(
    `SELECT d.id, d.kind, f.object_key, f.mime_type, f.byte_size
     FROM document d
     JOIN file_object f ON f.id = d.file_object_id
     WHERE d.project_id = $1 AND d.org_id = $2
       AND d.source = 'user_upload'
     ORDER BY d.created_at ASC`,
    [ctx.projectId, ctx.orgId]
  );

  if (documents.length === 0) {
    throw new Error('No uploaded documents found for this project');
  }

  const allTexts: string[] = [];
  let overallConfidence = 1.0;

  for (const doc of documents) {
    const signedUrl = await getSignedUrl(doc.object_key);
    const response = await fetch(signedUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    let text = '';
    let confidence = 1.0;

    try {
      if (doc.mime_type === 'application/pdf' || doc.kind === 'upload_pdf') {
        text = await extractFromPDF(buffer);
      } else if (
        doc.mime_type?.includes('wordprocessingml') ||
        doc.mime_type?.includes('msword') ||
        doc.kind === 'upload_docx'
      ) {
        text = await extractFromDOCX(buffer);
      } else if (doc.mime_type?.startsWith('text/') || doc.kind === 'upload_txt') {
        text = buffer.toString('utf-8');
      } else if (doc.mime_type?.startsWith('image/') || doc.kind === 'upload_image') {
        try {
          text = await extractFromImage(buffer);
          if (text.length < 100) {
            confidence = 0.3;
            await emitStepEvent(ctx, 'STEP_STARTED', {
              warning: 'OCR extracted very little text',
              char_count: text.length,
            });
          }
        } catch (ocrErr: any) {
          console.warn('OCR failed, skipping image:', ocrErr.message);
          confidence = 0.1;
          text = '';
        }
      } else {
        // Try as plain text fallback
        text = buffer.toString('utf-8');
      }
    } catch (err: any) {
      console.error(`Extraction failed for ${doc.object_key}:`, err.message);
      throw new Error(`Failed to extract text from ${doc.kind}: ${err.message}`);
    }

    if (text.trim().length > 0) {
      allTexts.push(text);
    }
    overallConfidence = Math.min(overallConfidence, confidence);
  }

  const extractedText = cleanResumeText(allTexts.join('\n\n'));

  if (extractedText.trim().length < 50) {
    throw new Error('Extracted text too short (< 50 chars). Upload may be unreadable.');
  }

  // Store extracted text as a document in R2
  const textBuffer = Buffer.from(extractedText, 'utf-8');
  const textKey = `${ctx.orgId}/${ctx.projectId}/extracted_text_${ctx.runId}.txt`;
  const fileObject = await uploadFile(ctx.orgId, textKey, textBuffer, 'text/plain');

  await insert('document', {
    org_id: ctx.orgId,
    project_id: ctx.projectId,
    kind: 'extracted_text',
    file_object_id: fileObject.id,
    source: 'system_derived',
  });

  await emitStepEvent(ctx, 'DOC_TEXT_EXTRACTED', {
    char_count: extractedText.length,
    confidence: overallConfidence,
    doc_count: documents.length,
  });

  return { extractedText, confidence: overallConfidence };
}

// --- Text Extraction Helpers ---

async function extractFromPDF(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  const text = result.text || '';
  if (text.trim().length === 0) {
    throw new Error('PDF contains no extractable text');
  }
  return text;
}

async function extractFromDOCX(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  if (!result.value || result.value.trim().length === 0) {
    throw new Error('Word document contains no extractable text');
  }
  return result.value;
}

async function extractFromImage(buffer: Buffer): Promise<string> {
  const Tesseract = await import('tesseract.js');
  const { data: { text } } = await Tesseract.recognize(buffer, 'eng');
  return text || '';
}

function cleanResumeText(text: string): string {
  if (!text) return text;
  text = text.replace(/[\u2018\u2019]/g, "'");
  text = text.replace(/[\u201C\u201D]/g, '"');
  text = text.replace(/\u2013/g, '-');
  text = text.replace(/\u2014/g, '-');
  text = text.replace(/\u2026/g, '...');
  text = text.replace(/[\u2022\u25CF\u25E6]/g, '*');
  text = text.replace(/\u00A0/g, ' ');
  text = text.replace(/\u00AD/g, '');
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/\n{4,}/g, '\n\n\n');
  text = text.split('\n').map(line => line.trim()).join('\n');
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return text.trim();
}

// ============================================================
// STEP 2: PARSE — AI-structured extraction
// ============================================================

const PARSE_PROMPT = `You are a resume parser. Extract structured information from the resume text below.

Return a JSON object with this EXACT structure:
{
  "profile": {
    "full_name": "string",
    "phone": "string or null",
    "email": "string or null",
    "city": "string or null",
    "state": "string or null",
    "zip": "string or null"
  },
  "work_history": [
    {
      "company": "string",
      "title": "string",
      "location": "string or null",
      "start_date": "YYYY-MM or null",
      "end_date": "YYYY-MM or null (use 'Present' if current)",
      "raw_dates": "string (original date text)",
      "bullets": ["array of achievement/responsibility strings"],
      "is_current": boolean
    }
  ],
  "education": [
    {
      "institution": "string",
      "credential": "string (degree/diploma/certificate)",
      "field": "string or null",
      "year": "string or null",
      "is_completed": boolean or null
    }
  ],
  "certifications_raw": ["array of certification strings"],
  "military": {
    "branch": "string or null",
    "rank": "string or null",
    "years": "string or null",
    "discharge": "string or null"
  }
}

IMPORTANT RULES:
- Extract ALL work experience, not just recent
- Preserve bullet points as written
- Use null for missing data, don't guess
- Keep dates in original format in raw_dates
- is_current = true only if explicitly stated (Present, Current, etc.)
- Parse certifications as complete strings

Resume text:`;

async function parseStep(
  ctx: StepContext,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const extractedText = input.extractedText as string;
  if (!extractedText) throw new Error('No extracted text available');

  const openai = getOpenAI();

  await emitStepEvent(ctx, 'AI_CALL_STARTED', {
    provider: 'openai',
    model: GPT_MODEL,
    purpose: 'resume_parsing',
  });

  const startTime = Date.now();

  const completion = await openai.chat.completions.create({
    model: GPT_MODEL,
    messages: [
      { role: 'system', content: 'You are a precise resume parser. Return only valid JSON, no explanations.' },
      { role: 'user', content: `${PARSE_PROMPT}\n\n${extractedText}` },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  const latencyMs = Date.now() - startTime;
  const content = completion.choices[0].message.content || '{}';
  const tokenEstimate = completion.usage?.total_tokens || Math.round(content.length / 4);

  await emitAICallEvent(ctx, 'openai', GPT_MODEL, latencyMs, tokenEstimate, true);

  const parsedProfile = extractAndParseJSON(content);

  // Validate parsed output
  const parseConfidence: Record<string, number> = {};
  parseConfidence.profile = parsedProfile.profile?.full_name ? 1.0 : 0.3;
  parseConfidence.work_history =
    Array.isArray(parsedProfile.work_history) && parsedProfile.work_history.length > 0
      ? Math.min(1.0, parsedProfile.work_history.length * 0.2)
      : 0.1;
  parseConfidence.education =
    Array.isArray(parsedProfile.education) && parsedProfile.education.length > 0 ? 1.0 : 0.5;
  parseConfidence.overall =
    Object.values(parseConfidence).reduce((a, b) => a + b, 0) / Object.keys(parseConfidence).length;

  // Store normalized JSON in R2
  const jsonBuffer = Buffer.from(JSON.stringify(parsedProfile, null, 2), 'utf-8');
  const jsonKey = `${ctx.orgId}/${ctx.projectId}/normalized_json_${ctx.runId}.json`;
  const fileObject = await uploadFile(ctx.orgId, jsonKey, jsonBuffer, 'application/json');

  await insert('document', {
    org_id: ctx.orgId,
    project_id: ctx.projectId,
    kind: 'normalized_json',
    file_object_id: fileObject.id,
    source: 'ai_generated',
  });

  await emitStepEvent(ctx, 'DOC_PARSE_COMPLETED', {
    confidence: parseConfidence,
    work_history_count: parsedProfile.work_history?.length || 0,
    has_education: (parsedProfile.education?.length || 0) > 0,
  });

  return { parsedProfile, parseConfidence };
}

// ============================================================
// STEP 3: ANALYZE — Multi-model AI analysis
// ============================================================

const COACH_VOICE = `You are a master career coach with 25+ years experience placing blue-collar workers. Your voice is:
- Direct and honest—no corporate fluff
- Respectful but not patronizing
- Experienced and practical
- Blue-collar authentic—you've worked these jobs yourself

Never be generic. Every insight should be specific to THIS person's situation.`;

async function analyzeStep(
  ctx: StepContext,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const parsedProfile = input.parsedProfile as any;
  if (!parsedProfile) throw new Error('No parsed profile available');

  const anthropic = getAnthropic();
  const openai = getOpenAI();

  // Run analysis calls in parallel
  const [narrative, skills, strategy] = await Promise.all([
    generateNarrative(ctx, anthropic, parsedProfile),
    generateSkills(ctx, openai, parsedProfile),
    generateStrategy(ctx, anthropic, parsedProfile),
  ]);

  // Store combined analysis in R2
  const analysisData = { narrative, skills, strategy };
  const analysisBuffer = Buffer.from(JSON.stringify(analysisData, null, 2), 'utf-8');
  const analysisKey = `${ctx.orgId}/${ctx.projectId}/ai_output_${ctx.runId}.json`;
  const fileObject = await uploadFile(ctx.orgId, analysisKey, analysisBuffer, 'application/json');

  await insert('document', {
    org_id: ctx.orgId,
    project_id: ctx.projectId,
    kind: 'ai_output',
    file_object_id: fileObject.id,
    source: 'ai_generated',
  });

  return { narrative, skills, strategy };
}

async function generateNarrative(
  ctx: StepContext,
  anthropic: Anthropic,
  parsedData: any
): Promise<any> {
  const prompt = `${COACH_VOICE}

You're building the career narrative for someone who needs to stand out in interviews and on paper.

THEIR DATA:
${JSON.stringify(parsedData, null, 2)}

YOUR TASK: Create a narrative that transforms their work history into a compelling story.

Generate a JSON object with these fields:

{
  "archetype": "A 2-4 word label that captures their career identity. Examples: 'The Steady Climber', 'The Comeback Story', 'The Career Pivoter'. Make it memorable and accurate.",
  "headline": "A professional headline for LinkedIn/resume. Should be specific to their experience level.",
  "summary": {
    "professional": "3-4 sentence resume summary. Lead with years of experience and strongest qualification.",
    "friendly": "Same information but conversational.",
    "direct": "2 sentences max. The absolutely essential pitch."
  },
  "elevator_pitch_30s": "The exact words to say when someone asks 'Tell me about yourself.' Must be under 30 seconds spoken.",
  "story_arc": {
    "beginning": "How they got started in this field.",
    "development": "How they grew. Key roles, skills acquired.",
    "challenge": "What obstacle or change they're facing.",
    "current": "Where they are right now.",
    "future": "Where they want to go."
  },
  "positioning_strategy": "How to frame this candidate to employers."
}

Use their ACTUAL job titles, companies, and achievements. Return ONLY valid JSON.`;

  await emitStepEvent(ctx, 'AI_CALL_STARTED', { provider: 'anthropic', model: CLAUDE_MODEL, purpose: 'narrative_analysis' });
  const startTime = Date.now();

  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const latencyMs = Date.now() - startTime;
    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const tokenEstimate = message.usage?.input_tokens + message.usage?.output_tokens || 0;
    await emitAICallEvent(ctx, 'anthropic', CLAUDE_MODEL, latencyMs, tokenEstimate, true);

    return extractAndParseJSON(text);
  } catch (err: any) {
    await emitAICallEvent(ctx, 'anthropic', CLAUDE_MODEL, Date.now() - startTime, 0, false, err.message);
    throw err;
  }
}

async function generateSkills(
  ctx: StepContext,
  openai: OpenAI,
  parsedData: any
): Promise<any> {
  const targetRole = parsedData.work_history?.[0]?.title || 'target role';
  const prompt = `You are an ATS (Applicant Tracking System) optimization expert who has reviewed thousands of blue-collar resumes.

CANDIDATE'S RESUME DATA:
${JSON.stringify(parsedData, null, 2)}

TARGET ROLE: ${targetRole}

Analyze their resume for keyword optimization. Be SPECIFIC.

Return JSON:
{
  "skills": {
    "hard": ["Array of technical/job-specific skills"],
    "soft": ["Array of interpersonal/leadership skills"],
    "transferable": ["Skills that apply across industries"]
  },
  "keywords": {
    "present": ["Keywords already in their resume"],
    "missing_critical": ["CRITICAL keywords that MUST be added"],
    "missing_recommended": ["Keywords that would strengthen"],
    "industry_buzzwords": ["Industry-specific terms"]
  },
  "skills_matrix": [
    {
      "skill": "Specific skill name",
      "level": "expert|proficient|familiar",
      "evidence": "Where in their resume this is demonstrated",
      "ats_value": "high|medium|low"
    }
  ],
  "ats_assessment": {
    "current_score_estimate": 0-100,
    "potential_score": 0-100,
    "biggest_gaps": ["The 3-5 most impactful things missing"],
    "quick_fixes": ["Specific changes to make immediately"]
  }
}`;

  await emitStepEvent(ctx, 'AI_CALL_STARTED', { provider: 'openai', model: GPT_MODEL, purpose: 'skills_analysis' });
  const startTime = Date.now();

  try {
    const completion = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        { role: 'system', content: 'You are an ATS expert. Return only valid JSON. Be specific and honest.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const latencyMs = Date.now() - startTime;
    const content = completion.choices[0].message.content || '{}';
    const tokenEstimate = completion.usage?.total_tokens || 0;
    await emitAICallEvent(ctx, 'openai', GPT_MODEL, latencyMs, tokenEstimate, true);

    return extractAndParseJSON(content);
  } catch (err: any) {
    await emitAICallEvent(ctx, 'openai', GPT_MODEL, Date.now() - startTime, 0, false, err.message);
    throw err;
  }
}

async function generateStrategy(
  ctx: StepContext,
  anthropic: Anthropic,
  parsedData: any
): Promise<any> {
  const targetRole = parsedData.work_history?.[0]?.title || 'target role';
  const location = `${parsedData.profile?.city || ''}, ${parsedData.profile?.state || ''}`.trim();

  const prompt = `${COACH_VOICE}

You're building a job search strategy for a real person. This needs to be specific enough that they can execute it tomorrow.

THEIR DATA:
${JSON.stringify(parsedData, null, 2)}

Generate a comprehensive strategy as JSON:

{
  "ideal_job_profile": "Detailed description of the perfect-fit roles for this person.",
  "target_titles": {
    "primary": ["4-6 job titles that are the BEST fit"],
    "secondary": ["4-6 alternative titles"],
    "stretch": ["3-4 reach titles"]
  },
  "target_industries": {
    "tier1_best_fit": [{"industry": "...", "why": "..."}],
    "tier2_good_alternatives": [{"industry": "...", "why": "..."}]
  },
  "salary": {
    "immediate_realistic": "Dollar range",
    "after_6_months": "Range after proving themselves",
    "negotiation_leverage": ["Specific leverage points"]
  },
  "competitive_advantages": ["5-7 specific strengths this person has over other applicants"],
  "timeline": {
    "quick_wins": ["Actions that can produce results within 1 week"],
    "first_month_goals": ["What success looks like after 30 days"]
  }
}

Make this SPECIFIC. Reference their actual job history and location (${location}). Return ONLY valid JSON.`;

  await emitStepEvent(ctx, 'AI_CALL_STARTED', { provider: 'anthropic', model: CLAUDE_MODEL, purpose: 'strategy_analysis' });
  const startTime = Date.now();

  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 5000,
      messages: [{ role: 'user', content: prompt }],
    });

    const latencyMs = Date.now() - startTime;
    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const tokenEstimate = message.usage?.input_tokens + message.usage?.output_tokens || 0;
    await emitAICallEvent(ctx, 'anthropic', CLAUDE_MODEL, latencyMs, tokenEstimate, true);

    return extractAndParseJSON(text);
  } catch (err: any) {
    await emitAICallEvent(ctx, 'anthropic', CLAUDE_MODEL, Date.now() - startTime, 0, false, err.message);
    throw err;
  }
}

// ============================================================
// STEP 4: GENERATE — Resume DOCX artifact
// ============================================================

async function generateStep(
  ctx: StepContext,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const parsedProfile = input.parsedProfile as any;
  const narrative = input.narrative as any;
  const skills = input.skills as any;
  const strategy = input.strategy as any;

  if (!parsedProfile) throw new Error('No parsed profile for generation');

  const anthropic = getAnthropic();

  // Generate enhanced resume content using Claude
  const resumeContent = await generateResumeContent(ctx, anthropic, parsedProfile, narrative, skills, strategy);

  // Build the DOCX
  const docxBuffer = await createResumeDOCX(resumeContent, parsedProfile);

  // Upload to R2
  const fileName = `${(parsedProfile.profile?.full_name || 'resume').replace(/\s+/g, '_')}_resume.docx`;
  const objectKey = `${ctx.orgId}/${ctx.projectId}/artifacts/${ctx.runId}/${fileName}`;
  const fileObject = await uploadFile(
    ctx.orgId,
    objectKey,
    docxBuffer,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );

  // Create artifact record
  const artifact = await insert<{ id: string }>('artifact', {
    org_id: ctx.orgId,
    run_id: ctx.runId,
    project_id: ctx.projectId,
    artifact_type: 'resume_docx',
    file_object_id: fileObject.id,
    version: 1,
    review_status: 'pending',
  });

  await emitStepEvent(ctx, 'ARTIFACT_GENERATED', {
    artifact_id: artifact.id,
    artifact_type: 'resume_docx',
    file_name: fileName,
    byte_size: docxBuffer.length,
  });

  return { artifactId: artifact.id, artifactType: 'resume_docx' };
}

// --- Resume Content Generation ---

async function generateResumeContent(
  ctx: StepContext,
  anthropic: Anthropic,
  parsedProfile: any,
  narrative: any,
  skills: any,
  _strategy: any
): Promise<ResumeContent> {
  const workHistory = parsedProfile.work_history || [];
  const yearsExp = calculateYearsExperience(workHistory);
  const currentRole = workHistory[0]?.title || 'Professional';
  const allBullets = workHistory.flatMap((j: any) => j.bullets || []).slice(0, 10);

  const prompt = `You are a TORI Award-winning resume writer. Generate enhanced resume content.

CANDIDATE DATA:
Name: ${parsedProfile.profile?.full_name || 'Candidate'}
Current/Most Recent Role: ${currentRole}
Years Experience: ${yearsExp}+

NARRATIVE: ${JSON.stringify(narrative?.summary || {}, null, 2)}
ARCHETYPE: ${narrative?.archetype || 'N/A'}

KEY ACHIEVEMENTS:
${allBullets.map((b: string) => '- ' + b).join('\n')}

SKILLS: ${JSON.stringify(skills?.skills || {}, null, 2)}

Generate TWO things. Return ONLY valid JSON:
{
  "brandedHeadline": "A powerful 5-10 word headline that goes under their name.",
  "summary": "A 3-4 sentence professional summary that reads like a PITCH. Lead with years of experience. FORBIDDEN PHRASES: 'results-driven', 'detail-oriented', 'team player', 'proven track record', 'seeking opportunity'."
}`;

  let brandedHeadline = `${yearsExp}+ Years Building Operations Excellence`;
  let summary = narrative?.summary?.professional || 'Experienced professional seeking new opportunities.';

  try {
    await emitStepEvent(ctx, 'AI_CALL_STARTED', { provider: 'anthropic', model: CLAUDE_MODEL, purpose: 'resume_content' });
    const startTime = Date.now();

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const latencyMs = Date.now() - startTime;
    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const tokenEstimate = message.usage?.input_tokens + message.usage?.output_tokens || 0;
    await emitAICallEvent(ctx, 'anthropic', CLAUDE_MODEL, latencyMs, tokenEstimate, true);

    const parsed = extractAndParseJSON(text);
    brandedHeadline = parsed.brandedHeadline || brandedHeadline;
    summary = parsed.summary || summary;
  } catch (err: any) {
    console.warn('Enhanced content generation failed, using fallbacks:', err.message);
  }

  // Build skill groups
  const hardSkills = skills?.skills?.hard || [];
  const softSkills = skills?.skills?.soft || [];
  const skillGroups = buildSkillGroups(hardSkills, softSkills);

  // Build experience entries
  const experience = workHistory.map((job: any) => ({
    title: job.title || '',
    company: job.company || '',
    location: job.location || null,
    dates: `${job.start_date || ''} - ${job.end_date || 'Present'}`,
    bullets: condenseBullets(job.bullets || [], 5),
  }));

  // Extract metrics
  const metricsBar = extractTopMetrics(workHistory, yearsExp, parsedProfile.certifications_raw);

  return {
    brandedHeadline,
    metricsBar,
    summary,
    skillGroups,
    experience,
    certifications: parsedProfile.certifications_raw || [],
    education: (parsedProfile.education || []).map((edu: any) => ({
      credential: edu.credential || '',
      institution: edu.institution || '',
      field: edu.field || null,
      year: edu.year || null,
    })),
  };
}

// --- Resume Content Types ---

interface ResumeContent {
  brandedHeadline: string;
  metricsBar: string[];
  summary: string;
  skillGroups: { category: string; skills: string[] }[];
  experience: {
    title: string;
    company: string;
    location: string | null;
    dates: string;
    bullets: string[];
  }[];
  certifications: string[];
  education: {
    credential: string;
    institution: string;
    field: string | null;
    year: string | null;
  }[];
}

// --- DOCX Builder (ported from smr-refinery) ---

async function createResumeDOCX(content: ResumeContent, parsedProfile: any): Promise<Buffer> {
  const GOLD = 'D4A84B';
  const DARK = '1a1a1a';
  const GRAY = '666666';
  const LIGHT_GOLD_BG = 'FDF6E3';

  const children: Paragraph[] = [];

  // Name
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: (parsedProfile.profile?.full_name || 'CANDIDATE').toUpperCase(),
          bold: true,
          size: 44,
          font: 'Calibri',
          color: DARK,
        }),
      ],
    })
  );

  // Branded Headline
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 140 },
      children: [
        new TextRun({
          text: content.brandedHeadline,
          bold: true,
          size: 26,
          font: 'Calibri',
          color: GOLD,
          italics: true,
        }),
      ],
    })
  );

  // Metrics Bar
  if (content.metricsBar.length > 0) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 140 },
        shading: { fill: LIGHT_GOLD_BG },
        border: {
          top: { color: GOLD, size: 8, style: BorderStyle.SINGLE, space: 1 },
          bottom: { color: GOLD, size: 8, style: BorderStyle.SINGLE, space: 1 },
        },
        children: [
          new TextRun({
            text: '  ' + content.metricsBar.join('   |   ') + '  ',
            bold: true,
            size: 22,
            font: 'Calibri',
            color: DARK,
          }),
        ],
      })
    );
  }

  // Contact Info
  const contactParts = [
    parsedProfile.profile?.phone,
    parsedProfile.profile?.email,
    [parsedProfile.profile?.city, parsedProfile.profile?.state].filter(Boolean).join(', '),
  ].filter(Boolean);

  if (contactParts.length > 0) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
        children: [
          new TextRun({
            text: contactParts.join('  |  '),
            size: 20,
            font: 'Calibri',
            color: GRAY,
          }),
        ],
      })
    );
  }

  // Professional Summary
  children.push(createSectionHeader('PROFESSIONAL SUMMARY', GOLD));
  children.push(
    new Paragraph({
      spacing: { after: 280 },
      children: [
        new TextRun({ text: content.summary, size: 22, font: 'Calibri' }),
      ],
    })
  );

  // Core Competencies
  if (content.skillGroups.length > 0) {
    children.push(createSectionHeader('CORE COMPETENCIES', GOLD));
    content.skillGroups.forEach((group) => {
      children.push(
        new Paragraph({
          spacing: { after: 100 },
          children: [
            new TextRun({
              text: `${group.category}: `,
              bold: true,
              size: 21,
              font: 'Calibri',
              color: DARK,
            }),
            new TextRun({
              text: group.skills.join('  |  '),
              size: 21,
              font: 'Calibri',
            }),
          ],
        })
      );
    });
    children.push(new Paragraph({ spacing: { after: 120 } }));
  }

  // Professional Experience
  children.push(createSectionHeader('PROFESSIONAL EXPERIENCE', GOLD));
  content.experience.forEach((job, index) => {
    children.push(
      new Paragraph({
        spacing: { before: index > 0 ? 280 : 140, after: 60 },
        children: [
          new TextRun({
            text: job.title.toUpperCase(),
            bold: true,
            size: 24,
            font: 'Calibri',
            color: DARK,
          }),
        ],
      })
    );

    const companyLine = [job.company, job.location, job.dates].filter(Boolean).join('  |  ');
    children.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({
            text: companyLine,
            size: 21,
            font: 'Calibri',
            italics: true,
            color: GRAY,
          }),
        ],
      })
    );

    job.bullets.forEach((bullet) => {
      children.push(createBulletParagraph(bullet));
    });
  });

  // Certifications
  if (content.certifications.length > 0) {
    children.push(createSectionHeader('CERTIFICATIONS & CREDENTIALS', GOLD));
    children.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: content.certifications.join('  |  '),
            size: 21,
            font: 'Calibri',
          }),
        ],
      })
    );
  }

  // Education
  if (content.education.length > 0) {
    children.push(createSectionHeader('EDUCATION', GOLD));
    content.education.forEach((edu) => {
      const eduLine = [
        edu.credential + (edu.field ? `, ${edu.field}` : ''),
        edu.institution,
        edu.year,
      ].filter(Boolean).join('  |  ');
      children.push(
        new Paragraph({
          spacing: { after: 100 },
          children: [
            new TextRun({ text: eduLine, size: 21, font: 'Calibri' }),
          ],
        })
      );
    });
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 576, right: 720, bottom: 576, left: 720 },
          },
        },
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

function createSectionHeader(text: string, accentColor: string): Paragraph {
  return new Paragraph({
    spacing: { before: 300, after: 140 },
    border: {
      bottom: { color: accentColor, size: 12, style: BorderStyle.SINGLE, space: 2 },
    },
    children: [
      new TextRun({
        text,
        bold: true,
        size: 26,
        font: 'Calibri',
        color: accentColor,
      }),
    ],
  });
}

function createBulletParagraph(text: string): Paragraph {
  const parts = text.split(/(\d+[%$,.\d]*[KMB]?|\$[\d,.]+ ?[KMB]?)/gi);
  const textRuns: TextRun[] = [
    new TextRun({ text: '• ', size: 21, font: 'Calibri' }),
  ];

  parts.forEach((part) => {
    if (part && /\d/.test(part)) {
      textRuns.push(new TextRun({ text: part, bold: true, size: 21, font: 'Calibri' }));
    } else if (part) {
      textRuns.push(new TextRun({ text: part, size: 21, font: 'Calibri' }));
    }
  });

  return new Paragraph({
    spacing: { after: 80 },
    indent: { left: 360 },
    children: textRuns,
  });
}

// --- Data Helpers ---

function calculateYearsExperience(workHistory: any[]): number {
  if (!workHistory || workHistory.length === 0) return 0;
  const earliest = workHistory[workHistory.length - 1];
  const startYear = parseInt(earliest?.start_date?.match(/\d{4}/)?.[0] || '0');
  const currentYear = new Date().getFullYear();
  return Math.max(0, currentYear - startYear);
}

function extractTopMetrics(
  workHistory: any[],
  yearsExp: number,
  certifications?: string[]
): string[] {
  const metrics: string[] = [];
  const allBullets = workHistory.flatMap((job: any) => job.bullets || []);
  const bulletText = allBullets.join(' ');

  const percentMatch = bulletText.match(/(\d+)%\s*(?:reduction|increase|improvement|growth|accuracy|on-time|efficiency|decrease)/i);
  if (percentMatch) {
    metrics.push(`${percentMatch[1]}% ${percentMatch[0].split('%')[1].trim()}`);
  }

  const dollarMatch = bulletText.match(/\$[\d,.]+[KMB]?/i);
  if (dollarMatch) {
    metrics.push(`${dollarMatch[0]} Accountability`);
  }

  const teamMatch = bulletText.match(/(\d+)[\s-]*(?:person|member|employee|staff|direct report|team)/i);
  if (teamMatch) {
    metrics.push(`${teamMatch[1]}-Person Team`);
  }

  if (yearsExp > 0 && metrics.length < 4) {
    metrics.push(`${yearsExp}+ Years Experience`);
  }

  if (certifications?.length && metrics.length < 4) {
    metrics.push(`${certifications.length} Certification${certifications.length > 1 ? 's' : ''}`);
  }

  return metrics.slice(0, 4);
}

function condenseBullets(bullets: string[], maxCount: number): string[] {
  if (bullets.length <= maxCount) return bullets;

  // Score and take top N
  const scored = bullets.map((bullet) => {
    let score = 0;
    if (/\d+%|\$[\d,]+|\d+\+/i.test(bullet)) score += 3; // Metrics
    if (/advanced|promoted|earned|selected|chosen/i.test(bullet)) score += 3; // Advancement
    if (/led|managed|supervised|trained|coordinated/i.test(bullet)) score += 2; // Leadership
    if (/^(assist|help|support)\s/i.test(bullet) && bullet.length < 50) score -= 2; // Generic
    return { bullet, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxCount).map((s) => s.bullet);
}

function buildSkillGroups(
  hardSkills: string[],
  softSkills: string[]
): { category: string; skills: string[] }[] {
  const categories: Record<string, string[]> = {
    'Leadership & Management': [],
    'Operations & Technical': [],
    'Safety & Compliance': [],
    'Tools & Systems': [],
  };

  const leadershipKW = ['team', 'lead', 'manage', 'train', 'supervis', 'mentor', 'coordinat'];
  const safetyKW = ['osha', 'safety', 'compliance', 'regulat', 'hazard'];
  const toolsKW = ['software', 'system', 'wms', 'erp', 'excel', 'computer', 'sap'];

  [...hardSkills, ...softSkills].forEach((skill) => {
    const lower = skill.toLowerCase();
    if (leadershipKW.some((k) => lower.includes(k))) {
      categories['Leadership & Management'].push(skill);
    } else if (safetyKW.some((k) => lower.includes(k))) {
      categories['Safety & Compliance'].push(skill);
    } else if (toolsKW.some((k) => lower.includes(k))) {
      categories['Tools & Systems'].push(skill);
    } else {
      categories['Operations & Technical'].push(skill);
    }
  });

  return Object.entries(categories)
    .filter(([_, skills]) => skills.length > 0)
    .map(([category, skills]) => ({ category, skills: skills.slice(0, 6) }));
}
