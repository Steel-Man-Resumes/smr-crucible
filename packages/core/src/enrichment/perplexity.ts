import type { EnrichmentProvider, EnrichmentTask, ProviderCtx, ProviderResult } from './types';
import { extractAndParseJSON } from '../jsonParser';

function getApiKey(): string {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) throw new Error('PERPLEXITY_API_KEY is not set');
  return key;
}

const PERPLEXITY_MODEL = 'sonar';

async function perplexityChat(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: PERPLEXITY_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Perplexity API error ${res.status}: ${text.substring(0, 200)}`);
  }

  const json: any = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

export const perplexityProvider: EnrichmentProvider = {
  key: 'perplexity',
  capabilities: ['enrich_employer_contacts', 'market_salary', 'local_resources', 'discover_employers'],

  async run(task: EnrichmentTask, _ctx: ProviderCtx): Promise<ProviderResult> {
    const start = Date.now();

    if (task.type === 'enrich_employer_contacts') {
      const { employers } = task.params;
      const enriched: any[] = [];

      // Batch employers in groups of 5 to reduce API calls
      for (let i = 0; i < employers.length; i += 5) {
        const batch = employers.slice(i, i + 5);
        const prompt = `For each of these companies, provide current factual information. Return JSON array.

Companies:
${batch.map((e, idx) => `${idx + 1}. ${e.name} in ${e.location}`).join('\n')}

For each company return:
{
  "name": "company name",
  "address": "full street address or null",
  "phone": "main phone or null",
  "website": "company website or null",
  "contact_name": "hiring manager or HR contact name if findable, or null",
  "company_intel": "1-2 sentences about the company's current situation, culture, or recent news",
  "second_chance_friendly": true/false/null (true if they're known to hire people with records),
  "approach_strategy": "Best way to approach this employer (walk-in, online application, staffing agency, etc.)"
}

Return ONLY a JSON array. No explanations.`;

        const content = await perplexityChat(
          'You are a job search research assistant. Return only valid JSON. Be factual and concise.',
          prompt
        );

        try {
          const parsed = extractAndParseJSON(content);
          const items = Array.isArray(parsed) ? parsed : [parsed];
          enriched.push(...items);
        } catch (err: any) {
          console.warn(`Perplexity contact enrichment batch failed: ${err.message}`);
          // Push nulls for failed batch
          batch.forEach(e => enriched.push({ name: e.name, address: null, phone: null, website: null, contact_name: null, company_intel: '', second_chance_friendly: null, approach_strategy: 'Apply online' }));
        }
      }

      return {
        data: { enriched_employers: enriched },
        provider: 'perplexity',
        latency_ms: Date.now() - start,
      };
    }

    if (task.type === 'market_salary') {
      const { role, location } = task.params;
      const prompt = `What is the current salary range for "${role}" positions in ${location}?

Return JSON:
{
  "salary_low": annual_number,
  "salary_mid": annual_number,
  "salary_high": annual_number,
  "hourly_low": hourly_number,
  "hourly_mid": hourly_number,
  "hourly_high": hourly_number,
  "confidence": "low" or "medium" or "high",
  "sources": ["source names"],
  "negotiation_leverage_points": ["specific leverage points for this role/location"]
}

Return ONLY valid JSON.`;

      const content = await perplexityChat(
        'You are a compensation research specialist. Return only valid JSON with realistic market data.',
        prompt
      );
      const data = extractAndParseJSON(content);

      return { data, provider: 'perplexity', latency_ms: Date.now() - start };
    }

    if (task.type === 'local_resources') {
      const { location, barrier_types } = task.params;
      const prompt = `Find local support resources in ${location} for someone facing these challenges: ${barrier_types.join(', ')}.

For each resource return:
{
  "name": "organization name",
  "type": "type of service",
  "address": "full address or null",
  "phone": "phone number or null",
  "website": "website or null",
  "hours": "operating hours or null",
  "eligibility": "who can use this service",
  "what_to_bring": "what to bring to first visit or null",
  "what_to_say_when_you_call": "suggested script for initial call or null"
}

Find 5-10 real, currently operating organizations. Return ONLY a JSON array.`;

      const content = await perplexityChat(
        'You are a social services research specialist. Return only valid JSON. Only include real, verifiable organizations.',
        prompt
      );

      let resources: unknown[];
      try {
        const parsed = extractAndParseJSON(content);
        resources = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        resources = [];
      }

      // Group by barrier type
      const grouped: Record<string, string[]> = {};
      barrier_types.forEach(bt => {
        grouped[bt] = resources.map((r: any) => r.name || '').filter(Boolean);
      });

      return {
        data: { resources, grouped_by_barrier_type: grouped, location_searched: location },
        provider: 'perplexity',
        latency_ms: Date.now() - start,
      };
    }

    if (task.type === 'discover_employers') {
      const { industry, location, second_chance } = task.params;
      const scNote = second_chance ? ' Focus on employers known to be second-chance friendly or willing to hire people with criminal records.' : '';
      const prompt = `List 20 employers in the ${industry} industry near ${location} that are currently hiring.${scNote}

For each return:
{
  "name": "company name",
  "industry": "${industry}",
  "location": "city, state",
  "website": "company website or null",
  "second_chance_friendly": true/false/null,
  "why_good_fit": "brief reason this is a good employer to target"
}

Return ONLY a JSON array.`;

      const content = await perplexityChat(
        'You are an employment research specialist. Return only valid JSON.',
        prompt
      );

      let employers: unknown[];
      try {
        const parsed = extractAndParseJSON(content);
        employers = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        employers = [];
      }

      return {
        data: { employers },
        provider: 'perplexity',
        latency_ms: Date.now() - start,
      };
    }

    throw new Error(`Perplexity does not support task type: ${task.type}`);
  },
};
