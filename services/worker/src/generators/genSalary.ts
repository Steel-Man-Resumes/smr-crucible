/**
 * gen_salary — Salary Negotiation Sheet (DOCX)
 *
 * Consumes: market.v1, signals.v1
 * Params: { lite?: boolean } — lite version if market confidence is low
 */
import { getRunData, uploadFile, insert, emitEvent, extractAndParseJSON } from '@crucible/core';
import type { MarketV1Type, SignalsV1Type } from '@crucible/core';
import Anthropic from '@anthropic-ai/sdk';
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, HeadingLevel,
} from 'docx';
import type { ArtifactJobData, GeneratorResult } from './types';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

function getAnthropic(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export async function generateSalaryNegotiation(job: ArtifactJobData): Promise<GeneratorResult> {
  const { runId, bundleId, orgId, projectId, artifactKey, params } = job;
  const isLite = params.lite === true;

  const signals = await getRunData<SignalsV1Type>(runId, 'signals.v1');
  let market: MarketV1Type | null = null;
  try { market = await getRunData<MarketV1Type>(runId, 'market.v1'); } catch { /* ok */ }

  const anthropic = getAnthropic();
  const salaryRange = market ? `$${market.salary_low.toLocaleString()}-$${market.salary_high.toLocaleString()}` : 'Unknown';
  const hourly = market?.hourly_equivalent;

  const prompt = isLite
    ? `You are a salary advisor. The candidate targets ${signals.target_roles.join(', ')} roles in ${signals.industry_primary}. Market data confidence is LOW — we don't have reliable salary numbers.

Generate a lite salary guidance sheet as JSON:
{
  "general_advice": "3-4 paragraphs of general salary discussion advice for ${signals.industry_primary} at ${signals.seniority_level} level",
  "research_sources": ["5-6 websites/tools they should use to research salary for their specific role and location"],
  "timing_tips": ["4-5 tips on when and how to bring up salary"],
  "total_comp_checklist": ["8-10 items beyond base pay to consider"],
  "red_flags": ["4-5 signs of a lowball offer"]
}
Return ONLY valid JSON.`
    : `You are a salary negotiation coach. Build a negotiation sheet for this candidate.

CANDIDATE:
- Industry: ${signals.industry_primary}
- Seniority: ${signals.seniority_level}
- Years experience: ${signals.years_experience}
- Target roles: ${signals.target_roles.join(', ')}
- Has barriers: ${signals.barriers_any ? 'Yes' : 'No'}

MARKET DATA (${market?.confidence || 'unknown'} confidence):
- Annual range: ${salaryRange}
- Midpoint: $${market?.salary_mid?.toLocaleString() || 'N/A'}
- Hourly: $${hourly?.low || '?'}-$${hourly?.high || '?'}/hr
- Sources: ${market?.sources.join(', ') || 'None'}
- Leverage points: ${market?.negotiation_leverage_points.join('; ') || 'None identified'}

Generate a salary negotiation sheet as JSON:
{
  "target_range": {
    "annual_low": ${market?.salary_low || 0},
    "annual_mid": ${market?.salary_mid || 0},
    "annual_high": ${market?.salary_high || 0},
    "hourly_low": ${hourly?.low || 0},
    "hourly_mid": ${hourly?.mid || 0},
    "hourly_high": ${hourly?.high || 0},
    "context": "1-2 sentences explaining what this range means for their market"
  },
  "scripts": [
    {
      "scenario": "Initial offer — they name a number first",
      "what_to_say": "Exact words to use",
      "what_NOT_to_say": "Common mistake to avoid"
    },
    {
      "scenario": "Counter-offer — you want more",
      "what_to_say": "Exact words",
      "what_NOT_to_say": "Common mistake"
    },
    {
      "scenario": "When to walk away",
      "what_to_say": "How to decline professionally while leaving the door open",
      "what_NOT_to_say": "What NOT to do when walking away"
    },
    {
      "scenario": "When they lowball you",
      "what_to_say": "Script for responding to a below-market offer without burning the bridge",
      "what_NOT_to_say": "What to avoid"
    }
  ],
  "total_comp_checklist": [
    {
      "item": "Health insurance",
      "why_it_matters": "Brief explanation",
      "dollar_value": "Approximate value to factor in"
    }
  ],
  "industry_context": "2-3 sentences about what's normal for ${signals.industry_primary} at ${signals.seniority_level} level in this market",
  "leverage_points": ["Things this candidate can use as leverage in negotiation"]
}

RULES:
- Scripts must be natural spoken language, not corporate.
- Numbers must come from the market data — don't invent salary figures.
- If candidate has barriers, address how this affects negotiation strategy honestly.

Return ONLY valid JSON.`;

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 5000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const data = extractAndParseJSON(text);

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'AI_CALL_COMPLETED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_salary',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: { provider: 'anthropic', model: CLAUDE_MODEL, lite: isLite },
  });

  // Build DOCX
  const GOLD = 'D4A84B'; const DARK = '1a1a1a'; const GRAY = '666666';
  const children: Paragraph[] = [];

  const sec = (t: string) => new Paragraph({
    heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 120 },
    border: { bottom: { color: GOLD, size: 10, style: BorderStyle.SINGLE, space: 4 } },
    children: [new TextRun({ text: t, bold: true, size: 28, font: 'Calibri', color: GOLD })],
  });

  children.push(new Paragraph({
    heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 300 },
    children: [new TextRun({ text: isLite ? 'SALARY GUIDANCE' : 'SALARY NEGOTIATION SHEET', bold: true, size: 44, font: 'Calibri', color: GOLD })],
  }));

  if (isLite) {
    // Lite version
    children.push(sec('GENERAL ADVICE'));
    for (const para of (data.general_advice || '').split(/\n\n+/)) {
      if (para.trim()) children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: para.trim(), size: 22, font: 'Calibri' })] }));
    }
    children.push(sec('RESEARCH THESE SOURCES'));
    for (const src of (data.research_sources || [])) {
      children.push(new Paragraph({ spacing: { after: 60 }, indent: { left: 360 }, children: [new TextRun({ text: `\u2022 ${src}`, size: 22, font: 'Calibri' })] }));
    }
    children.push(sec('TIMING TIPS'));
    for (const tip of (data.timing_tips || [])) {
      children.push(new Paragraph({ spacing: { after: 60 }, indent: { left: 360 }, children: [new TextRun({ text: `\u2022 ${tip}`, size: 22, font: 'Calibri' })] }));
    }
    children.push(sec('TOTAL COMPENSATION CHECKLIST'));
    for (const item of (data.total_comp_checklist || [])) {
      children.push(new Paragraph({ spacing: { after: 60 }, indent: { left: 360 }, children: [new TextRun({ text: `\u2610 ${item}`, size: 22, font: 'Calibri' })] }));
    }
    children.push(sec('RED FLAGS'));
    for (const flag of (data.red_flags || [])) {
      children.push(new Paragraph({ spacing: { after: 60 }, indent: { left: 360 }, children: [new TextRun({ text: `\u26A0 ${flag}`, size: 22, font: 'Calibri' })] }));
    }
  } else {
    // Full version
    if (data.target_range) {
      children.push(sec('YOUR TARGET SALARY RANGE'));
      const tr = data.target_range;
      children.push(new Paragraph({
        spacing: { after: 80 }, alignment: AlignmentType.CENTER,
        shading: { fill: 'FDF6E3' },
        border: { top: { color: GOLD, size: 8, style: BorderStyle.SINGLE, space: 2 }, bottom: { color: GOLD, size: 8, style: BorderStyle.SINGLE, space: 2 } },
        children: [new TextRun({
          text: `$${(tr.annual_low || 0).toLocaleString()} — $${(tr.annual_mid || 0).toLocaleString()} — $${(tr.annual_high || 0).toLocaleString()}`,
          bold: true, size: 28, font: 'Calibri', color: DARK,
        })],
      }));
      children.push(new Paragraph({
        spacing: { after: 80 }, alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text: `Hourly: $${tr.hourly_low || '?'}/hr — $${tr.hourly_mid || '?'}/hr — $${tr.hourly_high || '?'}/hr`,
          size: 22, font: 'Calibri', color: GRAY,
        })],
      }));
      if (tr.context) children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: tr.context, size: 22, font: 'Calibri' })] }));
    }

    // Scripts
    children.push(sec('NEGOTIATION SCRIPTS'));
    for (const script of (data.scripts || [])) {
      children.push(new Paragraph({ spacing: { before: 200, after: 40 }, shading: { fill: 'F5F5F5' },
        children: [new TextRun({ text: `SCENARIO: ${script.scenario}`, bold: true, size: 22, font: 'Calibri' })],
      }));
      children.push(new Paragraph({
        spacing: { after: 40 }, indent: { left: 360 },
        shading: { fill: 'FDF6E3' }, border: { left: { color: GOLD, size: 12, style: BorderStyle.SINGLE, space: 4 } },
        children: [
          new TextRun({ text: 'SAY: ', bold: true, size: 22, font: 'Calibri', color: GOLD }),
          new TextRun({ text: `"${script.what_to_say}"`, size: 22, font: 'Calibri', italics: true }),
        ],
      }));
      children.push(new Paragraph({
        spacing: { after: 80 }, indent: { left: 360 },
        children: [
          new TextRun({ text: 'AVOID: ', bold: true, size: 20, font: 'Calibri', color: 'CC0000' }),
          new TextRun({ text: script.what_NOT_to_say, size: 20, font: 'Calibri', color: GRAY }),
        ],
      }));
    }

    // Total comp
    children.push(sec('TOTAL COMPENSATION CHECKLIST'));
    for (const item of (data.total_comp_checklist || [])) {
      const label = typeof item === 'string' ? item : item.item;
      const detail = typeof item === 'string' ? '' : `${item.why_it_matters || ''} ${item.dollar_value ? `(~${item.dollar_value})` : ''}`;
      children.push(new Paragraph({ spacing: { after: 60 }, indent: { left: 360 }, children: [
        new TextRun({ text: `\u2610 ${label}`, bold: true, size: 22, font: 'Calibri' }),
        ...(detail ? [new TextRun({ text: ` — ${detail.trim()}`, size: 20, font: 'Calibri', color: GRAY })] : []),
      ] }));
    }

    // Industry context
    if (data.industry_context) {
      children.push(sec('INDUSTRY CONTEXT'));
      children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: data.industry_context, size: 22, font: 'Calibri' })] }));
    }

    // Leverage points
    if (data.leverage_points?.length) {
      children.push(sec('YOUR LEVERAGE'));
      for (const point of data.leverage_points) {
        children.push(new Paragraph({ spacing: { after: 60 }, indent: { left: 360 }, children: [new TextRun({ text: `\u2022 ${point}`, size: 22, font: 'Calibri' })] }));
      }
    }
  }

  const doc = new Document({ sections: [{ properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } }, children }] });
  const docxBuffer = Buffer.from(await Packer.toBuffer(doc));

  const fileName = isLite ? 'Salary_Guidance.docx' : 'Salary_Negotiation_Sheet.docx';
  const objectKey = `${orgId}/${projectId}/artifacts/${runId}/${fileName}`;
  const fileObject = await uploadFile(orgId, objectKey, docxBuffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  const artifact = await insert<{ id: string }>('artifact', {
    org_id: orgId, run_id: runId, project_id: projectId,
    artifact_type: artifactKey, artifact_key: artifactKey, bundle_id: bundleId,
    file_object_id: fileObject.id, display_title: isLite ? 'Salary Guidance' : 'Salary Negotiation Sheet',
    display_section: 'interview', preview_type: 'none', order_index: 31, version: 1, review_status: 'pending',
  });

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'ARTIFACT_GENERATED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_salary',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: { artifact_id: artifact.id, artifact_key: artifactKey, file_name: fileName, byte_size: docxBuffer.length, lite: isLite },
  });

  console.log(`[gen_salary] Salary sheet generated: ${fileName} (${docxBuffer.length} bytes, lite=${isLite})`);
  return { artifactKey, fileObjectId: fileObject.id, fileName, byteSize: docxBuffer.length };
}
