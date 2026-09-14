// Read-only AI cost probe. Feeds the pricing model's cost floor.
//   node scripts/cost-probe.mjs
// Source of truth: ai_token_usage (exact provider token counts + computed cost).
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../apps/consumer/.env.local', import.meta.url), 'utf8');
const sql = neon(env.match(/^DATABASE_URL=["']?([^"'\n]+)/m)[1]);

const usd = (n) => '$' + Number(n ?? 0).toFixed(4);
const int = (n) => Number(n ?? 0).toLocaleString();

const span = (await sql`
  select min(created_at) as first, max(created_at) as last,
         count(*)::int as calls, coalesce(sum(cost_usd),0) as total,
         count(distinct user_id)::int as users
  from ai_token_usage`)[0];

console.log('\n=== METER SPAN ===');
console.log('first call   ', span.first);
console.log('last call    ', span.last);
console.log('total calls  ', int(span.calls));
console.log('distinct users', int(span.users));
console.log('total spend  ', usd(span.total));

console.log('\n=== BY ENDPOINT ===');
const byEndpoint = await sql`
  select endpoint, model,
         count(*)::int as calls,
         round(avg(input_tokens))::int as avg_in,
         round(avg(output_tokens))::int as avg_out,
         round(avg(cache_read_input_tokens))::int as avg_cache_read,
         avg(cost_usd) as avg_cost,
         max(cost_usd) as max_cost,
         sum(cost_usd) as total_cost
  from ai_token_usage
  group by endpoint, model
  order by sum(cost_usd) desc`;
console.log(
  'endpoint'.padEnd(26), 'model'.padEnd(18), 'calls'.padStart(7),
  'avg_in'.padStart(9), 'avg_out'.padStart(8), 'cacheRd'.padStart(8),
  'avg$'.padStart(10), 'max$'.padStart(10), 'total$'.padStart(11));
for (const r of byEndpoint) {
  console.log(
    String(r.endpoint).slice(0, 25).padEnd(26),
    String(r.model).slice(0, 17).padEnd(18),
    int(r.calls).padStart(7),
    int(r.avg_in).padStart(9),
    int(r.avg_out).padStart(8),
    int(r.avg_cache_read).padStart(8),
    usd(r.avg_cost).padStart(10),
    usd(r.max_cost).padStart(10),
    usd(r.total_cost).padStart(11));
}

console.log('\n=== PER-USER TOTALS (the number that prices a seat) ===');
const perUser = await sql`
  select user_id,
         count(*)::int as calls,
         sum(cost_usd) as total,
         min(created_at) as first,
         max(created_at) as last
  from ai_token_usage
  where user_id is not null
  group by user_id
  order by sum(cost_usd) desc`;
console.log('users with a user_id:', perUser.length);
for (const r of perUser.slice(0, 15)) {
  const days = Math.max(1, Math.round((new Date(r.last) - new Date(r.first)) / 86400000));
  console.log(
    String(r.user_id).slice(0, 8), int(r.calls).padStart(6), 'calls',
    usd(r.total).padStart(10), ` over ${days}d`);
}
if (perUser.length) {
  const totals = perUser.map((r) => Number(r.total)).sort((a, b) => a - b);
  const pct = (p) => totals[Math.min(totals.length - 1, Math.floor(totals.length * p))];
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  console.log('\nper-user cost distribution');
  console.log('  mean   ', usd(mean));
  console.log('  median ', usd(pct(0.5)));
  console.log('  p90    ', usd(pct(0.9)));
  console.log('  max    ', usd(totals[totals.length - 1]));
}

console.log('\n=== ANONYMOUS (no user_id) ===');
const anon = (await sql`
  select count(*)::int as calls, coalesce(sum(cost_usd),0) as total
  from ai_token_usage where user_id is null`)[0];
console.log('calls', int(anon.calls), ' spend', usd(anon.total));

console.log('\n=== CACHE HEADROOM (the margin sitting on the table) ===');
const cache = (await sql`
  select coalesce(sum(input_tokens),0)::bigint as input,
         coalesce(sum(cache_read_input_tokens),0)::bigint as cache_read,
         coalesce(sum(cache_creation_input_tokens),0)::bigint as cache_create
  from ai_token_usage`)[0];
console.log('total input tokens       ', int(cache.input));
console.log('cache READ tokens        ', int(cache.cache_read));
console.log('cache CREATION tokens    ', int(cache.cache_create));
console.log(Number(cache.cache_read) === 0 && Number(cache.cache_create) === 0
  ? '>> prompt caching appears UNUSED. Input tokens are the whole bill.'
  : '>> prompt caching is in use.');

console.log('\n=== ENDPOINTS NEVER MEASURED ===');
const seen = new Set(byEndpoint.map((r) => r.endpoint));
for (const e of ['interview-practice', 'disclosure-guide', 'tailoring', 'job-search',
                 'email-package', 'resume-generate-full', 'coach', 'assistant']) {
  if (!seen.has(e)) console.log('  MISSING:', e);
}
console.log('');
