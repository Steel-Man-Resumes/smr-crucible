// Phase 0.1 one-time live verification of the artifact lock predicate.
// Uses a QA account's artifact only; fully reversible (lock -> attempt -> unlock).
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../apps/consumer/.env.local', import.meta.url), 'utf8');
const sql = neon(env.match(/^DATABASE_URL=["']?([^"'\n]+)/m)[1]);

const QA_USER = 'c8515692-8ad3-422f-9b1b-b4d24ca84e56'; // troyrichardcarr+qafable
const ART = '5faf3699-8c24-4ed1-8c4a-13aed57232a4';

const before = (await sql`select content, is_locked, updated_at from refinery_artifact where id=${ART} and user_id=${QA_USER}`)[0];
console.log('before: locked=', before.is_locked, 'updated_at=', before.updated_at);

await sql`update refinery_artifact set is_locked=true where id=${ART} and user_id=${QA_USER}`;

// The exact statement shape updateArtifact executes (content + predicate)
const rows = await sql`
  UPDATE refinery_artifact
     SET content = ${'{"tamper":"should-not-land"}'}, updated_at = now()
   WHERE id = ${ART} AND user_id = ${QA_USER} AND is_locked = false
   RETURNING id`;
console.log('write attempt while locked -> rows affected:', rows.length, rows.length === 0 ? 'REFUSED (correct)' : 'WROTE (BUG)');

const del = await sql`
  DELETE FROM refinery_artifact
   WHERE id = ${ART} AND user_id = ${QA_USER} AND is_locked = false
   RETURNING id`;
console.log('delete attempt while locked -> rows affected:', del.length, del.length === 0 ? 'REFUSED (correct)' : 'DELETED (BUG)');

await sql`update refinery_artifact set is_locked=false where id=${ART} and user_id=${QA_USER}`;
const after = (await sql`select content, is_locked from refinery_artifact where id=${ART} and user_id=${QA_USER}`)[0];
const intact = JSON.stringify(after.content) === JSON.stringify(before.content);
console.log('restored: locked=', after.is_locked, 'content intact:', intact ? 'YES' : 'NO -- INVESTIGATE');
