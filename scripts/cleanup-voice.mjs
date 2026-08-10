import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../apps/consumer/.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=["']?([^"'\n]+)/m)[1];
const { query } = await import('../packages/core/dist/index.js');
const r = await query(`DELETE FROM voice_session WHERE user_id = $1 RETURNING id`, ['c8515692-8ad3-422f-9b1b-b4d24ca84e56']);
console.log('cleaned', r.length, 'voice sessions');
