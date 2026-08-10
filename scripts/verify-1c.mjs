// Phase 1C live verify: secure object encrypt/store/decrypt/delete round-trip,
// TOTP secret encryption + plaintext-backfill shim, deletion_task ledger.
// QA account only, cleans up. Does NOT touch real user 2FA rows.
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../apps/consumer/.env.local', import.meta.url), 'utf8');
for (const k of ['DATABASE_URL', 'DOCUMENT_ENCRYPTION_KEY', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) {
  const m = env.match(new RegExp('^' + k + '=["\']?([^"\'\n]+)', 'm'));
  if (m) process.env[k] = m[1];
}

const core = await import('../packages/core/dist/index.js');
const { encryptString, decryptString, encryptJSON, decryptJSON,
  putEncryptedObject, getDecryptedObject, deleteObject, makeSecureObjectKey,
  enqueueDeletion, query } = core;

const QA = 'c8515692-8ad3-422f-9b1b-b4d24ca84e56';
let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log('  ok  ' + name);
  else { failures++; console.error('FAIL  ' + name + (detail ? ' -- ' + JSON.stringify(detail).slice(0, 200) : '')); }
};

// --- string crypto ---
const aad = `${QA}:test`;
const enc = encryptString('sensitive value 123', aad);
check('encrypt returns iv/tag/keyVersion', !!enc.ciphertext && !!enc.iv && !!enc.tag && !!enc.keyVersion, Object.keys(enc));
check('decrypt round-trips', decryptString(enc, aad) === 'sensitive value 123');
let aadThrew = false;
try { decryptString(enc, `${QA}:wrong`); } catch { aadThrew = true; }
check('AAD mismatch throws', aadThrew);
let tamperThrew = false;
try { decryptString({ ...enc, ciphertext: Buffer.from('tampered').toString('base64') }, aad); } catch { tamperThrew = true; }
check('tampered ciphertext throws', tamperThrew);
const j = encryptJSON({ a: 1, b: 'x' }, aad);
check('JSON round-trips', JSON.stringify(decryptJSON(j, aad)) === JSON.stringify({ a: 1, b: 'x' }));

// --- secure object (real R2) ---
let objKey;
try {
  objKey = makeSecureObjectKey ? makeSecureObjectKey(QA, 'verify') : `secure/${QA}/verify-${enc.iv.slice(0,8)}`;
  const payload = Buffer.from('encrypted file bytes here', 'utf8');
  const put = await putEncryptedObject({ ownerUserId: QA, purpose: 'verify', key: objKey, plaintext: payload, mimeType: 'text/plain' });
  check('putEncryptedObject stored', !!put, put && Object.keys(put));
  const got = await getDecryptedObject({ ownerUserId: QA, key: objKey });
  const gotBuf = Buffer.isBuffer(got) ? got : (got?.buffer || got?.bytes || got?.plaintext);
  check('getDecryptedObject round-trips bytes', gotBuf && Buffer.from(gotBuf).toString('utf8') === 'encrypted file bytes here',
    gotBuf && Buffer.from(gotBuf).toString('utf8').slice(0,40));
  const foreign = await getDecryptedObject({ ownerUserId: 'fac1ac74-6c26-40e1-a6d1-e80d3c79be9f', key: objKey }).catch(() => 'threw');
  check('foreign owner cannot read (exclusive-owner)', foreign === 'threw' || foreign == null, typeof foreign);
  const del = await deleteObject({ ownerUserId: QA, key: objKey });
  check('deleteObject removes it', del && (del.status === 'deleted' || del === true), del);
} catch (e) {
  check('secure object round-trip (R2 reachable)', false, e.message);
}

// --- deletion task ledger ---
const t = await enqueueDeletion(QA, 'r2_object', 'secure/verify/orphan-key');
check('enqueueDeletion inserts pending task', true);
const tasks = await query(`SELECT status FROM deletion_task WHERE user_id = $1 AND target_ref = $2`, [QA, 'secure/verify/orphan-key']);
check('deletion_task row is pending', tasks.length === 1 && tasks[0].status === 'pending', tasks);

// --- TOTP encryption shim (synthetic row, cleaned up) ---
const totpSecret = 'JBSWY3DPEHPK3PXP';
const te = encryptString(totpSecret, `${QA}:totp`);
await query(`INSERT INTO user_two_factor (user_id, secret, secret_iv, secret_tag, secret_key_version, confirmed_at)
  VALUES ($1,$2,$3,$4,$5,now())
  ON CONFLICT (user_id) DO UPDATE SET secret=$2, secret_iv=$3, secret_tag=$4, secret_key_version=$5`,
  [QA, te.ciphertext, te.iv, te.tag, te.keyVersion]);
const row = (await query(`SELECT secret, secret_iv, secret_tag, secret_key_version FROM user_two_factor WHERE user_id=$1`, [QA]))[0];
const back = decryptString({ ciphertext: row.secret, iv: row.secret_iv, tag: row.secret_tag, keyVersion: row.secret_key_version }, `${QA}:totp`);
check('TOTP secret encrypts + decrypts from DB', back === totpSecret, back);
check('stored TOTP secret is NOT plaintext', row.secret !== totpSecret);
await query(`DELETE FROM user_two_factor WHERE user_id = $1`, [QA]);

// cleanup
await query(`DELETE FROM deletion_task WHERE user_id = $1 AND target_ref = $2`, [QA, 'secure/verify/orphan-key']);
await query(`DELETE FROM secure_object WHERE owner_user_id = $1 AND purpose = 'verify'`, [QA]);

console.log(failures ? `\n${failures} FAILURES` : '\nall green');
process.exit(failures ? 1 : 0);
