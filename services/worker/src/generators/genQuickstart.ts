/**
 * gen_quickstart — Quick Start Guide (DOCX)
 *
 * Consumes: artifact_manifest.v1
 * AI-generated hour-by-hour guide referencing actual artifact names
 */
import { getRunData, uploadFile, insert, emitEvent, extractAndParseJSON } from '@crucible/core';
import type { ArtifactManifestV1 as ArtifactManifestV1Type } from '@crucible/core';
import Anthropic from '@anthropic-ai/sdk';
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, HeadingLevel,
} from 'docx';
import type { ArtifactJobData, GeneratorResult } from './types';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

function getAnthropic(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export async function generateQuickstart(job: ArtifactJobData): Promise<GeneratorResult> {
  const { runId, bundleId, orgId, projectId, artifactKey } = job;

  let manifest: ArtifactManifestV1Type | null = null;
  try { manifest = await getRunData<ArtifactManifestV1Type>(runId, 'artifact_manifest.v1'); } catch { /* ok */ }

  const artifactNames = (manifest?.sections || [])
    .flatMap(s => (s.artifacts || []).map(a => a.display_title))
    .filter(Boolean);

  const anthropic = getAnthropic();

  const prompt = `Generate a Quick Start Guide as JSON. This tells someone what to do in their first 48 hours after receiving their career package.

ARTIFACTS IN PACKAGE:
${artifactNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}

Generate JSON:
{
  "steps": [
    {
      "time": "Hour 1",
      "title": "Review Your Resume",
      "instructions": "Open your Resume document. Read it twice. Make sure all information is accurate. If anything needs correction, note it for your coach.",
      "artifact_ref": "Resume"
    },
    {
      "time": "Hour 2",
      "title": "Read Your Battle Plan",
      "instructions": "Open Target_Employers_BattlePlan.docx. Read the Tier 1 section carefully. These are your top 10 targets.",
      "artifact_ref": "Target Employers — Battle Plan"
    }
  ]
}

RULES:
- Reference ACTUAL artifact names from the list above.
- 8-12 steps covering hours 1-48.
- Each step must be concrete — "Open [document name]" not "Review your materials."
- First 4 hours: review documents (resume, cover letters, battle plan).
- Hours 4-8: Begin applications to top employers.
- Hours 8-24: Follow-up calls, resource visits if applicable.
- Hours 24-48: Expand to Tier 2, refine strategy.
- Keep instructions under 3 sentences each.

Return ONLY valid JSON.`;

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const guide = extractAndParseJSON(text);

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'AI_CALL_COMPLETED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_quickstart',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: { provider: 'anthropic', model: CLAUDE_MODEL },
  });

  // Build DOCX
  const GOLD = 'D4A84B'; const DARK = '1a1a1a'; const GRAY = '666666';
  const children: Paragraph[] = [];

  children.push(new Paragraph({
    heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 80 },
    children: [new TextRun({ text: 'QUICK START GUIDE', bold: true, size: 44, font: 'Calibri', color: GOLD })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 300 },
    children: [new TextRun({ text: 'Your first 48 hours start now.', size: 24, font: 'Calibri', color: GRAY, italics: true })],
  }));

  for (const step of (guide.steps || [])) {
    children.push(new Paragraph({
      spacing: { before: 240, after: 40 },
      shading: { fill: 'FDF6E3' },
      children: [
        new TextRun({ text: `${step.time}: `, bold: true, size: 24, font: 'Calibri', color: GOLD }),
        new TextRun({ text: step.title, bold: true, size: 24, font: 'Calibri', color: DARK }),
      ],
    }));
    children.push(new Paragraph({
      spacing: { after: 60 }, indent: { left: 360 },
      children: [new TextRun({ text: step.instructions, size: 22, font: 'Calibri' })],
    }));
    if (step.artifact_ref) {
      children.push(new Paragraph({
        spacing: { after: 80 }, indent: { left: 360 },
        children: [new TextRun({ text: `Document: ${step.artifact_ref}`, size: 20, font: 'Calibri', color: GRAY, italics: true })],
      }));
    }
  }

  const doc = new Document({ sections: [{ properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } }, children }] });
  const docxBuffer = Buffer.from(await Packer.toBuffer(doc));

  const fileName = 'Quick_Start_Guide.docx';
  const objectKey = `${orgId}/${projectId}/artifacts/${runId}/${fileName}`;
  const fileObject = await uploadFile(orgId, objectKey, docxBuffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  const artifact = await insert<{ id: string }>('artifact', {
    org_id: orgId, run_id: runId, project_id: projectId,
    artifact_type: artifactKey, artifact_key: artifactKey, bundle_id: bundleId,
    file_object_id: fileObject.id, display_title: 'Quick Start Guide',
    display_section: 'start_here', preview_type: 'none', order_index: 1, version: 1, review_status: 'pending',
  });

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'ARTIFACT_GENERATED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_quickstart',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: { artifact_id: artifact.id, artifact_key: artifactKey, file_name: fileName, byte_size: docxBuffer.length },
  });

  console.log(`[gen_quickstart] Quick start guide generated: ${fileName} (${docxBuffer.length} bytes)`);
  return { artifactKey, fileObjectId: fileObject.id, fileName, byteSize: docxBuffer.length };
}
