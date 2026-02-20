/**
 * gen_alloy — Alloy Report (CONFIDENTIAL barrier support document)
 *
 * Consumes: signals.v1, resources.v1, profile.v1, employers_enriched.v1
 * Output: Alloy_Report_CONFIDENTIAL.docx
 * Conditional: Only generated when signals.barriers_any === true
 */
import { getRunData, uploadFile, insert, emitEvent, extractAndParseJSON } from '@crucible/core';
import type { SignalsV1Type, ProfileV1Type, EmployersV1Type } from '@crucible/core';
import type { ResourcesV1 as ResourcesV1Type } from '@crucible/core';
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

function buildAlloyPrompt(
  signals: SignalsV1Type,
  profile: ProfileV1Type,
  resources: ResourcesV1Type | null,
  employers: EmployersV1Type | null
): string {
  const location = [profile.city, profile.state].filter(Boolean).join(', ');
  const yearsExp = calculateYearsExperience(profile.work_history);
  const state = profile.state || 'Unknown';

  const activeBarriers = Object.entries(signals.barriers)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const barrierDescriptions = activeBarriers.map(b => {
    switch (b) {
      case 'criminal_record': return 'Criminal record / felony conviction';
      case 'employment_gap': return 'Employment gap (6+ months)';
      case 'addiction_recovery': return 'Addiction recovery';
      case 'housing': return 'Housing instability';
      case 'transportation': return 'Transportation challenges';
      case 'childcare': return 'Childcare needs';
      case 'other': return 'Other barrier';
      default: return b.replace(/_/g, ' ');
    }
  });

  const workSummary = profile.work_history.slice(0, 4).map(w =>
    `${w.title} at ${w.company} (${w.raw_dates || [w.start_date, w.end_date].filter(Boolean).join(' - ')})`
  ).join('\n');

  const secondChanceEmployers = employers?.tier1
    .filter(e => e.second_chance_friendly === true)
    .map(e => `${e.name} (${e.location})`)
    .join(', ') || 'None identified in Tier 1';

  const resourcesSummary = resources?.resources
    .map(r => `- ${r.name}: ${r.type}, ${r.address || 'address unknown'}, ${r.phone || 'phone unknown'}`)
    .join('\n') || 'No local resources data available';

  const resourcesByBarrier = resources?.grouped_by_barrier_type
    ? JSON.stringify(resources.grouped_by_barrier_type, null, 2)
    : '{}';

  return ALLOY_PROMPT_TEMPLATE
    .replace('{{CANDIDATE_NAME}}', profile.full_name)
    .replace('{{LOCATION}}', location || 'Unknown')
    .replace('{{STATE}}', state)
    .replace('{{YEARS_EXP}}', String(yearsExp))
    .replace('{{WORK_SUMMARY}}', workSummary)
    .replace('{{SKILLS}}', signals.skills_technical.slice(0, 8).join(', '))
    .replace('{{ACTIVE_BARRIERS}}', barrierDescriptions.join(', '))
    .replace('{{BARRIER_FLAGS_JSON}}', JSON.stringify(signals.barriers, null, 2))
    .replace('{{RISK_NOTES}}', signals.risk_notes.join('; ') || 'None')
    .replace('{{SECOND_CHANCE_EMPLOYERS}}', secondChanceEmployers)
    .replace('{{RESOURCES_SUMMARY}}', resourcesSummary)
    .replace('{{RESOURCES_BY_BARRIER}}', resourcesByBarrier)
    .replace('{{CERTIFICATIONS}}', profile.certifications.join(', ') || 'None');
}

export const ALLOY_PROMPT_TEMPLATE = `You are writing the Alloy Report — the most important document in this career package. This is the document that names a person's barriers, provides scripts for handling them, and lays out a concrete plan for the next 48 hours.

The person reading this has probably never seen their situation articulated clearly with a response strategy. This document is an intervention. It names the demon so the demon loses power. It gives them words for situations where they've always gone silent or stumbled.

CANDIDATE:
- Name: {{CANDIDATE_NAME}}
- Location: {{LOCATION}}
- State: {{STATE}} (IMPORTANT: use this for state-specific legal rights)
- Years of experience: {{YEARS_EXP}}
- Skills: {{SKILLS}}
- Certifications: {{CERTIFICATIONS}}
- Work history:
{{WORK_SUMMARY}}

BARRIERS DETECTED:
{{ACTIVE_BARRIERS}}

Barrier flags: {{BARRIER_FLAGS_JSON}}

Risk notes from analysis: {{RISK_NOTES}}

SECOND-CHANCE EMPLOYERS (from research):
{{SECOND_CHANCE_EMPLOYERS}}

LOCAL RESOURCES:
{{RESOURCES_SUMMARY}}

Resources grouped by barrier type:
{{RESOURCES_BY_BARRIER}}

VOICE:
- Direct, warm, no bullshit. Talk to them like a human who's been through hard things and come out the other side.
- NOT clinical, NOT pitying, NOT performatively optimistic. Real.
- "You have a record. So do millions of working Americans. Here's how you handle it."
- Scripts must be MEMORIZABLE — short, natural language, not corporate speak.
- Legal rights must reference ACTUAL laws for {{STATE}}, not generic "some states have ban-the-box."

Generate a JSON object with all 8 sections of the Alloy Report:

{
  "your_situation": {
    "opening": "2-3 paragraphs that acknowledge their specific barriers without judgment. Name them clearly. Be direct but kind. Example opening: 'You have a felony conviction from [timeframe] and a 3-year employment gap. Let's talk about how to handle both.' If you don't know exact dates, use what's in the work history gaps.",
    "barriers_named": [
      {
        "barrier": "criminal_record",
        "acknowledgment": "Direct statement about what this means for their job search. Not sugar-coated, not catastrophized.",
        "reframe": "How this barrier can actually be positioned as evidence of growth."
      }
    ]
  },

  "application_scripts": {
    "intro": "Brief intro about handling barrier questions on applications",
    "scenarios": [
      {
        "scenario": "Checkbox question: 'Have you been convicted of a felony?'",
        "what_to_do": "Check yes. Don't lie — it's worse to get caught later. But here's the key: most applications have a space for explanation.",
        "script": "I was convicted of [general category, not details] in [year]. Since then, I have [specific positive actions]. I have [X] years of consistent employment and [specific achievement] that demonstrates my reliability.",
        "why_it_works": "Employers aren't looking for saints. They're looking for liability reduction. This script gives them evidence you're not a risk."
      }
    ]
  },

  "interview_scripts": {
    "intro": "Brief intro about handling barriers in person",
    "scripts": [
      {
        "situation": "When they ask about the gap / record / etc.",
        "the_30_second_version": "The exact words to say. Short enough to memorize. Natural enough to not sound rehearsed. Uses STAR method implicitly without jargon.",
        "the_follow_up": "What to say if they probe further",
        "body_language_note": "Practical tip: eye contact, don't fidget, don't over-explain"
      }
    ]
  },

  "what_employers_think": {
    "intro": "Honest intel — not what employers SAY, what they THINK",
    "concerns": [
      {
        "concern": "The real concern (e.g., 'They worry you'll steal from them')",
        "reality": "The truth about this concern",
        "how_to_address": "What to do/say to neutralize it"
      }
    ]
  },

  "legal_rights": {
    "state": "{{STATE}}",
    "intro": "Your rights under {{STATE}} law and federal law",
    "laws": [
      {
        "law_name": "Actual law name (e.g., 'Mississippi Fair Employment Act' or 'Federal Fair Chance Act')",
        "what_it_means": "Plain-English explanation of what this law means for the candidate",
        "practical_impact": "How this actually helps them day-to-day. What employers can and cannot ask."
      }
    ],
    "what_they_cannot_ask": ["List of specific questions employers cannot legally ask in {{STATE}}"],
    "what_to_do_if_violated": "Plain-English steps if an employer asks illegal questions"
  },

  "second_chance_employers": {
    "intro": "These employers are known to hire people with backgrounds like yours",
    "employers": [
      {
        "name": "Company name",
        "location": "City, State",
        "why": "Why they're second-chance friendly (specific program, policy, or track record)",
        "how_to_apply": "Specific application instructions"
      }
    ]
  },

  "local_resources": {
    "intro": "These organizations in your area can help with the specific challenges you're facing",
    "resources": [
      {
        "name": "Organization name",
        "type": "re-entry program / housing assistance / etc.",
        "address": "Full address",
        "phone": "Phone number",
        "hours": "Operating hours if known",
        "eligibility": "Who qualifies",
        "what_to_bring": "What to bring to your first visit",
        "what_to_say": "Exact words to use when you call: 'Hi, my name is [name]. I'm looking for [specific service]. I was told you might be able to help. What do I need to do to get started?'"
      }
    ]
  },

  "the_48_hour_script": {
    "intro": "This is what you do in the next 48 hours. Not next week. Not when you feel ready. Now.",
    "steps": [
      {
        "time": "Hour 1-2",
        "action": "Specific action",
        "detail": "Exactly how to do it, including what to say if you need to call someone",
        "why": "Why this matters right now"
      }
    ]
  }
}

RULES:
1. Every script must be written in natural, spoken language. Not corporate. Not clinical. These are words a real person would actually say out loud.
2. Legal rights MUST be specific to {{STATE}}. Look up actual ban-the-box status, fair chance hiring laws, expungement eligibility. If {{STATE}} has no ban-the-box law, say so directly — don't pretend it does.
3. Resources must use REAL data from the resources provided. If a resource has an address and phone, include them. If data is missing, say "Call for current hours" rather than making something up.
4. The 48-hour script must be executable. Each step must have enough detail that the person can do it without any other reference.
5. Application and interview scripts must include multiple scenarios — don't just cover criminal record. Cover gaps, recovery, housing instability if those barriers are flagged.
6. Second-chance employers should include real companies from the employer research, not generic lists.
7. The word "journey" is BANNED. So is "navigate your path" and "we believe in second chances." Write like a human, not a nonprofit brochure.

Return ONLY valid JSON. No markdown, no explanation.`;

// ── DOCX Builder ───────────────────────────────────────────────

const GOLD = 'D4A84B';
const DARK = '1a1a1a';
const GRAY = '666666';
const RED = '8B0000';

interface AlloyContent {
  your_situation: {
    opening: string;
    barriers_named: Array<{ barrier: string; acknowledgment: string; reframe: string }>;
  };
  application_scripts: {
    intro: string;
    scenarios: Array<{ scenario: string; what_to_do: string; script: string; why_it_works: string }>;
  };
  interview_scripts: {
    intro: string;
    scripts: Array<{ situation: string; the_30_second_version: string; the_follow_up: string; body_language_note: string }>;
  };
  what_employers_think: {
    intro: string;
    concerns: Array<{ concern: string; reality: string; how_to_address: string }>;
  };
  legal_rights: {
    state: string;
    intro: string;
    laws: Array<{ law_name: string; what_it_means: string; practical_impact: string }>;
    what_they_cannot_ask: string[];
    what_to_do_if_violated: string;
  };
  second_chance_employers: {
    intro: string;
    employers: Array<{ name: string; location: string; why: string; how_to_apply: string }>;
  };
  local_resources: {
    intro: string;
    resources: Array<{
      name: string; type: string; address: string; phone: string;
      hours: string; eligibility: string; what_to_bring: string; what_to_say: string;
    }>;
  };
  the_48_hour_script: {
    intro: string;
    steps: Array<{ time: string; action: string; detail: string; why: string }>;
  };
}

function buildDocx(content: AlloyContent, candidateName: string): Promise<Buffer> {
  const children: Paragraph[] = [];

  // Confidential banner
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    shading: { fill: 'FFF3F3' },
    border: {
      top: { color: RED, size: 8, style: BorderStyle.SINGLE, space: 2 },
      bottom: { color: RED, size: 8, style: BorderStyle.SINGLE, space: 2 },
    },
    children: [new TextRun({ text: 'CONFIDENTIAL — FOR YOUR EYES ONLY', bold: true, size: 24, font: 'Calibri', color: RED })],
  }));

  // Title
  children.push(new Paragraph({
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { before: 300, after: 80 },
    children: [new TextRun({ text: 'ALLOY REPORT', bold: true, size: 52, font: 'Calibri', color: GOLD })],
  }));

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: [new TextRun({ text: 'Your Barriers. Your Strengths. Your Strategy.', size: 24, font: 'Calibri', color: GRAY, italics: true })],
  }));

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
    children: [new TextRun({ text: `Prepared for ${candidateName.toUpperCase()}`, size: 22, font: 'Calibri', color: GRAY })],
  }));

  // ── Section 1: Your Situation ──
  children.push(sectionHeading('1. YOUR SITUATION'));

  for (const para of content.your_situation.opening.split(/\n\n+/)) {
    if (!para.trim()) continue;
    children.push(bodyParagraph(para.trim()));
  }

  for (const barrier of content.your_situation.barriers_named) {
    children.push(new Paragraph({
      spacing: { before: 160, after: 40 },
      children: [new TextRun({ text: barrier.barrier.replace(/_/g, ' ').toUpperCase(), bold: true, size: 21, font: 'Calibri', color: GOLD })],
    }));
    children.push(bodyParagraph(barrier.acknowledgment));
    children.push(new Paragraph({
      spacing: { before: 40, after: 120 },
      indent: { left: 360 },
      children: [
        new TextRun({ text: 'The reframe: ', bold: true, size: 21, font: 'Calibri', italics: true }),
        new TextRun({ text: barrier.reframe, size: 21, font: 'Calibri', italics: true }),
      ],
    }));
  }

  // ── Section 2: Application Scripts ──
  children.push(sectionHeading('2. APPLICATION SCRIPTS'));
  children.push(bodyParagraph(content.application_scripts.intro));

  for (const scenario of content.application_scripts.scenarios) {
    children.push(new Paragraph({
      spacing: { before: 200, after: 60 },
      shading: { fill: 'F5F5F5' },
      children: [new TextRun({ text: `SCENARIO: ${scenario.scenario}`, bold: true, size: 21, font: 'Calibri' })],
    }));
    children.push(bodyParagraph(scenario.what_to_do));
    children.push(new Paragraph({
      spacing: { before: 80, after: 60 },
      indent: { left: 360 },
      shading: { fill: 'FDF6E3' },
      border: { left: { color: GOLD, size: 12, style: BorderStyle.SINGLE, space: 4 } },
      children: [
        new TextRun({ text: 'SAY: ', bold: true, size: 21, font: 'Calibri', color: GOLD }),
        new TextRun({ text: `"${scenario.script}"`, size: 21, font: 'Calibri', italics: true }),
      ],
    }));
    children.push(new Paragraph({
      spacing: { after: 120 },
      indent: { left: 360 },
      children: [
        new TextRun({ text: 'Why this works: ', bold: true, size: 20, font: 'Calibri', color: GRAY }),
        new TextRun({ text: scenario.why_it_works, size: 20, font: 'Calibri', color: GRAY }),
      ],
    }));
  }

  // ── Section 3: Interview Scripts ──
  children.push(sectionHeading('3. INTERVIEW SCRIPTS'));
  children.push(bodyParagraph(content.interview_scripts.intro));

  for (const script of content.interview_scripts.scripts) {
    children.push(new Paragraph({
      spacing: { before: 200, after: 60 },
      shading: { fill: 'F5F5F5' },
      children: [new TextRun({ text: `WHEN THEY ASK: ${script.situation}`, bold: true, size: 21, font: 'Calibri' })],
    }));

    children.push(new Paragraph({
      spacing: { before: 80, after: 60 },
      indent: { left: 360 },
      shading: { fill: 'FDF6E3' },
      border: { left: { color: GOLD, size: 12, style: BorderStyle.SINGLE, space: 4 } },
      children: [
        new TextRun({ text: 'THE 30-SECOND VERSION: ', bold: true, size: 21, font: 'Calibri', color: GOLD }),
        new TextRun({ text: `"${script.the_30_second_version}"`, size: 21, font: 'Calibri', italics: true }),
      ],
    }));

    children.push(new Paragraph({
      spacing: { after: 60 },
      indent: { left: 360 },
      children: [
        new TextRun({ text: 'If they probe further: ', bold: true, size: 20, font: 'Calibri' }),
        new TextRun({ text: `"${script.the_follow_up}"`, size: 20, font: 'Calibri', italics: true }),
      ],
    }));

    children.push(new Paragraph({
      spacing: { after: 120 },
      indent: { left: 360 },
      children: [
        new TextRun({ text: 'Body language: ', bold: true, size: 20, font: 'Calibri', color: GRAY }),
        new TextRun({ text: script.body_language_note, size: 20, font: 'Calibri', color: GRAY }),
      ],
    }));
  }

  // ── Section 4: What Employers Actually Think ──
  children.push(sectionHeading('4. WHAT EMPLOYERS ACTUALLY THINK'));
  children.push(bodyParagraph(content.what_employers_think.intro));

  for (const concern of content.what_employers_think.concerns) {
    children.push(new Paragraph({
      spacing: { before: 160, after: 40 },
      children: [
        new TextRun({ text: 'Their concern: ', bold: true, size: 21, font: 'Calibri' }),
        new TextRun({ text: `"${concern.concern}"`, size: 21, font: 'Calibri', italics: true }),
      ],
    }));
    children.push(new Paragraph({
      spacing: { after: 40 },
      indent: { left: 360 },
      children: [
        new TextRun({ text: 'Reality: ', bold: true, size: 21, font: 'Calibri', color: GRAY }),
        new TextRun({ text: concern.reality, size: 21, font: 'Calibri' }),
      ],
    }));
    children.push(new Paragraph({
      spacing: { after: 120 },
      indent: { left: 360 },
      children: [
        new TextRun({ text: 'Your move: ', bold: true, size: 21, font: 'Calibri', color: GOLD }),
        new TextRun({ text: concern.how_to_address, size: 21, font: 'Calibri' }),
      ],
    }));
  }

  // ── Section 5: Your Legal Rights ──
  children.push(sectionHeading(`5. YOUR LEGAL RIGHTS (${content.legal_rights.state})`));
  children.push(bodyParagraph(content.legal_rights.intro));

  for (const law of content.legal_rights.laws) {
    children.push(new Paragraph({
      spacing: { before: 160, after: 40 },
      children: [new TextRun({ text: law.law_name, bold: true, size: 21, font: 'Calibri', color: DARK })],
    }));
    children.push(bodyParagraph(law.what_it_means));
    children.push(new Paragraph({
      spacing: { after: 120 },
      indent: { left: 360 },
      children: [
        new TextRun({ text: 'What this means for you: ', bold: true, size: 20, font: 'Calibri', color: GOLD }),
        new TextRun({ text: law.practical_impact, size: 20, font: 'Calibri' }),
      ],
    }));
  }

  if (content.legal_rights.what_they_cannot_ask.length > 0) {
    children.push(new Paragraph({
      spacing: { before: 160, after: 60 },
      children: [new TextRun({ text: 'QUESTIONS EMPLOYERS CANNOT ASK:', bold: true, size: 21, font: 'Calibri', color: GOLD })],
    }));
    for (const q of content.legal_rights.what_they_cannot_ask) {
      children.push(bulletPoint(q));
    }
  }

  if (content.legal_rights.what_to_do_if_violated) {
    children.push(new Paragraph({
      spacing: { before: 160, after: 60 },
      shading: { fill: 'FFF3F3' },
      children: [
        new TextRun({ text: 'IF YOUR RIGHTS ARE VIOLATED: ', bold: true, size: 21, font: 'Calibri', color: RED }),
        new TextRun({ text: content.legal_rights.what_to_do_if_violated, size: 21, font: 'Calibri' }),
      ],
    }));
  }

  // ── Section 6: Second-Chance Employers ──
  children.push(sectionHeading('6. SECOND-CHANCE EMPLOYERS'));
  children.push(bodyParagraph(content.second_chance_employers.intro));

  for (const emp of content.second_chance_employers.employers) {
    children.push(new Paragraph({
      spacing: { before: 160, after: 40 },
      children: [
        new TextRun({ text: emp.name, bold: true, size: 22, font: 'Calibri', color: DARK }),
        new TextRun({ text: `  |  ${emp.location}`, size: 21, font: 'Calibri', color: GRAY }),
      ],
    }));
    children.push(new Paragraph({
      spacing: { after: 40 },
      indent: { left: 360 },
      children: [new TextRun({ text: emp.why, size: 21, font: 'Calibri' })],
    }));
    children.push(new Paragraph({
      spacing: { after: 120 },
      indent: { left: 360 },
      children: [
        new TextRun({ text: 'How to apply: ', bold: true, size: 21, font: 'Calibri' }),
        new TextRun({ text: emp.how_to_apply, size: 21, font: 'Calibri' }),
      ],
    }));
  }

  // ── Section 7: Local Resources ──
  children.push(sectionHeading('7. LOCAL RESOURCES'));
  children.push(bodyParagraph(content.local_resources.intro));

  for (const resource of content.local_resources.resources) {
    children.push(new Paragraph({
      spacing: { before: 200, after: 40 },
      shading: { fill: 'F8F8F8' },
      children: [
        new TextRun({ text: resource.name, bold: true, size: 22, font: 'Calibri', color: DARK }),
        new TextRun({ text: `  (${resource.type})`, size: 20, font: 'Calibri', color: GRAY }),
      ],
    }));

    const details: Array<[string, string]> = [];
    if (resource.address) details.push(['Address', resource.address]);
    if (resource.phone) details.push(['Phone', resource.phone]);
    if (resource.hours) details.push(['Hours', resource.hours]);
    if (resource.eligibility) details.push(['Eligibility', resource.eligibility]);
    if (resource.what_to_bring) details.push(['What to bring', resource.what_to_bring]);

    for (const [label, value] of details) {
      children.push(new Paragraph({
        spacing: { after: 30 },
        indent: { left: 360 },
        children: [
          new TextRun({ text: `${label}: `, bold: true, size: 20, font: 'Calibri' }),
          new TextRun({ text: value, size: 20, font: 'Calibri' }),
        ],
      }));
    }

    if (resource.what_to_say) {
      children.push(new Paragraph({
        spacing: { before: 60, after: 120 },
        indent: { left: 360 },
        shading: { fill: 'FDF6E3' },
        border: { left: { color: GOLD, size: 12, style: BorderStyle.SINGLE, space: 4 } },
        children: [
          new TextRun({ text: 'WHEN YOU CALL: ', bold: true, size: 20, font: 'Calibri', color: GOLD }),
          new TextRun({ text: `"${resource.what_to_say}"`, size: 20, font: 'Calibri', italics: true }),
        ],
      }));
    }
  }

  // ── Section 8: The 48-Hour Script ──
  children.push(sectionHeading('8. THE 48-HOUR SCRIPT'));
  children.push(bodyParagraph(content.the_48_hour_script.intro));

  for (let i = 0; i < content.the_48_hour_script.steps.length; i++) {
    const step = content.the_48_hour_script.steps[i];
    children.push(new Paragraph({
      spacing: { before: 200, after: 40 },
      shading: { fill: 'FDF6E3' },
      children: [
        new TextRun({ text: `${step.time}: `, bold: true, size: 22, font: 'Calibri', color: GOLD }),
        new TextRun({ text: step.action, bold: true, size: 22, font: 'Calibri', color: DARK }),
      ],
    }));
    children.push(bodyParagraph(step.detail));
    children.push(new Paragraph({
      spacing: { after: 120 },
      indent: { left: 360 },
      children: [
        new TextRun({ text: 'Why now: ', bold: true, size: 20, font: 'Calibri', color: GRAY }),
        new TextRun({ text: step.why, size: 20, font: 'Calibri', color: GRAY, italics: true }),
      ],
    }));
  }

  // Final note
  children.push(new Paragraph({
    spacing: { before: 400, after: 200 },
    border: {
      top: { color: GOLD, size: 8, style: BorderStyle.SINGLE, space: 4 },
      bottom: { color: GOLD, size: 8, style: BorderStyle.SINGLE, space: 4 },
    },
    shading: { fill: 'FDF6E3' },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: 'You have what it takes. This document is your playbook. Use it.',
      bold: true, size: 24, font: 'Calibri', color: DARK, italics: true,
    })],
  }));

  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: 'CONFIDENTIAL — ALLOY REPORT', size: 16, font: 'Calibri', color: RED })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({
              text: `CONFIDENTIAL — Prepared for ${candidateName} — Steel Man Resumes`,
              size: 16, font: 'Calibri', color: GRAY,
            })],
          })],
        }),
      },
      children,
    }],
  });

  return Packer.toBuffer(doc).then(b => Buffer.from(b));
}

// ── DOCX Helper Paragraphs ─────────────────────────────────────

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 500, after: 200 },
    border: { bottom: { color: GOLD, size: 12, style: BorderStyle.SINGLE, space: 4 } },
    children: [new TextRun({ text, bold: true, size: 30, font: 'Calibri', color: GOLD })],
  });
}

function bodyParagraph(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 140 },
    children: [new TextRun({ text, size: 22, font: 'Calibri' })],
  });
}

function bulletPoint(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    indent: { left: 360 },
    children: [new TextRun({ text: `\u2022 ${text}`, size: 21, font: 'Calibri' })],
  });
}

// ── Main Generator ─────────────────────────────────────────────

export async function generateAlloyReport(job: ArtifactJobData): Promise<GeneratorResult> {
  const { runId, bundleId, orgId, projectId, artifactKey } = job;

  // Read frozen data products
  const signals = await getRunData<SignalsV1Type>(runId, 'signals.v1');
  const profile = await getRunData<ProfileV1Type>(runId, 'profile.v1');

  // Conditional check — this should have been filtered by plan_package, but double-check
  if (!signals.barriers_any) {
    throw new Error('Alloy Report requires barriers_any === true, but no barriers detected');
  }

  // Resources may not exist if step was skipped
  let resources: ResourcesV1Type | null = null;
  try {
    resources = await getRunData<ResourcesV1Type>(runId, 'resources.v1');
  } catch {
    console.warn('[gen_alloy] resources.v1 not found, proceeding without local resources');
  }

  // Employers for second-chance friendly list
  let employers: EmployersV1Type | null = null;
  try {
    employers = await getRunData<EmployersV1Type>(runId, 'employers_enriched.v1');
  } catch {
    console.warn('[gen_alloy] employers_enriched.v1 not found, proceeding without employer data');
  }

  const anthropic = getAnthropic();
  const prompt = buildAlloyPrompt(signals, profile, resources, employers);

  console.log(`[gen_alloy] Calling Claude for Alloy Report (barriers: ${Object.entries(signals.barriers).filter(([,v]) => v).map(([k]) => k).join(', ')})...`);
  const startTime = Date.now();

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  });

  const latencyMs = Date.now() - startTime;
  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  console.log(`[gen_alloy] Claude responded in ${latencyMs}ms (${text.length} chars)`);

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'AI_CALL_COMPLETED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_alloy',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: {
      provider: 'anthropic', model: CLAUDE_MODEL, latency_ms: latencyMs,
      token_estimate: (message.usage?.input_tokens || 0) + (message.usage?.output_tokens || 0),
      barriers: Object.entries(signals.barriers).filter(([,v]) => v).map(([k]) => k),
    },
  });

  const content = extractAndParseJSON(text) as AlloyContent;

  // Validate critical sections exist
  if (!content.your_situation?.opening) {
    throw new Error('Alloy Report missing critical section: your_situation');
  }
  if (!content.application_scripts?.scenarios?.length) {
    throw new Error('Alloy Report missing critical section: application_scripts');
  }
  if (!content.the_48_hour_script?.steps?.length) {
    throw new Error('Alloy Report missing critical section: the_48_hour_script');
  }

  // Ensure defaults for optional sections
  content.interview_scripts = content.interview_scripts || { intro: '', scripts: [] };
  content.what_employers_think = content.what_employers_think || { intro: '', concerns: [] };
  content.legal_rights = content.legal_rights || {
    state: profile.state || 'Unknown', intro: '', laws: [],
    what_they_cannot_ask: [], what_to_do_if_violated: '',
  };
  content.second_chance_employers = content.second_chance_employers || { intro: '', employers: [] };
  content.local_resources = content.local_resources || { intro: '', resources: [] };

  // Build DOCX
  const docxBuffer = await buildDocx(content, profile.full_name);

  // Upload to R2
  const safeName = (profile.full_name || 'Candidate').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `${safeName}_Alloy_Report_CONFIDENTIAL.docx`;
  const objectKey = `${orgId}/${projectId}/artifacts/${runId}/${fileName}`;
  const fileObject = await uploadFile(
    orgId, objectKey, docxBuffer,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );

  const artifact = await insert<{ id: string }>('artifact', {
    org_id: orgId,
    run_id: runId,
    project_id: projectId,
    artifact_type: artifactKey,
    artifact_key: artifactKey,
    bundle_id: bundleId,
    file_object_id: fileObject.id,
    display_title: 'Alloy Report (Confidential)',
    display_section: 'barriers',
    preview_type: 'none',
    order_index: 40,
    version: 1,
    review_status: 'pending',
  });

  await emitEvent({
    org_id: orgId, project_id: projectId, run_id: runId, step_id: null,
    event_type: 'ARTIFACT_GENERATED', severity: 'info',
    actor_type: 'system', actor_user_id: null, actor_label: 'gen_alloy',
    data_classification: 'internal', retention_class: 'standard',
    correlation_id: null, parent_event_id: null, sensitive_ref: null,
    payload: {
      artifact_id: artifact.id, artifact_key: artifactKey,
      file_name: fileName, byte_size: docxBuffer.length,
      sections: 8,
      barriers_covered: Object.entries(signals.barriers).filter(([,v]) => v).map(([k]) => k),
    },
  });

  console.log(`[gen_alloy] Alloy Report generated: ${fileName} (${docxBuffer.length} bytes)`);

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
