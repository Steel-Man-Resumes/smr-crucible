import type { EnrichmentProvider, EnrichmentTask, ProviderCtx, ProviderResult } from './types';

const RAPIDAPI_HOST = 'jsearch.p.rapidapi.com';

function getApiKey(): string {
  const key = process.env.JSEARCH_API_KEY;
  if (!key) throw new Error('JSEARCH_API_KEY is not set');
  return key;
}

async function jsearchFetch(endpoint: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`https://${RAPIDAPI_HOST}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      'X-RapidAPI-Key': getApiKey(),
      'X-RapidAPI-Host': RAPIDAPI_HOST,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`JSearch API error ${res.status}: ${text.substring(0, 200)}`);
  }

  return res.json();
}

export const jsearchProvider: EnrichmentProvider = {
  key: 'jsearch',
  capabilities: ['discover_jobs', 'discover_employers', 'market_salary'],

  async run(task: EnrichmentTask, _ctx: ProviderCtx): Promise<ProviderResult> {
    const start = Date.now();

    if (task.type === 'discover_jobs') {
      const { query, location, pages } = task.params;
      const results: unknown[] = [];
      let totalFound = 0;

      for (let page = 1; page <= pages; page++) {
        const raw: any = await jsearchFetch('search', {
          query: `${query} in ${location}`,
          page: String(page),
          num_pages: '1',
          date_posted: 'month',
        });

        totalFound = raw.data?.length ? Math.max(totalFound, page * 10) : totalFound;

        if (raw.data) {
          for (const job of raw.data) {
            results.push({
              title: job.job_title || '',
              company: job.employer_name || '',
              location: [job.job_city, job.job_state].filter(Boolean).join(', '),
              salary: formatSalary(job),
              url: job.job_apply_link || job.job_google_link || '',
              posted_date: job.job_posted_at_datetime_utc || null,
              description_summary: (job.job_description || '').substring(0, 300),
              relevance_score: job.job_is_remote ? 60 : 80,
              source: 'jsearch',
            });
          }
        }

        if (!raw.data || raw.data.length < 10) break;
      }

      return {
        data: { jobs: results, total_found: totalFound },
        provider: 'jsearch',
        latency_ms: Date.now() - start,
      };
    }

    if (task.type === 'discover_employers') {
      const { industry, location } = task.params;
      const raw: any = await jsearchFetch('search', {
        query: `${industry} jobs in ${location}`,
        page: '1',
        num_pages: '5',
        date_posted: 'month',
      });

      // Extract unique employers from job listings
      const employerMap = new Map<string, { name: string; location: string; job_count: number; jobs: any[] }>();
      if (raw.data) {
        for (const job of raw.data) {
          const name = job.employer_name || '';
          if (!name) continue;
          const existing = employerMap.get(name);
          if (existing) {
            existing.job_count++;
            existing.jobs.push(job);
          } else {
            employerMap.set(name, {
              name,
              location: [job.job_city, job.job_state].filter(Boolean).join(', '),
              job_count: 1,
              jobs: [job],
            });
          }
        }
      }

      const employers = Array.from(employerMap.values())
        .sort((a, b) => b.job_count - a.job_count);

      return {
        data: { employers },
        provider: 'jsearch',
        latency_ms: Date.now() - start,
      };
    }

    if (task.type === 'market_salary') {
      const { role, location } = task.params;
      const raw: any = await jsearchFetch('estimated-salary', {
        job_title: role,
        location,
        radius: '50',
      });

      const salaryData = raw.data?.[0] || {};

      return {
        data: {
          min_salary: salaryData.min_salary || 0,
          max_salary: salaryData.max_salary || 0,
          median_salary: salaryData.median_salary || 0,
          salary_period: salaryData.salary_period || 'YEAR',
          publisher_name: salaryData.publisher_name || 'jsearch',
        },
        provider: 'jsearch',
        latency_ms: Date.now() - start,
      };
    }

    throw new Error(`JSearch does not support task type: ${task.type}`);
  },
};

function formatSalary(job: any): string | null {
  if (job.job_min_salary && job.job_max_salary) {
    const period = job.job_salary_period === 'HOUR' ? '/hr' : '/yr';
    return `$${Math.round(job.job_min_salary)}-$${Math.round(job.job_max_salary)}${period}`;
  }
  return null;
}
