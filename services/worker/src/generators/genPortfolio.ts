/**
 * gen_portfolio — Standalone HTML Portfolio
 *
 * Consumes: profile.v1, signals.v1, portfolio_prefs.v1
 * Output: Single HTML file with all CSS inline — no external dependencies
 */
import { getRunData, uploadFile, insert, emitEvent, extractAndParseJSON } from '@crucible/core';
import type { ProfileV1Type, SignalsV1Type } from '@crucible/core';
import type { PortfolioPrefsV1 as PortfolioPrefsV1Type } from '@crucible/core';
import { DEFAULT_PORTFOLIO_PREFS } from '@crucible/core';
import Anthropic from '@anthropic-ai/sdk';
import type { ArtifactJobData, GeneratorResult } from './types';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

function getAnthropic(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Theme color palettes
const THEMES: Record<string, { bg: string; surface: string; text: string; textMuted: string; headerBg: string }> = {
  forge:     { bg: '#0f0f0f', surface: '#1a1a1a', text: '#f0f0f0', textMuted: '#999999', headerBg: '#111111' },
  executive: { bg: '#fafaf8', surface: '#ffffff', text: '#1a1a1a', textMuted: '#666666', headerBg: '#1a1a1a' },
  midnight:  { bg: '#0d1117', surface: '#161b22', text: '#c9d1d9', textMuted: '#8b949e', headerBg: '#0d1117' },
  steel:     { bg: '#f5f5f5', surface: '#ffffff', text: '#2d2d2d', textMuted: '#777777', headerBg: '#2d2d2d' },
  nature:    { bg: '#f9f7f2', surface: '#ffffff', text: '#2d3a2d', textMuted: '#6a7d6a', headerBg: '#2d3a2d' },
  ocean:     { bg: '#f0f5fa', surface: '#ffffff', text: '#1a3a5c', textMuted: '#5a7a9a', headerBg: '#1a3a5c' },
};

export async function generatePortfolio(job: ArtifactJobData): Promise<GeneratorResult> {
  const { runId, bundleId, orgId, projectId, artifactKey } = job;

  const profile = await getRunData<ProfileV1Type>(runId, 'profile.v1');
  const signals = await getRunData<SignalsV1Type>(runId, 'signals.v1');

  let prefs: PortfolioPrefsV1Type = DEFAULT_PORTFOLIO_PREFS;
  try {
    prefs = await getRunData<PortfolioPrefsV1Type>(runId, 'portfolio_prefs.v1');
  } catch {
    console.log('[gen_portfolio] No portfolio_prefs.v1 found, using defaults');
  }

  // Generate tagline and about section via Claude
  const anthropic = getAnthropic();
  const yearsExp = calculateYearsExperience(profile.work_history);

  const prompt = `Generate portfolio content for a career professional. Return JSON:
{
  "tagline": "A ${prefs.tagline_style} tagline (8-12 words). ${prefs.tagline_style === 'bold' ? 'Confident and punchy.' : prefs.tagline_style === 'friendly' ? 'Warm and approachable.' : 'Polished and traditional.'}",
  "about": "3-4 sentence professional bio for a portfolio website. ${yearsExp}+ years in ${signals.industry_primary}. Reference real roles: ${profile.work_history.slice(0, 2).map(w => w.title + ' at ' + w.company).join(', ')}."
}
Return ONLY valid JSON.`;

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const aiContent = extractAndParseJSON(text);

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'AI_CALL_COMPLETED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_portfolio',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: { provider: 'anthropic', model: CLAUDE_MODEL },
  });

  const theme = THEMES[prefs.theme] || THEMES.forge;
  const accent = prefs.accent_color || '#D4A84B';
  const sections = prefs.sections_enabled;

  const location = [profile.city, profile.state].filter(Boolean).join(', ');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Build sections HTML
  let sectionsHtml = '';

  if (sections.about) {
    sectionsHtml += `
    <section id="about">
      <h2>About</h2>
      <p>${esc(aiContent.about || `${yearsExp}+ years of experience in ${signals.industry_primary}.`)}</p>
    </section>`;
  }

  if (sections.skills) {
    const allSkills = [...signals.skills_technical.slice(0, 8), ...signals.skills_soft.slice(0, 4)];
    sectionsHtml += `
    <section id="skills">
      <h2>Skills</h2>
      <div class="skills-grid">
        ${allSkills.map(s => `<span class="skill-tag">${esc(s)}</span>`).join('\n        ')}
      </div>
    </section>`;
  }

  if (sections.experience) {
    const jobs = profile.work_history.slice(0, 5);
    sectionsHtml += `
    <section id="experience">
      <h2>Experience</h2>
      ${jobs.map(j => `
      <div class="job">
        <div class="job-header">
          <strong>${esc(j.title)}</strong>
          <span class="job-dates">${esc(j.raw_dates || [j.start_date, j.end_date].filter(Boolean).join(' - ') || '')}</span>
        </div>
        <div class="job-company">${esc(j.company)}${j.location ? ` — ${esc(j.location)}` : ''}</div>
        ${j.bullets.length > 0 ? `<ul>${j.bullets.slice(0, 4).map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      </div>`).join('')}
    </section>`;
  }

  if (sections.education && profile.education.length > 0) {
    sectionsHtml += `
    <section id="education">
      <h2>Education</h2>
      ${profile.education.map(e => `
      <div class="edu">
        <strong>${esc(e.credential)}${e.field ? `, ${esc(e.field)}` : ''}</strong>
        <div class="edu-detail">${esc(e.institution)}${e.year ? ` — ${esc(e.year)}` : ''}</div>
      </div>`).join('')}
    </section>`;
  }

  if (sections.certifications && profile.certifications.length > 0) {
    sectionsHtml += `
    <section id="certifications">
      <h2>Certifications</h2>
      <ul>
        ${profile.certifications.map(c => `<li>${esc(c)}</li>`).join('\n        ')}
      </ul>
    </section>`;
  }

  if (sections.contact) {
    const contactItems = [
      profile.email ? `<li>Email: ${esc(profile.email)}</li>` : '',
      profile.phone ? `<li>Phone: ${esc(profile.phone)}</li>` : '',
      location ? `<li>Location: ${esc(location)}</li>` : '',
    ].filter(Boolean);
    if (contactItems.length > 0) {
      sectionsHtml += `
    <section id="contact">
      <h2>Contact</h2>
      <ul>${contactItems.join('\n        ')}</ul>
    </section>`;
    }
  }

  const isDark = ['forge', 'midnight'].includes(prefs.theme);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(profile.full_name)} — Portfolio</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: ${theme.bg};
      color: ${theme.text};
      line-height: 1.6;
    }
    header {
      background: ${theme.headerBg};
      color: ${isDark ? theme.text : '#ffffff'};
      padding: 60px 20px;
      text-align: center;
    }
    header h1 {
      font-size: 2.5em;
      letter-spacing: 3px;
      margin-bottom: 10px;
    }
    header .tagline {
      font-size: 1.2em;
      color: ${accent};
      font-style: italic;
    }
    header .accent-bar {
      width: 80px;
      height: 4px;
      background: ${accent};
      margin: 20px auto 0;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    section {
      background: ${theme.surface};
      border-radius: 8px;
      padding: 30px;
      margin-bottom: 30px;
      ${isDark ? '' : 'box-shadow: 0 2px 8px rgba(0,0,0,0.06);'}
    }
    h2 {
      color: ${accent};
      font-size: 1.4em;
      margin-bottom: 15px;
      padding-bottom: 8px;
      border-bottom: 2px solid ${accent};
    }
    p { margin-bottom: 10px; color: ${theme.text}; }
    ul { padding-left: 20px; }
    li { margin-bottom: 6px; color: ${theme.text}; }
    .skills-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .skill-tag {
      background: ${accent}22;
      color: ${accent};
      border: 1px solid ${accent}44;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 0.9em;
      font-weight: 500;
    }
    .job { margin-bottom: 24px; }
    .job-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      flex-wrap: wrap;
    }
    .job-dates { color: ${theme.textMuted}; font-size: 0.9em; }
    .job-company { color: ${theme.textMuted}; margin-bottom: 8px; }
    .edu { margin-bottom: 12px; }
    .edu-detail { color: ${theme.textMuted}; font-size: 0.95em; }
    footer {
      text-align: center;
      padding: 30px;
      color: ${theme.textMuted};
      font-size: 0.85em;
    }
    @media (max-width: 600px) {
      header h1 { font-size: 1.8em; }
      section { padding: 20px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>${esc(profile.full_name.toUpperCase())}</h1>
    <p class="tagline">${esc(aiContent.tagline || `${yearsExp}+ Years in ${signals.industry_primary}`)}</p>
    <div class="accent-bar"></div>
  </header>
  <div class="container">
    ${sectionsHtml}
  </div>
  <footer>
    Generated by Steel Man Resumes &mdash; ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
  </footer>
</body>
</html>`;

  const htmlBuffer = Buffer.from(html, 'utf-8');
  const safeName = (profile.full_name || 'Candidate').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `${safeName}_Portfolio.html`;
  const objectKey = `${orgId}/${projectId}/artifacts/${runId}/${fileName}`;
  const fileObject = await uploadFile(orgId, objectKey, htmlBuffer, 'text/html');

  const artifact = await insert<{ id: string }>('artifact', {
    org_id: orgId, run_id: runId, project_id: projectId,
    artifact_type: artifactKey, artifact_key: artifactKey, bundle_id: bundleId,
    file_object_id: fileObject.id, display_title: 'Online Portfolio',
    display_section: 'online', preview_type: 'html', order_index: 50, version: 1, review_status: 'pending',
  });

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'ARTIFACT_GENERATED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_portfolio',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: { artifact_id: artifact.id, artifact_key: artifactKey, file_name: fileName, byte_size: htmlBuffer.length, theme: prefs.theme },
  });

  console.log(`[gen_portfolio] Portfolio generated: ${fileName} (${htmlBuffer.length} bytes, theme=${prefs.theme})`);
  return { artifactKey, fileObjectId: fileObject.id, fileName, byteSize: htmlBuffer.length };
}

function calculateYearsExperience(workHistory: Array<{ start_date: string | null }>): number {
  if (!workHistory || workHistory.length === 0) return 0;
  const earliest = workHistory[workHistory.length - 1];
  const startYear = parseInt(earliest?.start_date?.match(/\d{4}/)?.[0] || '0');
  if (startYear === 0) return 0;
  return Math.max(0, new Date().getFullYear() - startYear);
}
