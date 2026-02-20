/**
 * gen_actionplan — 30-Day Action Plan (DOCX)
 *
 * Consumes: employers_enriched.v1, jobs.v1, resources.v1, market.v1, signals.v1
 * Output: table-based 4-week DOCX with real employer names and job URLs
 */
import { getRunData, uploadFile, insert, emitEvent, extractAndParseJSON } from '@crucible/core';
import type { EmployersV1Type, JobsV1Type, MarketV1Type, SignalsV1Type } from '@crucible/core';
import type { ResourcesV1 as ResourcesV1Type } from '@crucible/core';
import Anthropic from '@anthropic-ai/sdk';
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle,
  HeadingLevel, Header, Footer,
} from 'docx';
import type { ArtifactJobData, GeneratorResult } from './types';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

function getAnthropic(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export async function generateActionPlan(job: ArtifactJobData): Promise<GeneratorResult> {
  const { runId, bundleId, orgId, projectId, artifactKey } = job;

  const employers = await getRunData<EmployersV1Type>(runId, 'employers_enriched.v1');
  const signals = await getRunData<SignalsV1Type>(runId, 'signals.v1');
  let jobs: JobsV1Type = { jobs: [], query_used: '', pages_fetched: 0, total_found: 0, fetched_at: '' };
  try { jobs = await getRunData<JobsV1Type>(runId, 'jobs.v1'); } catch { /* ok */ }
  let market: MarketV1Type | null = null;
  try { market = await getRunData<MarketV1Type>(runId, 'market.v1'); } catch { /* ok */ }
  let resources: ResourcesV1Type | null = null;
  try { resources = await getRunData<ResourcesV1Type>(runId, 'resources.v1'); } catch { /* ok */ }

  const tier1Names = employers.tier1.slice(0, 5).map(e => e.name);
  const topJobUrls = jobs.jobs.slice(0, 5).map(j => `${j.title} at ${j.company}: ${j.url}`);
  const resourceList = resources?.resources.slice(0, 3).map(r => `${r.name} at ${r.address || 'address TBD'} (${r.phone || 'call for info'})`) || [];

  const anthropic = getAnthropic();
  const prompt = `You are a career coach building a 30-day action plan for a job seeker.

CANDIDATE:
- Industry: ${signals.industry_primary}
- Target roles: ${signals.target_roles.join(', ')}
- Has barriers: ${signals.barriers_any ? 'Yes' : 'No'}
- Salary target: ${market ? `$${market.salary_low}-$${market.salary_high}` : 'Not yet researched'}

TOP EMPLOYERS (Tier 1): ${tier1Names.join(', ')}
TOP JOB LISTINGS: ${topJobUrls.join('; ')}
LOCAL RESOURCES: ${resourceList.join('; ') || 'None identified'}

Generate a 4-week action plan as JSON. Each week has 5-7 tasks. Tasks must reference REAL employer names, job URLs, and resources from the data above.

{
  "weeks": [
    {
      "week": 1,
      "theme": "Foundation & First Applications",
      "tasks": [
        {
          "day": "Day 1",
          "task": "Specific actionable task",
          "detail": "Exactly what to do, referencing real companies/URLs",
          "checkbox": false
        }
      ]
    }
  ],
  "contingency": {
    "trigger": "No interviews by Day 14",
    "actions": ["Specific contingency actions referencing real data"]
  },
  "daily_habits": ["3-4 daily habits to maintain throughout the 30 days"]
}

RULES:
- Week 1: Focus on Tier 1 employers by name. "Apply to ${tier1Names[0] || 'top employer'}" not "apply to companies."
- Week 2: Expand to Tier 2. Include actual job URLs where available.
- Week 3: Follow-ups, interview prep, networking.
- Week 4: Evaluate, adjust strategy, continue applications.
- If resources exist, include "Visit [resource name] at [address]" in week 1 or 2.
- Each task must be completable in one sitting.
- Use natural language, not corporate speak.

Return ONLY valid JSON.`;

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 6000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const plan = extractAndParseJSON(text);

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'AI_CALL_COMPLETED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_actionplan',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: { provider: 'anthropic', model: CLAUDE_MODEL },
  });

  // Build DOCX
  const children: Paragraph[] = [];
  const GOLD = 'D4A84B'; const DARK = '1a1a1a'; const GRAY = '666666';

  children.push(new Paragraph({
    heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 80 },
    children: [new TextRun({ text: '30-DAY ACTION PLAN', bold: true, size: 44, font: 'Calibri', color: GOLD })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 300 },
    children: [new TextRun({ text: 'Your roadmap from day one to interview day.', size: 22, font: 'Calibri', color: GRAY, italics: true })],
  }));

  for (const week of (plan.weeks || [])) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 120 },
      border: { bottom: { color: GOLD, size: 10, style: BorderStyle.SINGLE, space: 4 } },
      children: [new TextRun({ text: `WEEK ${week.week}: ${(week.theme || '').toUpperCase()}`, bold: true, size: 28, font: 'Calibri', color: GOLD })],
    }));

    for (const task of (week.tasks || [])) {
      children.push(new Paragraph({
        spacing: { before: 120, after: 40 },
        children: [
          new TextRun({ text: '\u2610 ', size: 24, font: 'Calibri' }),
          new TextRun({ text: `${task.day}: `, bold: true, size: 22, font: 'Calibri', color: DARK }),
          new TextRun({ text: task.task, size: 22, font: 'Calibri' }),
        ],
      }));
      if (task.detail) {
        children.push(new Paragraph({
          spacing: { after: 60 }, indent: { left: 480 },
          children: [new TextRun({ text: task.detail, size: 20, font: 'Calibri', color: GRAY })],
        }));
      }
    }
  }

  // Contingency
  if (plan.contingency) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 120 },
      border: { bottom: { color: 'CC0000', size: 10, style: BorderStyle.SINGLE, space: 4 } },
      children: [new TextRun({ text: `CONTINGENCY: ${plan.contingency.trigger || 'If Things Stall'}`, bold: true, size: 28, font: 'Calibri', color: 'CC0000' })],
    }));
    for (const action of (plan.contingency.actions || [])) {
      children.push(new Paragraph({
        spacing: { after: 60 }, indent: { left: 360 },
        children: [new TextRun({ text: `\u2022 ${action}`, size: 22, font: 'Calibri' })],
      }));
    }
  }

  // Daily habits
  if (plan.daily_habits?.length) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 120 },
      border: { bottom: { color: GOLD, size: 10, style: BorderStyle.SINGLE, space: 4 } },
      children: [new TextRun({ text: 'DAILY HABITS', bold: true, size: 28, font: 'Calibri', color: GOLD })],
    }));
    for (const habit of plan.daily_habits) {
      children.push(new Paragraph({
        spacing: { after: 60 }, indent: { left: 360 },
        children: [new TextRun({ text: `\u2610 ${habit}`, size: 22, font: 'Calibri' })],
      }));
    }
  }

  const doc = new Document({ sections: [{ properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } }, children }] });
  const docxBuffer = Buffer.from(await Packer.toBuffer(doc));

  const fileName = 'Action_Plan_30Day.docx';
  const objectKey = `${orgId}/${projectId}/artifacts/${runId}/${fileName}`;
  const fileObject = await uploadFile(orgId, objectKey, docxBuffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  const artifact = await insert<{ id: string }>('artifact', {
    org_id: orgId, run_id: runId, project_id: projectId,
    artifact_type: artifactKey, artifact_key: artifactKey, bundle_id: bundleId,
    file_object_id: fileObject.id, display_title: '30-Day Action Plan',
    display_section: 'apply', preview_type: 'none', order_index: 21, version: 1, review_status: 'pending',
  });

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'ARTIFACT_GENERATED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_actionplan',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: { artifact_id: artifact.id, artifact_key: artifactKey, file_name: fileName, byte_size: docxBuffer.length },
  });

  console.log(`[gen_actionplan] Action plan generated: ${fileName} (${docxBuffer.length} bytes)`);
  return { artifactKey, fileObjectId: fileObject.id, fileName, byteSize: docxBuffer.length };
}
