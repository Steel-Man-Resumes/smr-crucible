/**
 * gen_employers — Target Employers Battle Plan (DOCX)
 *
 * Consumes: employers_enriched.v1, signals.v1, jobs.v1, profile.v1
 * Output: Target_Employers_BattlePlan.docx
 */
import { getRunData, uploadFile, insert, emitEvent, extractAndParseJSON, query } from '@crucible/core';
import type { EmployersV1Type, SignalsV1Type, ProfileV1Type, JobsV1Type } from '@crucible/core';
import Anthropic from '@anthropic-ai/sdk';
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle,
  HeadingLevel, Footer, Header,
} from 'docx';
import type { ArtifactJobData, GeneratorResult } from './types';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

function getAnthropic(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── Prompt Template ────────────────────────────────────────────

function buildEmployerPrompt(
  employers: EmployersV1Type,
  signals: SignalsV1Type,
  profile: ProfileV1Type,
  jobs: JobsV1Type
): string {
  const location = [profile.city, profile.state].filter(Boolean).join(', ');
  const yearsExp = calculateYearsExperience(profile.work_history);
  const topJobs = jobs.jobs.slice(0, 20);

  // Build the work history summary for the prompt
  const workSummary = profile.work_history
    .slice(0, 5)
    .map(w => `${w.title} at ${w.company} (${w.raw_dates || [w.start_date, w.end_date].filter(Boolean).join(' - ')})`)
    .join('; ');

  const barrierList = Object.entries(signals.barriers)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, ' '))
    .join(', ');

  return EMPLOYERS_PROMPT_TEMPLATE
    .replace('{{CANDIDATE_NAME}}', profile.full_name)
    .replace('{{LOCATION}}', location || 'Unknown')
    .replace('{{YEARS_EXP}}', String(yearsExp))
    .replace('{{INDUSTRY}}', signals.industry_primary)
    .replace('{{SENIORITY}}', signals.seniority_level)
    .replace('{{TARGET_ROLES}}', signals.target_roles.join(', '))
    .replace('{{SKILLS_TECHNICAL}}', signals.skills_technical.slice(0, 10).join(', '))
    .replace('{{SKILLS_SOFT}}', signals.skills_soft.slice(0, 8).join(', '))
    .replace('{{WORK_SUMMARY}}', workSummary)
    .replace('{{HAS_BARRIERS}}', signals.barriers_any ? 'YES' : 'NO')
    .replace('{{BARRIER_LIST}}', barrierList || 'none')
    .replace('{{TIER1_JSON}}', JSON.stringify(employers.tier1, null, 2))
    .replace('{{TIER2_JSON}}', JSON.stringify(employers.tier2, null, 2))
    .replace('{{TIER3_JSON}}', JSON.stringify(employers.tier3, null, 2))
    .replace('{{CURRENT_OPENINGS_JSON}}', JSON.stringify(topJobs.map(j => ({
      title: j.title, company: j.company, location: j.location, salary: j.salary, url: j.url,
    })), null, 2))
    .replace('{{TOTAL_COUNT}}', String(employers.total_count));
}

// ── The Actual Prompt ──────────────────────────────────────────

export const EMPLOYERS_PROMPT_TEMPLATE = `You are a career strategist building a Target Employers Battle Plan for a real person. This is not a generic list. This is a tactical document they will carry into their job search and execute against.

CANDIDATE PROFILE:
- Name: {{CANDIDATE_NAME}}
- Location: {{LOCATION}}
- Years of experience: {{YEARS_EXP}}
- Target industry: {{INDUSTRY}}
- Seniority: {{SENIORITY}}
- Target roles: {{TARGET_ROLES}}
- Technical skills: {{SKILLS_TECHNICAL}}
- Soft skills: {{SKILLS_SOFT}}
- Recent work history: {{WORK_SUMMARY}}
- Has barriers: {{HAS_BARRIERS}} ({{BARRIER_LIST}})

DATA — TIER 1 EMPLOYERS (already ranked, enriched with contact info):
{{TIER1_JSON}}

DATA — TIER 2 EMPLOYERS:
{{TIER2_JSON}}

DATA — TIER 3 EMPLOYERS:
{{TIER3_JSON}}

CURRENT JOB OPENINGS (matched to candidate):
{{CURRENT_OPENINGS_JSON}}

TOTAL EMPLOYERS: {{TOTAL_COUNT}}

YOUR TASK: Generate the content for each employer across all three tiers. Return a JSON object with this structure:

{
  "tier1": [
    {
      "name": "Company Name",
      "industry": "Actual industry name (NOT 'Employer' — use Retail, Logistics, Manufacturing, Healthcare, etc.)",
      "location": "City, State",
      "why_you_fit": "2-3 sentences specific to THIS candidate. Reference their actual experience, skills, and history. Example: 'Your 9 years managing customer-facing teams at Piggly Wiggly directly translates to their Shift Lead requirements. Your forklift certification gives you an edge over most applicants.'",
      "second_chance_status": "Known second-chance employer / Likely open / Unknown / Apply with caution",
      "second_chance_detail": "Brief explanation if known, e.g. 'Partners with Goodwill re-entry program' or null",
      "approach_strategy": "Specific tactical advice. NOT generic 'apply online'. Example: 'Apply on their website first, then call the Ridgeland location at (601) 555-1234 within 48 hours. Ask to speak with the hiring manager for the warehouse. Say: I just submitted my application for the Shift Lead role — I have 9 years in grocery operations and I wanted to introduce myself.'",
      "talking_points": [
        "Specific thing to mention #1 — tied to THEIR experience",
        "Specific thing to mention #2 — tied to the company's needs",
        "Specific thing to mention #3 — addresses any concerns proactively"
      ],
      "contact_info": {
        "phone": "from enrichment data or null",
        "address": "from enrichment data or null",
        "website": "from enrichment data or null",
        "contact_name": "from enrichment data or null"
      },
      "application_channel": "Direct website / Walk-in / Staffing agency name / Indeed / etc.",
      "current_openings": [
        {
          "title": "Job title from openings data",
          "url": "Direct application URL",
          "salary": "if available"
        }
      ]
    }
  ],
  "tier2": [
    {
      "name": "Company Name",
      "industry": "Actual industry",
      "location": "City, State",
      "website": "url or null",
      "application_channel": "How to apply",
      "fit_statement": "2-3 sentences on why this company is worth applying to. Be specific to the candidate.",
      "second_chance_friendly": true/false/null
    }
  ],
  "tier3": [
    {
      "name": "Company Name",
      "location": "City, State",
      "job_url": "Direct link if available, or company careers page",
      "fit_note": "1 line — why this is on the list"
    }
  ]
}

RULES:
1. Every "why_you_fit" and "fit_statement" must reference the candidate's ACTUAL skills, job history, or certifications. No generic text.
2. Approach strategies for Tier 1 must be ACTIONABLE and SPECIFIC. Include what to say, who to ask for, when to follow up.
3. Talking points must be things the candidate can actually say in an interview. Written in first person where appropriate.
4. Industry must be the REAL industry (Retail, Logistics, Manufacturing, Food Service, Healthcare, Construction, etc.) — never "Employer" or "Various".
5. If the candidate has barriers, Tier 1 talking points should include a proactive framing strategy. Don't avoid it — address it.
6. Current openings should be matched from the job data where the company name matches. Include the direct URL.
7. Contact info comes from the enrichment data. Use what's there. Don't fabricate phone numbers.
8. The total employer count in the document header must match the actual count you return.

VOICE: Direct, tactical, no corporate fluff. This is a battle plan, not a report. Write like a coach who knows the local job market and is giving real advice.

Return ONLY valid JSON. No markdown, no explanation.`;

// ── DOCX Builder ───────────────────────────────────────────────

const GOLD = 'D4A84B';
const DARK = '1a1a1a';
const GRAY = '666666';

function buildDocx(
  data: { tier1: Tier1Content[]; tier2: Tier2Content[]; tier3: Tier3Content[] },
  candidateName: string,
  totalCount: number
): Promise<Buffer> {
  const children: Paragraph[] = [];

  // Title
  children.push(new Paragraph({
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: 'TARGET EMPLOYERS', bold: true, size: 52, font: 'Calibri', color: GOLD })],
  }));

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: [new TextRun({ text: 'BATTLE PLAN', bold: true, size: 36, font: 'Calibri', color: DARK })],
  }));

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({
      text: `${totalCount} EMPLOYERS | Prepared for ${candidateName.toUpperCase()}`,
      size: 22, font: 'Calibri', color: GRAY,
    })],
  }));

  // Divider
  children.push(createDivider());

  // ── TIER 1 ──
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    border: { bottom: { color: GOLD, size: 12, style: BorderStyle.SINGLE, space: 4 } },
    children: [new TextRun({ text: `TIER 1 — YOUR TOP ${data.tier1.length}`, bold: true, size: 32, font: 'Calibri', color: GOLD })],
  }));

  children.push(new Paragraph({
    spacing: { after: 300 },
    children: [new TextRun({
      text: 'These are your best-fit employers. Each one gets a full tactical briefing: why you fit, how to approach them, what to say, and who to contact.',
      size: 22, font: 'Calibri', color: GRAY, italics: true,
    })],
  }));

  for (const emp of data.tier1) {
    // Company name heading
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 360, after: 80 },
      children: [new TextRun({ text: emp.name.toUpperCase(), bold: true, size: 28, font: 'Calibri', color: DARK })],
    }));

    // Meta line: industry | location
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({
        text: `${emp.industry}  |  ${emp.location}`,
        size: 21, font: 'Calibri', italics: true, color: GRAY,
      })],
    }));

    // Second-chance status
    if (emp.second_chance_status) {
      const color = emp.second_chance_status.toLowerCase().includes('known') ? '2E7D32' :
                    emp.second_chance_status.toLowerCase().includes('likely') ? '558B2F' : GRAY;
      children.push(new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({ text: 'Second-Chance Status: ', bold: true, size: 21, font: 'Calibri' }),
          new TextRun({ text: emp.second_chance_status, size: 21, font: 'Calibri', color }),
          ...(emp.second_chance_detail ? [
            new TextRun({ text: ` — ${emp.second_chance_detail}`, size: 20, font: 'Calibri', color: GRAY }),
          ] : []),
        ],
      }));
    }

    // Why You Fit
    children.push(fieldBlock('WHY YOU FIT', emp.why_you_fit));

    // Approach Strategy
    children.push(fieldBlock('APPROACH STRATEGY', emp.approach_strategy));

    // Talking Points
    if (emp.talking_points.length > 0) {
      children.push(new Paragraph({
        spacing: { before: 120, after: 40 },
        children: [new TextRun({ text: 'TALKING POINTS:', bold: true, size: 21, font: 'Calibri', color: GOLD })],
      }));
      for (const point of emp.talking_points) {
        children.push(new Paragraph({
          spacing: { after: 60 },
          indent: { left: 360 },
          children: [new TextRun({ text: `\u2022 ${point}`, size: 21, font: 'Calibri' })],
        }));
      }
    }

    // Contact Info
    const contactLines: string[] = [];
    if (emp.contact_info.contact_name) contactLines.push(`Contact: ${emp.contact_info.contact_name}`);
    if (emp.contact_info.phone) contactLines.push(`Phone: ${emp.contact_info.phone}`);
    if (emp.contact_info.address) contactLines.push(`Address: ${emp.contact_info.address}`);
    if (emp.contact_info.website) contactLines.push(`Website: ${emp.contact_info.website}`);

    if (contactLines.length > 0) {
      children.push(new Paragraph({
        spacing: { before: 120, after: 40 },
        children: [new TextRun({ text: 'CONTACT INFO:', bold: true, size: 21, font: 'Calibri', color: GOLD })],
      }));
      for (const line of contactLines) {
        children.push(new Paragraph({
          spacing: { after: 40 },
          indent: { left: 360 },
          children: [new TextRun({ text: line, size: 21, font: 'Calibri' })],
        }));
      }
    }

    // Application Channel
    children.push(new Paragraph({
      spacing: { before: 80, after: 40 },
      children: [
        new TextRun({ text: 'How to Apply: ', bold: true, size: 21, font: 'Calibri' }),
        new TextRun({ text: emp.application_channel, size: 21, font: 'Calibri' }),
      ],
    }));

    // Current Openings
    if (emp.current_openings && emp.current_openings.length > 0) {
      children.push(new Paragraph({
        spacing: { before: 120, after: 40 },
        children: [new TextRun({ text: 'CURRENT OPENINGS:', bold: true, size: 21, font: 'Calibri', color: GOLD })],
      }));
      for (const opening of emp.current_openings) {
        const parts = [opening.title, opening.salary].filter(Boolean).join(' — ');
        children.push(new Paragraph({
          spacing: { after: 40 },
          indent: { left: 360 },
          children: [
            new TextRun({ text: `\u2022 ${parts}`, size: 21, font: 'Calibri' }),
            ...(opening.url ? [new TextRun({ text: `  [${opening.url}]`, size: 18, font: 'Calibri', color: GRAY })] : []),
          ],
        }));
      }
    }

    // Divider between employers
    children.push(createDivider());
  }

  // ── TIER 2 ──
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    border: { bottom: { color: GOLD, size: 12, style: BorderStyle.SINGLE, space: 4 } },
    children: [new TextRun({ text: `TIER 2 — STRONG ${data.tier2.length}`, bold: true, size: 32, font: 'Calibri', color: GOLD })],
  }));

  children.push(new Paragraph({
    spacing: { after: 300 },
    children: [new TextRun({
      text: 'Solid alternatives worth applying to. Less intel than Tier 1, but strong fit for your background.',
      size: 22, font: 'Calibri', color: GRAY, italics: true,
    })],
  }));

  for (const emp of data.tier2) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240, after: 60 },
      children: [new TextRun({ text: emp.name.toUpperCase(), bold: true, size: 26, font: 'Calibri', color: DARK })],
    }));

    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({
        text: `${emp.industry}  |  ${emp.location}`,
        size: 21, font: 'Calibri', italics: true, color: GRAY,
      })],
    }));

    if (emp.second_chance_friendly === true) {
      children.push(new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: 'Second-chance friendly', size: 20, font: 'Calibri', color: '2E7D32', bold: true })],
      }));
    }

    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: emp.fit_statement, size: 21, font: 'Calibri' })],
    }));

    const applyLine = [emp.application_channel, emp.website].filter(Boolean).join('  |  ');
    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({ text: 'Apply: ', bold: true, size: 21, font: 'Calibri' }),
        new TextRun({ text: applyLine, size: 21, font: 'Calibri', color: GRAY }),
      ],
    }));
  }

  // ── TIER 3 ──
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    border: { bottom: { color: GOLD, size: 12, style: BorderStyle.SINGLE, space: 4 } },
    children: [new TextRun({ text: `TIER 3 — ADDITIONAL ${data.tier3.length}`, bold: true, size: 32, font: 'Calibri', color: GOLD })],
  }));

  children.push(new Paragraph({
    spacing: { after: 300 },
    children: [new TextRun({
      text: 'Backup targets. Apply if your Tier 1 and 2 are moving slowly, or to keep volume up.',
      size: 22, font: 'Calibri', color: GRAY, italics: true,
    })],
  }));

  for (const emp of data.tier3) {
    children.push(new Paragraph({
      spacing: { before: 120, after: 60 },
      children: [
        new TextRun({ text: `${emp.name}`, bold: true, size: 22, font: 'Calibri', color: DARK }),
        new TextRun({ text: `  |  ${emp.location}`, size: 21, font: 'Calibri', color: GRAY }),
        ...(emp.fit_note ? [new TextRun({ text: `  — ${emp.fit_note}`, size: 20, font: 'Calibri', italics: true })] : []),
      ],
    }));
    if (emp.job_url) {
      children.push(new Paragraph({
        spacing: { after: 40 },
        indent: { left: 360 },
        children: [new TextRun({ text: emp.job_url, size: 18, font: 'Calibri', color: GRAY })],
      }));
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: 'STEEL MAN RESUMES — TARGET EMPLOYERS', size: 16, font: 'Calibri', color: GRAY })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: `Prepared for ${candidateName} — Confidential`, size: 16, font: 'Calibri', color: GRAY })],
          })],
        }),
      },
      children,
    }],
  });

  return Packer.toBuffer(doc).then(b => Buffer.from(b));
}

// ── Helper: field block ────────────────────────────────────────

function fieldBlock(label: string, content: string): Paragraph {
  return new Paragraph({
    spacing: { before: 120, after: 80 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 21, font: 'Calibri', color: GOLD }),
      new TextRun({ text: content, size: 21, font: 'Calibri' }),
    ],
  });
}

function createDivider(): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { color: 'CCCCCC', size: 4, style: BorderStyle.SINGLE, space: 4 } },
    children: [],
  });
}

// ── Content types ──────────────────────────────────────────────

interface Tier1Content {
  name: string;
  industry: string;
  location: string;
  why_you_fit: string;
  second_chance_status: string;
  second_chance_detail: string | null;
  approach_strategy: string;
  talking_points: string[];
  contact_info: { phone: string | null; address: string | null; website: string | null; contact_name: string | null };
  application_channel: string;
  current_openings: { title: string; url: string | null; salary: string | null }[];
}

interface Tier2Content {
  name: string;
  industry: string;
  location: string;
  website: string | null;
  application_channel: string;
  fit_statement: string;
  second_chance_friendly: boolean | null;
}

interface Tier3Content {
  name: string;
  location: string;
  job_url: string | null;
  fit_note: string;
}

// ── Main Generator ─────────────────────────────────────────────

export async function generateEmployersBattlePlan(job: ArtifactJobData): Promise<GeneratorResult> {
  const { runId, bundleId, orgId, projectId, artifactKey } = job;

  // Read frozen data products
  const employers = await getRunData<EmployersV1Type>(runId, 'employers_enriched.v1');
  const signals = await getRunData<SignalsV1Type>(runId, 'signals.v1');
  const profile = await getRunData<ProfileV1Type>(runId, 'profile.v1');

  // Try to get jobs — non-critical if missing
  let jobs: JobsV1Type = { jobs: [], query_used: '', pages_fetched: 0, total_found: 0, fetched_at: '' };
  try {
    jobs = await getRunData<JobsV1Type>(runId, 'jobs.v1');
  } catch {
    console.warn('[gen_employers] jobs.v1 not found, proceeding without current openings');
  }

  const anthropic = getAnthropic();
  const prompt = buildEmployerPrompt(employers, signals, profile, jobs);

  console.log(`[gen_employers] Calling Claude for employer battle plan content (${employers.total_count} employers)...`);
  const startTime = Date.now();

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  });

  const latencyMs = Date.now() - startTime;
  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  console.log(`[gen_employers] Claude responded in ${latencyMs}ms (${text.length} chars)`);

  // Emit AI call event
  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'AI_CALL_COMPLETED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_employers',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: {
      provider: 'anthropic', model: CLAUDE_MODEL, latency_ms: latencyMs,
      token_estimate: (message.usage?.input_tokens || 0) + (message.usage?.output_tokens || 0),
    },
  });

  const content = extractAndParseJSON(text);

  // Normalize with fallbacks
  const tier1: Tier1Content[] = (content.tier1 || []).map((e: Record<string, unknown>, i: number) => {
    const src = employers.tier1[i];
    return {
      name: (e.name as string) || src?.name || 'Unknown',
      industry: (e.industry as string) || src?.industry || signals.industry_primary,
      location: (e.location as string) || src?.location || '',
      why_you_fit: (e.why_you_fit as string) || src?.why_good_fit || '',
      second_chance_status: (e.second_chance_status as string) || (src?.second_chance_friendly ? 'Likely open' : 'Unknown'),
      second_chance_detail: (e.second_chance_detail as string | null) || null,
      approach_strategy: (e.approach_strategy as string) || src?.approach_strategy || 'Apply on company website',
      talking_points: Array.isArray(e.talking_points) ? (e.talking_points as string[]) : (src?.talking_points || []),
      contact_info: {
        phone: ((e.contact_info as Record<string, unknown>)?.phone as string | null) || src?.phone || null,
        address: ((e.contact_info as Record<string, unknown>)?.address as string | null) || src?.address || null,
        website: ((e.contact_info as Record<string, unknown>)?.website as string | null) || src?.website || null,
        contact_name: ((e.contact_info as Record<string, unknown>)?.contact_name as string | null) || src?.contact_name || null,
      },
      application_channel: (e.application_channel as string) || src?.application_channel || 'Company website',
      current_openings: Array.isArray(e.current_openings) ? (e.current_openings as Tier1Content['current_openings']) : [],
    };
  });

  const tier2: Tier2Content[] = (content.tier2 || []).map((e: Record<string, unknown>, i: number) => {
    const src = employers.tier2[i];
    return {
      name: (e.name as string) || src?.name || 'Unknown',
      industry: (e.industry as string) || src?.industry || signals.industry_primary,
      location: (e.location as string) || src?.location || '',
      website: (e.website as string | null) || src?.website || null,
      application_channel: (e.application_channel as string) || src?.application_channel || 'Company website',
      fit_statement: (e.fit_statement as string) || src?.why_good_fit || '',
      second_chance_friendly: (e.second_chance_friendly as boolean | null) ?? src?.second_chance_friendly ?? null,
    };
  });

  const tier3: Tier3Content[] = (content.tier3 || []).map((e: Record<string, unknown>, i: number) => {
    const src = employers.tier3[i];
    return {
      name: (e.name as string) || src?.name || 'Unknown',
      location: (e.location as string) || src?.location || '',
      job_url: (e.job_url as string | null) || null,
      fit_note: (e.fit_note as string) || src?.why_good_fit || '',
    };
  });

  const totalCount = tier1.length + tier2.length + tier3.length;

  // Build DOCX
  const docxBuffer = await buildDocx({ tier1, tier2, tier3 }, profile.full_name, totalCount);

  // Upload to R2
  const safeName = (profile.full_name || 'Candidate').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `${safeName}_Target_Employers_BattlePlan.docx`;
  const objectKey = `${orgId}/${projectId}/artifacts/${runId}/${fileName}`;
  const fileObject = await uploadFile(
    orgId, objectKey, docxBuffer,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );

  // Create artifact record
  const artifact = await insert<{ id: string }>('artifact', {
    org_id: orgId,
    run_id: runId,
    project_id: projectId,
    artifact_type: artifactKey,
    artifact_key: artifactKey,
    bundle_id: bundleId,
    file_object_id: fileObject.id,
    display_title: 'Target Employers — Battle Plan',
    display_section: 'battle_plan',
    preview_type: 'none',
    order_index: 20,
    version: 1,
    review_status: 'pending',
  });

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'ARTIFACT_GENERATED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_employers',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: {
      artifact_id: artifact.id, artifact_key: artifactKey,
      file_name: fileName, byte_size: docxBuffer.length,
      tier_counts: { tier1: tier1.length, tier2: tier2.length, tier3: tier3.length },
    },
  });

  console.log(`[gen_employers] Battle plan generated: ${fileName} (${docxBuffer.length} bytes, ${totalCount} employers)`);

  return { artifactKey, fileObjectId: fileObject.id, fileName, byteSize: docxBuffer.length };
}

// ── Utility ────────────────────────────────────────────────────

function calculateYearsExperience(workHistory: Array<{ start_date: string | null }>): number {
  if (!workHistory || workHistory.length === 0) return 0;
  const earliest = workHistory[workHistory.length - 1];
  const startYear = parseInt(earliest?.start_date?.match(/\d{4}/)?.[0] || '0');
  if (startYear === 0) return 0;
  return Math.max(0, new Date().getFullYear() - startYear);
}
