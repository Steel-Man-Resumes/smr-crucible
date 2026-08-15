// Probe which R2 bucket the existing credentials + new endpoint can write to.
// Puts a tiny object, reads it back, deletes it. Prints per-bucket result.
// No secrets printed.
import { readFileSync } from 'node:fs';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const env = readFileSync(new URL('../apps/consumer/.env.local', import.meta.url), 'utf8');
const val = (k) => (env.match(new RegExp('^' + k + '=["\']?([^"\'\n]+)', 'm')) || [])[1];

const client = new S3Client({
  region: 'auto',
  endpoint: val('R2_ENDPOINT'),
  credentials: { accessKeyId: val('R2_ACCESS_KEY_ID'), secretAccessKey: val('R2_SECRET_ACCESS_KEY') },
});

const buckets = ['crucible-files', 'steelman'];
const key = `__probe/refinery-connectivity-${Date.now()}.txt`;
const body = Buffer.from('r2 connectivity probe -- safe to delete', 'utf8');

for (const Bucket of buckets) {
  try {
    await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: 'text/plain' }));
    const got = await client.send(new GetObjectCommand({ Bucket, Key: key }));
    const read = await got.Body.transformToString();
    const ok = read.startsWith('r2 connectivity probe');
    await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    console.log(`  ${ok ? 'OK  ' : 'READBACK-FAIL'} ${Bucket}  (put + get + delete succeeded)`);
  } catch (e) {
    console.log(`  FAIL ${Bucket}  ${e.name}: ${String(e.message).slice(0, 80)}`);
  }
}
