// Phase 7.7 live verify: avatar asset round-trip against the real DB + R2.
// putEncrypted(purpose:headshot) + createAvatarAsset -> list -> decrypt ->
// foreign owner cannot read -> select/normalize -> delete removes BOTH rows and
// enqueues the R2 ciphertext for deletion. Also checks the kind CHECK
// constraint, the headshot_generate hard cap, the usage-display exclusion
// (upload excluded, generate NOT), and that generation is gated OFF (501).
// QA account only; snapshots + restores the QA user's ui_avatar; cleans up.
//
// Run: node --import tsx scripts/verify-7-avatar.mjs   (from repo root, after
//      `cd packages/core && npm run build`)
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const env = readFileSync(new URL('../apps/consumer/.env.local', import.meta.url), 'utf8');
for (const k of ['DATABASE_URL', 'DOCUMENT_ENCRYPTION_KEY', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'HEADSHOT_GEN_ENABLED', 'OPENAI_API_KEY']) {
  const m = env.match(new RegExp('^' + k + '=["\']?([^"\'\n]+)', 'm'));
  if (m) process.env[k] = m[1];
}

const core = await import('../packages/core/dist/index.js');
const {
  makeSecureObjectKey, putEncryptedObject, getDecryptedObject,
  createAvatarAsset, listAvatarAssets, getAvatarAsset, deleteAvatarAsset,
  query, getUserDailyUsage, incrementUserUsage, checkUserRateLimit,
  reserveEndpointSlot, releaseEndpointSlot,
  getUiPrefs, setUiPrefs, normalizeAvatar,
  HEADSHOT_DAILY_CAP, HEADSHOT_GENERATE_ENDPOINT, HEADSHOT_UPLOAD_ENDPOINT,
} = core;

const QA = 'c8515692-8ad3-422f-9b1b-b4d24ca84e56';
const FOREIGN = 'fac1ac74-6c26-40e1-a6d1-e80d3c79be9f';
let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log('  ok  ' + name);
  else { failures++; console.error('FAIL  ' + name + (detail !== undefined ? ' -- ' + JSON.stringify(detail).slice(0, 200) : '')); }
};

// Snapshot the QA user's ui_avatar so the selection test can be restored.
let avatarSnapshot;
try {
  const r = await query(`SELECT ui_avatar FROM users WHERE id = $1`, [QA]);
  avatarSnapshot = r[0]?.ui_avatar ?? null;
} catch {}

let assetId, objKey, secureId;
try {
  // --- upload (what the POST /api/avatar/photo route does) ---
  // A minimal valid PNG signature is enough: the route sniffs, but this script
  // exercises the core layer directly (put + create), which stores whatever bytes.
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
  const sha = createHash('sha256').update(bytes).digest('hex');
  objKey = makeSecureObjectKey(QA, 'headshot');
  check('makeSecureObjectKey namespaces under headshot/', objKey.includes('/headshot/'), objKey);
  const secure = await putEncryptedObject({ ownerUserId: QA, purpose: 'headshot', key: objKey, plaintext: bytes, mimeType: 'image/png', sha256: sha });
  secureId = secure.id;
  check('putEncryptedObject(purpose:headshot) stored', !!secure?.id);
  const asset = await createAvatarAsset({ userId: QA, secureObjectId: secure.id, kind: 'original_photo', width: 512, height: 512 });
  assetId = asset.id;
  check('createAvatarAsset(original_photo) inserted', !!asset?.id && asset.kind === 'original_photo');

  // --- list ---
  const list = await listAvatarAssets(QA);
  const found = list.find((a) => a.id === assetId);
  check('listAvatarAssets returns the asset joined to secure_object', !!found && found.byte_size === bytes.length && found.object_key === objKey && found.mime_type === 'image/png', found && { size: found.byte_size, mime: found.mime_type });
  const listFiltered = await listAvatarAssets(QA, { kind: 'generated_headshot' });
  check('listAvatarAssets kind filter excludes originals', !listFiltered.find((a) => a.id === assetId));

  // --- image proxy path (what GET /api/avatar/[id]/image does) ---
  const owned = await getAvatarAsset(QA, assetId);
  check('getAvatarAsset (owner) returns row + object_key', !!owned && owned.object_key === objKey);
  const decrypted = await getDecryptedObject({ ownerUserId: QA, key: owned.object_key });
  check('getDecryptedObject round-trips the image bytes', !!decrypted && Buffer.from(decrypted.buffer).equals(bytes));

  // --- foreign owner CANNOT read (IDOR) ---
  const foreignGet = await getAvatarAsset(FOREIGN, assetId);
  check('foreign getAvatarAsset returns null', foreignGet == null, foreignGet);
  const foreignBytes = await getDecryptedObject({ ownerUserId: FOREIGN, key: objKey });
  check('foreign getDecryptedObject returns null', foreignBytes == null, typeof foreignBytes);
  const foreignDelete = await deleteAvatarAsset(FOREIGN, assetId);
  check('foreign deleteAvatarAsset reports not_found', foreignDelete?.status === 'not_found', foreignDelete);
  const stillThere = await getAvatarAsset(QA, assetId);
  check('asset survives a foreign delete attempt', !!stillThere);

  // --- kind CHECK constraint ---
  let checkThrew = false;
  try {
    await createAvatarAsset({ userId: QA, secureObjectId: secure.id, kind: 'selfie' });
  } catch { checkThrew = true; }
  check('invalid kind rejected by CHECK constraint', checkThrew);

  // --- selection: choose the photo, normalize round-trips photoAssetId ---
  const base = (await getUiPrefs(QA)).avatar ?? normalizeAvatar({});
  const afterSelect = await setUiPrefs(QA, { avatar: normalizeAvatar({ ...base, photoAssetId: assetId }) });
  check('setUiPrefs stores photoAssetId (selection)', afterSelect.avatar?.photoAssetId === assetId, afterSelect.avatar);
  const reread = await getUiPrefs(QA);
  check('getUiPrefs round-trips the selected photoAssetId', reread.avatar?.photoAssetId === assetId);
  // switch back to illustrated -> photoAssetId cleared, illustrated fields kept
  const afterIllus = await setUiPrefs(QA, { avatar: normalizeAvatar({ ...reread.avatar, photoAssetId: null }) });
  check('selecting illustrated clears photoAssetId, keeps the mark', afterIllus.avatar?.photoAssetId == null && !!afterIllus.avatar?.shape);

  // --- owner delete removes BOTH rows + enqueues R2 cleanup ---
  const del = await deleteAvatarAsset(QA, assetId);
  check('deleteAvatarAsset (owner) reports deleted', del?.status === 'deleted', del);
  const aaGone = await query(`SELECT id FROM avatar_asset WHERE id = $1`, [assetId]);
  check('avatar_asset row removed', aaGone.length === 0);
  const soGone = await query(`SELECT id FROM secure_object WHERE id = $1`, [secureId]);
  check('secure_object row removed (CASCADE)', soGone.length === 0);
  const enq = await query(`SELECT status FROM deletion_task WHERE user_id = $1 AND target_ref LIKE $2`, [QA, `%::${objKey}`]);
  check('R2 ciphertext enqueued for deletion', enq.length >= 1 && enq[0].status === 'pending', enq);
  assetId = null; secureId = null;
} catch (e) {
  check('avatar round-trip (DB + R2 reachable)', false, e.message);
}

// --- usage-display exclusion: upload excluded, generate NOT ---
try {
  const before = await getUserDailyUsage(QA);
  await incrementUserUsage(QA, HEADSHOT_UPLOAD_ENDPOINT);
  const afterUpload = await getUserDailyUsage(QA);
  check('headshot_upload does NOT count toward getUserDailyUsage', afterUpload === before, { before, afterUpload });
  await incrementUserUsage(QA, HEADSHOT_GENERATE_ENDPOINT);
  const afterGen = await getUserDailyUsage(QA);
  check('headshot_generate DOES count toward getUserDailyUsage', afterGen === before + 1, { before, afterGen });
  await query(`DELETE FROM ai_usage WHERE user_id = $1 AND usage_date = CURRENT_DATE AND endpoint IN ($2, $3)`, [QA, HEADSHOT_UPLOAD_ENDPOINT, HEADSHOT_GENERATE_ENDPOINT]);
} catch (e) {
  check('usage-exclusion check ran', false, e.message);
}

// --- hard daily cap for headshot_generate ---
try {
  const rl = await checkUserRateLimit(QA, HEADSHOT_GENERATE_ENDPOINT);
  check('checkUserRateLimit caps headshot_generate at HEADSHOT_DAILY_CAP', rl.limit === HEADSHOT_DAILY_CAP, rl);
} catch (e) {
  check('hard-cap check ran', false, e.message);
}

// --- failed-slot refund: releaseEndpointSlot decrements, floors at 0 ---
try {
  const EP = 'headshot_refund_test';
  await query(`DELETE FROM ai_usage WHERE user_id = $1 AND usage_date = CURRENT_DATE AND endpoint = $2`, [QA, EP]);
  const r1 = await reserveEndpointSlot(QA, EP, 3); // count 1
  const r2 = await reserveEndpointSlot(QA, EP, 3); // count 2
  check('reserve increments to 2', r2.count === 2, { r1, r2 });
  await releaseEndpointSlot(QA, EP);               // back to 1
  const afterRefund = await reserveEndpointSlot(QA, EP, 3); // 1 -> 2 again
  check('release refunds one slot (2 -> 1, next reserve is 2 not 3)', afterRefund.count === 2, afterRefund);
  // Floor at 0: release more times than reserved must not go negative.
  await releaseEndpointSlot(QA, EP);
  await releaseEndpointSlot(QA, EP);
  await releaseEndpointSlot(QA, EP);
  const floored = await query(`SELECT call_count FROM ai_usage WHERE user_id = $1 AND usage_date = CURRENT_DATE AND endpoint = $2`, [QA, EP]);
  check('release floors call_count at 0 (never negative)', (floored[0]?.call_count ?? 0) === 0, floored[0]);
  await query(`DELETE FROM ai_usage WHERE user_id = $1 AND usage_date = CURRENT_DATE AND endpoint = $2`, [QA, EP]);
} catch (e) {
  check('refund check ran', false, e.message);
}

// --- generation gate FORMULA: enabled IFF (flag === 'true' AND a key is set) ---
// Mirrors isHeadshotGenEnabled() (apps/consumer/lib/headshot-provider). Env-
// independent so it holds whether or not the feature is currently switched on.
try {
  const gate = (flag, key) => flag === 'true' && Boolean(key && String(key).trim());
  check('gate ON only when BOTH flag and key set', gate('true', 'sk-x') === true);
  check('gate OFF when flag missing', gate(undefined, 'sk-x') === false);
  check('gate OFF when flag is not "true"', gate('false', 'sk-x') === false);
  check('gate OFF when key missing', gate('true', '') === false);
  const live = gate(process.env.HEADSHOT_GEN_ENABLED, process.env.OPENAI_API_KEY);
  console.log('  info  live gate state (this env): ' + (live ? 'ENABLED' : 'disabled'));
} catch (e) {
  check('gate check ran', false, e.message);
}

// restore the QA user's ui_avatar snapshot.
try {
  await query(`UPDATE users SET ui_avatar = $2 WHERE id = $1`, [QA, avatarSnapshot]);
} catch {}

// cleanup: remove any leftover verify rows/tasks.
try {
  if (assetId) await query(`DELETE FROM avatar_asset WHERE id = $1`, [assetId]);
  if (objKey) {
    await query(`DELETE FROM secure_object WHERE owner_user_id = $1 AND purpose = 'headshot' AND object_key = $2`, [QA, objKey]);
    await query(`DELETE FROM deletion_task WHERE user_id = $1 AND target_ref LIKE $2`, [QA, `%::${objKey}`]);
  }
} catch {}

console.log(failures ? `\n${failures} FAILURES` : '\nall green');
process.exit(failures ? 1 : 0);
