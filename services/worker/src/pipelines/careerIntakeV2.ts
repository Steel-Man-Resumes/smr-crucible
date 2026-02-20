/**
 * career_intake_v2 — Phase 3 Stage A pipeline
 *
 * 10 sequential steps producing frozen data products in run_data.
 * Steps 1-2 are refactored from v1 to write to run_data.
 * Steps 3-10 are new.
 */
import type { PipelineDef, StepHandler, StepContext } from '@crucible/core';
import {
  query, getOne, insert,
  uploadFile, getSignedUrl,
  emitStepEvent, emitAICallEvent,
  extractAndParseJSON,
  putRunData, getRunData, hasRunData,
  enrich,
} from '@crucible/core';
import type { ProfileV1Type, SignalsV1Type, JobsV1Type, EmployersV1Type, MarketV1Type } from '@crucible/core';
import { DEFAULT_PORTFOLIO_PREFS } from '@crucible/core';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { Queue } from 'bullmq';

// --- Pipeline Definition ---

export const careerIntakeV2: PipelineDef = {
  key: 'career_intake_v2',
  version: '2.0',
  steps: [
    { key: 'extract_resume_text',  critical: true,  maxRetries: 2, timeoutMs: 60_000 },
    { key: 'parse_profile',        critical: true,  maxRetries: 2, timeoutMs: 120_000 },
    { key: 'compute_signals',      critical: true,  maxRetries: 1, timeoutMs: 60_000 },
    { key: 'research_jobs',        critical: true,  maxRetries: 2, timeoutMs: 90_000 },
    { key: 'build_employer_tiers', critical: true,  maxRetries: 1, timeoutMs: 120_000 },
    { key: 'enrich_contacts',      critical: false, maxRetries: 1, timeoutMs: 120_000 },
    { key: 'market_salary',        critical: false, maxRetries: 1, timeoutMs: 60_000 },
    { key: 'local_resources',      critical: false, maxRetries: 1, timeoutMs: 60_000 },
    { key: 'plan_package',         critical: true,  maxRetries: 1, timeoutMs: 30_000 },
    { key: 'init_bundle',          critical: true,  maxRetries: 1, timeoutMs: 30_000 },
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

// --- Enrichment context helper ---

function enrichCtx(ctx: StepContext) {
  return {
    runId: ctx.runId,
    orgId: ctx.orgId,
    projectId: ctx.projectId,
    correlationId: ctx.correlationId,
  };
}

// --- Step Handlers ---

export const careerIntakeV2Handlers: Record<string, StepHandler> = {
  extract_resume_text: extractResumeTextStep,
  parse_profile:       parseProfileStep,
  compute_signals:     computeSignalsStep,
  research_jobs:       researchJobsStep,
  build_employer_tiers: buildEmployerTiersStep,
  enrich_contacts:     enrichContactsStep,
  market_salary:       marketSalaryStep,
  local_resources:     localResourcesStep,
  plan_package:        planPackageStep,
  init_bundle:         initBundleStep,
};

// ============================================================
// STEP 1: EXTRACT RESUME TEXT
// ============================================================

interface DocumentRow {
  id: string;
  kind: string;
  object_key: string;
  mime_type: string;
  byte_size: number;
}

async function extractResumeTextStep(
  ctx: StepContext,
  _input: Record<string, unknown>
): Promise<Record<string, unknown>> {
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

    if (doc.mime_type === 'application/pdf' || doc.kind === 'upload_pdf') {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      text = result.text || '';
      if (!text.trim()) throw new Error('PDF contains no extractable text');
    } else if (
      doc.mime_type?.includes('wordprocessingml') ||
      doc.mime_type?.includes('msword') ||
      doc.kind === 'upload_docx'
    ) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || '';
      if (!text.trim()) throw new Error('Word document contains no extractable text');
    } else if (doc.mime_type?.startsWith('text/') || doc.kind === 'upload_txt') {
      text = buffer.toString('utf-8');
    } else if (doc.mime_type?.startsWith('image/') || doc.kind === 'upload_image') {
      try {
        const Tesseract = await import('tesseract.js');
        const { data } = await Tesseract.recognize(buffer, 'eng');
        text = data.text || '';
        if (text.length < 100) confidence = 0.3;
      } catch {
        confidence = 0.1;
        text = '';
      }
    } else {
      text = buffer.toString('utf-8');
    }

    if (text.trim().length > 0) allTexts.push(text);
    overallConfidence = Math.min(overallConfidence, confidence);
  }

  const extractedText = cleanText(allTexts.join('\n\n'));

  if (extractedText.trim().length < 50) {
    throw new Error('Extracted text too short (< 50 chars). Upload may be unreadable.');
  }

  // Store in R2
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

  // Write to run_data
  await putRunData(ctx.runId, 'doc_text.v1', { text: extractedText, confidence: overallConfidence }, {
    classification: 'pii',
    producerStepKey: 'extract_resume_text',
    rawRef: fileObject.id,
  });

  await emitStepEvent(ctx, 'DOC_TEXT_EXTRACTED', {
    char_count: extractedText.length,
    confidence: overallConfidence,
    doc_count: documents.length,
  });

  return {};
}

// ============================================================
// STEP 2: PARSE PROFILE
// ============================================================

const PARSE_PROMPT = `You are a resume parser. Extract structured information from the resume text below.

Return a JSON object with this EXACT structure:
{
  "full_name": "string",
  "phone": "string or null",
  "email": "string or null",
  "city": "string or null",
  "state": "string or null",
  "zip": "string or null",
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
  "certifications": ["array of certification strings"],
  "military": {
    "branch": "string or null",
    "rank": "string or null",
    "years": "string or null",
    "discharge": "string or null",
    "mos": "string or null"
  }
}

IMPORTANT RULES:
- Extract ALL work experience, not just recent
- Preserve bullet points as written
- Use null for missing data, don't guess
- Keep dates in original format in raw_dates
- is_current = true only if explicitly stated (Present, Current, etc.)
- Parse certifications as complete strings
- If military section not present, return null for military

Resume text:`;

async function parseProfileStep(
  ctx: StepContext,
  _input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const docText = await getRunData<{ text: string }>(ctx.runId, 'doc_text.v1');
  const extractedText = docText.text;

  const openai = getOpenAI();

  await emitStepEvent(ctx, 'AI_CALL_STARTED', {
    provider: 'openai', model: GPT_MODEL, purpose: 'resume_parsing',
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

  const parsed = extractAndParseJSON(content);

  // Normalize into profile.v1 shape
  const profile: ProfileV1Type = {
    full_name: parsed.full_name || parsed.profile?.full_name || '',
    email: parsed.email || parsed.profile?.email || null,
    phone: parsed.phone || parsed.profile?.phone || null,
    city: parsed.city || parsed.profile?.city || null,
    state: parsed.state || parsed.profile?.state || null,
    zip: parsed.zip || parsed.profile?.zip || null,
    work_history: (parsed.work_history || []).map((w: any) => ({
      company: w.company || '',
      title: w.title || '',
      location: w.location || null,
      start_date: w.start_date || null,
      end_date: w.end_date || null,
      raw_dates: w.raw_dates || '',
      bullets: Array.isArray(w.bullets) ? w.bullets : [],
      is_current: w.is_current || false,
    })),
    education: (parsed.education || []).map((e: any) => ({
      institution: e.institution || '',
      credential: e.credential || '',
      field: e.field || null,
      year: e.year || null,
      is_completed: e.is_completed ?? null,
    })),
    certifications: Array.isArray(parsed.certifications)
      ? parsed.certifications
      : (Array.isArray(parsed.certifications_raw) ? parsed.certifications_raw : []),
    military: parsed.military || null,
    raw_text: extractedText,
  };

  await putRunData(ctx.runId, 'profile.v1', profile, {
    classification: 'pii',
    producerStepKey: 'parse_profile',
  });

  await emitStepEvent(ctx, 'DOC_PARSE_COMPLETED', {
    work_history_count: profile.work_history.length,
    has_education: profile.education.length > 0,
  });

  return {};
}

// ============================================================
// STEP 3: COMPUTE SIGNALS
// ============================================================

async function computeSignalsStep(
  ctx: StepContext,
  _input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const profile = await getRunData<ProfileV1Type>(ctx.runId, 'profile.v1');
  const openai = getOpenAI();

  // Calculate years of experience from work history
  const yearsExp = calculateYearsExperience(profile.work_history);

  // Determine seniority
  let seniority: 'entry' | 'mid' | 'senior' | 'lead' = 'entry';
  if (yearsExp >= 10) seniority = 'lead';
  else if (yearsExp >= 5) seniority = 'senior';
  else if (yearsExp >= 2) seniority = 'mid';

  // Use GPT to analyze signals: barriers, industry, ATS score, target roles
  await emitStepEvent(ctx, 'AI_CALL_STARTED', {
    provider: 'openai', model: GPT_MODEL, purpose: 'compute_signals',
  });

  const startTime = Date.now();
  const completion = await openai.chat.completions.create({
    model: GPT_MODEL,
    messages: [
      { role: 'system', content: 'You are a career analyst. Return only valid JSON.' },
      { role: 'user', content: `Analyze this candidate profile and return JSON:

PROFILE:
Name: ${profile.full_name}
Work history: ${profile.work_history.map(w => `${w.title} at ${w.company}`).join('; ')}
Education: ${profile.education.map(e => `${e.credential} from ${e.institution}`).join('; ')}
Certifications: ${profile.certifications.join(', ')}
Location: ${profile.city || ''}, ${profile.state || ''}

Return:
{
  "industry_primary": "most likely target industry",
  "industry_secondary": "secondary industry or null",
  "barriers": {
    "criminal_record": false,
    "employment_gap": true/false (gap > 6 months in work history),
    "addiction_recovery": false,
    "housing": false,
    "transportation": false,
    "childcare": false,
    "other": false
  },
  "ats_score": 0-100 (how ATS-optimized is this resume),
  "skills_technical": ["extracted technical skills"],
  "skills_soft": ["extracted soft skills"],
  "target_roles": ["4-6 best-fit job titles"],
  "target_salary_range": { "low": number, "high": number, "hourly": true/false },
  "risk_notes": ["things that need strategic framing in the resume"]
}

Be honest about gaps and barriers visible in the work history. Return ONLY valid JSON.` },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  });

  const latencyMs = Date.now() - startTime;
  const content = completion.choices[0].message.content || '{}';
  const tokenEstimate = completion.usage?.total_tokens || 0;
  await emitAICallEvent(ctx, 'openai', GPT_MODEL, latencyMs, tokenEstimate, true);

  const aiSignals = extractAndParseJSON(content);

  // Detect employment gaps from work history
  const hasGap = detectEmploymentGap(profile.work_history);

  const barriers = {
    criminal_record: aiSignals.barriers?.criminal_record || false,
    employment_gap: hasGap || aiSignals.barriers?.employment_gap || false,
    addiction_recovery: aiSignals.barriers?.addiction_recovery || false,
    housing: aiSignals.barriers?.housing || false,
    transportation: aiSignals.barriers?.transportation || false,
    childcare: aiSignals.barriers?.childcare || false,
    other: aiSignals.barriers?.other || false,
  };

  const signals: SignalsV1Type = {
    industry_primary: aiSignals.industry_primary || 'general',
    industry_secondary: aiSignals.industry_secondary || null,
    seniority_level: seniority,
    years_experience: yearsExp,
    barriers,
    barriers_any: Object.values(barriers).some(Boolean),
    ats_score: Math.min(100, Math.max(0, aiSignals.ats_score || 50)),
    skills_technical: Array.isArray(aiSignals.skills_technical) ? aiSignals.skills_technical : [],
    skills_soft: Array.isArray(aiSignals.skills_soft) ? aiSignals.skills_soft : [],
    target_roles: Array.isArray(aiSignals.target_roles) ? aiSignals.target_roles : [],
    target_salary_range: aiSignals.target_salary_range || { low: 30000, high: 50000, hourly: false },
    risk_notes: Array.isArray(aiSignals.risk_notes) ? aiSignals.risk_notes : [],
  };

  await putRunData(ctx.runId, 'signals.v1', signals, {
    classification: 'internal',
    producerStepKey: 'compute_signals',
  });

  return {};
}

// ============================================================
// STEP 4: RESEARCH JOBS
// ============================================================

async function researchJobsStep(
  ctx: StepContext,
  _input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const profile = await getRunData<ProfileV1Type>(ctx.runId, 'profile.v1');
  const signals = await getRunData<SignalsV1Type>(ctx.runId, 'signals.v1');

  const location = [profile.city, profile.state].filter(Boolean).join(', ') || 'United States';
  const query_used = signals.target_roles[0] || signals.industry_primary;

  const result = await enrich(
    { type: 'discover_jobs', params: { query: query_used, location, pages: 3 } },
    enrichCtx(ctx)
  );

  const raw = result.data as any;

  // Score relevance based on title match
  const jobs = (raw.jobs || []).map((job: any) => ({
    ...job,
    relevance_score: scoreJobRelevance(job, signals),
  }));

  // Sort by relevance
  jobs.sort((a: any, b: any) => b.relevance_score - a.relevance_score);

  const jobsData: JobsV1Type = {
    jobs: jobs.slice(0, 100), // cap at 100
    query_used,
    pages_fetched: 3,
    total_found: raw.total_found || jobs.length,
    fetched_at: new Date().toISOString(),
  };

  await putRunData(ctx.runId, 'jobs.v1', jobsData, {
    classification: 'internal',
    producerStepKey: 'research_jobs',
  });

  await emitStepEvent(ctx, 'STEP_COMPLETED', {
    step_key: 'research_jobs',
    jobs_found: jobsData.jobs.length,
    provider: result.provider,
  });

  return {};
}

// ============================================================
// STEP 5: BUILD EMPLOYER TIERS
// ============================================================

async function buildEmployerTiersStep(
  ctx: StepContext,
  _input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const jobs = await getRunData<JobsV1Type>(ctx.runId, 'jobs.v1');
  const signals = await getRunData<SignalsV1Type>(ctx.runId, 'signals.v1');
  const profile = await getRunData<ProfileV1Type>(ctx.runId, 'profile.v1');

  const location = [profile.city, profile.state].filter(Boolean).join(', ');
  const anthropic = getAnthropic();

  // Extract unique employers from jobs
  const employerMap = new Map<string, { name: string; location: string; job_count: number; jobs: any[] }>();
  for (const job of jobs.jobs) {
    const name = job.company;
    if (!name) continue;
    const existing = employerMap.get(name);
    if (existing) {
      existing.job_count++;
      existing.jobs.push(job);
    } else {
      employerMap.set(name, { name, location: job.location, job_count: 1, jobs: [job] });
    }
  }

  // If we don't have enough employers from jobs, supplement with enrichment
  let allEmployers = Array.from(employerMap.values());
  if (allEmployers.length < 50) {
    try {
      const supplemental = await enrich(
        { type: 'discover_employers', params: { industry: signals.industry_primary, location, second_chance: signals.barriers_any } },
        enrichCtx(ctx)
      );
      const extra = (supplemental.data as any).employers || [];
      for (const emp of extra) {
        if (!employerMap.has(emp.name)) {
          allEmployers.push({ name: emp.name, location: emp.location || location, job_count: 0, jobs: [] });
        }
      }
    } catch (err: any) {
      console.warn('Supplemental employer discovery failed:', err.message);
    }
  }

  // Use Claude to rank and tier employers
  await emitStepEvent(ctx, 'AI_CALL_STARTED', {
    provider: 'anthropic', model: CLAUDE_MODEL, purpose: 'employer_tiering',
  });

  const startTime = Date.now();
  const tierPrompt = `You are a career strategist ranking employers for a job seeker.

CANDIDATE:
- Industry: ${signals.industry_primary}
- Seniority: ${signals.seniority_level}
- Target roles: ${signals.target_roles.join(', ')}
- Location: ${location}
- Has barriers: ${signals.barriers_any ? 'Yes' : 'No'}
- Skills: ${signals.skills_technical.slice(0, 10).join(', ')}

EMPLOYERS FOUND (${allEmployers.length}):
${allEmployers.slice(0, 60).map((e, i) => `${i + 1}. ${e.name} — ${e.location} — ${e.job_count} active jobs`).join('\n')}

TASK: Select and rank exactly 50 employers (or all if fewer than 50) into 3 tiers:
- Tier 1 (top 10): Best fit — active hiring, industry match, likely to interview this candidate
- Tier 2 (next 20): Strong alternatives — decent fit, worth applying
- Tier 3 (remaining 20): Additional options — backup targets

For each employer return:
{
  "name": "company name",
  "industry": "actual industry (NOT 'Employer')",
  "location": "city, state",
  "tier": 1 or 2 or 3,
  "score": 0-100,
  "job_count": number,
  "second_chance_friendly": true/false/null,
  "why_good_fit": "specific 1-sentence reason this employer fits THIS candidate"
}

For Tier 1 ALSO include:
  "approach_strategy": "How to approach this employer (walk-in, online, staffing agency, etc.)",
  "talking_points": ["3 specific things to mention in an interview"],
  "application_channel": "best way to apply",
  "company_intel": "1-2 sentences of useful info about this company",
  "contact_name": null

For Tier 2 ALSO include:
  "website": null,
  "application_channel": "how to apply"

Return JSON: { "tier1": [...], "tier2": [...], "tier3": [...] }
Return ONLY valid JSON.`;

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    messages: [{ role: 'user', content: tierPrompt }],
  });

  const latencyMs = Date.now() - startTime;
  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const tokenEstimate = (message.usage?.input_tokens || 0) + (message.usage?.output_tokens || 0);
  await emitAICallEvent(ctx, 'anthropic', CLAUDE_MODEL, latencyMs, tokenEstimate, true);

  const tiered = extractAndParseJSON(text);

  const tier1 = (tiered.tier1 || []).map((e: any) => ({
    name: e.name || '', industry: e.industry || signals.industry_primary,
    location: e.location || location, tier: 1 as const, score: e.score || 0,
    job_count: e.job_count || 0, second_chance_friendly: e.second_chance_friendly ?? null,
    why_good_fit: e.why_good_fit || '',
    address: e.address || null, phone: e.phone || null, website: e.website || null,
    approach_strategy: e.approach_strategy || 'Apply online',
    talking_points: Array.isArray(e.talking_points) ? e.talking_points : [],
    application_channel: e.application_channel || 'Company website',
    company_intel: e.company_intel || '', contact_name: e.contact_name || null,
  }));

  const tier2 = (tiered.tier2 || []).map((e: any) => ({
    name: e.name || '', industry: e.industry || signals.industry_primary,
    location: e.location || location, tier: 2 as const, score: e.score || 0,
    job_count: e.job_count || 0, second_chance_friendly: e.second_chance_friendly ?? null,
    why_good_fit: e.why_good_fit || '',
    website: e.website || null, application_channel: e.application_channel || 'Company website',
  }));

  const tier3 = (tiered.tier3 || []).map((e: any) => ({
    name: e.name || '', industry: e.industry || signals.industry_primary,
    location: e.location || location, tier: 3 as const, score: e.score || 0,
    job_count: e.job_count || 0, second_chance_friendly: e.second_chance_friendly ?? null,
    why_good_fit: e.why_good_fit || '',
  }));

  const employers: EmployersV1Type = {
    tier1, tier2, tier3,
    total_count: tier1.length + tier2.length + tier3.length,
    tier_counts: { tier1: tier1.length, tier2: tier2.length, tier3: tier3.length },
  };

  await putRunData(ctx.runId, 'employers.v1', employers, {
    classification: 'internal',
    producerStepKey: 'build_employer_tiers',
  });

  return {};
}

// ============================================================
// STEP 6: ENRICH CONTACTS (Tier 1 only, via Perplexity)
// ============================================================

async function enrichContactsStep(
  ctx: StepContext,
  _input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const employers = await getRunData<EmployersV1Type>(ctx.runId, 'employers.v1');

  if (employers.tier1.length === 0) {
    // Nothing to enrich — write same data as enriched
    await putRunData(ctx.runId, 'employers_enriched.v1', employers, {
      classification: 'internal',
      producerStepKey: 'enrich_contacts',
    });
    return {};
  }

  const result = await enrich(
    {
      type: 'enrich_employer_contacts',
      params: {
        employers: employers.tier1.map(e => ({ name: e.name, location: e.location })),
      },
    },
    enrichCtx(ctx)
  );

  const enrichedData = (result.data as any).enriched_employers || [];

  // Merge enrichment into tier1
  const enrichedTier1 = employers.tier1.map((emp, i) => {
    const enriched = enrichedData[i] || {};
    return {
      ...emp,
      address: enriched.address || emp.address,
      phone: enriched.phone || emp.phone,
      website: enriched.website || emp.website,
      contact_name: enriched.contact_name || emp.contact_name,
      company_intel: enriched.company_intel || emp.company_intel,
      second_chance_friendly: enriched.second_chance_friendly ?? emp.second_chance_friendly,
      approach_strategy: enriched.approach_strategy || emp.approach_strategy,
    };
  });

  const enrichedEmployers: EmployersV1Type = {
    ...employers,
    tier1: enrichedTier1,
  };

  await putRunData(ctx.runId, 'employers_enriched.v1', enrichedEmployers, {
    classification: 'internal',
    producerStepKey: 'enrich_contacts',
  });

  return {};
}

// ============================================================
// STEP 7: MARKET SALARY
// ============================================================

async function marketSalaryStep(
  ctx: StepContext,
  _input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const signals = await getRunData<SignalsV1Type>(ctx.runId, 'signals.v1');
  const profile = await getRunData<ProfileV1Type>(ctx.runId, 'profile.v1');

  const role = signals.target_roles[0] || 'general laborer';
  const location = [profile.city, profile.state].filter(Boolean).join(', ') || 'United States';

  // Try JSearch first for salary data
  let jsearchData: any = null;
  try {
    const jsResult = await enrich(
      { type: 'market_salary', params: { role, location } },
      enrichCtx(ctx)
    );
    jsearchData = jsResult.data;
  } catch {
    console.warn('JSearch salary lookup failed, falling back to Perplexity only');
  }

  // Supplement with Perplexity
  let pplxData: any = null;
  try {
    const pplxResult = await enrich(
      { type: 'market_salary', params: { role, location } },
      { ...enrichCtx(ctx), correlationId: ctx.correlationId + '-pplx' } // force perplexity via separate call
    );
    pplxData = pplxResult.data;
  } catch {
    console.warn('Perplexity salary lookup failed');
  }

  // Merge: prefer JSearch numbers, Perplexity for narrative
  const salaryLow = jsearchData?.min_salary || pplxData?.salary_low || signals.target_salary_range.low;
  const salaryHigh = jsearchData?.max_salary || pplxData?.salary_high || signals.target_salary_range.high;
  const salaryMid = jsearchData?.median_salary || pplxData?.salary_mid || Math.round((salaryLow + salaryHigh) / 2);

  const isHourly = signals.target_salary_range.hourly;
  const hourlyDivisor = isHourly ? 1 : 2080;

  const market: MarketV1Type = {
    target_role: role,
    target_location: location,
    salary_low: salaryLow,
    salary_mid: salaryMid,
    salary_high: salaryHigh,
    hourly_equivalent: {
      low: Math.round((salaryLow / hourlyDivisor) * 100) / 100,
      mid: Math.round((salaryMid / hourlyDivisor) * 100) / 100,
      high: Math.round((salaryHigh / hourlyDivisor) * 100) / 100,
    },
    sources: [
      jsearchData ? 'JSearch/RapidAPI' : null,
      pplxData ? 'Perplexity' : null,
    ].filter(Boolean) as string[],
    confidence: jsearchData && pplxData ? 'high' : (jsearchData || pplxData ? 'medium' : 'low'),
    negotiation_leverage_points: pplxData?.negotiation_leverage_points || [],
  };

  await putRunData(ctx.runId, 'market.v1', market, {
    classification: 'internal',
    producerStepKey: 'market_salary',
  });

  return {};
}

// ============================================================
// STEP 8: LOCAL RESOURCES (conditional on barriers)
// ============================================================

async function localResourcesStep(
  ctx: StepContext,
  _input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const signals = await getRunData<SignalsV1Type>(ctx.runId, 'signals.v1');

  if (!signals.barriers_any) {
    // No barriers — skip resource lookup
    return {};
  }

  const profile = await getRunData<ProfileV1Type>(ctx.runId, 'profile.v1');
  const location = [profile.city, profile.state].filter(Boolean).join(', ') || 'United States';

  const barrierTypes = Object.entries(signals.barriers)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, ' '));

  const result = await enrich(
    { type: 'local_resources', params: { location, barrier_types: barrierTypes } },
    enrichCtx(ctx)
  );

  const raw = result.data as any;

  await putRunData(ctx.runId, 'resources.v1', {
    resources: raw.resources || [],
    grouped_by_barrier_type: raw.grouped_by_barrier_type || {},
    location_searched: location,
  }, {
    classification: 'sensitive',
    producerStepKey: 'local_resources',
  });

  return {};
}

// ============================================================
// STEP 9: PLAN PACKAGE
// ============================================================

async function planPackageStep(
  ctx: StepContext,
  _input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const signals = await getRunData<SignalsV1Type>(ctx.runId, 'signals.v1');
  const hasResources = await hasRunData(ctx.runId, 'resources.v1');
  const hasEnrichedEmployers = await hasRunData(ctx.runId, 'employers_enriched.v1');
  const market = await getRunData<MarketV1Type>(ctx.runId, 'market.v1').catch(() => null);

  // If enrich_contacts was skipped, fall back to base employers
  if (!hasEnrichedEmployers) {
    const baseEmployers = await getRunData<EmployersV1Type>(ctx.runId, 'employers.v1');
    await putRunData(ctx.runId, 'employers_enriched.v1', baseEmployers, {
      classification: 'internal',
      producerStepKey: 'plan_package',
    });
  }

  // Default portfolio prefs if not set by user during research
  const hasPrefs = await hasRunData(ctx.runId, 'portfolio_prefs.v1');
  if (!hasPrefs) {
    await putRunData(ctx.runId, 'portfolio_prefs.v1', DEFAULT_PORTFOLIO_PREFS, {
      classification: 'internal',
      producerStepKey: 'plan_package',
    });
  }

  const tasks: any[] = [];
  const exclusions: any[] = [];

  // Always-generated artifacts
  tasks.push(
    { artifact_key: 'resume_docx', job_key: 'gen_resume', consumes: ['profile.v1', 'signals.v1', 'employers_enriched.v1'], review_required: true },
    { artifact_key: 'employers_battleplan', job_key: 'gen_employers', consumes: ['employers_enriched.v1', 'signals.v1'], review_required: true },
    { artifact_key: 'action_plan_30day', job_key: 'gen_actionplan', consumes: ['employers_enriched.v1', 'jobs.v1', 'market.v1'], review_required: false },
    { artifact_key: 'interview_prep', job_key: 'gen_interview', consumes: ['signals.v1', 'employers_enriched.v1', 'market.v1'], review_required: false },
    { artifact_key: 'portfolio_html', job_key: 'gen_portfolio', consumes: ['profile.v1', 'signals.v1', 'portfolio_prefs.v1'], review_required: false },
    { artifact_key: 'tracker_xlsx', job_key: 'gen_tracker', consumes: ['employers_enriched.v1'], review_required: false },
    { artifact_key: 'quickstart_guide', job_key: 'gen_quickstart', consumes: ['artifact_manifest.v1'], review_required: false },
    { artifact_key: 'readme_toc', job_key: 'gen_readme', consumes: ['artifact_manifest.v1'], review_required: false },
  );

  // Cover letters — target top 3 Tier 1 employers
  const employers = await getRunData<EmployersV1Type>(ctx.runId, 'employers_enriched.v1');
  const topEmployers = employers.tier1.slice(0, 3);
  if (topEmployers.length >= 1) {
    tasks.push({ artifact_key: 'coverletter_bold', job_key: 'gen_coverletter', consumes: ['profile.v1', 'employers_enriched.v1'], params: { tone: 'bold', target_employer_index: 0 }, review_required: true });
  }
  if (topEmployers.length >= 2) {
    tasks.push({ artifact_key: 'coverletter_friendly', job_key: 'gen_coverletter', consumes: ['profile.v1', 'employers_enriched.v1'], params: { tone: 'friendly', target_employer_index: 1 }, review_required: true });
  }
  if (topEmployers.length >= 3) {
    tasks.push({ artifact_key: 'coverletter_professional', job_key: 'gen_coverletter', consumes: ['profile.v1', 'employers_enriched.v1'], params: { tone: 'professional', target_employer_index: 2 }, review_required: true });
  }
  if (topEmployers.length < 3) {
    exclusions.push({ artifact_key: 'coverletter_missing', reason: `Only ${topEmployers.length} Tier 1 employers — fewer cover letters generated` });
  }

  // Salary negotiation — conditional on market confidence
  if (market && market.confidence !== 'low') {
    tasks.push({ artifact_key: 'salary_negotiation', job_key: 'gen_salary', consumes: ['market.v1', 'signals.v1'], review_required: false });
  } else {
    tasks.push({ artifact_key: 'salary_negotiation', job_key: 'gen_salary', consumes: ['market.v1', 'signals.v1'], params: { lite: true }, review_required: false });
  }

  // Alloy report — conditional on barriers
  if (signals.barriers_any && hasResources) {
    tasks.push({ artifact_key: 'alloy_report', job_key: 'gen_alloy', consumes: ['signals.v1', 'resources.v1', 'profile.v1'], review_required: true });
  } else if (!signals.barriers_any) {
    exclusions.push({ artifact_key: 'alloy_report', reason: 'No barriers detected — Alloy Report not needed' });
  }

  const plan = {
    tasks,
    conditional_exclusions: exclusions,
  };

  await putRunData(ctx.runId, 'runplan.v1', plan, {
    classification: 'internal',
    producerStepKey: 'plan_package',
  });

  return {};
}

// ============================================================
// STEP 10: INIT BUNDLE
// ============================================================

async function initBundleStep(
  ctx: StepContext,
  _input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const plan = await getRunData<{ tasks: any[]; conditional_exclusions: any[] }>(ctx.runId, 'runplan.v1');

  // Create bundle record
  const bundle = await insert<{ id: string }>('bundle', {
    run_id: ctx.runId,
    org_id: ctx.orgId,
    project_id: ctx.projectId,
    status: 'building',
  });

  // Build initial manifest
  const sectionMap: Record<string, { key: string; title: string; artifacts: any[] }> = {
    start_here: { key: 'start_here', title: 'Start Here', artifacts: [] },
    apply: { key: 'apply', title: 'Your Documents', artifacts: [] },
    battle_plan: { key: 'battle_plan', title: 'Your Battle Plan', artifacts: [] },
    interview: { key: 'interview', title: 'Interview & Negotiate', artifacts: [] },
    barriers: { key: 'barriers', title: 'Your Barriers, Your Strengths', artifacts: [] },
    online: { key: 'online', title: 'Your Online Presence', artifacts: [] },
  };

  const ARTIFACT_META: Record<string, { display_title: string; section: string; preview_type: string; order: number }> = {
    readme_toc:             { display_title: 'README — Table of Contents', section: 'start_here', preview_type: 'none', order: 0 },
    quickstart_guide:       { display_title: 'Quick Start Guide', section: 'start_here', preview_type: 'none', order: 1 },
    resume_docx:            { display_title: 'Resume', section: 'apply', preview_type: 'none', order: 10 },
    coverletter_bold:       { display_title: 'Cover Letter (Bold)', section: 'apply', preview_type: 'none', order: 11 },
    coverletter_friendly:   { display_title: 'Cover Letter (Friendly)', section: 'apply', preview_type: 'none', order: 12 },
    coverletter_professional: { display_title: 'Cover Letter (Professional)', section: 'apply', preview_type: 'none', order: 13 },
    employers_battleplan:   { display_title: 'Target Employers — Battle Plan', section: 'battle_plan', preview_type: 'none', order: 20 },
    action_plan_30day:      { display_title: '30-Day Action Plan', section: 'battle_plan', preview_type: 'none', order: 21 },
    tracker_xlsx:           { display_title: 'Job Application Tracker', section: 'battle_plan', preview_type: 'none', order: 22 },
    interview_prep:         { display_title: 'Interview Prep Sheet', section: 'interview', preview_type: 'none', order: 30 },
    salary_negotiation:     { display_title: 'Salary Negotiation Sheet', section: 'interview', preview_type: 'none', order: 31 },
    alloy_report:           { display_title: 'Alloy Report (Confidential)', section: 'barriers', preview_type: 'none', order: 40 },
    portfolio_html:         { display_title: 'Online Portfolio', section: 'online', preview_type: 'html', order: 50 },
  };

  // Create placeholder artifact records + build manifest
  for (const task of plan.tasks) {
    const meta = ARTIFACT_META[task.artifact_key] || {
      display_title: task.artifact_key,
      section: 'apply',
      preview_type: 'none',
      order: 99,
    };

    // Create artifact record (no file_object yet — placeholder)
    await insert('artifact', {
      org_id: ctx.orgId,
      run_id: ctx.runId,
      project_id: ctx.projectId,
      artifact_type: task.artifact_key,
      artifact_key: task.artifact_key,
      bundle_id: bundle.id,
      display_title: meta.display_title,
      display_section: meta.section === 'battle_plan' ? 'apply' : meta.section,
      preview_type: meta.preview_type,
      order_index: meta.order,
      depends_on_keys: JSON.stringify(task.consumes),
      // file_object_id is NOT NULL in schema — we'll need a placeholder or defer
      // For now, leave this to Stage B which creates the real artifact
      version: 1,
      review_status: task.review_required ? 'pending' : 'pending',
    }).catch(() => {
      // file_object_id NOT NULL constraint — skip placeholder creation,
      // Stage B generators will create artifact records with real files
    });

    const section = sectionMap[meta.section] || sectionMap['apply'];
    section.artifacts.push({
      artifact_key: task.artifact_key,
      display_title: meta.display_title,
      status: 'pending',
      order_index: meta.order,
      download_url: null,
      preview_type: meta.preview_type,
    });
  }

  const manifest = {
    sections: Object.values(sectionMap).filter(s => s.artifacts.length > 0),
    recommended_next_action: 'Wait for package generation to complete, then review artifacts.',
    package_complete: false,
  };

  // Store manifest on bundle
  await query(
    `UPDATE bundle SET manifest = $2 WHERE id = $1`,
    [bundle.id, JSON.stringify(manifest)]
  );

  await putRunData(ctx.runId, 'artifact_manifest.v1', manifest, {
    classification: 'internal',
    producerStepKey: 'init_bundle',
  });

  // Enqueue Stage B artifact jobs
  const artifactQueue = getArtifactQueue();
  for (const task of plan.tasks) {
    await artifactQueue.add(task.job_key, {
      runId: ctx.runId,
      bundleId: bundle.id,
      orgId: ctx.orgId,
      projectId: ctx.projectId,
      artifactKey: task.artifact_key,
      params: task.params || {},
    });
  }

  await emitStepEvent(ctx, 'STEP_COMPLETED', {
    step_key: 'init_bundle',
    bundle_id: bundle.id,
    artifact_jobs_enqueued: plan.tasks.length,
  });

  return {};
}

// --- Artifact Queue ---

let _artifactQueue: Queue | null = null;

function getArtifactQueue(): Queue {
  if (_artifactQueue) return _artifactQueue;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is not set');

  const parsed = new URL(redisUrl);
  _artifactQueue = new Queue('crucible-artifacts', {
    connection: {
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
    },
  });
  return _artifactQueue;
}

// --- Utility Functions ---

function cleanText(text: string): string {
  if (!text) return text;
  text = text.replace(/[\u2018\u2019]/g, "'");
  text = text.replace(/[\u201C\u201D]/g, '"');
  text = text.replace(/\u2013/g, '-').replace(/\u2014/g, '-');
  text = text.replace(/\u2026/g, '...');
  text = text.replace(/[\u2022\u25CF\u25E6]/g, '*');
  text = text.replace(/\u00A0/g, ' ').replace(/\u00AD/g, '');
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/\n{4,}/g, '\n\n\n');
  text = text.split('\n').map(line => line.trim()).join('\n');
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return text.trim();
}

function calculateYearsExperience(workHistory: Array<{ start_date: string | null }>): number {
  if (!workHistory || workHistory.length === 0) return 0;
  const earliest = workHistory[workHistory.length - 1];
  const startYear = parseInt(earliest?.start_date?.match(/\d{4}/)?.[0] || '0');
  if (startYear === 0) return 0;
  return Math.max(0, new Date().getFullYear() - startYear);
}

function detectEmploymentGap(workHistory: Array<{ start_date: string | null; end_date: string | null }>): boolean {
  if (workHistory.length < 2) return false;
  for (let i = 0; i < workHistory.length - 1; i++) {
    const endDate = workHistory[i].end_date;
    const startDate = workHistory[i + 1].start_date;
    if (!endDate || !startDate) continue;
    const endMatch = endDate.match(/(\d{4})-(\d{2})/);
    const startMatch = startDate.match(/(\d{4})-(\d{2})/);
    if (endMatch && startMatch) {
      const endMonths = parseInt(endMatch[1]) * 12 + parseInt(endMatch[2]);
      const startMonths = parseInt(startMatch[1]) * 12 + parseInt(startMatch[2]);
      if (endMonths - startMonths > 6) return true;
    }
  }
  return false;
}

function scoreJobRelevance(job: any, signals: SignalsV1Type): number {
  let score = 50;
  const titleLower = (job.title || '').toLowerCase();
  for (const role of signals.target_roles) {
    if (titleLower.includes(role.toLowerCase())) { score += 30; break; }
  }
  for (const skill of signals.skills_technical.slice(0, 5)) {
    if ((job.description_summary || '').toLowerCase().includes(skill.toLowerCase())) { score += 5; }
  }
  if (job.salary) score += 10;
  return Math.min(100, score);
}
