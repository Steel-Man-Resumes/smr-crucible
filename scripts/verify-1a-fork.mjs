// Phase 1A live verify rows: IDOR fork rejection, concurrent-fork dedupe,
// locked-master survival. QA artifacts only; cleans up after itself.
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../apps/consumer/.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=["']?([^"'\n]+)/m)[1];

const core = await import('../packages/core/dist/index.js');
const { forkArtifact, updateArtifact, lockBaseline, unlockBaseline, getArtifact } = core;

const OWNER = 'c8515692-8ad3-422f-9b1b-b4d24ca84e56';   // qafable
const FOREIGN = 'fac1ac74-6c26-40e1-a6d1-e80d3c79be9f'; // qasol
const SRC = '5faf3699-8c24-4ed1-8c4a-13aed57232a4';     // qafable resume

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log('  ok  ' + name);
  else { failures++; console.error('FAIL  ' + name + (detail ? ' -- ' + JSON.stringify(detail).slice(0, 200) : '')); }
};

const before = await getArtifact(SRC, OWNER);
await lockBaseline(OWNER, SRC, 'verify-lane');
const locked = await getArtifact(SRC, OWNER);
check('lockBaseline sets approved_at', !!locked.approved_at, locked.approved_at);

// 1. Owner fork with operation key
const f1 = await forkArtifact({ userId: OWNER, sourceArtifactId: SRC, reason: 'verify', operationKey: 'verify-1a' });
check('owner fork succeeds', f1.status === 'forked' && !f1.deduped, f1.status);
check('fork content matches source', JSON.stringify(f1.artifact.content) === JSON.stringify(before.content));
check('fork is unlocked + unpinned', f1.artifact.is_locked === false && f1.artifact.is_current === false);
check('fork lineage set', f1.artifact.parent_artifact_id === SRC && f1.artifact.origin_artifact_id === SRC,
  { parent: f1.artifact.parent_artifact_id, origin: f1.artifact.origin_artifact_id });
check('fork has content_hash + reason', !!f1.artifact.content_hash && f1.artifact.creation_reason === 'verify');

// 2. Duplicate operation key dedupes to the same row
const f2 = await forkArtifact({ userId: OWNER, sourceArtifactId: SRC, reason: 'verify', operationKey: 'verify-1a' });
check('duplicate operationKey dedupes', f2.status === 'forked' && f2.deduped && f2.artifact.id === f1.artifact.id,
  { s: f2.status, deduped: f2.deduped });

// 3. IDOR: foreign user cannot fork
const f3 = await forkArtifact({ userId: FOREIGN, sourceArtifactId: SRC, reason: 'verify', operationKey: 'verify-idor' });
check('foreign user fork rejected (IDOR)', f3.status === 'not_found', f3.status);

// 4. Edit the fork; locked master must survive untouched
const edit = await updateArtifact(f1.artifact.id, OWNER, { tampered: 'fork-edit', formatVersion: 2 });
check('fork is editable', edit.status === 'updated', edit.status);
const masterAfter = await getArtifact(SRC, OWNER);
check('locked master content unchanged', JSON.stringify(masterAfter.content) === JSON.stringify(before.content));
const editMaster = await updateArtifact(SRC, OWNER, { tampered: 'master-write' });
check('locked master still refuses direct writes', editMaster.status === 'locked', editMaster.status);

// Cleanup: remove fork, unlock master, clear verify lane
const { query } = core;
await query('DELETE FROM refinery_artifact WHERE id = $1 AND user_id = $2', [f1.artifact.id, OWNER]);
await unlockBaseline(OWNER, SRC);
await query('UPDATE refinery_artifact SET lane = NULL, approved_at = NULL WHERE id = $1', [SRC]);
const restored = await getArtifact(SRC, OWNER);
check('cleanup: master unlocked + content intact',
  restored.is_locked === false && JSON.stringify(restored.content) === JSON.stringify(before.content));

console.log(failures ? `\n${failures} FAILURES` : '\nall green');
process.exit(failures ? 1 : 0);
