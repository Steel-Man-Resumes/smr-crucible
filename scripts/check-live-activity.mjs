// One-time pre-deploy check: any user activity in the last 30 minutes?
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../apps/consumer/.env.local', import.meta.url), 'utf8');
const sql = neon(env.match(/^DATABASE_URL=["']?([^"'\n]+)/m)[1]);

async function latest(label, q) {
  try { return [label, (await q)[0]?.t ?? null]; }
  catch (e) { return [label, `error: ${e.message}`]; }
}
const checks = Object.fromEntries(await Promise.all([
  latest('refinery_artifact', sql`select max(updated_at) as t from refinery_artifact`),
  latest('coach_conversation', sql`select max(created_at) as t from coach_conversation`),
  latest('forge_session', sql`select max(updated_at) as t from forge_session`),
  latest('ai_token_usage', sql`select max(created_at) as t from ai_token_usage`),
]));
const now = Date.now();
for (const [table, v] of Object.entries(checks)) {
  if (typeof v === 'string') { console.log(table.padEnd(20), v); continue; }
  const t = v ? new Date(v) : null;
  const minsAgo = t ? Math.round((now - t.getTime()) / 60000) : null;
  console.log(table.padEnd(20), t ? `${t.toISOString()} (${minsAgo} min ago)` : 'no rows');
}
