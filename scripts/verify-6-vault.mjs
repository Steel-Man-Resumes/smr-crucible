// Phase 6 live verify: vault document round-trip against the real DB + R2.
// upload -> list -> download/decrypt -> foreign owner cannot read -> delete
// removes both rows and enqueues the R2 ciphertext for deletion. Also checks the
// category CHECK constraint and owner-scoped update. QA account only; cleans up.
//
// Run: node --import tsx scripts/verify-6-vault.mjs   (from repo root, after
//      `cd packages/core && npm run build`)
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const env = readFileSync(new URL('../apps/consumer/.env.local', import.meta.url), 'utf8');
for (const k of ['DATABASE_URL', 'DOCUMENT_ENCRYPTION_KEY', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) {
  const m = env.match(new RegExp('^' + k + '=["\']?([^"\'\n]+)', 'm'));
  if (m) process.env[k] = m[1];
}

const core = await import('../packages/core/dist/index.js');
const {
  makeSecureObjectKey, putEncryptedObject, getDecryptedObject,
  createVaultDocument, listVaultDocuments, getVaultDocument,
  updateVaultDocument, deleteVaultDocument, query,
  getUserDailyUsage, incrementUserUsage,
} = core;

const QA = 'c8515692-8ad3-422f-9b1b-b4d24ca84e56';
const FOREIGN = 'fac1ac74-6c26-40e1-a6d1-e80d3c79be9f';
let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log('  ok  ' + name);
  else { failures++; console.error('FAIL  ' + name + (detail !== undefined ? ' -- ' + JSON.stringify(detail).slice(0, 200) : '')); }
};

let docId, objKey, secureId;
try {
  // --- upload (what the POST route does) ---
  const bytes = Buffer.from('%PDF-1.4 vault verify document bytes', 'utf8');
  const sha = createHash('sha256').update(bytes).digest('hex');
  objKey = makeSecureObjectKey(QA, 'vault');
  const secure = await putEncryptedObject({ ownerUserId: QA, purpose: 'vault', key: objKey, plaintext: bytes, mimeType: 'application/pdf', sha256: sha });
  secureId = secure.id;
  check('putEncryptedObject stored', !!secure?.id, secure && Object.keys(secure));
  const doc = await createVaultDocument({ userId: QA, secureObjectId: secure.id, category: 'record', label: 'Verify Doc', originalFilename: 'verify.pdf', note: 'live verify' });
  docId = doc.id;
  check('createVaultDocument inserted', !!doc?.id);

  // --- list ---
  const list = await listVaultDocuments(QA);
  const found = list.find((d) => d.id === docId);
  check('listVaultDocuments returns the doc joined to secure_object', !!found && found.byte_size === bytes.length && found.object_key === objKey, found && { size: found.byte_size, key: found.object_key });

  // --- download / decrypt (what the download route does) ---
  const owned = await getVaultDocument(QA, docId);
  check('getVaultDocument (owner) returns row + object_key', !!owned && owned.object_key === objKey);
  const decrypted = await getDecryptedObject({ ownerUserId: QA, key: owned.object_key });
  check('getDecryptedObject round-trips bytes', !!decrypted && Buffer.from(decrypted.buffer).toString('utf8') === bytes.toString('utf8'));

  // --- foreign owner CANNOT read (IDOR) ---
  const foreignDoc = await getVaultDocument(FOREIGN, docId);
  check('foreign getVaultDocument returns null', foreignDoc == null, foreignDoc);
  const foreignBytes = await getDecryptedObject({ ownerUserId: FOREIGN, key: objKey });
  check('foreign getDecryptedObject returns null', foreignBytes == null, typeof foreignBytes);
  const foreignUpdate = await updateVaultDocument(FOREIGN, docId, { label: 'hacked' });
  check('foreign updateVaultDocument returns null (no cross-owner edit)', foreignUpdate == null, foreignUpdate);
  const foreignDelete = await deleteVaultDocument(FOREIGN, docId);
  check('foreign deleteVaultDocument reports not_found', foreignDelete?.status === 'not_found', foreignDelete);

  // Confirm the foreign delete did NOT remove the real rows.
  const stillThere = await getVaultDocument(QA, docId);
  check('doc survives a foreign delete attempt', !!stillThere);

  // --- category CHECK constraint ---
  let checkThrew = false;
  try {
    await createVaultDocument({ userId: QA, secureObjectId: secure.id, category: 'password', label: 'bad' });
  } catch { checkThrew = true; }
  check('invalid category rejected by CHECK constraint', checkThrew);

  // --- owner delete removes BOTH rows + enqueues R2 cleanup ---
  const del = await deleteVaultDocument(QA, docId);
  check('deleteVaultDocument (owner) reports deleted', del?.status === 'deleted', del);
  const vdGone = await query(`SELECT id FROM vault_document WHERE id = $1`, [docId]);
  check('vault_document row removed', vdGone.length === 0);
  const soGone = await query(`SELECT id FROM secure_object WHERE id = $1`, [secureId]);
  check('secure_object row removed (CASCADE)', soGone.length === 0);
  const enq = await query(`SELECT status FROM deletion_task WHERE user_id = $1 AND target_ref LIKE $2`, [QA, `%::${objKey}`]);
  check('R2 ciphertext enqueued for deletion', enq.length >= 1 && enq[0].status === 'pending', enq);
  docId = null; secureId = null;
} catch (e) {
  check('vault round-trip (DB + R2 reachable)', false, e.message);
}

// --- M1: vault_upload must NOT count toward the displayed AI usage total ---
try {
  const before = await getUserDailyUsage(QA);
  await incrementUserUsage(QA, 'vault_upload');
  const afterVault = await getUserDailyUsage(QA);
  check('vault_upload does NOT count toward getUserDailyUsage', afterVault === before, { before, afterVault });
  // A real (non-vault) endpoint still counts, so the exclusion is not blanket.
  await incrementUserUsage(QA, 'verify_ai_endpoint');
  const afterAi = await getUserDailyUsage(QA);
  check('a real AI endpoint still counts toward getUserDailyUsage', afterAi === before + 1, { before, afterAi });
  // cleanup the synthetic ai_usage rows for today.
  await query(`DELETE FROM ai_usage WHERE user_id = $1 AND usage_date = CURRENT_DATE AND endpoint IN ('vault_upload','verify_ai_endpoint')`, [QA]);
} catch (e) {
  check('M1 usage-exclusion check ran', false, e.message);
}

// cleanup: remove any leftover verify rows/tasks.
try {
  if (docId) await query(`DELETE FROM vault_document WHERE id = $1`, [docId]);
  await query(`DELETE FROM secure_object WHERE owner_user_id = $1 AND purpose = 'vault' AND object_key = $2`, [QA, objKey]);
  await query(`DELETE FROM deletion_task WHERE user_id = $1 AND target_ref LIKE $2`, [QA, `%::${objKey}`]);
} catch {}

console.log(failures ? `\n${failures} FAILURES` : '\nall green');
process.exit(failures ? 1 : 0);
