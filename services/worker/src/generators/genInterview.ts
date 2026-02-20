/**
 * gen_interview — Interview Prep Sheet (DOCX)
 *
 * Consumes: signals.v1, employers_enriched.v1, market.v1
 */
import { getRunData, uploadFile, insert, emitEvent, extractAndParseJSON } from '@crucible/core';
import type { SignalsV1Type, EmployersV1Type, MarketV1Type } from '@crucible/core';
import Anthropic from '@anthropic-ai/sdk';
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, HeadingLevel,
} from 'docx';
import type { ArtifactJobData, GeneratorResult } from './types';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

function getAnthropic(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export async function generateInterviewPrep(job: ArtifactJobData): Promise<GeneratorResult> {
  const { runId, bundleId, orgId, projectId, artifactKey } = job;

  const signals = await getRunData<SignalsV1Type>(runId, 'signals.v1');
  const employers = await getRunData<EmployersV1Type>(runId, 'employers_enriched.v1');
  let market: MarketV1Type | null = null;
  try { market = await getRunData<MarketV1Type>(runId, 'market.v1'); } catch { /* ok */ }

  const top3 = employers.tier1.slice(0, 3);
  const anthropic = getAnthropic();

  const prompt = `You are a career coach preparing someone for interviews in the ${signals.industry_primary} industry.

CANDIDATE:
- Seniority: ${signals.seniority_level}
- Target roles: ${signals.target_roles.join(', ')}
- Technical skills: ${signals.skills_technical.join(', ')}
- Has barriers: ${signals.barriers_any ? 'Yes' : 'No'}

TOP 3 EMPLOYERS:
${top3.map((e, i) => `${i + 1}. ${e.name} (${e.industry}, ${e.location}) — "${e.why_good_fit}"`).join('\n')}

SALARY DATA: ${market ? `$${market.salary_low}-$${market.salary_high} (${market.confidence} confidence)` : 'Not available'}

Generate interview prep as JSON:
{
  "pre_interview_checklist": ["8-10 items to do before any interview"],
  "star_questions": [
    {
      "question": "Common interview question for this industry",
      "why_they_ask": "What the interviewer is really looking for",
      "star_answer_framework": "Situation → Task → Action → Result framework using candidate's actual skills",
      "example_opener": "Exact opening sentence they can use"
    }
  ],
  "company_specific": [
    {
      "company": "Tier 1 employer name",
      "research_points": ["3 things to know about this company before interviewing"],
      "questions_to_ask": ["2-3 smart questions to ask THIS employer"],
      "potential_concerns": "What this employer might worry about and how to address it"
    }
  ],
  "salary_discussion": {
    "when_to_discuss": "Timing advice",
    "what_to_say": "Exact script for salary discussion",
    "target_range": "${market ? `$${market.salary_low}-$${market.salary_high}` : 'Research needed'}",
    "negotiation_tip": "One key negotiation insight"
  },
  "dos_and_donts": {
    "do": ["5-6 industry-specific do's"],
    "dont": ["5-6 industry-specific don'ts"]
  },
  "what_to_wear": "Industry-appropriate attire recommendation",
  "what_to_bring": ["List of items to bring to the interview"]
}

Make STAR questions specific to ${signals.industry_primary}. Company-specific sections must reference REAL company names.

Return ONLY valid JSON.`;

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 6000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const prep = extractAndParseJSON(text);

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'AI_CALL_COMPLETED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_interview',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: { provider: 'anthropic', model: CLAUDE_MODEL },
  });

  // Build DOCX
  const GOLD = 'D4A84B'; const DARK = '1a1a1a'; const GRAY = '666666';
  const children: Paragraph[] = [];

  children.push(new Paragraph({
    heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 300 },
    children: [new TextRun({ text: 'INTERVIEW PREP SHEET', bold: true, size: 44, font: 'Calibri', color: GOLD })],
  }));

  // Pre-interview checklist
  const sec = (t: string) => new Paragraph({
    heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 120 },
    border: { bottom: { color: GOLD, size: 10, style: BorderStyle.SINGLE, space: 4 } },
    children: [new TextRun({ text: t, bold: true, size: 28, font: 'Calibri', color: GOLD })],
  });
  const bullet = (t: string, checkbox = false) => new Paragraph({
    spacing: { after: 60 }, indent: { left: 360 },
    children: [new TextRun({ text: `${checkbox ? '\u2610' : '\u2022'} ${t}`, size: 22, font: 'Calibri' })],
  });

  children.push(sec('PRE-INTERVIEW CHECKLIST'));
  for (const item of (prep.pre_interview_checklist || [])) children.push(bullet(item, true));

  // STAR Questions
  children.push(sec('COMMON INTERVIEW QUESTIONS (STAR METHOD)'));
  for (const q of (prep.star_questions || [])) {
    children.push(new Paragraph({
      spacing: { before: 200, after: 40 }, shading: { fill: 'F5F5F5' },
      children: [new TextRun({ text: `Q: "${q.question}"`, bold: true, size: 22, font: 'Calibri' })],
    }));
    children.push(new Paragraph({
      spacing: { after: 40 }, indent: { left: 360 },
      children: [
        new TextRun({ text: 'Why they ask: ', bold: true, size: 20, font: 'Calibri', color: GRAY }),
        new TextRun({ text: q.why_they_ask, size: 20, font: 'Calibri', color: GRAY }),
      ],
    }));
    children.push(new Paragraph({
      spacing: { after: 40 }, indent: { left: 360 },
      children: [
        new TextRun({ text: 'Framework: ', bold: true, size: 20, font: 'Calibri' }),
        new TextRun({ text: q.star_answer_framework, size: 20, font: 'Calibri' }),
      ],
    }));
    children.push(new Paragraph({
      spacing: { after: 80 }, indent: { left: 360 },
      shading: { fill: 'FDF6E3' },
      border: { left: { color: GOLD, size: 12, style: BorderStyle.SINGLE, space: 4 } },
      children: [
        new TextRun({ text: 'Start with: ', bold: true, size: 20, font: 'Calibri', color: GOLD }),
        new TextRun({ text: `"${q.example_opener}"`, size: 20, font: 'Calibri', italics: true }),
      ],
    }));
  }

  // Company-specific
  children.push(sec('COMPANY-SPECIFIC PREP'));
  for (const co of (prep.company_specific || [])) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 60 },
      children: [new TextRun({ text: (co.company || '').toUpperCase(), bold: true, size: 24, font: 'Calibri', color: DARK })],
    }));
    for (const point of (co.research_points || [])) children.push(bullet(point));
    children.push(new Paragraph({
      spacing: { before: 80, after: 40 },
      children: [new TextRun({ text: 'Smart questions to ask:', bold: true, size: 21, font: 'Calibri', color: GOLD })],
    }));
    for (const q of (co.questions_to_ask || [])) children.push(bullet(q));
    if (co.potential_concerns) {
      children.push(new Paragraph({
        spacing: { before: 40, after: 80 }, indent: { left: 360 },
        children: [
          new TextRun({ text: 'Watch for: ', bold: true, size: 20, font: 'Calibri', color: GRAY }),
          new TextRun({ text: co.potential_concerns, size: 20, font: 'Calibri', color: GRAY }),
        ],
      }));
    }
  }

  // Salary discussion
  if (prep.salary_discussion) {
    children.push(sec('SALARY DISCUSSION'));
    const sd = prep.salary_discussion;
    if (sd.when_to_discuss) children.push(new Paragraph({ spacing: { after: 60 }, children: [
      new TextRun({ text: 'When: ', bold: true, size: 22, font: 'Calibri' }),
      new TextRun({ text: sd.when_to_discuss, size: 22, font: 'Calibri' }),
    ] }));
    if (sd.what_to_say) children.push(new Paragraph({
      spacing: { after: 60 }, indent: { left: 360 },
      shading: { fill: 'FDF6E3' },
      border: { left: { color: GOLD, size: 12, style: BorderStyle.SINGLE, space: 4 } },
      children: [
        new TextRun({ text: 'Say: ', bold: true, size: 22, font: 'Calibri', color: GOLD }),
        new TextRun({ text: `"${sd.what_to_say}"`, size: 22, font: 'Calibri', italics: true }),
      ],
    }));
    if (sd.target_range) children.push(new Paragraph({ spacing: { after: 60 }, children: [
      new TextRun({ text: `Target: ${sd.target_range}`, bold: true, size: 22, font: 'Calibri' }),
    ] }));
    if (sd.negotiation_tip) children.push(new Paragraph({ spacing: { after: 60 }, indent: { left: 360 }, children: [
      new TextRun({ text: `Tip: ${sd.negotiation_tip}`, size: 20, font: 'Calibri', italics: true, color: GRAY }),
    ] }));
  }

  // Do's and Don'ts
  if (prep.dos_and_donts) {
    children.push(sec("DO'S AND DON'TS"));
    children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'DO:', bold: true, size: 22, font: 'Calibri', color: '2E7D32' })] }));
    for (const d of (prep.dos_and_donts.do || [])) children.push(bullet(`\u2713 ${d}`));
    children.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [new TextRun({ text: "DON'T:", bold: true, size: 22, font: 'Calibri', color: 'CC0000' })] }));
    for (const d of (prep.dos_and_donts.dont || [])) children.push(bullet(`\u2717 ${d}`));
  }

  // What to wear / bring
  if (prep.what_to_wear) {
    children.push(sec('WHAT TO WEAR'));
    children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: prep.what_to_wear, size: 22, font: 'Calibri' })] }));
  }
  if (prep.what_to_bring?.length) {
    children.push(sec('WHAT TO BRING'));
    for (const item of prep.what_to_bring) children.push(bullet(item, true));
  }

  const doc = new Document({ sections: [{ properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } }, children }] });
  const docxBuffer = Buffer.from(await Packer.toBuffer(doc));

  const fileName = 'Interview_Prep_Sheet.docx';
  const objectKey = `${orgId}/${projectId}/artifacts/${runId}/${fileName}`;
  const fileObject = await uploadFile(orgId, objectKey, docxBuffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  const artifact = await insert<{ id: string }>('artifact', {
    org_id: orgId, run_id: runId, project_id: projectId,
    artifact_type: artifactKey, artifact_key: artifactKey, bundle_id: bundleId,
    file_object_id: fileObject.id, display_title: 'Interview Prep Sheet',
    display_section: 'interview', preview_type: 'none', order_index: 30, version: 1, review_status: 'pending',
  });

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'ARTIFACT_GENERATED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_interview',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: { artifact_id: artifact.id, artifact_key: artifactKey, file_name: fileName, byte_size: docxBuffer.length },
  });

  console.log(`[gen_interview] Interview prep generated: ${fileName} (${docxBuffer.length} bytes)`);
  return { artifactKey, fileObjectId: fileObject.id, fileName, byteSize: docxBuffer.length };
}
