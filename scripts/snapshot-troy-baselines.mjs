// Phase 0.2 -- one-time snapshot of Troy's artifacts to a location OUTSIDE the repo.
// Reads DATABASE_URL from apps/consumer/.env.local. Writes JSON to ~/refinery-snapshots/<date>/.
// Read-only against the DB.
import { neon } from '@neondatabase/serverless';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const env = readFileSync(new URL('../apps/consumer/.env.local', import.meta.url), 'utf8');
const m = env.match(/^DATABASE_URL=["']?([^"'\n]+)/m);
if (!m) throw new Error('DATABASE_URL not found');
const sql = neon(m[1]);

const outDir = join(homedir(), 'refinery-snapshots', '2026-08-10');
mkdirSync(outDir, { recursive: true });

const users = await sql`
  select id, email, name from users
  where email ilike '%troy%' or email ilike '%carr%'
`;
console.log('users matched:', users.map(u => `${u.id} ${u.email}`));

for (const u of users) {
  const artifacts = await sql`
    select * from refinery_artifact where user_id = ${u.id} order by created_at
  `;
  const file = join(outDir, `artifacts-${u.id}.json`);
  writeFileSync(file, JSON.stringify({ user: u, exported_at: new Date().toISOString(), artifacts }, null, 2));
  console.log(`${u.email}: ${artifacts.length} artifacts -> ${file}`);
  for (const a of artifacts) {
    const content = typeof a.content === 'string' ? a.content : JSON.stringify(a.content ?? '');
    console.log(
      [
        a.id,
        (a.type ?? a.kind ?? '?').toString().padEnd(14),
        `locked=${a.is_locked ?? 'n/a'}`,
        `lane=${a.lane ?? '-'}`,
        `current=${a.is_current ?? '-'}`,
        `len=${content.length}`,
        `updated=${a.updated_at ?? a.created_at}`,
        JSON.stringify((a.title ?? a.name ?? '').toString().slice(0, 60)),
      ].join('  ')
    );
  }
}
