/**
 * gen_resume — Resume DOCX artifact generator
 *
 * Refactored from careerIntakeV1's generate step to read from run_data.
 * Consumes: profile.v1, signals.v1, employers_enriched.v1
 * Output: DOCX with branded formatting, proper heading styles
 */
import { getRunData, uploadFile, insert, emitEvent } from '@crucible/core';
import { parseAIJson } from './repairJson';
import type { ProfileV1Type, SignalsV1Type, EmployersV1Type } from '@crucible/core';
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

// ── AI Content Generation ──────────────────────────────────────

async function generateResumeContent(
  profile: ProfileV1Type,
  signals: SignalsV1Type,
  anthropic: Anthropic,
): Promise<{ brandedHeadline: string; summary: string }> {
  const yearsExp = calculateYearsExperience(profile.work_history);
  const currentRole = profile.work_history[0]?.title || 'Professional';
  const allBullets = profile.work_history.flatMap(j => j.bullets || []).slice(0, 10);
  const isEntryLevel = signals.seniority_level === 'entry';

  const prompt = `You are a TORI Award-winning resume writer. Generate a branded headline and professional summary for this candidate.

CANDIDATE:
- Name: ${profile.full_name}
- Current/Most Recent Role: ${currentRole}
- Years Experience: ${yearsExp}+
- Seniority: ${signals.seniority_level}
- Industry: ${signals.industry_primary}
- Target Roles: ${signals.target_roles.join(', ')}
- Key Technical Skills: ${signals.skills_technical.slice(0, 8).join(', ')}
- ATS Score: ${signals.ats_score}/100

KEY ACHIEVEMENTS:
${allBullets.map(b => '- ' + b).join('\n')}

WORK HISTORY:
${profile.work_history.slice(0, 4).map(w => `${w.title} at ${w.company}`).join(', ')}

Generate JSON:
{
  "brandedHeadline": "A powerful 5-10 word headline that goes under their name on the resume. Must be specific to THIS person — reference their industry, years, or signature strength. NOT generic like 'Results-Driven Professional'.",
  "summary": "${isEntryLevel ? '2-3 sentence' : '3-4 sentence'} professional summary. Lead with years of experience and strongest qualification. Reference specific skills and achievements. FORBIDDEN PHRASES: 'results-driven', 'detail-oriented', 'team player', 'proven track record', 'seeking opportunity', 'passionate about'."
}

Return ONLY valid JSON.`;

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const parsed = await parseAIJson(text);

  return {
    brandedHeadline: parsed.brandedHeadline || `${yearsExp}+ Years Building Operations Excellence`,
    summary: parsed.summary || `Experienced ${signals.industry_primary} professional with ${yearsExp}+ years of progressive experience.`,
  };
}

// ── DOCX Builder ───────────────────────────────────────────────

const GOLD = 'D4A84B';
const DARK = '1a1a1a';
const GRAY = '666666';
const LIGHT_GOLD_BG = 'FDF6E3';

function buildDocx(
  profile: ProfileV1Type,
  signals: SignalsV1Type,
  content: { brandedHeadline: string; summary: string },
): Promise<Buffer> {
  const children: Paragraph[] = [];
  const yearsExp = calculateYearsExperience(profile.work_history);
  const isEntryLevel = signals.seniority_level === 'entry';

  // Name
  children.push(new Paragraph({
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({
      text: (profile.full_name || 'CANDIDATE').toUpperCase(),
      bold: true, size: 44, font: 'Calibri', color: DARK,
    })],
  }));

  // Branded Headline
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 140 },
    children: [new TextRun({
      text: content.brandedHeadline,
      bold: true, size: 26, font: 'Calibri', color: GOLD, italics: true,
    })],
  }));

  // Metrics Bar
  const metrics = extractTopMetrics(profile, yearsExp, signals);
  if (metrics.length > 0) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 60, after: 140 },
      shading: { fill: LIGHT_GOLD_BG },
      border: {
        top: { color: GOLD, size: 8, style: BorderStyle.SINGLE, space: 1 },
        bottom: { color: GOLD, size: 8, style: BorderStyle.SINGLE, space: 1 },
      },
      children: [new TextRun({
        text: '  ' + metrics.join('   |   ') + '  ',
        bold: true, size: 22, font: 'Calibri', color: DARK,
      })],
    }));
  }

  // Contact Info
  const contactParts = [
    profile.phone, profile.email,
    [profile.city, profile.state].filter(Boolean).join(', '),
  ].filter(Boolean);

  if (contactParts.length > 0) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [new TextRun({ text: contactParts.join('  |  '), size: 20, font: 'Calibri', color: GRAY })],
    }));
  }

  // Professional Summary
  children.push(sectionHeader('PROFESSIONAL SUMMARY'));
  children.push(new Paragraph({
    spacing: { after: 280 },
    children: [new TextRun({ text: content.summary, size: 22, font: 'Calibri' })],
  }));

  // Core Competencies
  const skillGroups = buildSkillGroups(signals.skills_technical, signals.skills_soft);
  if (skillGroups.length > 0) {
    children.push(sectionHeader('CORE COMPETENCIES'));
    for (const group of skillGroups) {
      children.push(new Paragraph({
        spacing: { after: 100 },
        children: [
          new TextRun({ text: `${group.category}: `, bold: true, size: 21, font: 'Calibri', color: DARK }),
          new TextRun({ text: group.skills.join('  |  '), size: 21, font: 'Calibri' }),
        ],
      }));
    }
    children.push(new Paragraph({ spacing: { after: 120 } }));
  }

  // Professional Experience
  children.push(sectionHeader('PROFESSIONAL EXPERIENCE'));
  const maxJobs = isEntryLevel ? 3 : 5;
  const maxBullets = isEntryLevel ? 3 : 5;

  for (let idx = 0; idx < Math.min(profile.work_history.length, maxJobs); idx++) {
    const job = profile.work_history[idx];

    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: idx > 0 ? 280 : 140, after: 60 },
      children: [new TextRun({ text: (job.title || '').toUpperCase(), bold: true, size: 24, font: 'Calibri', color: DARK })],
    }));

    const companyLine = [job.company, job.location, job.raw_dates || [job.start_date, job.end_date].filter(Boolean).join(' - ')].filter(Boolean).join('  |  ');
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: companyLine, size: 21, font: 'Calibri', italics: true, color: GRAY })],
    }));

    const bullets = condenseBullets(job.bullets || [], maxBullets);
    for (const bullet of bullets) {
      children.push(createBulletParagraph(bullet));
    }
  }

  // Certifications
  if (profile.certifications.length > 0) {
    children.push(sectionHeader('CERTIFICATIONS & CREDENTIALS'));
    children.push(new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: profile.certifications.join('  |  '), size: 21, font: 'Calibri' })],
    }));
  }

  // Education
  if (profile.education.length > 0) {
    children.push(sectionHeader('EDUCATION'));
    for (const edu of profile.education) {
      const eduLine = [
        edu.credential + (edu.field ? `, ${edu.field}` : ''),
        edu.institution, edu.year,
      ].filter(Boolean).join('  |  ');
      children.push(new Paragraph({
        spacing: { after: 100 },
        children: [new TextRun({ text: eduLine, size: 21, font: 'Calibri' })],
      }));
    }
  }

  // Military
  if (profile.military?.branch) {
    children.push(sectionHeader('MILITARY SERVICE'));
    const milLine = [
      profile.military.branch,
      profile.military.rank,
      profile.military.mos,
      profile.military.years,
      profile.military.discharge,
    ].filter(Boolean).join('  |  ');
    children.push(new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({ text: milLine, size: 21, font: 'Calibri' })],
    }));
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 576, right: 720, bottom: 576, left: 720 } },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: 'STEEL MAN RESUMES', size: 14, font: 'Calibri', color: GRAY })],
          })],
        }),
      },
      children,
    }],
  });

  return Packer.toBuffer(doc).then(b => Buffer.from(b));
}

function sectionHeader(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 300, after: 140 },
    border: { bottom: { color: GOLD, size: 12, style: BorderStyle.SINGLE, space: 2 } },
    children: [new TextRun({ text, bold: true, size: 26, font: 'Calibri', color: GOLD })],
  });
}

function createBulletParagraph(text: string): Paragraph {
  const parts = text.split(/(\d+[%$,.\d]*[KMB]?|\$[\d,.]+ ?[KMB]?)/gi);
  const textRuns: TextRun[] = [new TextRun({ text: '\u2022 ', size: 21, font: 'Calibri' })];
  for (const part of parts) {
    if (part && /\d/.test(part)) {
      textRuns.push(new TextRun({ text: part, bold: true, size: 21, font: 'Calibri' }));
    } else if (part) {
      textRuns.push(new TextRun({ text: part, size: 21, font: 'Calibri' }));
    }
  }
  return new Paragraph({ spacing: { after: 80 }, indent: { left: 360 }, children: textRuns });
}

// ── Main Generator ─────────────────────────────────────────────

export async function generateResume(job: ArtifactJobData): Promise<GeneratorResult> {
  const { runId, bundleId, orgId, projectId, artifactKey } = job;

  const profile = await getRunData<ProfileV1Type>(runId, 'profile.v1');
  const signals = await getRunData<SignalsV1Type>(runId, 'signals.v1');

  const anthropic = getAnthropic();
  const content = await generateResumeContent(profile, signals, anthropic);

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'AI_CALL_COMPLETED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_resume',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: { provider: 'anthropic', model: CLAUDE_MODEL, purpose: 'resume_content' },
  });

  const docxBuffer = await buildDocx(profile, signals, content);

  const safeName = (profile.full_name || 'Candidate').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `${safeName}_Resume.docx`;
  const objectKey = `${orgId}/${projectId}/artifacts/${runId}/${fileName}`;
  const fileObject = await uploadFile(orgId, objectKey, docxBuffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  const artifact = await insert<{ id: string }>('artifact', {
    org_id: orgId, run_id: runId, project_id: projectId,
    artifact_type: artifactKey, artifact_key: artifactKey, bundle_id: bundleId,
    file_object_id: fileObject.id, display_title: 'Resume',
    display_section: 'apply', preview_type: 'none', order_index: 10,
    version: 1, review_status: 'pending',
  });

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'ARTIFACT_GENERATED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_resume',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: { artifact_id: artifact.id, artifact_key: artifactKey, file_name: fileName, byte_size: docxBuffer.length },
  });

  console.log(`[gen_resume] Resume generated: ${fileName} (${docxBuffer.length} bytes)`);
  return { artifactKey, fileObjectId: fileObject.id, fileName, byteSize: docxBuffer.length };
}

// ── Utilities ──────────────────────────────────────────────────

function calculateYearsExperience(workHistory: Array<{ start_date: string | null }>): number {
  if (!workHistory || workHistory.length === 0) return 0;
  const earliest = workHistory[workHistory.length - 1];
  const startYear = parseInt(earliest?.start_date?.match(/\d{4}/)?.[0] || '0');
  if (startYear === 0) return 0;
  return Math.max(0, new Date().getFullYear() - startYear);
}

function extractTopMetrics(profile: ProfileV1Type, yearsExp: number, signals: SignalsV1Type): string[] {
  const metrics: string[] = [];
  const allBullets = profile.work_history.flatMap(j => j.bullets || []);
  const bulletText = allBullets.join(' ');

  const percentMatch = bulletText.match(/(\d+)%\s*(?:reduction|increase|improvement|growth|accuracy|on-time|efficiency|decrease)/i);
  if (percentMatch) metrics.push(`${percentMatch[1]}% ${percentMatch[0].split('%')[1].trim()}`);

  const dollarMatch = bulletText.match(/\$[\d,.]+[KMB]?/i);
  if (dollarMatch) metrics.push(`${dollarMatch[0]} Accountability`);

  const teamMatch = bulletText.match(/(\d+)[\s-]*(?:person|member|employee|staff|direct report|team)/i);
  if (teamMatch) metrics.push(`${teamMatch[1]}-Person Team`);

  if (yearsExp > 0 && metrics.length < 4) metrics.push(`${yearsExp}+ Years Experience`);
  if (profile.certifications.length > 0 && metrics.length < 4) {
    metrics.push(`${profile.certifications.length} Certification${profile.certifications.length > 1 ? 's' : ''}`);
  }

  return metrics.slice(0, 4);
}

function condenseBullets(bullets: string[], maxCount: number): string[] {
  if (bullets.length <= maxCount) return bullets;
  const scored = bullets.map(bullet => {
    let score = 0;
    if (/\d+%|\$[\d,]+|\d+\+/i.test(bullet)) score += 3;
    if (/advanced|promoted|earned|selected|chosen/i.test(bullet)) score += 3;
    if (/led|managed|supervised|trained|coordinated/i.test(bullet)) score += 2;
    if (/^(assist|help|support)\s/i.test(bullet) && bullet.length < 50) score -= 2;
    return { bullet, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxCount).map(s => s.bullet);
}

function buildSkillGroups(technical: string[], soft: string[]): { category: string; skills: string[] }[] {
  const categories: Record<string, string[]> = {
    'Leadership & Management': [],
    'Operations & Technical': [],
    'Safety & Compliance': [],
    'Tools & Systems': [],
  };
  const leadershipKW = ['team', 'lead', 'manage', 'train', 'supervis', 'mentor', 'coordinat'];
  const safetyKW = ['osha', 'safety', 'compliance', 'regulat', 'hazard'];
  const toolsKW = ['software', 'system', 'wms', 'erp', 'excel', 'computer', 'sap'];

  for (const skill of [...technical, ...soft]) {
    const lower = skill.toLowerCase();
    if (leadershipKW.some(k => lower.includes(k))) categories['Leadership & Management'].push(skill);
    else if (safetyKW.some(k => lower.includes(k))) categories['Safety & Compliance'].push(skill);
    else if (toolsKW.some(k => lower.includes(k))) categories['Tools & Systems'].push(skill);
    else categories['Operations & Technical'].push(skill);
  }

  return Object.entries(categories)
    .filter(([, skills]) => skills.length > 0)
    .map(([category, skills]) => ({ category, skills: skills.slice(0, 6) }));
}
