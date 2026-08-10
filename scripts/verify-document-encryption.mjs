// Phase 1C live verify: encryptString -> decryptString round-trip using the
// REAL DOCUMENT_ENCRYPTION_KEY from apps/consumer/.env.local. Pure crypto --
// no DB, no R2. Never prints the key or the plaintext, only pass/fail.
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../apps/consumer/.env.local', import.meta.url), 'utf8');
const m = env.match(/^DOCUMENT_ENCRYPTION_KEY=["']?([^"'\n]+)/m);
if (!m) {
  console.error('FAIL  DOCUMENT_ENCRYPTION_KEY not found in apps/consumer/.env.local');
  process.exit(1);
}
process.env.DOCUMENT_ENCRYPTION_KEY = m[1];

const { encryptString, decryptString, currentKeyVersion } = await import('../packages/core/dist/crypto.js');

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log('  ok  ' + name);
  else { failures++; console.error('FAIL  ' + name); }
};

try {
  const aad = 'verify-script:document-encryption';
  const plaintext = 'live-round-trip-' + Date.now();

  const enc = encryptString(plaintext, aad);
  check('key version resolved', typeof currentKeyVersion() === 'string' && currentKeyVersion().length > 0);
  check('encryptString returns base64 ciphertext/iv/tag', typeof enc.ciphertext === 'string' && typeof enc.iv === 'string' && typeof enc.tag === 'string');

  const decrypted = decryptString(enc, aad);
  check('decryptString round-trips the original plaintext', decrypted === plaintext);

  let aadMismatchThrew = false;
  try { decryptString(enc, aad + ':wrong'); } catch { aadMismatchThrew = true; }
  check('AAD mismatch throws', aadMismatchThrew);

  console.log(`\n${failures === 0 ? 'ok' : 'fail'} -- live encryptString/decryptString round-trip against the real DOCUMENT_ENCRYPTION_KEY`);
  process.exit(failures === 0 ? 0 : 1);
} catch (err) {
  console.error('FAIL  unexpected error during round-trip (message only, no key/plaintext):', err?.message || err);
  process.exit(1);
}
